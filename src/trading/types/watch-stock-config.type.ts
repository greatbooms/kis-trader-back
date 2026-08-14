import { Broker } from '@prisma/client';

export interface WatchStockConfig {
  id: string;
  broker?: Broker;
  market: 'DOMESTIC' | 'OVERSEAS';
  exchangeCode: string;
  stockCode: string;
  stockName: string;
  strategyName?: string;
  quota?: number;
  cycle: number;
  maxCycles: number;
  stopLossRate: number;
  maxPortfolioRate: number;
  strategyParams?: Record<string, any>;
}
