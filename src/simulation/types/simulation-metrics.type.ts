export interface SimulationMetrics {
  totalReturn: number;
  totalReturnAmount: number;
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
