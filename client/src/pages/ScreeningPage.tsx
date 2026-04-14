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
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Search, TrendingUp, BarChart3, Zap, ChevronDown, ChevronUp, ChevronLeft, Target, Calendar, Info, ShieldAlert, DollarSign, BookOpen, FlaskConical, X } from 'lucide-react'
import {
  useGetScreeningDateSummariesQuery,
  useGetStockRecommendationsQuery,
  useGetStockDeepAnalysisQuery,
  useCreateSimulationMutation,
  GetSimulationSessionsDocument,
  type Market,
  type GetStockRecommendationsQuery,
} from '@/graphql/generated'
import { getMutationErrorMessage } from '@/lib/apollo-utils'
import { formatNumber } from '@/lib/utils'
import { EXCHANGE_LABELS, COUNTRY_OPTIONS } from '@/lib/market-constants'
import { Tooltip } from '@/components/ui/tooltip'
import { TechnicalRatingsPanel } from '@/components/TechnicalRatingsPanel'
import type { TechnicalRatingsView } from '@/types'

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

const CELL_TOOLTIPS: Record<string, string> = {
  현재가: '조회 시점의 현재 체결가입니다.',
  거래량: '당일 누적 거래량입니다.',
  시가총액: '현재가 기준 시가총액입니다. 국내 값은 억 원 단위 원천 데이터를 사용합니다.',
  등락률: '전일 종가 대비 현재가 변화율입니다.',
}

const INDICATOR_TOOLTIPS: Record<string, string> = {
  'RSI(14)': '14일 기준 상대강도지수입니다. 보통 30 이하는 과매도, 70 이상은 과매수로 봅니다.',
  MA20: '최근 20거래일 종가 평균입니다.',
  MA60: '최근 60거래일 종가 평균입니다.',
  PER: '주가수익비율입니다. 현재 주가가 주당순이익의 몇 배인지 보여줍니다.',
  ROE: '자기자본이익률입니다. 자본 대비 수익 창출 효율을 뜻합니다.',
  'EV/EBITDA': '기업가치를 EBITDA로 나눈 값입니다. 업종 내 상대가치 비교에 자주 씁니다.',
  배당수익률: '현재 주가 대비 연간 배당금 비율입니다.',
  안전마진: '내부 DCF 적정가 대비 현재가가 얼마나 할인 또는 고평가 상태인지 보여줍니다. 음수면 현재가가 적정가보다 높다는 뜻입니다.',
}

const FACTOR_TOOLTIPS: Record<string, string> = {
  trend: '이동평균 구조, Ichimoku, MACD, ADX, Bollinger 등 가격 구조와 방향성 점수입니다.',
  timing: 'RSI, Stochastic, CCI, Williams %R 등 과열/침체와 눌림·반등 타이밍 점수입니다.',
  riskSupply: '변동성·낙폭·재무안정성과 함께 거래량·외인/기관 흐름을 합친 점수입니다.',
  valuation: 'PER, PBR, EV/EBITDA, 안전마진 등 가치평가 지표 기반 점수입니다.',
  growth: '매출, 이익, 자본 성장률 중심의 성장성 점수입니다.',
  profitability: '영업이익률, ROE, 순이익률 등 수익성 지표 점수입니다.',
  risk: '변동성, MDD, 부채비율, 유동비율, 차입금 의존도 등을 반영한 리스크 점수입니다.',
  supplyDemand: '거래량, 수급, 외국인/기관 흐름 등 수급 기반 점수입니다.',
  dividend: '배당수익률, 배당성향, 연속 배당 여부 등 주주환원 점수입니다.',
  consensus: '증권사 목표가, 투자의견, 추정 실적 등 시장 컨센서스를 바탕으로 한 점수입니다.',
  fundamental: '가치, 성장, 수익성 등 펀더멘털 팩터를 종합한 보조 점수입니다.',
}

