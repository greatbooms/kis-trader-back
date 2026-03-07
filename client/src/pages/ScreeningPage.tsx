import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Search, TrendingUp, BarChart3, Brain, Zap, ChevronDown, ChevronUp, Target } from 'lucide-react'
import {
  useGetStockRecommendationsQuery,
  useGetScreeningDatesQuery,
} from '@/graphql/generated'
import { formatNumber } from '@/lib/utils'
import { COUNTRY_OPTIONS, EXCHANGE_LABELS, filterByCountry } from '@/lib/market-constants'

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

export function ScreeningPage() {
  const [countryFilter, setCountryFilter] = useState<string | null>(null)
  const selectedCountry = COUNTRY_OPTIONS.find((c) => c.value === countryFilter)
  const marketFilter = selectedCountry?.market ?? undefined

  const [selectedDate, setSelectedDate] = useState<string | undefined>()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: datesData } = useGetScreeningDatesQuery({ variables: { limit: 30 } })
  const dates = datesData?.screeningDates ?? []

  const { data, loading } = useGetStockRecommendationsQuery({
    variables: {
      date: selectedDate || undefined,
      market: marketFilter,
      limit: 50,
    },
  })
  const allRecommendations = data?.stockRecommendations ?? []
  const recommendations = filterByCountry(allRecommendations, countryFilter)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">종목 추천</h2>
        <p className="text-sm text-muted-foreground mt-1">
          다중 팩터 분석 기반 종목 스크리닝 결과
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <Select
          value={selectedDate || ''}
          onChange={(e) => setSelectedDate(e.target.value || undefined)}
          className="w-44"
        >
          <option value="">최신 날짜</option>
          {dates.map((d) => (
            <option key={d} value={d}>{formatScreeningDate(d)}</option>
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
          {COUNTRY_OPTIONS.map((c) => (
            <Button
              key={c.value}
              variant={countryFilter === c.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setCountryFilter(c.value)}
            >
              {c.label}
            </Button>
          ))}
        </div>

        <span className="text-sm text-muted-foreground ml-auto">
          {recommendations.length}개 종목
        </span>
      </div>

      {/* Results */}
      {loading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">로딩중...</div>
      ) : recommendations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Search className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">스크리닝 결과가 없습니다</p>
            <p className="text-xs text-muted-foreground mt-1">스케줄러가 실행되면 자동으로 업데이트됩니다</p>
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
    </div>
  )
}

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
                  <span className={`text-sm font-medium ${rec.changeRate >= 0 ? 'text-success' : 'text-danger'}`}>
                    {rec.changeRate >= 0 ? '+' : ''}{rec.changeRate.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className={`text-xl font-bold ${scoreColor(rec.totalScore)}`}>
                  {rec.totalScore.toFixed(1)}
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

      {/* Score bars (always visible) */}
      <CardContent className="pt-0 pb-3">
        <div className="grid grid-cols-3 gap-3">
          <ScoreBar icon={<Brain className="h-3.5 w-3.5" />} label="기술적" score={rec.technicalScore} max={40} />
          <ScoreBar icon={<BarChart3 className="h-3.5 w-3.5" />} label="펀더멘탈" score={rec.fundamentalScore} max={30} />
          <ScoreBar icon={<Zap className="h-3.5 w-3.5" />} label="모멘텀" score={rec.momentumScore} max={30} />
        </div>
      </CardContent>

      {/* Expanded details */}
      {expanded && (
        <CardContent className="border-t border-border pt-4 space-y-4">
          {/* Key metrics */}
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

          {/* Indicators */}
          {Object.keys(indicators).length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">지표</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                {indicators.rsi14 !== undefined && (
                  <div className="rounded-lg bg-muted/50 px-3 py-1.5">
                    <span className="text-muted-foreground text-xs">RSI(14)</span>
                    <p className="font-medium">{Number(indicators.rsi14).toFixed(1)}</p>
                  </div>
                )}
                {indicators.ma20 !== undefined && (
                  <div className="rounded-lg bg-muted/50 px-3 py-1.5">
                    <span className="text-muted-foreground text-xs">MA20</span>
                    <p className="font-medium">{formatNumber(Number(indicators.ma20))}</p>
                  </div>
                )}
                {indicators.ma60 !== undefined && (
                  <div className="rounded-lg bg-muted/50 px-3 py-1.5">
                    <span className="text-muted-foreground text-xs">MA60</span>
                    <p className="font-medium">{formatNumber(Number(indicators.ma60))}</p>
                  </div>
                )}
                {indicators.ma200 !== undefined && (
                  <div className="rounded-lg bg-muted/50 px-3 py-1.5">
                    <span className="text-muted-foreground text-xs">MA200</span>
                    <p className="font-medium">{formatNumber(Number(indicators.ma200))}</p>
                  </div>
                )}
                {indicators.per !== undefined && (
                  <div className="rounded-lg bg-muted/50 px-3 py-1.5">
                    <span className="text-muted-foreground text-xs">PER</span>
                    <p className="font-medium">{Number(indicators.per).toFixed(1)}</p>
                  </div>
                )}
                {indicators.roe !== undefined && (
                  <div className="rounded-lg bg-muted/50 px-3 py-1.5">
                    <span className="text-muted-foreground text-xs">ROE</span>
                    <p className="font-medium">{Number(indicators.roe).toFixed(1)}%</p>
                  </div>
                )}
                {indicators.volumeSurgeRate !== undefined && (
                  <div className="rounded-lg bg-muted/50 px-3 py-1.5">
                    <span className="text-muted-foreground text-xs">거래량 급증</span>
                    <p className="font-medium">+{Number(indicators.volumeSurgeRate).toFixed(0)}%</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Suggested Strategies */}
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

          {/* Reasons */}
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

function ScoreBar({ icon, label, score, max }: { icon: React.ReactNode; label: string; score: number; max: number }) {
  const pct = Math.min((score / max) * 100, 100)
  const color = pct >= 70 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-400'

  return (
    <div>
      <div className="flex items-center gap-1 mb-1">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-medium ml-auto">{score.toFixed(0)}/{max}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
