TRUNCATE TABLE
  "simulation_snapshots",
  "simulation_positions",
  "simulation_trades",
  "simulation_watch_stocks",
  "simulation_sessions"
CASCADE;

CREATE TYPE "SimulationTradeStatus" AS ENUM ('EXECUTED', 'FAILED');

ALTER TABLE "simulation_sessions"
ADD COLUMN "exchange_code" TEXT NOT NULL,
ADD COLUMN "stock_code" TEXT NOT NULL,
ADD COLUMN "stock_name" TEXT NOT NULL,
ADD COLUMN "quota" DECIMAL(12,2),
ADD COLUMN "cycle" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "max_cycles" INTEGER NOT NULL DEFAULT 40,
ADD COLUMN "stop_loss_rate" DECIMAL(4,3) NOT NULL DEFAULT 0.3,
ADD COLUMN "max_portfolio_rate" DECIMAL(4,3) NOT NULL DEFAULT 0.2,
ADD COLUMN "strategy_params" JSONB;

ALTER TABLE "simulation_trades"
ADD COLUMN "trade_status" "SimulationTradeStatus" NOT NULL DEFAULT 'EXECUTED',
ADD COLUMN "fail_reason" TEXT;

DROP TABLE "simulation_watch_stocks";
