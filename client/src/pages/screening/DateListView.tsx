import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Search, ChevronDown, Calendar } from 'lucide-react'
import { scoreColor, formatScreeningDate, COUNTRY_FLAG } from './screening-helpers'
import type { DateListViewProps } from './types'

// ── 날짜 + 국가 요약 그리드 (마스터 리스트) ──

export function DateListView({ summaries, loading, onSelect }: DateListViewProps) {
  const latestDate = summaries.length > 0 ? summaries[0].date : null
  const [selectedDate, setSelectedDate] = useState<string | null>(latestDate)
  const [countryFilter, setCountryFilter] = useState<string | null>(null)

  if (selectedDate === null && latestDate) {
    setSelectedDate(latestDate)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">로딩중...</div>
  }

  if (summaries.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Search className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">스크리닝 결과가 없습니다</p>
          <p className="text-xs text-muted-foreground mt-1">스케줄러가 실행되면 자동으로 업데이트됩니다</p>
        </CardContent>
      </Card>
    )
  }

  const filteredSummaries = summaries
    .filter((item) => !selectedDate || item.date === selectedDate)
    .map((item) => ({
      ...item,
      countries: countryFilter
        ? item.countries.filter((country) => country.country === countryFilter)
        : item.countries,
    }))
    .filter((item) => item.countries.length > 0)

  const allCountries = new Map<string, string>()
  for (const summary of summaries) {
    for (const country of summary.countries) {
      allCountries.set(country.country, country.label)
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Select
          value={selectedDate || ''}
          onChange={(event) => setSelectedDate(event.target.value || null)}
          className="w-full sm:w-48"
        >
          <option value="">전체 날짜</option>
          {summaries.map((item) => (
            <option key={item.date} value={item.date}>
              {formatScreeningDate(item.date)} ({item.totalCount}종목)
            </option>
          ))}
        </Select>

        <div className="flex gap-1 flex-wrap">
          <Button
            variant={countryFilter === null ? 'default' : 'outline'}
            size="sm"
            onClick={() => setCountryFilter(null)}
          >
            전체
          </Button>
          {[...allCountries.entries()].map(([code, label]) => (
            <Button
              key={code}
              variant={countryFilter === code ? 'default' : 'outline'}
              size="sm"
              onClick={() => setCountryFilter(code)}
            >
              {COUNTRY_FLAG[code] || ''} {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {filteredSummaries.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Search className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">해당 조건의 스크리닝 결과가 없습니다</p>
            </CardContent>
          </Card>
        ) : (
          filteredSummaries.map((item) => (
            <Card key={item.date}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">{formatScreeningDate(item.date)}</CardTitle>
                  <Badge variant="outline" className="ml-auto text-xs">
                    {item.countries.reduce((sum, country) => sum + country.count, 0)}종목
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {item.countries.map((country) => (
                    <button
                      key={country.country}
                      className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer text-left"
                      onClick={() => onSelect(item.date, country.country)}
                    >
                      <span className="text-lg">{COUNTRY_FLAG[country.country] || '🌐'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium">{country.label}</span>
                          <span className="text-xs text-muted-foreground">{country.count}종목</span>
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-xs text-muted-foreground">평균</span>
                          <span className={`text-xs font-medium ${scoreColor(country.avgScore)}`}>
                            {country.avgScore.toFixed(1)}점
                          </span>
                        </div>
                      </div>
                      <ChevronDown className="h-4 w-4 text-muted-foreground -rotate-90" />
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </>
  )
}
