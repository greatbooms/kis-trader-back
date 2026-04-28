import { useSearchParams } from 'react-router-dom'
import { useGetScreeningDateSummariesQuery } from '@/graphql/generated'
import { DateListView } from '@/pages/screening/DateListView'
import { StockDetailView } from '@/pages/screening/StockDetailView'

export function ScreeningPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedDate = searchParams.get('date')
  const selectedCountry = searchParams.get('country')
  const selected = selectedDate && selectedCountry ? { date: selectedDate, country: selectedCountry } : null

  const { data: summariesData, loading: summariesLoading } = useGetScreeningDateSummariesQuery({ variables: { input: { limit: 30 } } })
  const summaries = summariesData?.screeningDateSummaries ?? []

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">종목 추천</h2>
        <p className="text-sm text-muted-foreground mt-1">
          다중 팩터 분석 기반 종목 스크리닝 결과
        </p>
      </div>

      {selected ? (
        <StockDetailView
          date={selected.date}
          country={selected.country}
          onBack={() => setSearchParams({})}
        />
      ) : (
        <DateListView
          summaries={summaries}
          loading={summariesLoading}
          onSelect={(date, country) => setSearchParams({ date, country })}
        />
      )}
    </div>
  )
}
