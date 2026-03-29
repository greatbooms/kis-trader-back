import { useState } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Search, TrendingUp, BarChart3, Brain, Zap, ChevronDown, ChevronUp, ChevronLeft, Target, Calendar, Info, ShieldAlert, DollarSign, Award } from 'lucide-react'
import {
  useGetScreeningDateSummariesQuery,
  useGetStockRecommendationsQuery,
  useGetStockDeepAnalysisQuery,
  type GetStockRecommendationsQuery,
} from '@/graphql/generated'
import { formatNumber } from '@/lib/utils'
import { EXCHANGE_LABELS, COUNTRY_OPTIONS } from '@/lib/market-constants'
import { Tooltip } from '@/components/ui/tooltip'

function scoreColor(score: number): string {
  if (score >= 70) return 'text-emerald-600'
  if (score >= 50) return 'text-amber-600'
  return 'text-red-500'
}

function scoreBadgeVariant(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 70) return 'success'
  if (score >= 50) return 'warning'
  return 'danger'
}

function formatScreeningDate(date: string): string {
  if (date.length === 8) {
    return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
  }
  return date
}

function parseJson<T>(value?: string | null): T | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

function riskBadgeVariant(riskGrade?: string | null): 'success' | 'warning' | 'danger' | 'outline' {
  if (riskGrade === 'LOW') return 'success'
  if (riskGrade === 'MEDIUM') return 'warning'
  if (riskGrade === 'HIGH' || riskGrade === 'EXTREME') return 'danger'
  return 'outline'
}

const COUNTRY_FLAG: Record<string, string> = {
  KR: '🇰🇷', US: '🇺🇸', HK: '🇭🇰', CN: '🇨🇳', JP: '🇯🇵', VN: '🇻🇳',
}

type DateSummary = {
  date: string
  totalCount: number
  countries: Array<{ country: string; label: string; count: number; avgScore: number }>
}

type ScreeningRecommendationItem = GetStockRecommendationsQuery['stockRecommendations'][number]
type FactorScores = ScreeningRecommendationItem['factorScores']

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

