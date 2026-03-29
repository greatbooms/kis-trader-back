export interface DCFValuation {
  projectedRevenue: number[];
  projectedOperatingMargin: number;
  wacc: number;
  terminalGrowthRate: number;
  intrinsicValue: number;
  currentPrice: number;
  marginOfSafety: number;
  sensitivityMatrix: number[][];
}

export interface RiskProfile {
  volatility30d: number;
  beta?: number;
  maxDrawdown90d: number;
  shortSaleRatio?: number;
  creditBalanceRate?: number;
  equityRatio?: number;
  netAssetPerShare?: number;
  riskGrade: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
}

export interface TechnicalDetail {
  trendDirection: 'UP' | 'DOWN' | 'SIDEWAYS';
  support: number[];
  resistance: number[];
  fibonacciRetracement: Record<string, number>;
  macd: { line: number; signal: number; histogram: number };
  bollingerBands: { upper: number; middle: number; lower: number; percentB: number };
  stochastic?: { k: number; d: number };
  adx: number;
  ichimoku?: { conversionLine: number; baseLine: number; cloud: string };
}

export interface DividendAnalysis {
  currentYield: number;
  payoutRatio: number;
  consecutiveDividendYears: number;
  dividendGrowthRate5y?: number;
  exDividendDate?: string;
  nextPaymentDate?: string;
}

export interface ConsensusData {
  targetPrice: number;
  analystCount: number;
  rating: string;
  earningsSurprise: number[];
  estimatedEps: number;
}

export interface DeepAnalysisResult {
  stockCode: string;
  stockName: string;
  exchangeCode: string;
  dcfValuation?: DCFValuation;
  riskProfile?: RiskProfile;
  technicalDetail?: TechnicalDetail;
  dividendAnalysis?: DividendAnalysis;
  consensusData?: ConsensusData;
  reportSummary: string;
}
