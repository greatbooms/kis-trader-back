export interface SimulationMetrics {
  totalReturn: number;
  totalReturnAmount: number;
  realizedPnL: number;
  unrealizedPnL: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  sharpeRatio: number;
  profitFactor: number;
  currentCash: number;
  currentPortfolioValue: number;
}
