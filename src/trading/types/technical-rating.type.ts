export type TechnicalIndicatorAction = 'BUY' | 'NEUTRAL' | 'SELL';

export type TechnicalRecommendation =
  | 'STRONG_BUY'
  | 'BUY'
  | 'NEUTRAL'
  | 'SELL'
  | 'STRONG_SELL';

export interface TechnicalIndicatorSnapshot {
  key: string;
  label: string;
  value?: number;
  action: TechnicalIndicatorAction;
}

export interface TechnicalRatingGroupSnapshot {
  score: number;
  recommendation: TechnicalRecommendation;
  buyCount: number;
  neutralCount: number;
  sellCount: number;
}

export interface TechnicalRatingsSnapshot {
  timeframe: '1D';
  oscillators: TechnicalIndicatorSnapshot[];
  movingAverages: TechnicalIndicatorSnapshot[];
  oscillatorSummary: TechnicalRatingGroupSnapshot;
  movingAverageSummary: TechnicalRatingGroupSnapshot;
  overallSummary: TechnicalRatingGroupSnapshot;
}
