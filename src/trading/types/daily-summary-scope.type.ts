export interface DailySummaryScope {
  summaryDate: string;
  claimScope: string;
  summaryTitle: string;
  market: 'DOMESTIC' | 'OVERSEAS';
  exchangeCodes: string[];
  tradeStart: Date;
  tradeEnd: Date;
}
