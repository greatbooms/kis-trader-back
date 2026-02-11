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
  strategyParams?: Record<string, any>;
}
