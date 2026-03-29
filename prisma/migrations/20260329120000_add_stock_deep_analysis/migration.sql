-- AlterTable
ALTER TABLE "stock_recommendations"
ADD COLUMN "factor_scores" JSONB,
ADD COLUMN "deep_analysis_id" TEXT;

-- CreateTable
CREATE TABLE "stock_deep_analyses" (
    "id" TEXT NOT NULL,
    "screening_date" TEXT NOT NULL,
    "stock_code" TEXT NOT NULL,
    "stock_name" TEXT NOT NULL,
    "exchange_code" TEXT NOT NULL,
    "market" "Market" NOT NULL,
    "intrinsic_value" DECIMAL(16,4),
    "margin_of_safety" DECIMAL(8,4),
    "dcf_detail" JSONB,
    "risk_grade" TEXT,
    "volatility_30d" DECIMAL(8,4),
    "max_drawdown_90d" DECIMAL(8,4),
    "risk_detail" JSONB,
    "trend_direction" TEXT,
    "technical_detail" JSONB,
    "dividend_yield" DECIMAL(8,4),
    "consecutive_dividend_years" INTEGER,
    "dividend_detail" JSONB,
    "target_price" DECIMAL(16,4),
    "target_upside" DECIMAL(8,4),
    "consensus_rating" TEXT,
    "consensus_detail" JSONB,
    "report_summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_deep_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_deep_analyses_screening_date_exchange_code_stock_code_key" ON "stock_deep_analyses"("screening_date", "exchange_code", "stock_code");

-- CreateIndex
CREATE INDEX "stock_deep_analyses_screening_date_market_idx" ON "stock_deep_analyses"("screening_date", "market");
