import type { GetAccountSummaryQuery, GetPositionsQuery } from '@/graphql/generated'

export type DashboardAccountSummary = GetAccountSummaryQuery['accountSummary']
export type DashboardPosition = GetPositionsQuery['positions'][number]

export interface CapitalSummaryCardProps {
  loading: boolean
  summary?: DashboardAccountSummary
}

export interface PositionInsightsCardProps {
  loading: boolean
  positions: DashboardPosition[]
  totalAssets: number
  winningCount: number
  losingCount: number
}
