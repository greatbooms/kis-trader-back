import { StockPriceResult } from '../../kis/types/kis-api.types';
import { TradingSignal } from './trading-signal.type';

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
