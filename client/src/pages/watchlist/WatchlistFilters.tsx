import { Button } from '@/components/ui/button'
import { COUNTRY_OPTIONS } from '@/lib/market-constants'
import type { WatchlistFiltersProps } from './types'

// ── 국가 필터 칩 그룹 ──

export function WatchlistFilters({ countryFilter, allStocks, onChange }: WatchlistFiltersProps) {
  return (
    <div className="flex gap-2 flex-wrap">
      <Button
        variant={countryFilter === null ? 'default' : 'outline'}
        size="sm"
        onClick={() => onChange(null)}
      >
        전체
      </Button>
      {COUNTRY_OPTIONS.map((c) => {
        const count = allStocks.filter((s) => c.exchanges.includes(s.exchangeCode ?? '')).length
        return (
          <Button
            key={c.value}
            variant={countryFilter === c.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => onChange(c.value)}
          >
            {c.label} {count > 0 && <span className="ml-1 text-xs opacity-70">({count})</span>}
          </Button>
        )
      })}
    </div>
  )
}
