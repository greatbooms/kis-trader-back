export type MarketRegimeLabel = 'TRENDING_UP' | 'SIDEWAYS' | 'TRENDING_DOWN';

export type RiskLevel = 'very-low' | 'low' | 'medium' | 'high' | 'very-high';

export interface RiskState {
  buyBlocked: boolean;
  liquidateAll: boolean;
  positionCount: number;
  investedRate: number;
  dailyPnlRate: number;
  drawdown: number;
  reasons: string[];
}

/** 전략의 개별 MDD 임계값으로 매수차단/전량청산 판단 */
export function evaluateStrategyMdd(
  drawdown: number,
  mddBuyBlock: number,
  mddLiquidate: number,
): { buyBlocked: boolean; liquidateAll: boolean } {
  return {
    buyBlocked: drawdown <= mddBuyBlock,
    liquidateAll: drawdown <= mddLiquidate,
  };
}
