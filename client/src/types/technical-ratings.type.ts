export interface TechnicalIndicatorView {
  key: string
  label: string
  value?: number | null
  action: string
}

export interface TechnicalRatingSummaryView {
  score: number
  recommendation: string
  buyCount: number
  neutralCount: number
  sellCount: number
}

export interface TechnicalRatingsView {
  timeframe?: string | null
  oscillators: TechnicalIndicatorView[]
  movingAverages: TechnicalIndicatorView[]
  oscillatorSummary: TechnicalRatingSummaryView
  movingAverageSummary: TechnicalRatingSummaryView
  overallSummary: TechnicalRatingSummaryView
}
