-- AlterTable
ALTER TABLE "stock_recommendations" ALTER COLUMN "risk_supply_score" DROP DEFAULT;

-- CreateTable
CREATE TABLE "day_trade_candidates" (
    "id" TEXT NOT NULL,
    "screening_date" TEXT NOT NULL,
    "market" "Market" NOT NULL,
    "exchange_code" TEXT NOT NULL,
    "stock_code" TEXT NOT NULL,
    "stock_name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" DECIMAL(6,2) NOT NULL,
    "prev_range_pct" DECIMAL(8,4) NOT NULL,
    "atr_pct" DECIMAL(8,4) NOT NULL,
    "avg_trade_value_20d" BIGINT NOT NULL,
    "above_ma20" BOOLEAN NOT NULL,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "exclude_reason" TEXT,
    "simulation_session_id" TEXT,
    "indicators" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "day_trade_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "day_trade_candidates_screening_date_market_idx" ON "day_trade_candidates"("screening_date", "market");

-- CreateIndex
CREATE UNIQUE INDEX "day_trade_candidates_screening_date_market_stock_code_key" ON "day_trade_candidates"("screening_date", "market", "stock_code");
