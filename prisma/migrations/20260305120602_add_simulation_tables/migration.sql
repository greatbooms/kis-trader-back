-- CreateEnum
CREATE TYPE "SimulationStatus" AS ENUM ('RUNNING', 'PAUSED', 'COMPLETED');

-- CreateTable
CREATE TABLE "simulation_sessions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "market" "Market" NOT NULL,
    "strategy_name" TEXT NOT NULL,
    "status" "SimulationStatus" NOT NULL DEFAULT 'RUNNING',
    "initial_capital" DECIMAL(16,4) NOT NULL,
    "current_cash" DECIMAL(16,4) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stopped_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "simulation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulation_watch_stocks" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "market" "Market" NOT NULL,
    "exchange_code" TEXT,
    "stock_code" TEXT NOT NULL,
    "stock_name" TEXT NOT NULL,
    "quota" DECIMAL(12,2),
    "cycle" INTEGER NOT NULL DEFAULT 0,
    "max_cycles" INTEGER NOT NULL DEFAULT 40,
    "stop_loss_rate" DECIMAL(4,3) NOT NULL DEFAULT 0.3,
    "max_portfolio_rate" DECIMAL(4,3) NOT NULL DEFAULT 0.2,
    "strategy_params" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "simulation_watch_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulation_trades" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "market" "Market" NOT NULL,
    "exchange_code" TEXT,
    "stock_code" TEXT NOT NULL,
    "stock_name" TEXT NOT NULL,
    "side" "Side" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DECIMAL(16,4) NOT NULL,
    "total_amount" DECIMAL(16,4) NOT NULL,
    "strategy_name" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulation_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulation_positions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "market" "Market" NOT NULL,
    "exchange_code" TEXT,
    "stock_code" TEXT NOT NULL,
    "stock_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "avg_price" DECIMAL(16,4) NOT NULL,
    "current_price" DECIMAL(16,4) NOT NULL,
    "total_invested" DECIMAL(16,4) NOT NULL,
    "profit_loss" DECIMAL(16,4) NOT NULL,
    "profit_rate" DECIMAL(8,6) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "simulation_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulation_snapshots" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "snapshot_date" TEXT NOT NULL,
    "portfolio_value" DECIMAL(16,4) NOT NULL,
    "cash_balance" DECIMAL(16,4) NOT NULL,
    "total_value" DECIMAL(16,4) NOT NULL,
    "daily_pnl" DECIMAL(16,4) NOT NULL,
    "daily_pnl_rate" DECIMAL(8,6) NOT NULL,
    "drawdown" DECIMAL(8,6) NOT NULL,
    "peak_value" DECIMAL(16,4) NOT NULL,
    "position_count" INTEGER NOT NULL,
    "trade_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "simulation_watch_stocks_session_id_stock_code_key" ON "simulation_watch_stocks"("session_id", "stock_code");

-- CreateIndex
CREATE UNIQUE INDEX "simulation_positions_session_id_stock_code_key" ON "simulation_positions"("session_id", "stock_code");

-- CreateIndex
CREATE UNIQUE INDEX "simulation_snapshots_session_id_snapshot_date_key" ON "simulation_snapshots"("session_id", "snapshot_date");

-- AddForeignKey
ALTER TABLE "simulation_watch_stocks" ADD CONSTRAINT "simulation_watch_stocks_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "simulation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_trades" ADD CONSTRAINT "simulation_trades_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "simulation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_positions" ADD CONSTRAINT "simulation_positions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "simulation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_snapshots" ADD CONSTRAINT "simulation_snapshots_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "simulation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
