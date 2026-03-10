import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Search, TrendingUp, BarChart3, Brain, Zap, ChevronDown, ChevronUp, ChevronLeft, Target, Calendar, Info } from 'lucide-react'
import {
  useGetStockRecommendationsQuery,
  useGetScreeningDateSummariesQuery,
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

const COUNTRY_FLAG: Record<string, string> = {
  KR: '🇰🇷', US: '🇺🇸', HK: '🇭🇰', CN: '🇨🇳', JP: '🇯🇵', VN: '🇻🇳',
}

type DateSummary = {
  date: string
  totalCount: number
  countries: Array<{ country: string; label: string; count: number; avgScore: number }>
}

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

// ── 날짜 목록 화면 (필터 포함) ──

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

  // summaries 로딩 완료 후 최신 날짜 자동 선택
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

  // 필터링된 summaries
  const filteredSummaries = summaries
    .filter((s) => !selectedDate || s.date === selectedDate)
    .map((s) => ({
      ...s,
      countries: countryFilter
        ? s.countries.filter((c) => c.country === countryFilter)
        : s.countries,
    }))
    .filter((s) => s.countries.length > 0)

  // 전체 국가 목록 (필터 버튼용)
  const allCountries = new Map<string, string>()
  for (const s of summaries) {
    for (const c of s.countries) {
      allCountries.set(c.country, c.label)
    }
  }

  return (
    <>
      {/* 필터 바 */}
      <div className="flex flex-wrap gap-3 items-center">
        <Select
          value={selectedDate || ''}
          onChange={(e) => setSelectedDate(e.target.value || null)}
          className="w-48"
        >
          <option value="">전체 날짜</option>
          {summaries.map((s) => (
            <option key={s.date} value={s.date}>
              {formatScreeningDate(s.date)} ({s.totalCount}종목)
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

      {/* 날짜별 카드 */}
      <div className="space-y-3">
        {filteredSummaries.map((s) => (
          <Card key={s.date}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">{formatScreeningDate(s.date)}</CardTitle>
                <Badge variant="outline" className="ml-auto text-xs">
                  {s.countries.reduce((sum, c) => sum + c.count, 0)}종목
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {s.countries.map((c) => (
                  <button
                    key={c.country}
                    className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer text-left"
                    onClick={() => onSelect(s.date, c.country)}
                  >
                    <span className="text-lg">{COUNTRY_FLAG[c.country] || '🌐'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium">{c.label}</span>
                        <span className="text-xs text-muted-foreground">{c.count}종목</span>
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-xs text-muted-foreground">평균</span>
                        <span className={`text-xs font-medium ${scoreColor(c.avgScore)}`}>
                          {c.avgScore.toFixed(1)}점
                        </span>
                      </div>
                    </div>
                    <ChevronDown className="h-4 w-4 text-muted-foreground -rotate-90" />
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}

        {filteredSummaries.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground text-sm">해당 조건의 스크리닝 결과가 없습니다</p>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}

// ── 종목 상세 화면 ──

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
  const countryOption = COUNTRY_OPTIONS.find((c) => c.value === country)
  const countryLabel = countryOption?.label || country
  const marketFilter = countryOption?.market ?? undefined

  const { data, loading } = useGetStockRecommendationsQuery({
    variables: { input: { date, market: marketFilter, limit: 50 } },
  })

  const allRecommendations = data?.stockRecommendations ?? []
  const recommendations = allRecommendations.filter((r) => {
    if (!countryOption) return true
    return countryOption.exchanges.includes(r.exchangeCode)
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
        <Badge variant="outline" className="ml-auto">
          {recommendations.length}개 종목
        </Badge>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">로딩중...</div>
      ) : recommendations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Search className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">추천 종목이 없습니다</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {recommendations.map((r) => (
            <RecommendationCard
              key={r.id}
              rec={r}
              expanded={expandedId === r.id}
              onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
            />
          ))}
        </div>
      )}
    </>
  )
}

// ── 종목 카드 ──

interface SuggestedStrategy {
  name: string
  displayName: string
  matchScore: number
  reason: string
}

interface RecommendationCardProps {
  rec: {
    id: string
    rank: number
    stockCode: string
    stockName: string
    exchangeCode: string
    market: string
    totalScore: number
    technicalScore: number
    fundamentalScore: number
    momentumScore: number
    currentPrice: number
    changeRate: number
    volume: number
    marketCap: number
    reasons: string
    indicators: string
    suggestedStrategies: SuggestedStrategy[]
    createdAt: string
  }
  expanded: boolean
  onToggle: () => void
}

function RecommendationCard({ rec, expanded, onToggle }: RecommendationCardProps) {
  let reasons: string[] = []
  try { reasons = JSON.parse(rec.reasons) } catch { /* ignore */ }

  let indicators: Record<string, unknown> = {}
  try { indicators = JSON.parse(rec.indicators) } catch { /* ignore */ }

  return (
    <Card className="overflow-hidden">
      <button
        className="w-full text-left cursor-pointer"
        onClick={onToggle}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold text-muted-foreground w-8">
                #{rec.rank}
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">{rec.stockName}</CardTitle>
                  <span className="text-xs text-muted-foreground">{rec.stockCode}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <Badge variant="outline" className="text-xs">
                    {EXCHANGE_LABELS[rec.exchangeCode] || rec.exchangeCode}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(rec.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className={`text-sm font-medium ${rec.changeRate >= 0 ? 'text-success' : 'text-danger'}`}>
                    {rec.changeRate >= 0 ? '+' : ''}{rec.changeRate.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="flex items-center gap-1 justify-end">
                  <span className={`text-xl font-bold ${scoreColor(rec.totalScore)}`}>
                    {rec.totalScore.toFixed(1)}
                  </span>
                  <Tooltip text="기술적(40) + 펀더멘탈(30) + 모멘텀(30) = 100점 만점. 70점 이상 강력 추천, 50점 이상 관심, 그 미만은 보통. 거래량 상위 종목 대상 자동 스코어링 결과이며, 투자 판단은 개별 지표와 추천 근거를 함께 확인하세요.">
                    <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                  </Tooltip>
                </div>
                <Badge variant={scoreBadgeVariant(rec.totalScore)} className="text-xs">
                  {rec.totalScore >= 70 ? '강력 추천' : rec.totalScore >= 50 ? '관심' : '보통'}
                </Badge>
              </div>
              {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>
        </CardHeader>
      </button>

      <CardContent className="pt-0 pb-3">
        <div className="grid grid-cols-3 gap-3">
          <ScoreBar icon={<Brain className="h-3.5 w-3.5" />} label="기술적" score={rec.technicalScore} max={40} tooltip="이동평균선, RSI, 볼린저밴드 등 차트 기반 분석 점수 (40점 만점)" />
          <ScoreBar icon={<BarChart3 className="h-3.5 w-3.5" />} label="펀더멘탈" score={rec.fundamentalScore} max={30} tooltip="PER, ROE, 시가총액 등 재무 건전성 평가 점수 (30점 만점)" />
          <ScoreBar icon={<Zap className="h-3.5 w-3.5" />} label="모멘텀" score={rec.momentumScore} max={30} tooltip="거래량 급증, 가격 상승 추세 등 단기 모멘텀 점수 (30점 만점)" />
        </div>
      </CardContent>

      {expanded && (
        <CardContent className="border-t border-border pt-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">현재가</span>
              <p className="font-medium">{formatNumber(rec.currentPrice)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">거래량</span>
              <p className="font-medium">{formatNumber(rec.volume)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">시가총액</span>
              <p className="font-medium">{formatNumber(rec.marketCap)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">등락률</span>
              <p className={`font-medium ${rec.changeRate >= 0 ? 'text-success' : 'text-danger'}`}>
                {rec.changeRate >= 0 ? '+' : ''}{rec.changeRate.toFixed(2)}%
              </p>
            </div>
          </div>

          {Object.keys(indicators).length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">지표</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                {indicators.rsi14 !== undefined && (
                  <div className="rounded-lg bg-muted/50 px-3 py-1.5">
                    <span className="text-muted-foreground text-xs flex items-center gap-0.5">RSI(14)<Tooltip text="상대강도지수. 30 이하 과매도(매수 기회), 70 이상 과매수(매도 신호)"><Info className="h-3 w-3 text-muted-foreground/60 cursor-help" /></Tooltip></span>
                    <p className="font-medium">{Number(indicators.rsi14).toFixed(1)}</p>
                  </div>
                )}
                {indicators.ma20 !== undefined && (
                  <div className="rounded-lg bg-muted/50 px-3 py-1.5">
                    <span className="text-muted-foreground text-xs flex items-center gap-0.5">MA20<Tooltip text="20일 이동평균선. 단기 추세 지표로, 현재가가 위에 있으면 상승 추세"><Info className="h-3 w-3 text-muted-foreground/60 cursor-help" /></Tooltip></span>
                    <p className="font-medium">{formatNumber(Number(indicators.ma20))}</p>
                  </div>
                )}
                {indicators.ma60 !== undefined && (
                  <div className="rounded-lg bg-muted/50 px-3 py-1.5">
                    <span className="text-muted-foreground text-xs flex items-center gap-0.5">MA60<Tooltip text="60일 이동평균선. 중기 추세 지표. MA20이 MA60 상향 돌파 시 골든크로스(매수 신호)"><Info className="h-3 w-3 text-muted-foreground/60 cursor-help" /></Tooltip></span>
                    <p className="font-medium">{formatNumber(Number(indicators.ma60))}</p>
                  </div>
                )}
                {indicators.ma200 !== undefined && (
                  <div className="rounded-lg bg-muted/50 px-3 py-1.5">
                    <span className="text-muted-foreground text-xs flex items-center gap-0.5">MA200<Tooltip text="200일 이동평균선. 장기 추세 기준선으로, 현재가가 위에 있으면 장기 상승 추세"><Info className="h-3 w-3 text-muted-foreground/60 cursor-help" /></Tooltip></span>
                    <p className="font-medium">{formatNumber(Number(indicators.ma200))}</p>
                  </div>
                )}
                {indicators.per !== undefined && (
                  <div className="rounded-lg bg-muted/50 px-3 py-1.5">
                    <span className="text-muted-foreground text-xs flex items-center gap-0.5">PER<Tooltip text="주가수익비율. 주가 ÷ 주당순이익. 낮을수록 저평가, 업종 평균과 비교하여 판단"><Info className="h-3 w-3 text-muted-foreground/60 cursor-help" /></Tooltip></span>
                    <p className="font-medium">{Number(indicators.per).toFixed(1)}</p>
                  </div>
                )}
                {indicators.roe !== undefined && (
                  <div className="rounded-lg bg-muted/50 px-3 py-1.5">
                    <span className="text-muted-foreground text-xs flex items-center gap-0.5">ROE<Tooltip text="자기자본이익률. 자기자본 대비 이익 비율. 10% 이상이면 양호"><Info className="h-3 w-3 text-muted-foreground/60 cursor-help" /></Tooltip></span>
                    <p className="font-medium">{Number(indicators.roe).toFixed(1)}%</p>
                  </div>
                )}
                {indicators.volumeSurgeRate !== undefined && (
                  <div className="rounded-lg bg-muted/50 px-3 py-1.5">
                    <span className="text-muted-foreground text-xs flex items-center gap-0.5">거래량 급증<Tooltip text="평균 거래량 대비 급증 비율. 시장의 관심이 집중되고 있음을 의미"><Info className="h-3 w-3 text-muted-foreground/60 cursor-help" /></Tooltip></span>
                    <p className="font-medium">+{Number(indicators.volumeSurgeRate).toFixed(0)}%</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {rec.suggestedStrategies.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">적합 전략</p>
              <div className="space-y-2">
                {rec.suggestedStrategies.map((s) => (
                  <div key={s.name} className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2">
                    <Target className="h-4 w-4 text-primary-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{s.displayName}</span>
                        <Badge variant={s.matchScore >= 70 ? 'success' : s.matchScore >= 50 ? 'warning' : 'outline'} className="text-[10px] px-1.5">
                          {s.matchScore}점
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{s.reason}</p>
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
                {reasons.map((reason, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
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

function ScoreBar({ icon, label, score, max, tooltip }: { icon: React.ReactNode; label: string; score: number; max: number; tooltip?: string }) {
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
