import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Search, ChevronLeft } from 'lucide-react'
import { useGetStockRecommendationsQuery } from '@/graphql/generated'
import { COUNTRY_OPTIONS } from '@/lib/market-constants'
import {
  COUNTRY_FLAG,
  formatScreeningDate,
  axisRatio,
  getAxisMax,
} from './screening-helpers'
import { RecommendationCard } from './RecommendationCard'
import type { StockDetailViewProps } from './types'

// ── 종목 추천 상세 뷰 (날짜+국가 선택 후) ──

export function StockDetailView({ date, country, onBack }: StockDetailViewProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [tab, setTab] = useState<'all' | 'stock' | 'etf'>('all')
  const [sortBy, setSortBy] = useState<'total' | 'dividend' | 'safety' | 'risk'>('total')
  const [factorFilter, setFactorFilter] = useState<'all' | 'income' | 'safe'>('all')
  const countryOption = COUNTRY_OPTIONS.find((item) => item.value === country)
  const countryLabel = countryOption?.label || country
  const marketFilter = countryOption?.market ?? undefined

  const { data, loading } = useGetStockRecommendationsQuery({
    variables: { input: { date, market: marketFilter, country, limit: 100 } },
  })

  const countryFiltered = data?.stockRecommendations ?? []

  const stockRecs = countryFiltered.filter((item) => !item.isEtf)
  const etfRecs = countryFiltered.filter((item) => item.isEtf)
  const baseRecommendations = tab === 'stock'
    ? stockRecs
    : tab === 'etf'
      ? etfRecs
      : countryFiltered
  const filteredRecommendations = baseRecommendations.filter((item) => {
    if (factorFilter === 'income') return (item.factorScores?.dividend ?? 0) >= 2
    if (factorFilter === 'safe') return axisRatio(item.riskSupplyScore, getAxisMax(item, 'riskSupply')) >= 55
    return true
  })
  const recommendations = [...filteredRecommendations].sort((left, right) => {
    if (sortBy === 'dividend') return (right.factorScores?.dividend ?? 0) - (left.factorScores?.dividend ?? 0)
    if (sortBy === 'safety') return (right.factorScores?.valuation ?? 0) - (left.factorScores?.valuation ?? 0)
    if (sortBy === 'risk') {
      return axisRatio(right.riskSupplyScore, getAxisMax(right, 'riskSupply'))
        - axisRatio(left.riskSupplyScore, getAxisMax(left, 'riskSupply'))
    }
    return right.totalScore - left.totalScore
  })

  return (
    <>
      <button
        onClick={onBack}
        type="button"
        aria-label="목록으로 이동"
        title="목록으로 이동"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <div className="flex items-center gap-3">
        <span className="text-xl">{COUNTRY_FLAG[country] || '🌐'}</span>
        <div>
          <h3 className="text-lg font-semibold">{countryLabel} 종목 추천</h3>
          <p className="text-sm text-muted-foreground">{formatScreeningDate(date)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={tab === 'all' ? 'default' : 'outline'} size="sm" onClick={() => { setTab('all'); setExpandedId(null) }}>
          전체 ({countryFiltered.length})
        </Button>
        <Button variant={tab === 'stock' ? 'default' : 'outline'} size="sm" onClick={() => { setTab('stock'); setExpandedId(null) }}>
          개별주 ({stockRecs.length})
        </Button>
        <Button variant={tab === 'etf' ? 'default' : 'outline'} size="sm" onClick={() => { setTab('etf'); setExpandedId(null) }}>
          ETF ({etfRecs.length})
        </Button>
        <Select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)} className="w-full sm:w-40">
          <option value="total">총점순</option>
          <option value="dividend">배당 순</option>
          <option value="safety">안전마진 순</option>
          <option value="risk">저리스크 순</option>
        </Select>
        <Select value={factorFilter} onChange={(event) => setFactorFilter(event.target.value as typeof factorFilter)} className="w-full sm:w-40">
          <option value="all">전체</option>
          <option value="income">배당 중심</option>
          <option value="safe">안전 중심</option>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">로딩중...</div>
      ) : recommendations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Search className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">해당 조건의 추천 종목이 없습니다</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {recommendations.map((item) => (
            <RecommendationCard
              key={item.id}
              rec={item}
              date={date}
              expanded={expandedId === item.id}
              onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
            />
          ))}
        </div>
      )}
    </>
  )
}
