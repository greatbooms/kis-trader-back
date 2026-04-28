import type { Market, GetPositionsQuery } from '@/graphql/generated'

// ── 포트폴리오 페이지 도메인 타입 ──

export type PortfolioPosition = GetPositionsQuery['positions'][number]

export interface PortfolioCardScopeProps {
  market: Market | null
  countryFilter: string | null
}

export interface AccountSummaryCardProps {
  countryFilter: string | null
}
