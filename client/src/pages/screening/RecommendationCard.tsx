import { useState } from 'react'
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
import { Tooltip } from '@/components/ui/tooltip'
import { TechnicalRatingsPanel } from '@/components/TechnicalRatingsPanel'
import {
  TrendingUp,
  BarChart3,
  Zap,
  ChevronDown,
  ChevronUp,
  Target,
  Info,
  ShieldAlert,
  DollarSign,
  BookOpen,
  FlaskConical,
} from 'lucide-react'
import { useGetStockDeepAnalysisQuery } from '@/graphql/generated'
import { formatNumber } from '@/lib/utils'
import { EXCHANGE_LABELS } from '@/lib/market-constants'
import type { TechnicalRatingsView } from '@/types'
import {
  scoreColor,
  scoreBadgeVariant,
  parseJson,
  riskBadgeVariant,
  buildRadarData,
  factorEntries,
  factorLabel,
  formatMaybeNumber,
  formatMaybePercent,
  arrayHead,
  valueOf,
  getAxisMax,
  CELL_TOOLTIPS,
  FACTOR_TOOLTIPS,
  SECTION_TOOLTIPS,
  DEEP_ANALYSIS_GLOSSARY,
} from './screening-helpers'
import { ScoreBar, InfoCell, DeepCard, DetailPanel, MetricLabel, renderIndicator } from './ScreeningCommon'
import { AddToSimulationModal } from './AddToSimulationModal'
import type { RecommendationCardProps, ScreeningRecommendationItem } from './types'

// ── 추천 종목 카드 (접기/펼치기) ──

export function RecommendationCard({ rec, date, expanded, onToggle }: RecommendationCardProps) {
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
