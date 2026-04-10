import type { GetAccountSummaryQuery, GetPositionsQuery } from '@/graphql/generated'

export type DashboardAccountSummary = GetAccountSummaryQuery['accountSummary']
export type DashboardPosition = GetPositionsQuery['positions'][number]

export interface DashboardCapitalSummary {
  currencyCode: string
  cashBalance: number
  currentValue: number
  costBasis: number
  totalAssets: number
  totalProfitLoss: number
  positionCount: number
  cashBalanceCount: number
}

export interface CapitalSummaryCardProps {
  loading: boolean
  countryLabel: string
  summary?: DashboardCapitalSummary
}

export interface PositionInsightsCardProps {
  loading: boolean
  positions: DashboardPosition[]
  totalAssets: number
  winningCount: number
  losingCount: number
}
