export interface MarketCondition {
  referenceIndexAboveMA200: boolean;
  referenceIndexName: string;
  interestRateRising: boolean;
  interestRate?: number;
}
