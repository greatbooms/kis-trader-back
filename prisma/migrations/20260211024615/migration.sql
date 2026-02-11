-- CreateEnum
CREATE TYPE "MarketRegime" AS ENUM ('TRENDING_UP', 'SIDEWAYS', 'TRENDING_DOWN');

-- AlterTable
ALTER TABLE "watch_stocks" ADD COLUMN     "strategy_params" JSONB;

-- CreateTable
CREATE TABLE "market_regime_snapshots" (
    "id" TEXT NOT NULL,
    "market" "Market" NOT NULL,
    "exchange_code" TEXT NOT NULL,
    "regime" "MarketRegime" NOT NULL,
    "adx" DECIMAL(8,4) NOT NULL,
    "ma20" DECIMAL(16,4) NOT NULL,
    "ma60" DECIMAL(16,4) NOT NULL,
    "index_price" DECIMAL(16,4) NOT NULL,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_regime_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_snapshots" (
    "id" TEXT NOT NULL,
    "market" "Market" NOT NULL,
    "snapshot_date" TEXT NOT NULL,
    "portfolio_value" DECIMAL(16,4) NOT NULL,
    "cash_balance" DECIMAL(16,4) NOT NULL,
    "daily_pnl" DECIMAL(16,4) NOT NULL,
    "daily_pnl_rate" DECIMAL(8,6) NOT NULL,
    "drawdown" DECIMAL(8,6) NOT NULL,
    "peak_value" DECIMAL(16,4) NOT NULL,
    "position_count" INTEGER NOT NULL,
    "invested_rate" DECIMAL(8,6) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_allocations" (
    "id" TEXT NOT NULL,
    "market" "Market" NOT NULL,
    "strategy_name" TEXT NOT NULL,
    "allocation_rate" DECIMAL(4,3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strategy_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "risk_snapshots_market_snapshot_date_key" ON "risk_snapshots"("market", "snapshot_date");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_allocations_market_strategy_name_key" ON "strategy_allocations"("market", "strategy_name");
