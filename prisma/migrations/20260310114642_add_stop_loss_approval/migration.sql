-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'AWAITING_APPROVAL';

-- CreateTable
CREATE TABLE "stop_loss_approvals" (
    "id" TEXT NOT NULL,
    "trade_record_id" TEXT NOT NULL,
    "market" "Market" NOT NULL,
    "exchange_code" TEXT,
    "stock_code" TEXT NOT NULL,
    "stock_name" TEXT NOT NULL,
    "strategy_name" TEXT,
    "signal" JSONB NOT NULL,
    "current_price" DECIMAL(16,4) NOT NULL,
    "avg_price" DECIMAL(16,4) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "loss_rate" DECIMAL(8,6) NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "slack_message_ts" TEXT,
    "slack_channel" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),
    "timeout_minutes" INTEGER NOT NULL DEFAULT 5,

    CONSTRAINT "stop_loss_approvals_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "stop_loss_approvals" ADD CONSTRAINT "stop_loss_approvals_trade_record_id_fkey" FOREIGN KEY ("trade_record_id") REFERENCES "trade_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
