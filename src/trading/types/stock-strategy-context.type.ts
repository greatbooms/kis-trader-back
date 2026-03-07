import { StockPriceResult } from '../../kis/types/kis-api.types';
import { TradingSignal } from './trading-signal.type';
import { WatchStockConfig } from './watch-stock-config.type';
import { MarketCondition } from './market-condition.type';
import { StockIndicators } from './stock-indicators.type';
import { MarketRegimeLabel, RiskState } from './risk-state.type';

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
  marketRegime?: MarketRegimeLabel;
  riskState?: RiskState;
}

export type ExecutionMode =
  | { type: 'continuous' }
  | { type: 'once-daily'; hours: { domestic: number; overseas: number } };

export interface PerStockTradingStrategy {
  name: string;
  displayName: string;
  description: string;
  executionMode: ExecutionMode;
  evaluateStock(context: StockStrategyContext): Promise<TradingSignal[]>;
}
