-- CreateEnum
CREATE TYPE "Broker" AS ENUM ('KIS', 'TOSS');

-- AlterTable
ALTER TABLE "trade_records" ADD COLUMN "broker" "Broker" NOT NULL DEFAULT 'KIS';
ALTER TABLE "positions" ADD COLUMN "broker" "Broker" NOT NULL DEFAULT 'KIS';
ALTER TABLE "watch_stocks" ADD COLUMN "broker" "Broker" NOT NULL DEFAULT 'KIS';
ALTER TABLE "risk_snapshots" ADD COLUMN "broker" "Broker" NOT NULL DEFAULT 'KIS';
ALTER TABLE "strategy_allocations" ADD COLUMN "broker" "Broker" NOT NULL DEFAULT 'KIS';

-- Expand/contract: retain legacy unique indexes for rollback compatibility with
-- the pre-broker binary. Drop them in a Phase 2 migration when TOSS rows are introduced.

-- CreateIndex
CREATE UNIQUE INDEX "positions_broker_market_exchange_code_stock_code_key" ON "positions"("broker", "market", "exchange_code", "stock_code");
CREATE UNIQUE INDEX "watch_stocks_broker_market_exchange_code_stock_code_key" ON "watch_stocks"("broker", "market", "exchange_code", "stock_code");
CREATE UNIQUE INDEX "risk_snapshots_broker_market_snapshot_date_key" ON "risk_snapshots"("broker", "market", "snapshot_date");
CREATE UNIQUE INDEX "strategy_allocations_broker_market_strategy_name_key" ON "strategy_allocations"("broker", "market", "strategy_name");
