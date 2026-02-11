export type MarketRegimeLabel = 'TRENDING_UP' | 'SIDEWAYS' | 'TRENDING_DOWN';

export interface RiskState {
  buyBlocked: boolean;
  liquidateAll: boolean;
  positionCount: number;
  investedRate: number;
  dailyPnlRate: number;
  drawdown: number;
  reasons: string[];
}
