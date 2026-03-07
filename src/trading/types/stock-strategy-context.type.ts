import { StockPriceResult } from '../../kis/types/kis-api.types';
import { TradingSignal } from './trading-signal.type';
import { WatchStockConfig } from './watch-stock-config.type';
import { MarketCondition } from './market-condition.type';
import { StockIndicators } from './stock-indicators.type';
import { StockFundamentals } from './stock-fundamentals.type';
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
  fundamentals?: StockFundamentals;
  buyableAmount: number;
  totalPortfolioValue: number;
  marketRegime?: MarketRegimeLabel;
  riskState?: RiskState;
}

export type ExecutionMode =
  | { type: 'continuous' }
  | {
      type: 'once-daily';
      hours: {
        domestic: number;
        /**
         * 해외 시장 실행 시점 기준.
         * 'afterOpen' + offset: 장 시작 후 N시간 (무한매수법 등 장 초반 주문)
         * 'beforeClose' + offset: 장 마감 N시간 전 (추세/밸류 등 장 마감 전 판단)
         */
        overseas: { basis: 'afterOpen' | 'beforeClose'; offsetHours: number };
      };
    };

export type RiskLevel = 'very-low' | 'low' | 'medium' | 'high' | 'very-high';

export interface StrategyMeta {
  riskLevel: RiskLevel;
  expectedReturn: string;
  maxLoss: string;
  investmentPeriod: string;
  tradingFrequency: string;
  suitableFor: string[];
  tags: string[];
}

export interface PerStockTradingStrategy {
  name: string;
  displayName: string;
  description: string;
  executionMode: ExecutionMode;
  meta: StrategyMeta;
  evaluateStock(context: StockStrategyContext): Promise<TradingSignal[]>;
}
