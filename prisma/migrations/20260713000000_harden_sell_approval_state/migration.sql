-- Extend existing enums before any rows use the new values.
ALTER TYPE "OrderStatus" ADD VALUE 'SUBMITTING';
ALTER TYPE "OrderStatus" ADD VALUE 'SUBMISSION_UNKNOWN';
ALTER TYPE "WatchStockExecutionEventType" ADD VALUE 'ORDER_SUBMISSION_UNKNOWN';
ALTER TYPE "WatchStockExecutionEventType" ADD VALUE 'ORDER_RECONCILIATION';

-- CreateEnum
CREATE TYPE "BrokerEnvironment" AS ENUM ('PAPER', 'PROD');

-- CreateEnum
CREATE TYPE "SubmissionResolution" AS ENUM (
  'LINKED_BROKER_ORDER',
  'CONFIRMED_NOT_SUBMITTED',
  'MATCHED_EXISTING_TRADE_RECORD'
);

-- CreateEnum
CREATE TYPE "CancellationAttemptStatus" AS ENUM (
  'SUBMITTING',
  'ACCEPTED',
  'REJECTED',
  'UNKNOWN',
  'RESOLVED'
);

-- CreateEnum
CREATE TYPE "BrokerOrderActionChannel" AS ENUM ('SYSTEM', 'SLACK', 'WEB');

-- CreateEnum
CREATE TYPE "BrokerOrderAction" AS ENUM (
  'UNKNOWN_DETECTED',
  'LEGACY_CONTEXT_ASSIGNED',
  'CANDIDATES_INSPECTED',
  'BROKER_ORDER_LINKED',
  'CONFIRMED_NOT_SUBMITTED',
  'MATCHED_EXISTING_TRADE_RECORD',
  'CANCELLATION_UNKNOWN',
  'CANCELLATION_RECONCILED',
  'CANCELLATION_NOT_ACCEPTED'
);

-- Add nullable TradeRecord state first so historical rows remain representable.
ALTER TABLE "trade_records"
  ADD COLUMN "submission_started_at" TIMESTAMP(3),
  ADD COLUMN "broker_order_date" TEXT,
  ADD COLUMN "broker_order_time" TEXT,
  ADD COLUMN "broker_environment" "BrokerEnvironment",
  ADD COLUMN "broker_account_hash" TEXT,
  ADD COLUMN "broker_message" TEXT,
  ADD COLUMN "submission_resolved_at" TIMESTAMP(3),
  ADD COLUMN "submission_resolved_by" TEXT,
  ADD COLUMN "submission_resolution" "SubmissionResolution",
  ADD COLUMN "cancellation_status" "CancellationAttemptStatus",
  ADD COLUMN "cancellation_started_at" TIMESTAMP(3),
  ADD COLUMN "cancellation_resolved_at" TIMESTAMP(3),
  ADD COLUMN "cancellation_resolved_by" TEXT,
  ADD COLUMN "cancellation_message" TEXT;

-- expires_at remains nullable until every historical approval has been backfilled.
ALTER TABLE "stop_loss_approvals"
  ADD COLUMN "expires_at" TIMESTAMP(3),
  ADD COLUMN "notified_at" TIMESTAMP(3),
  ADD COLUMN "responded_by" TEXT;

