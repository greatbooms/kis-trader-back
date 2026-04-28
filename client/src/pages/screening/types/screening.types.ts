import type { GetStockRecommendationsQuery } from '@/graphql/generated'

// ── 스크리닝 페이지 도메인 타입 ──

export type DateSummary = {
  date: string
  totalCount: number
  countries: Array<{ country: string; label: string; count: number; avgScore: number }>
}

export type ScreeningRecommendationItem = GetStockRecommendationsQuery['stockRecommendations'][number]
export type FactorScores = ScreeningRecommendationItem['factorScores']

export interface DateListViewProps {
  summaries: DateSummary[]
  loading: boolean
  onSelect: (date: string, country: string) => void
}

export interface StockDetailViewProps {
  date: string
  country: string
  onBack: () => void
}

export interface RecommendationCardProps {
  rec: ScreeningRecommendationItem
  date: string
  expanded: boolean
  onToggle: () => void
}

export interface AddToSimulationModalProps {
  rec: ScreeningRecommendationItem
  strategyName: string
  strategyDisplayName: string
  onClose: () => void
}
