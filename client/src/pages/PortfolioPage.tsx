import { useCountryFilter } from '@/hooks/useCountryFilter'
import { PortfolioFilters } from '@/pages/portfolio/PortfolioFilters'
import { AccountSummaryCard } from '@/pages/portfolio/AccountSummaryCard'
import { PositionsCard } from '@/pages/portfolio/PositionsCard'
import { TradesCard } from '@/pages/portfolio/TradesCard'

export function PortfolioPage() {
  const { countryFilter, setCountryFilter, marketFilter } = useCountryFilter()
  // PositionsCard/TradesCard는 market을 nullable로 받으므로 undefined → null 변환
  const market = marketFilter ?? null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">포트폴리오</h2>
        <p className="text-sm text-muted-foreground mt-1">계좌 현황, 보유 종목, 매매 기록을 확인하세요</p>
      </div>

      <PortfolioFilters countryFilter={countryFilter} onChange={setCountryFilter} />

      <AccountSummaryCard countryFilter={countryFilter} />
      <PositionsCard market={market} countryFilter={countryFilter} />
      <TradesCard market={market} countryFilter={countryFilter} />
    </div>
  )
}
