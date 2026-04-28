import { Button } from '@/components/ui/button'
import { COUNTRY_OPTIONS } from '@/lib/market-constants'

interface PortfolioFiltersProps {
  countryFilter: string | null
  onChange: (value: string | null) => void
}

// ── 국가 필터 칩 ──

export function PortfolioFilters({ countryFilter, onChange }: PortfolioFiltersProps) {
  return (
    <div className="flex gap-2 flex-wrap">
      <Button
        variant={countryFilter === null ? 'default' : 'outline'}
        size="sm"
        onClick={() => onChange(null)}
      >
        전체
      </Button>
      {COUNTRY_OPTIONS.map((c) => (
        <Button
          key={c.value}
          variant={countryFilter === c.value ? 'default' : 'outline'}
          size="sm"
          onClick={() => onChange(c.value)}
        >
          {c.label}
        </Button>
      ))}
    </div>
  )
}
