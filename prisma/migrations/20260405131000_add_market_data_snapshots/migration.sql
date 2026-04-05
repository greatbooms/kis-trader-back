CREATE TABLE "market_data_snapshots" (
    "id" TEXT NOT NULL,
    "snapshot_key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "market" TEXT,
    "exchange_code" TEXT,
    "stock_code" TEXT,
    "data" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_data_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "market_data_snapshots_snapshot_key_key" ON "market_data_snapshots"("snapshot_key");
CREATE INDEX "market_data_snapshots_source_category_idx" ON "market_data_snapshots"("source", "category");
CREATE INDEX "market_data_snapshots_market_exchange_code_stock_code_idx" ON "market_data_snapshots"("market", "exchange_code", "stock_code");
