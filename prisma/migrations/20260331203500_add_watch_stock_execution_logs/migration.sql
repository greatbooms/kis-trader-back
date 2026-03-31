-- CreateEnum
CREATE TYPE "WatchStockExecutionEventType" AS ENUM (
  'SKIPPED',
  'SIGNAL_CREATED',
  'ORDER_SUBMITTED',
  'ORDER_FILLED',
  'ORDER_FAILED',
  'ORDER_AWAITING_APPROVAL',
  'ORDER_CANCELLED',
  'ERROR'
);

-- CreateTable
CREATE TABLE "watch_stock_execution_logs" (
  "id" TEXT NOT NULL,
  "watch_stock_id" TEXT NOT NULL,
  "trade_record_id" TEXT,
  "market" "Market" NOT NULL,
  "exchange_code" TEXT NOT NULL,
  "stock_code" TEXT NOT NULL,
  "stock_name" TEXT NOT NULL,
  "strategy_name" TEXT,
  "event_type" "WatchStockExecutionEventType" NOT NULL,
  "message" TEXT NOT NULL,
  "details" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "watch_stock_execution_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "watch_stock_execution_logs_watch_stock_id_created_at_idx"
ON "watch_stock_execution_logs"("watch_stock_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "watch_stock_execution_logs_stock_code_created_at_idx"
ON "watch_stock_execution_logs"("stock_code", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "watch_stock_execution_logs"
ADD CONSTRAINT "watch_stock_execution_logs_watch_stock_id_fkey"
FOREIGN KEY ("watch_stock_id") REFERENCES "watch_stocks"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch_stock_execution_logs"
ADD CONSTRAINT "watch_stock_execution_logs_trade_record_id_fkey"
FOREIGN KEY ("trade_record_id") REFERENCES "trade_records"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
