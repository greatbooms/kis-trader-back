import { StockPriceResult } from '../../kis/types/kis-api.types';

export interface TradingSignal {
  market: 'DOMESTIC' | 'OVERSEAS';
  exchangeCode?: string;
  stockCode: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price?: number;
  reason: string;
  orderDivision?: string; // '00'=지정가, '34'=LOC 등
}

export interface TradingStrategyContext {
  market: 'DOMESTIC' | 'OVERSEAS';
  prices: Map<string, StockPriceResult>;
  positions: Array<{
    stockCode: string;
    quantity: number;
    avgPrice: number;
    currentPrice: number;
  }>;
}

export interface TradingStrategy {
  name: string;
  evaluate(context: TradingStrategyContext): Promise<TradingSignal[]>;
}

// --- 종목별 전략 인터페이스 (무한매수법 등) ---

export interface WatchStockConfig {
  id: string;
  market: 'DOMESTIC' | 'OVERSEAS';
  exchangeCode?: string;
  stockCode: string;
  stockName: string;
  strategyName?: string;
  quota?: number;
  cycle: number;
  maxCycles: number;
  stopLossRate: number;
  maxPortfolioRate: number;
}

export interface MarketCondition {
  referenceIndexAboveMA200: boolean;
  referenceIndexName: string;
  interestRateRising: boolean;
  interestRate?: number;
}

export interface StockIndicators {
  ma200?: number;
  rsi14?: number;
  currentAboveMA200: boolean;
}

export interface StockStrategyContext {
  watchStock: WatchStockConfig;
  price: StockPriceResult;
  position?: {
    stockCode: string;
    quantity: number;
    avgPrice: number;
    currentPrice: number;
    totalInvested: number;
  };
  alreadyExecutedToday: boolean;
  marketCondition: MarketCondition;
  stockIndicators: StockIndicators;
  buyableAmount: number;
  totalPortfolioValue: number;
}

export interface PerStockTradingStrategy {
  name: string;
  evaluateStock(context: StockStrategyContext): Promise<TradingSignal[]>;
}
