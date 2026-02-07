-- CreateEnum
CREATE TYPE "Market" AS ENUM ('DOMESTIC', 'OVERSEAS');

-- CreateEnum
CREATE TYPE "Side" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('MARKET', 'LIMIT', 'LOC');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'FILLED', 'PARTIAL', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "trade_records" (
    "id" TEXT NOT NULL,
    "market" "Market" NOT NULL,
    "exchange_code" TEXT,
    "stock_code" TEXT NOT NULL,
    "stock_name" TEXT NOT NULL,
    "side" "Side" NOT NULL,
    "order_type" "OrderType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "executed_price" DECIMAL(65,30),
    "executed_qty" INTEGER,
    "order_no" TEXT,
    "status" "OrderStatus" NOT NULL,
    "strategy_name" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" TEXT NOT NULL,
    "market" "Market" NOT NULL,
    "exchange_code" TEXT,
    "stock_code" TEXT NOT NULL,
    "stock_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "avg_price" DECIMAL(65,30) NOT NULL,
    "current_price" DECIMAL(65,30) NOT NULL,
    "profit_loss" DECIMAL(65,30) NOT NULL,
    "profit_rate" DECIMAL(65,30) NOT NULL,
    "total_invested" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watch_stocks" (
    "id" TEXT NOT NULL,
    "market" "Market" NOT NULL,
    "exchange_code" TEXT,
    "stock_code" TEXT NOT NULL,
    "stock_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "strategy_name" TEXT,
    "quota" DECIMAL(12,2),
    "cycle" INTEGER NOT NULL DEFAULT 0,
    "max_cycles" INTEGER NOT NULL DEFAULT 40,
    "stop_loss_rate" DECIMAL(4,3) NOT NULL DEFAULT 0.3,
    "max_portfolio_rate" DECIMAL(4,3) NOT NULL DEFAULT 0.2,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watch_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_executions" (
    "id" TEXT NOT NULL,
    "market" "Market" NOT NULL,
    "stock_code" TEXT NOT NULL,
    "strategy_name" TEXT NOT NULL,
    "executed_date" TEXT NOT NULL,
    "progress" DECIMAL(8,2) NOT NULL,
    "signal_count" INTEGER NOT NULL,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategy_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "positions_market_stock_code_key" ON "positions"("market", "stock_code");

-- CreateIndex
CREATE UNIQUE INDEX "watch_stocks_market_stock_code_key" ON "watch_stocks"("market", "stock_code");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_executions_market_stock_code_strategy_name_execute_key" ON "strategy_executions"("market", "stock_code", "strategy_name", "executed_date");
