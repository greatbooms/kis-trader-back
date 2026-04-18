-- CreateTable
CREATE TABLE "historical_daily_prices" (
    "id" TEXT NOT NULL,
    "market" "Market" NOT NULL,
    "exchange_code" TEXT NOT NULL,
    "stock_code" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "open" DECIMAL(16,4) NOT NULL,
    "high" DECIMAL(16,4) NOT NULL,
    "low" DECIMAL(16,4) NOT NULL,
    "close" DECIMAL(16,4) NOT NULL,
    "volume" BIGINT NOT NULL,
    "amount" DECIMAL(20,2),
    "adjusted" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "historical_daily_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "historical_daily_prices_market_exchange_code_stock_code_dat_key"
    ON "historical_daily_prices"("market", "exchange_code", "stock_code", "date");

-- CreateIndex
CREATE INDEX "historical_daily_prices_stock_code_date_idx"
    ON "historical_daily_prices"("stock_code", "date");
