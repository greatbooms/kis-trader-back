export interface SimulationPendingOrder {
  sessionId: string;
  market: string;
  exchangeCode?: string;
  stockCode: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number; // 지정가
  reason: string;
  createdAt: Date;
}
