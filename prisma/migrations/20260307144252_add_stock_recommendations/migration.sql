-- CreateTable
CREATE TABLE "stock_recommendations" (
    "id" TEXT NOT NULL,
    "screening_date" TEXT NOT NULL,
    "market" "Market" NOT NULL,
    "exchange_code" TEXT NOT NULL,
    "stock_code" TEXT NOT NULL,
    "stock_name" TEXT NOT NULL,
    "total_score" DECIMAL(6,2) NOT NULL,
    "technical_score" DECIMAL(6,2) NOT NULL,
    "fundamental_score" DECIMAL(6,2) NOT NULL,
    "momentum_score" DECIMAL(6,2) NOT NULL,
    "rank" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL,
    "indicators" JSONB NOT NULL,
    "current_price" DECIMAL(16,4) NOT NULL,
    "change_rate" DECIMAL(8,4) NOT NULL,
    "volume" BIGINT NOT NULL DEFAULT 0,
    "market_cap" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_recommendations_screening_date_market_idx" ON "stock_recommendations"("screening_date", "market");

-- CreateIndex
CREATE UNIQUE INDEX "stock_recommendations_screening_date_market_stock_code_key" ON "stock_recommendations"("screening_date", "market", "stock_code");
