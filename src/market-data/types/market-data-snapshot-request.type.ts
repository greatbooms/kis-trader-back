export interface MarketDataSnapshotRequest {
  source: string;
  category: string;
  market?: string;
  exchangeCode?: string;
  stockCode?: string;
  ttlMs: number;
  forceRefresh?: boolean;
}