-- CreateTable
CREATE TABLE "broker_order_action_audit_logs" (
  "id" TEXT NOT NULL,
  "trade_record_id" TEXT NOT NULL,
  "channel" "BrokerOrderActionChannel" NOT NULL,
  "action" "BrokerOrderAction" NOT NULL,
  "actor" TEXT NOT NULL,
  "broker_order_date" TEXT,
  "exchange_code" TEXT,
  "order_no" TEXT,
  "before_status" "OrderStatus",
  "after_status" "OrderStatus",
  "details" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "broker_order_action_audit_logs_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "broker_order_action_audit_logs"
ADD CONSTRAINT "broker_order_action_audit_logs_trade_record_id_fkey"
FOREIGN KEY ("trade_record_id") REFERENCES "trade_records"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill every approval, regardless of status, from its historical timeout.
UPDATE "stop_loss_approvals"
SET "expires_at" = "requested_at" + ("timeout_minutes" * INTERVAL '1 minute');

-- No pre-migration pending approval remains authoritative.
UPDATE "stop_loss_approvals"
SET "status" = 'EXPIRED'
WHERE "status" = 'PENDING';

-- An approved awaiting trade may have crossed the old submit crash window.
WITH migrated AS (
  UPDATE "trade_records" AS trade
  SET
    "status" = 'SUBMISSION_UNKNOWN',
    "submission_started_at" = (
      SELECT approval."responded_at"
      FROM "stop_loss_approvals" AS approval
      WHERE approval."trade_record_id" = trade."id"
        AND approval."status" = 'APPROVED'
      ORDER BY approval."responded_at" DESC NULLS LAST, approval."id" DESC
      LIMIT 1
    )
  WHERE trade."status" = 'AWAITING_APPROVAL'
    AND EXISTS (
      SELECT 1
      FROM "stop_loss_approvals" AS approval
      WHERE approval."trade_record_id" = trade."id"
        AND approval."status" = 'APPROVED'
    )
  RETURNING trade."id", trade."broker_order_date", trade."exchange_code", trade."order_no"
)
INSERT INTO "broker_order_action_audit_logs" (
  "id", "trade_record_id", "channel", "action", "actor", "broker_order_date",
  "exchange_code", "order_no", "before_status", "after_status", "details"
)
SELECT
  'migration-20260713000000-approved-' || migrated."id",
  migrated."id",
  'SYSTEM',
  'UNKNOWN_DETECTED',
  'migration:20260713000000',
  migrated."broker_order_date",
  migrated."exchange_code",
  migrated."order_no",
  'AWAITING_APPROVAL',
  'SUBMISSION_UNKNOWN',
  jsonb_build_object('classification', 'approved_awaiting_approval')
FROM migrated;

-- Orphan awaiting trades and those with only non-approved decisions are safe to cancel.
UPDATE "trade_records"
SET "status" = 'CANCELLED'
WHERE "status" = 'AWAITING_APPROVAL';

-- A pre-migration PENDING row without an order number is a possible accepted order.
WITH migrated AS (
  UPDATE "trade_records" AS trade
  SET
    "status" = 'SUBMISSION_UNKNOWN',
    "submission_started_at" = trade."created_at"
  WHERE trade."status" = 'PENDING'
    AND trade."order_no" IS NULL
  RETURNING trade."id", trade."broker_order_date", trade."exchange_code", trade."order_no"
)
INSERT INTO "broker_order_action_audit_logs" (
  "id", "trade_record_id", "channel", "action", "actor", "broker_order_date",
  "exchange_code", "order_no", "before_status", "after_status", "details"
)
SELECT
  'migration-20260713000000-pending-' || migrated."id",
  migrated."id",
  'SYSTEM',
  'UNKNOWN_DETECTED',
  'migration:20260713000000',
  migrated."broker_order_date",
  migrated."exchange_code",
  migrated."order_no",
  'PENDING',
  'SUBMISSION_UNKNOWN',
  jsonb_build_object('classification', 'pending_without_order_number')
FROM migrated;

-- Recent FAILED rows could be flattened transport ambiguity in the old code.
WITH migrated AS (
  UPDATE "trade_records" AS trade
  SET
    "status" = 'SUBMISSION_UNKNOWN',
    "submission_started_at" = trade."created_at"
  WHERE trade."status" = 'FAILED'
    AND trade."order_no" IS NULL
    AND trade."created_at" >= CURRENT_TIMESTAMP - INTERVAL '30 days'
  RETURNING trade."id", trade."broker_order_date", trade."exchange_code", trade."order_no"
)
INSERT INTO "broker_order_action_audit_logs" (
  "id", "trade_record_id", "channel", "action", "actor", "broker_order_date",
  "exchange_code", "order_no", "before_status", "after_status", "details"
)
SELECT
  'migration-20260713000000-failed-' || migrated."id",
  migrated."id",
  'SYSTEM',
  'UNKNOWN_DETECTED',
  'migration:20260713000000',
  migrated."broker_order_date",
  migrated."exchange_code",
  migrated."order_no",
  'FAILED',
  'SUBMISSION_UNKNOWN',
  jsonb_build_object('classification', 'recent_failed_without_order_number')
FROM migrated;

-- New approvals always use ten minutes; historical expiry calculations above retain old values.
ALTER TABLE "stop_loss_approvals"
  ALTER COLUMN "timeout_minutes" SET DEFAULT 10,
  ALTER COLUMN "expires_at" SET NOT NULL;

-- CreateIndex
CREATE INDEX "stop_loss_approvals_active_lookup_idx"
ON "stop_loss_approvals" ("market", "exchange_code", "stock_code", "status", "expires_at");

-- CreateIndex
CREATE INDEX "stop_loss_approvals_cooldown_lookup_idx"
ON "stop_loss_approvals" ("market", "exchange_code", "stock_code", "notified_at");

-- CreateIndex
CREATE INDEX "broker_order_action_audit_logs_trade_record_id_created_at_idx"
ON "broker_order_action_audit_logs" ("trade_record_id", "created_at");

-- Concurrent approval creators may leave only one active row per instrument.
CREATE UNIQUE INDEX "stop_loss_approvals_one_pending_per_instrument"
ON "stop_loss_approvals" ("market", "exchange_code", "stock_code")
WHERE "status" = 'PENDING';

-- Historical rows stay nullable; only complete broker identities participate.
CREATE UNIQUE INDEX "trade_records_broker_identity_unique"
ON "trade_records" (
  "broker_environment", "broker_account_hash", "market",
  "exchange_code", "broker_order_date", "order_no"
)
WHERE "broker_environment" IS NOT NULL
  AND "broker_account_hash" IS NOT NULL
  AND "broker_order_date" IS NOT NULL
  AND "order_no" IS NOT NULL;
