-- Backfill NULL exchange_code values
UPDATE watch_stocks SET exchange_code = 'KRX' WHERE market = 'DOMESTIC' AND exchange_code IS NULL;

UPDATE positions SET exchange_code = 'KRX' WHERE market = 'DOMESTIC' AND exchange_code IS NULL;

UPDATE trade_records SET exchange_code = 'KRX' WHERE market = 'DOMESTIC' AND exchange_code IS NULL;

UPDATE stop_loss_approvals SET exchange_code = 'KRX' WHERE market = 'DOMESTIC' AND exchange_code IS NULL;

UPDATE simulation_watch_stocks SET exchange_code = 'KRX' WHERE market = 'DOMESTIC' AND exchange_code IS NULL;

UPDATE simulation_positions SET exchange_code = 'KRX' WHERE market = 'DOMESTIC' AND exchange_code IS NULL;

UPDATE simulation_trades SET exchange_code = 'KRX' WHERE market = 'DOMESTIC' AND exchange_code IS NULL;

DO $$
DECLARE
  unresolved_tables text[];
BEGIN
  SELECT array_remove(
    ARRAY[
      CASE WHEN EXISTS (SELECT 1 FROM watch_stocks WHERE market = 'OVERSEAS' AND exchange_code IS NULL) THEN 'watch_stocks' END,
      CASE WHEN EXISTS (SELECT 1 FROM positions WHERE market = 'OVERSEAS' AND exchange_code IS NULL) THEN 'positions' END,
      CASE WHEN EXISTS (SELECT 1 FROM trade_records WHERE market = 'OVERSEAS' AND exchange_code IS NULL) THEN 'trade_records' END,
      CASE WHEN EXISTS (SELECT 1 FROM stop_loss_approvals WHERE market = 'OVERSEAS' AND exchange_code IS NULL) THEN 'stop_loss_approvals' END,
      CASE WHEN EXISTS (SELECT 1 FROM simulation_watch_stocks WHERE market = 'OVERSEAS' AND exchange_code IS NULL) THEN 'simulation_watch_stocks' END,
      CASE WHEN EXISTS (SELECT 1 FROM simulation_positions WHERE market = 'OVERSEAS' AND exchange_code IS NULL) THEN 'simulation_positions' END,
      CASE WHEN EXISTS (SELECT 1 FROM simulation_trades WHERE market = 'OVERSEAS' AND exchange_code IS NULL) THEN 'simulation_trades' END
    ],
    NULL
  ) INTO unresolved_tables;

  IF COALESCE(array_length(unresolved_tables, 1), 0) > 0 THEN
    RAISE EXCEPTION
      'Found OVERSEAS rows with NULL exchange_code in: %. Backfill actual exchange_code values before applying this migration.',
      array_to_string(unresolved_tables, ', ');
  END IF;
END $$;

-- Make exchange_code NOT NULL
ALTER TABLE "watch_stocks" ALTER COLUMN "exchange_code" SET NOT NULL;
ALTER TABLE "positions" ALTER COLUMN "exchange_code" SET NOT NULL;
ALTER TABLE "trade_records" ALTER COLUMN "exchange_code" SET NOT NULL;
ALTER TABLE "stop_loss_approvals" ALTER COLUMN "exchange_code" SET NOT NULL;
ALTER TABLE "simulation_watch_stocks" ALTER COLUMN "exchange_code" SET NOT NULL;
ALTER TABLE "simulation_positions" ALTER COLUMN "exchange_code" SET NOT NULL;
ALTER TABLE "simulation_trades" ALTER COLUMN "exchange_code" SET NOT NULL;

-- Update unique constraints to include exchange_code
DROP INDEX IF EXISTS "watch_stocks_market_stock_code_key";
CREATE UNIQUE INDEX "watch_stocks_market_exchange_code_stock_code_key" ON "watch_stocks"("market", "exchange_code", "stock_code");

DROP INDEX IF EXISTS "positions_market_stock_code_key";
CREATE UNIQUE INDEX "positions_market_exchange_code_stock_code_key" ON "positions"("market", "exchange_code", "stock_code");

DROP INDEX IF EXISTS "simulation_watch_stocks_session_id_stock_code_key";
CREATE UNIQUE INDEX "simulation_watch_stocks_session_id_exchange_code_stock_code_key" ON "simulation_watch_stocks"("session_id", "exchange_code", "stock_code");

DROP INDEX IF EXISTS "simulation_positions_session_id_stock_code_key";
CREATE UNIQUE INDEX "simulation_positions_session_id_exchange_code_stock_code_key" ON "simulation_positions"("session_id", "exchange_code", "stock_code");
