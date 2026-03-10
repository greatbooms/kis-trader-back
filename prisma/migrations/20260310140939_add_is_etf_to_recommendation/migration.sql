-- AlterTable
ALTER TABLE "stock_recommendations" ADD COLUMN     "is_etf" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "stock_recommendations_screening_date_market_is_etf_idx" ON "stock_recommendations"("screening_date", "market", "is_etf");