const SECTION_TOOLTIPS: Record<string, string> = {
  DCF: '우리 내부 DCF 모델로 계산한 적정가와 안전마진입니다. 목표가는 별도의 증권사 컨센서스 값입니다.',
  리스크: '변동성, MDD, 재무안정성, 공매도·신용 데이터 기반 위험 요약입니다.',
  기술적: '추세 방향과 함께 배당, 증권사 컨센서스 같은 보조 판단 지표를 묶어 보여줍니다.',
  '기술 상세': '기술적 지표 세부값입니다. 지지선, 저항선, ADX를 확인할 수 있습니다.',
  '배당/컨센서스': '배당 이력과 배당성향, 증권사 목표가 대비 괴리, 실적 서프라이즈를 보여줍니다.',
}

const DEEP_ANALYSIS_GLOSSARY = [
  {
    term: '내부 DCF',
    description: '우리 내부 할인현금흐름(DCF) 모델 기준으로 계산한 적정가 영역입니다.',
  },
  {
    term: '내부 DCF 적정가',
    description: '매출 성장, 영업이익률, 할인율(WACC)을 넣어 우리 모델이 계산한 적정 주가입니다.',
  },
  {
    term: '안전마진',
    description: '내부 DCF 적정가 대비 현재가의 할인율입니다. 음수면 현재가가 적정가보다 높은 상태입니다.',
  },
  {
    term: '증권사 컨센서스 목표가',
    description: '여러 증권사 리포트의 목표가를 모아 본 시장 평균 목표가입니다.',
  },
  {
    term: '리스크',
    description: '변동성과 낙폭, 재무안정성, 공매도·신용 관련 위험을 종합해 보는 영역입니다.',
  },
  {
    term: '등급',
    description: '리스크 종합 결과를 LOW, MEDIUM, HIGH, EXTREME 같은 단계로 요약한 값입니다.',
  },
  {
    term: '30일 변동성',
    description: '최근 30거래일 가격 움직임이 얼마나 큰지 연율화해 보여주는 값입니다.',
  },
  {
    term: '90일 MDD',
    description: '최근 90거래일 기준 가장 큰 낙폭입니다. 값이 낮을수록 하락 폭이 컸다는 뜻입니다.',
  },
  {
    term: '기술적',
    description: '추세와 차트 위치, 보조지표를 바탕으로 현재 기술적 상태를 요약한 영역입니다.',
  },
  {
    term: '추세',
    description: '이동평균, MACD, ADX 등으로 본 현재 가격 흐름 방향입니다. 보통 상승, 하락, 횡보로 표시합니다.',
  },
  {
    term: '배당',
    description: '현재 주가 대비 연간 배당금 비율인 배당수익률을 뜻합니다.',
  },
  {
    term: '증권사 컨센서스',
    description: '여러 증권사 애널리스트의 투자의견, 목표가, 추정 실적을 모아 본 시장 평균 의견입니다.',
  },
  {
    term: '지지선',
    description: '최근 가격 흐름에서 주가가 버티기 쉬운 가격 구간입니다.',
  },
  {
    term: '저항선',
    description: '최근 가격 흐름에서 매물 부담이 커질 수 있는 가격 구간입니다.',
  },
  {
    term: 'ADX',
    description: '추세 강도를 보는 지표입니다. 보통 값이 높을수록 추세가 더 강하다고 해석합니다.',
  },
  {
    term: '배당/컨센서스',
    description: '배당 이력과 주주환원 지표, 증권사 목표가·실적 기대를 함께 보는 영역입니다.',
  },
  {
    term: '연속 배당',
    description: '배당 지급이 이어진 연수를 뜻합니다. 값이 높을수록 배당 이력이 꾸준하다는 의미입니다.',
  },
  {
    term: '배당성향',
    description: '순이익 대비 배당금 비율입니다. 벌어들인 이익 중 얼마를 배당에 쓰는지 보여줍니다.',
  },
  {
    term: '목표가 괴리(상승여력)',
    description: '현재가와 증권사 컨센서스 목표가의 차이입니다. 플러스면 목표가가 현재가보다 높다는 뜻입니다.',
  },
  {
    term: '최근 서프라이즈',
    description: '시장 예상 실적과 실제 실적의 차이를 뜻합니다. 플러스면 예상보다 좋았다는 의미입니다.',
  },
]