function DateListView({
  summaries,
  loading,
  onSelect,
}: {
  summaries: DateSummary[]
  loading: boolean
  onSelect: (date: string, country: string) => void
}) {
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
      <div className="flex flex-wrap gap-3 items-center">
        <Select
          value={selectedDate || ''}
          onChange={(event) => setSelectedDate(event.target.value || null)}
          className="w-48"
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

function StockDetailView({
  date,
  country,
  onBack,
}: {
  date: string
  country: string
  onBack: () => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [tab, setTab] = useState<'stock' | 'etf'>('stock')
  const [sortBy, setSortBy] = useState<'total' | 'dividend' | 'safety' | 'risk'>('total')
  const [factorFilter, setFactorFilter] = useState<'all' | 'income' | 'safe'>('all')
  const countryOption = COUNTRY_OPTIONS.find((item) => item.value === country)
  const countryLabel = countryOption?.label || country
  const marketFilter = countryOption?.market ?? undefined

  const { data, loading } = useGetStockRecommendationsQuery({
    variables: { input: { date, market: marketFilter, limit: 100 } },
  })

  const allRecommendations = data?.stockRecommendations ?? []
  const countryFiltered = allRecommendations.filter((item) => {
    if (!countryOption) return true
    return countryOption.exchanges.includes(item.exchangeCode)
  })

  const stockRecs = countryFiltered.filter((item) => !item.isEtf)
  const etfRecs = countryFiltered.filter((item) => item.isEtf)
  const baseRecommendations = tab === 'stock' ? stockRecs : etfRecs
  const filteredRecommendations = baseRecommendations.filter((item) => {
    if (factorFilter === 'income') return (item.factorScores?.dividend ?? 0) >= 2
    if (factorFilter === 'safe') return (item.factorScores?.risk ?? 0) >= 7
    return true
  })
  const recommendations = [...filteredRecommendations].sort((left, right) => {
    if (sortBy === 'dividend') return (right.factorScores?.dividend ?? 0) - (left.factorScores?.dividend ?? 0)
    if (sortBy === 'safety') return (right.factorScores?.valuation ?? 0) - (left.factorScores?.valuation ?? 0)
    if (sortBy === 'risk') return (right.factorScores?.risk ?? 0) - (left.factorScores?.risk ?? 0)
    return right.totalScore - left.totalScore
  })

  return (
    <>
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ChevronLeft className="h-4 w-4" />
        목록으로
      </button>

      <div className="flex items-center gap-3">
        <span className="text-xl">{COUNTRY_FLAG[country] || '🌐'}</span>
        <div>
          <h3 className="text-lg font-semibold">{countryLabel} 종목 추천</h3>
          <p className="text-sm text-muted-foreground">{formatScreeningDate(date)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={tab === 'stock' ? 'default' : 'outline'} size="sm" onClick={() => { setTab('stock'); setExpandedId(null) }}>
          개별주 ({stockRecs.length})
        </Button>
        <Button variant={tab === 'etf' ? 'default' : 'outline'} size="sm" onClick={() => { setTab('etf'); setExpandedId(null) }}>
          ETF ({etfRecs.length})
        </Button>
        <Select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)} className="w-40">
          <option value="total">총점순</option>
          <option value="dividend">배당 순</option>
          <option value="safety">안전마진 순</option>
          <option value="risk">저리스크 순</option>
        </Select>
        <Select value={factorFilter} onChange={(event) => setFactorFilter(event.target.value as typeof factorFilter)} className="w-40">
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

function RecommendationCard({
  rec,
  date,
  expanded,
  onToggle,
}: {
  rec: ScreeningRecommendationItem
  date: string
  expanded: boolean
  onToggle: () => void
}) {
  let reasons: string[] = []
  try { reasons = JSON.parse(rec.reasons) } catch { }

  let indicators: Record<string, unknown> = {}
  try { indicators = JSON.parse(rec.indicators) } catch { }

  const { data: deepAnalysisData, loading: deepLoading } = useGetStockDeepAnalysisQuery({
    variables: { stockCode: rec.stockCode, date },
    skip: !expanded,
  })

  const deepAnalysis = deepAnalysisData?.stockDeepAnalysis ?? null
  const technicalDetail = parseJson<Record<string, unknown>>(deepAnalysis?.technicalDetail)
  const dividendDetail = parseJson<Record<string, unknown>>(deepAnalysis?.dividendDetail)
  const consensusDetail = parseJson<Record<string, unknown>>(deepAnalysis?.consensusDetail)
  const radarData = buildRadarData(rec.factorScores)

  return (
    <Card className="overflow-hidden">
      <button className="w-full text-left cursor-pointer" onClick={onToggle}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold text-muted-foreground w-8">#{rec.rank}</span>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">{rec.stockName}</CardTitle>
                  <span className="text-xs text-muted-foreground">{rec.stockCode}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <Badge variant="outline" className="text-xs">
                    {EXCHANGE_LABELS[rec.exchangeCode] || rec.exchangeCode}
                  </Badge>
                  <span className={`text-sm font-medium ${rec.changeRate >= 0 ? 'text-success' : 'text-danger'}`}>
                    {rec.changeRate >= 0 ? '+' : ''}{rec.changeRate.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="flex items-center gap-1 justify-end">
                  <span className={`text-xl font-bold ${scoreColor(rec.totalScore)}`}>{rec.totalScore.toFixed(1)}</span>
                  <Tooltip text="멀티팩터 100점 만점 점수입니다. 기술, 가치, 성장, 수익성, 리스크, 수급, 배당, 컨센서스를 종합합니다.">
                    <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                  </Tooltip>
                </div>
                <div className="flex items-center gap-1.5 justify-end">
                  <Badge variant={scoreBadgeVariant(rec.totalScore)} className="text-xs">
                    {rec.totalScore >= 70 ? '강력 추천' : rec.totalScore >= 50 ? '관심' : '보통'}
                  </Badge>
                  {typeof indicators.dataAvailability === 'number' && indicators.dataAvailability < 100 && (
                    <Tooltip text={`팩터 데이터 ${indicators.dataAvailability}% 가용 — 일부 지표 미수신`}>
                      <Badge variant="outline" className="text-[10px] px-1 py-0 text-muted-foreground">
                        {indicators.dataAvailability}%
                      </Badge>
                    </Tooltip>
                  )}
                </div>
              </div>
              {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>
        </CardHeader>
      </button>

      <CardContent className="pt-0 pb-3">
        <div className="grid grid-cols-5 gap-2">
          <ScoreBar icon={<Brain className="h-3.5 w-3.5" />} label="기술" score={rec.technicalScore} max={40} tooltip="기술적 분석 호환 점수" />
          <ScoreBar icon={<BarChart3 className="h-3.5 w-3.5" />} label="펀더" score={rec.fundamentalScore} max={30} tooltip="가치/성장/수익성/배당/컨센서스 집계" />
          <ScoreBar icon={<Zap className="h-3.5 w-3.5" />} label="모멘텀" score={rec.momentumScore} max={30} tooltip="모멘텀/수급 집계" />
          <ScoreBar icon={<ShieldAlert className="h-3.5 w-3.5" />} label="리스크" score={rec.factorScores?.risk ?? 0} max={10} tooltip="부채/유동비율/변동성/MDD/차입금의존도" />
          <ScoreBar icon={<Award className="h-3.5 w-3.5" />} label="퀄리티" score={((rec.factorScores?.growth ?? 0) + (rec.factorScores?.profitability ?? 0) + (rec.factorScores?.dividend ?? 0))} max={25} tooltip="성장+수익성+배당 종합 품질" />
        </div>
      </CardContent>

      {expanded && (
        <CardContent className="border-t border-border pt-4 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <InfoCell label="현재가" value={formatNumber(rec.currentPrice)} />
            <InfoCell label="거래량" value={formatNumber(rec.volume)} />
            <InfoCell label="시가총액" value={formatNumber(rec.marketCap)} />
            <InfoCell label="등락률" value={`${rec.changeRate >= 0 ? '+' : ''}${rec.changeRate.toFixed(2)}%`} danger={rec.changeRate < 0} success={rec.changeRate >= 0} />
          </div>

          {radarData.length >= 4 && (
            <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
              <div className="rounded-xl border border-border bg-muted/20 p-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">멀티팩터 레이더</p>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="rgba(100,116,139,0.24)" />
                      <PolarAngleAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
                      <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                      <Radar dataKey="value" stroke="#0f766e" fill="#14b8a6" fillOpacity={0.3} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {Object.entries(rec.factorScores ?? {}).map(([key, value]) => (
                  <div key={key} className="rounded-lg bg-muted/50 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{factorLabel(key)}</p>
                    <p className="text-sm font-semibold">{Number(value).toFixed(1)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {Object.keys(indicators).length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">지표</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                {renderIndicator('RSI(14)', indicators.rsi14)}
                {renderIndicator('MA20', indicators.ma20, true)}
                {renderIndicator('MA60', indicators.ma60, true)}
                {renderIndicator('PER', indicators.per)}
                {renderIndicator('ROE', indicators.roe, false, '%')}
                {renderIndicator('EV/EBITDA', indicators.evEbitda)}
                {renderIndicator('배당수익률', indicators.dividendYield, false, '%')}
                {renderIndicator('안전마진', indicators.marginOfSafety, false, '%')}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border bg-background p-4 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium">딥 분석 패널</p>
              {deepAnalysis?.riskGrade && <Badge variant={riskBadgeVariant(deepAnalysis.riskGrade)}>{deepAnalysis.riskGrade}</Badge>}
            </div>

            {deepLoading ? (
              <p className="text-sm text-muted-foreground">딥 분석 로딩중...</p>
            ) : !deepAnalysis ? (
              <p className="text-sm text-muted-foreground">딥 분석 결과가 아직 없습니다.</p>
            ) : (
              <div className="space-y-4">
                {deepAnalysis.reportSummary && (
                  <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm text-foreground">{deepAnalysis.reportSummary}</div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <DeepCard
                    icon={<DollarSign className="h-4 w-4" />}
                    title="DCF"
                    lines={[
                      `내재가치 ${formatMaybeNumber(deepAnalysis.intrinsicValue)}`,
                      `안전마진 ${formatMaybePercent(deepAnalysis.marginOfSafety)}`,
                      `목표가 ${formatMaybeNumber(deepAnalysis.targetPrice)}`,
                    ]}
                  />
                  <DeepCard
                    icon={<ShieldAlert className="h-4 w-4" />}
                    title="리스크"
                    lines={[
                      `등급 ${deepAnalysis.riskGrade ?? 'N/A'}`,
                      `30일 변동성 ${formatMaybePercent(deepAnalysis.volatility30d)}`,
                      `90일 MDD ${formatMaybePercent(deepAnalysis.maxDrawdown90d)}`,
                    ]}
                  />
                  <DeepCard
                    icon={<TrendingUp className="h-4 w-4" />}
                    title="기술적"
                    lines={[
                      `추세 ${deepAnalysis.trendDirection ?? 'N/A'}`,
                      `배당 ${formatMaybePercent(deepAnalysis.dividendYield)}`,
                      `컨센서스 ${deepAnalysis.consensusRating ?? 'N/A'}`,
                    ]}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <DetailPanel title="기술 상세" rows={[
                    `지지선: ${arrayHead(technicalDetail?.support as number[])}`,
                    `저항선: ${arrayHead(technicalDetail?.resistance as number[])}`,
                    `ADX: ${formatMaybeNumber(technicalDetail?.adx as number | undefined)}`,
                  ]} />
                  <DetailPanel title="배당/컨센서스" rows={[
                    `연속 배당: ${valueOf(dividendDetail?.consecutiveDividendYears)}`,
                    `배당성향: ${formatMaybePercent(dividendDetail?.payoutRatio as number | undefined)}`,
                    `목표가 괴리: ${formatMaybePercent(deepAnalysis.targetUpside)}`,
                    `최근 서프라이즈: ${arrayHead(consensusDetail?.earningsSurprise as number[], '%')}`,
                  ]} />
                </div>
              </div>
            )}
          </div>

          {rec.suggestedStrategies.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">적합 전략</p>
              <div className="space-y-2">
                {rec.suggestedStrategies.map((strategy) => (
                  <div key={strategy.name} className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2">
                    <Target className="h-4 w-4 text-primary-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{strategy.displayName}</span>
                        <Badge variant={strategy.matchScore >= 70 ? 'success' : strategy.matchScore >= 50 ? 'warning' : 'outline'} className="text-[10px] px-1.5">
                          {strategy.matchScore}점
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{strategy.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {reasons.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">추천 근거</p>
              <div className="space-y-1">
                {reasons.map((reason, index) => (
                  <div key={index} className="flex items-start gap-2 text-sm">
                    <TrendingUp className="h-3.5 w-3.5 text-primary-500 mt-0.5 shrink-0" />
                    <span>{reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

function ScoreBar({ icon, label, score, max, tooltip }: { icon: ReactNode; label: string; score: number; max: number; tooltip?: string }) {
  const pct = Math.min((score / max) * 100, 100)
  const color = pct >= 70 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-400'

  return (
    <div>
      <div className="flex items-center gap-1 mb-1">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
        {tooltip && (
          <Tooltip text={tooltip}>
            <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
          </Tooltip>
        )}
        <span className="text-xs font-medium ml-auto">{score.toFixed(0)}/{max}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function InfoCell({ label, value, danger, success }: { label: string; value: string; danger?: boolean; success?: boolean }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}</span>
      <p className={`font-medium ${danger ? 'text-danger' : success ? 'text-success' : ''}`}>{value}</p>
    </div>
  )
}

function DeepCard({ icon, title, lines }: { icon: ReactNode; title: string; lines: string[] }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-sm font-medium mb-2">{icon}{title}</div>
      <div className="space-y-1 text-sm text-muted-foreground">
        {lines.map((line) => <p key={line}>{line}</p>)}
      </div>
    </div>
  )
}

function DetailPanel({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div className="rounded-lg bg-muted/30 px-3 py-3">
      <p className="text-xs font-medium text-muted-foreground mb-2">{title}</p>
      <div className="space-y-1">
        {rows.map((row) => <p key={row}>{row}</p>)}
      </div>
    </div>
  )
}

function renderIndicator(label: string, value: unknown, numberFormat = false, suffix = '') {
  if (value === undefined || value === null) return null
  const display = numberFormat ? formatNumber(Number(value)) : `${Number(value).toFixed(1)}${suffix}`
  return (
    <div key={label} className="rounded-lg bg-muted/50 px-3 py-1.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <p className="font-medium">{display}</p>
    </div>
  )
}

function buildRadarData(factors?: FactorScores) {
  if (!factors) return []
  return [
    ['기술', factors.technical, 15],
    ['가치', factors.valuation, 15],
    ['성장', factors.growth, 10],
    ['수익성', factors.profitability, 10],
    ['리스크', factors.risk, 10],
    ['모멘텀', factors.momentum, 10],
    ['수급', factors.supplyDemand, 10],
    ['배당', factors.dividend, 5],
    ['컨센서스', factors.consensus, 10],
    ['패턴', factors.pattern, 5],
  ]
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([label, value, max]) => ({ label, value: (Number(value) / Number(max)) * 100 }))
}

function factorLabel(key: string): string {
  const map: Record<string, string> = {
    technical: '기술',
    valuation: '가치',
    growth: '성장',
    profitability: '수익성',
    risk: '리스크',
    momentum: '모멘텀',
    supplyDemand: '수급',
    dividend: '배당',
    consensus: '컨센서스',
    pattern: '패턴',
    fundamental: '펀더 종합',
  }
  return map[key] || key
}

function formatMaybeNumber(value?: number | null) {
  if (value === undefined || value === null) return 'N/A'
  return formatNumber(value)
}

function formatMaybePercent(value?: number | null) {
  if (value === undefined || value === null) return 'N/A'
  return `${value.toFixed(1)}%`
}

function arrayHead(values?: number[], suffix = '') {
  if (!values || values.length === 0) return 'N/A'
  return values.slice(0, 3).map((value) => `${formatNumber(value)}${suffix}`).join(', ')
}

function valueOf(value: unknown) {
  if (value === undefined || value === null || value === '') return 'N/A'
  return String(value)
}
