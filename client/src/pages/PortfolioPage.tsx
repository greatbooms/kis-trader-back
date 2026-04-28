import { useState } from 'react'
import { type Market } from '@/graphql/generated'
import { COUNTRY_OPTIONS } from '@/lib/market-constants'
import { PortfolioFilters } from '@/pages/portfolio/PortfolioFilters'
import { AccountSummaryCard } from '@/pages/portfolio/AccountSummaryCard'
import { PositionsCard } from '@/pages/portfolio/PositionsCard'
import { TradesCard } from '@/pages/portfolio/TradesCard'

export function PortfolioPage() {
  const [countryFilter, setCountryFilter] = useState<string | null>(null)
  const selectedCountry = COUNTRY_OPTIONS.find((c) => c.value === countryFilter)
  const marketFilter: Market | null = selectedCountry?.market ?? null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">포트폴리오</h2>
        <p className="text-sm text-muted-foreground mt-1">계좌 현황, 보유 종목, 매매 기록을 확인하세요</p>
      </div>

      <PortfolioFilters countryFilter={countryFilter} onChange={setCountryFilter} />

      <AccountSummaryCard countryFilter={countryFilter} />
      <PositionsCard market={marketFilter} countryFilter={countryFilter} />
      <TradesCard market={marketFilter} countryFilter={countryFilter} />
    </div>
  )
}