type DateSummary = {
  date: string
  totalCount: number
  countries: Array<{ country: string; label: string; count: number; avgScore: number }>
}

type ScreeningRecommendationItem = GetStockRecommendationsQuery['stockRecommendations'][number]
type FactorScores = ScreeningRecommendationItem['factorScores']

function getAxisMax(rec: Pick<ScreeningRecommendationItem, 'isEtf'>, axis: 'trend' | 'timing' | 'fundamental' | 'riskSupply') {
  if (rec.isEtf) {
    return { trend: 35, timing: 25, fundamental: 10, riskSupply: 30 }[axis]
  }
  return { trend: 30, timing: 20, fundamental: 30, riskSupply: 20 }[axis]
}

function axisRatio(score: number, max: number) {
  if (max <= 0) return 0
  return (score / max) * 100
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
  const [showDeepHelp, setShowDeepHelp] = useState(false)
  const [simTarget, setSimTarget] = useState<{
    rec: ScreeningRecommendationItem
    strategy: { name: string; displayName: string; matchScore: number }
  } | null>(null)
  let reasons: string[] = []
  try { reasons = JSON.parse(rec.reasons) } catch { /* ignore invalid JSON */ }

  let indicators: Record<string, unknown> = {}
  try { indicators = JSON.parse(rec.indicators) } catch { /* ignore invalid JSON */ }

  const { data: deepAnalysisData, loading: deepLoading } = useGetStockDeepAnalysisQuery({
    variables: { stockCode: rec.stockCode, exchangeCode: rec.exchangeCode, date },
    skip: !expanded,
  })

  const deepAnalysis = deepAnalysisData?.stockDeepAnalysis ?? null
  const deepAnalysisStatusMessage = (() => {
    if (deepAnalysis) return null
    if (rec.deepAnalysisStatus === 'FAILED') {
      return rec.deepAnalysisMessage
        ? `딥 분석 실패: ${rec.deepAnalysisMessage}`
        : '딥 분석이 실패했습니다.'
    }
    if (rec.deepAnalysisStatus === 'PENDING') {
      return rec.deepAnalysisMessage || '딥 분석 대기 중입니다.'
    }
    if (rec.deepAnalysisStatus === 'SUCCESS') {
      return '딥 분석 저장 결과를 아직 불러오지 못했습니다.'
    }
    return '딥 분석 결과가 아직 없습니다.'
  })()
  const technicalDetail = parseJson<Record<string, unknown>>(deepAnalysis?.technicalDetail)
  const dividendDetail = parseJson<Record<string, unknown>>(deepAnalysis?.dividendDetail)
  const consensusDetail = parseJson<Record<string, unknown>>(deepAnalysis?.consensusDetail)
  const technicalRatings = indicators.technicalRatings as TechnicalRatingsView | undefined
  const radarData = buildRadarData(rec)

  return (
    <Card className="overflow-hidden">
      <button className="w-full text-left cursor-pointer" onClick={onToggle}>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <span className="text-lg font-bold text-muted-foreground w-8 shrink-0">#{rec.rank}</span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{rec.stockName}</CardTitle>
                  <span className="text-xs text-muted-foreground">{rec.stockCode}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <Badge variant="outline" className="text-xs">
                    {EXCHANGE_LABELS[rec.exchangeCode] || rec.exchangeCode}
                  </Badge>
                  <span className={`text-sm font-medium ${rec.changeRate >= 0 ? 'text-success' : 'text-danger'}`}>
                    {rec.changeRate >= 0 ? '+' : ''}{rec.changeRate.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 md:justify-end">
              <div className="text-left md:text-right">
                <div className="flex items-center gap-1 justify-end">
                  <span className={`text-xl font-bold ${scoreColor(rec.totalScore)}`}>{rec.totalScore.toFixed(1)}</span>
                  <Tooltip text="멀티팩터 100점 만점 점수입니다. 추세, 타이밍, 펀더, 리스크·수급 4축을 종합합니다.">
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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <ScoreBar icon={<TrendingUp className="h-3.5 w-3.5" />} label="추세" score={rec.trendScore} max={getAxisMax(rec, 'trend')} tooltip="가격 구조와 방향성 점수" />
          <ScoreBar icon={<Zap className="h-3.5 w-3.5" />} label="타이밍" score={rec.timingScore} max={getAxisMax(rec, 'timing')} tooltip="과열/침체와 눌림·반등 타이밍 점수" />
          <ScoreBar icon={<BarChart3 className="h-3.5 w-3.5" />} label="펀더" score={rec.fundamentalScore} max={getAxisMax(rec, 'fundamental')} tooltip="가치·성장·수익성·주주환원 종합 점수" />
          <ScoreBar icon={<ShieldAlert className="h-3.5 w-3.5" />} label="리스크·수급" score={rec.riskSupplyScore} max={getAxisMax(rec, 'riskSupply')} tooltip="위험도와 실제 자금 유입 흐름 종합 점수" />
        </div>
      </CardContent>

      {expanded && (
        <CardContent className="border-t border-border pt-4 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <InfoCell label="현재가" value={formatNumber(rec.currentPrice)} tooltip={CELL_TOOLTIPS.현재가} />
            <InfoCell label="거래량" value={formatNumber(rec.volume)} tooltip={CELL_TOOLTIPS.거래량} />
            <InfoCell label="시가총액" value={formatNumber(rec.marketCap)} tooltip={CELL_TOOLTIPS.시가총액} />
            <InfoCell label="등락률" value={`${rec.changeRate >= 0 ? '+' : ''}${rec.changeRate.toFixed(2)}%`} danger={rec.changeRate < 0} success={rec.changeRate >= 0} tooltip={CELL_TOOLTIPS.등락률} />
          </div>

          <TechnicalRatingsPanel ratings={technicalRatings} title="TradingView 스타일 기술 요약" compact />

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

              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
                {factorEntries(rec.factorScores).map(([key, value]) => (
                  <div key={key} className="rounded-lg bg-muted/50 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide">
                      <MetricLabel label={factorLabel(key)} tooltip={FACTOR_TOOLTIPS[key]} />
                    </div>
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">딥 분석 패널</p>
                {deepAnalysis?.riskGrade && <Badge variant={riskBadgeVariant(deepAnalysis.riskGrade)}>{deepAnalysis.riskGrade}</Badge>}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDeepHelp((value) => !value)}
              >
                <BookOpen className="h-3.5 w-3.5" />
                {showDeepHelp ? '도움말 닫기' : '용어 도움말'}
              </Button>
            </div>

            {deepLoading ? (
              <p className="text-sm text-muted-foreground">딥 분석 로딩중...</p>
            ) : !deepAnalysis ? (
              <p className="text-sm text-muted-foreground">{deepAnalysisStatusMessage}</p>
            ) : (
              <div className="space-y-4">
                {showDeepHelp && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    {DEEP_ANALYSIS_GLOSSARY.map((item) => (
                      <div key={item.term} className="rounded-lg bg-muted/30 px-3 py-3">
                        <p className="font-medium text-foreground">{item.term}</p>
                        <p className="mt-1 text-muted-foreground">{item.description}</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <DeepCard
                    icon={<DollarSign className="h-4 w-4" />}
                    title="내부 DCF"
                    tooltip={SECTION_TOOLTIPS.DCF}
                    lines={[
                      `내부 DCF 적정가 ${formatMaybeNumber(deepAnalysis.intrinsicValue)}`,
                      `안전마진 ${formatMaybePercent(deepAnalysis.marginOfSafety)}`,
                      `증권사 컨센서스 목표가 ${formatMaybeNumber(deepAnalysis.targetPrice)}`,
                    ]}
                  />
                  <DeepCard
                    icon={<ShieldAlert className="h-4 w-4" />}
                    title="리스크"
                    tooltip={SECTION_TOOLTIPS.리스크}
                    lines={[
                      `등급 ${deepAnalysis.riskGrade ?? 'N/A'}`,
                      `30일 변동성 ${formatMaybePercent(deepAnalysis.volatility30d)}`,
                      `90일 MDD ${formatMaybePercent(deepAnalysis.maxDrawdown90d)}`,
                    ]}
                  />
                  <DeepCard
                    icon={<TrendingUp className="h-4 w-4" />}
                    title="기술적"
                    tooltip={SECTION_TOOLTIPS.기술적}
                    lines={[
                      `추세 ${deepAnalysis.trendDirection ?? 'N/A'}`,
                      `배당 ${formatMaybePercent(deepAnalysis.dividendYield)}`,
                      `증권사 컨센서스 ${deepAnalysis.consensusRating ?? 'N/A'}`,
                    ]}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <DetailPanel title="기술 상세" rows={[
                    `지지선: ${arrayHead(technicalDetail?.support as number[])}`,
                    `저항선: ${arrayHead(technicalDetail?.resistance as number[])}`,
                    `ADX: ${formatMaybeNumber(technicalDetail?.adx as number | undefined)}`,
                  ]} tooltip={SECTION_TOOLTIPS['기술 상세']} />
                  <DetailPanel title="배당/컨센서스" rows={[
                    `연속 배당: ${valueOf(dividendDetail?.consecutiveDividendYears)}`,
                    `배당성향: ${formatMaybePercent(dividendDetail?.payoutRatio as number | undefined)}`,
                    `목표가 괴리(상승여력): ${formatMaybePercent(deepAnalysis.targetUpside)}`,
                    `최근 서프라이즈: ${arrayHead(consensusDetail?.earningsSurprise as number[], '%')}`,
                  ]} tooltip={SECTION_TOOLTIPS['배당/컨센서스']} />
                </div>
              </div>
            )}
          </div>

          {rec.suggestedStrategies.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">적합 자동매매 전략</p>
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
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSimTarget({
                          rec,
                          strategy: {
                            name: strategy.name,
                            displayName: strategy.displayName,
                            matchScore: strategy.matchScore,
                          },
                        })
                      }}
                    >
                      <FlaskConical size={14} />
                      시뮬레이션 추가
                    </Button>
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

      {simTarget && (
        <AddToSimulationModal
          rec={simTarget.rec}
          strategyName={simTarget.strategy.name}
          strategyDisplayName={simTarget.strategy.displayName}
          onClose={() => setSimTarget(null)}
        />
      )}
    </Card>
  )
}

function AddToSimulationModal({
  rec,
  strategyName,
  strategyDisplayName,
  onClose,
}: {
  rec: ScreeningRecommendationItem
  strategyName: string
  strategyDisplayName: string
  onClose: () => void
}) {
  const defaultName = `${rec.stockName} × ${strategyDisplayName}`
  const [name, setName] = useState(defaultName)
  const [investmentAmount, setInvestmentAmount] = useState('')
  const [error, setError] = useState('')

  const [createMutation, { loading }] = useCreateSimulationMutation({
    refetchQueries: [GetSimulationSessionsDocument],
  })

  const handleCreate = async () => {
    const missing: string[] = []
    if (!name.trim()) missing.push('이름')
    if (!investmentAmount || Number(investmentAmount) <= 0) missing.push('투자금')

    if (missing.length > 0) {
      setError(`${missing.join(', ')}을(를) 입력해주세요`)
      return
    }

    setError('')

    try {
      await createMutation({
        variables: {
          input: {
            name: name.trim(),
            market: rec.market as Market,
            exchangeCode: rec.exchangeCode,
            stockCode: rec.stockCode,
            stockName: rec.stockName,
            strategyName,
            quota: Number(investmentAmount),
          },
        },
      })
      onClose()
    } catch (e: unknown) {
      setError(getMutationErrorMessage(e, '생성 중 오류가 발생했습니다'))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative bg-card border border-border rounded-xl shadow-lg w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-foreground">{rec.stockName} × {strategyDisplayName}</h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted text-muted-foreground cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">이름</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">투자금</label>
            <Input
              type="number"
              value={investmentAmount}
              onChange={(e) => setInvestmentAmount(e.target.value)}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            손절률 등 상세 설정은 시뮬레이션 페이지에서 변경할 수 있습니다.
          </p>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>취소</Button>
            <Button onClick={handleCreate} disabled={loading}>
              {loading ? '생성중...' : '생성'}
            </Button>
          </div>
        </div>
      </div>
    </div>
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

function MetricLabel({ label, tooltip }: { label: string; tooltip?: string }) {
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      <span className="text-sm">{label}</span>
      {tooltip && (
        <Tooltip text={tooltip}>
          <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
        </Tooltip>
      )}
    </span>
  )
}

function InfoCell({ label, value, danger, success, tooltip }: { label: string; value: string; danger?: boolean; success?: boolean; tooltip?: string }) {
  return (
    <div>
      <MetricLabel label={label} tooltip={tooltip} />
      <p className={`font-medium ${danger ? 'text-danger' : success ? 'text-success' : ''}`}>{value}</p>
    </div>
  )
}

function DeepCard({ icon, title, lines, tooltip }: { icon: ReactNode; title: string; lines: string[]; tooltip?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-sm font-medium mb-2">
        {icon}
        <span>{title}</span>
        {tooltip && (
          <Tooltip text={tooltip}>
            <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
          </Tooltip>
        )}
      </div>
      <div className="space-y-1 text-sm text-muted-foreground">
        {lines.map((line) => <p key={line}>{line}</p>)}
      </div>
    </div>
  )
}

function DetailPanel({ title, rows, tooltip }: { title: string; rows: string[]; tooltip?: string }) {
  return (
    <div className="rounded-lg bg-muted/30 px-3 py-3">
      <div className="mb-2 text-xs font-medium">
        <MetricLabel label={title} tooltip={tooltip} />
      </div>
      <div className="space-y-1">
        {rows.map((row) => <p key={row}>{row}</p>)}
      </div>
    </div>
  )
}

function renderIndicator(label: string, value: unknown, numberFormat = false, suffix = '') {
  if (value === undefined || value === null) return null
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return null
  const display = numberFormat ? formatNumber(numericValue) : `${numericValue.toFixed(1)}${suffix}`
  return (
    <div key={label} className="rounded-lg bg-muted/50 px-3 py-1.5">
      <div className="text-xs font-medium">
        <MetricLabel label={label} tooltip={INDICATOR_TOOLTIPS[label]} />
      </div>
      <p className="font-medium">{display}</p>
    </div>
  )
}

function buildRadarData(rec: Pick<ScreeningRecommendationItem, 'factorScores' | 'trendScore' | 'timingScore' | 'fundamentalScore' | 'riskSupplyScore' | 'isEtf'>) {
  return [
    ['추세', rec.trendScore, getAxisMax(rec, 'trend')],
    ['타이밍', rec.timingScore, getAxisMax(rec, 'timing')],
    ['펀더', rec.fundamentalScore, getAxisMax(rec, 'fundamental')],
    ['리스크·수급', rec.riskSupplyScore, getAxisMax(rec, 'riskSupply')],
  ]
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([label, value, max]) => ({ label, value: (Number(value) / Number(max)) * 100 }))
}

function factorEntries(factors?: FactorScores) {
  if (!factors) return []
  return Object.entries(factors).filter(([key, value]) => key !== '__typename' && Number.isFinite(Number(value)))
}

function factorLabel(key: string): string {
  const map: Record<string, string> = {
    trend: '추세',
    timing: '타이밍',
    valuation: '가치',
    growth: '성장',
    profitability: '수익성',
    risk: '리스크',
    riskSupply: '리스크·수급',
    supplyDemand: '수급',
    dividend: '배당',
    consensus: '컨센서스',
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
