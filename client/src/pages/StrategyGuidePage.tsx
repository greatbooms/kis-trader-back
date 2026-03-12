import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BookOpen, ChevronDown, ChevronUp, TrendingUp, ShieldAlert, Clock, CalendarDays, BarChart3, Users } from 'lucide-react'
import { useGetAvailableStrategiesQuery } from '@/graphql/generated'

const RISK_CONFIG: Record<string, { label: string; color: string; barWidth: string }> = {
  'very-low': { label: '매우 낮음', color: 'text-emerald-400', barWidth: 'w-1/5' },
  'low': { label: '낮음', color: 'text-green-400', barWidth: 'w-2/5' },
  'medium': { label: '보통', color: 'text-yellow-400', barWidth: 'w-3/5' },
  'high': { label: '높음', color: 'text-orange-400', barWidth: 'w-4/5' },
  'very-high': { label: '매우 높음', color: 'text-red-400', barWidth: 'w-full' },
}

const RISK_BAR_BG: Record<string, string> = {
  'very-low': 'bg-emerald-400',
  'low': 'bg-green-400',
  'medium': 'bg-yellow-400',
  'high': 'bg-orange-400',
  'very-high': 'bg-red-400',
}

export function StrategyGuidePage() {
  const { data, loading } = useGetAvailableStrategiesQuery()
  const strategies = data?.availableStrategies ?? []
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">전략 가이드</h2>
        <p className="text-sm text-muted-foreground mt-1">자동매매 전략별 동작 방식과 투자 참고 정보를 확인하세요</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-warning" />
            <CardTitle>공통 리스크 관리</CardTitle>
          </div>
          <CardDescription>모든 전략에 공통으로 적용되는 리스크 관리 규칙입니다. 조건 충족 시 자동으로 매수 차단 또는 전량 청산이 실행됩니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex items-start gap-3 p-3 rounded-lg border border-border/50">
                <Badge variant="danger" className="shrink-0 mt-0.5">차단</Badge>
                <div>
                  <p className="text-sm font-medium">보유 종목 수 ≥ 6개</p>
                  <p className="text-xs text-muted-foreground mt-0.5">포지션이 6개 이상이면 신규 매수를 차단합니다.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg border border-border/50">
                <Badge variant="danger" className="shrink-0 mt-0.5">차단</Badge>
                <div>
                  <p className="text-sm font-medium">투자비율 ≥ 80%</p>
                  <p className="text-xs text-muted-foreground mt-0.5">총 자산 대비 투자 비율이 80% 이상이면 신규 매수를 차단합니다.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg border border-border/50">
                <Badge variant="danger" className="shrink-0 mt-0.5">차단</Badge>
                <div>
                  <p className="text-sm font-medium">일간 손익률 ≤ -2%</p>
                  <p className="text-xs text-muted-foreground mt-0.5">당일 손익률이 -2% 이하이면 당일 신규 매수를 차단합니다.</p>
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-500/30 bg-amber-50 dark:bg-amber-950/20">
              <Badge variant="warning" className="shrink-0 mt-0.5">MDD</Badge>
              <div>
                <p className="text-sm font-medium">최대 낙폭(MDD) — 전략별 차등 적용</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  MDD(Maximum Drawdown)는 운용 이후 최고점 대비 현재 포트폴리오가 얼마나 하락했는지를 나타냅니다.
                  전략마다 매수차단/전량청산 임계값이 다르게 설정되어 있습니다. 각 전략 상세에서 확인하세요.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary-500" />
            <CardTitle>사용 가능한 전략</CardTitle>
          </div>
          <CardDescription>관심종목에 설정 가능한 자동매매 전략 목록입니다. 각 전략을 클릭하면 상세 설명을 확인할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">로딩중...</p>
          ) : (
            <div className="space-y-2">
              {strategies.map((strategy, idx) => {
                const risk = RISK_CONFIG[strategy.meta.riskLevel] ?? RISK_CONFIG['medium']
                const barBg = RISK_BAR_BG[strategy.meta.riskLevel] ?? RISK_BAR_BG['medium']

                return (
                  <div key={strategy.name} className="rounded-lg border border-border/50">
                    <button
                      className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-accent/50 transition-colors"
                      onClick={() => setExpandedIndex(expandedIndex === idx ? null : idx)}
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-medium text-sm">{strategy.displayName}</span>
                        <Badge variant="outline" className="text-xs">{strategy.name}</Badge>
                        <span className={`text-xs font-medium ${risk.color}`}>
                          위험도: {risk.label}
                        </span>
                      </div>
                      {expandedIndex === idx ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                    {expandedIndex === idx && (
                      <div className="px-4 pb-4 pt-1 space-y-4">
                        {/* 투자 참고 정보 */}
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          <div className="flex items-start gap-2 p-2.5 rounded-md bg-accent/30">
                            <ShieldAlert size={14} className={`mt-0.5 shrink-0 ${risk.color}`} />
                            <div>
                              <p className="text-[11px] text-muted-foreground">위험도</p>
                              <p className={`text-xs font-medium ${risk.color}`}>{risk.label}</p>
                              <div className="w-16 h-1 bg-muted rounded-full mt-1">
                                <div className={`h-full rounded-full ${barBg} ${risk.barWidth}`} />
                              </div>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 p-2.5 rounded-md bg-accent/30">
                            <TrendingUp size={14} className="mt-0.5 shrink-0 text-blue-400" />
                            <div>
                              <p className="text-[11px] text-muted-foreground">기대 수익률</p>
                              <p className="text-xs font-medium text-foreground">{strategy.meta.expectedReturn}</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 p-2.5 rounded-md bg-accent/30">
                            <BarChart3 size={14} className="mt-0.5 shrink-0 text-red-400" />
                            <div>
                              <p className="text-[11px] text-muted-foreground">최대 손실</p>
                              <p className="text-xs font-medium text-foreground">{strategy.meta.maxLoss}</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 p-2.5 rounded-md bg-accent/30">
                            <CalendarDays size={14} className="mt-0.5 shrink-0 text-purple-400" />
                            <div>
                              <p className="text-[11px] text-muted-foreground">투자 기간</p>
                              <p className="text-xs font-medium text-foreground">{strategy.meta.investmentPeriod}</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 p-2.5 rounded-md bg-accent/30">
                            <Clock size={14} className="mt-0.5 shrink-0 text-cyan-400" />
                            <div>
                              <p className="text-[11px] text-muted-foreground">매매 빈도</p>
                              <p className="text-xs font-medium text-foreground">{strategy.meta.tradingFrequency}</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 p-2.5 rounded-md bg-accent/30">
                            <Users size={14} className="mt-0.5 shrink-0 text-amber-400" />
                            <div>
                              <p className="text-[11px] text-muted-foreground">적합 대상</p>
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {strategy.meta.suitableFor.map((s) => (
                                  <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground">{s}</span>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* MDD 임계값 */}
                        <div className="flex items-center gap-3 p-2.5 rounded-md bg-red-50 dark:bg-red-950/20 text-xs">
                          <ShieldAlert size={14} className="shrink-0 text-danger" />
                          <span className="text-muted-foreground">MDD 매수차단: <span className="font-medium text-foreground">{(strategy.meta.mddBuyBlock * 100).toFixed(0)}%</span></span>
                          <span className="text-muted-foreground">|</span>
                          <span className="text-muted-foreground">MDD 전량청산: <span className="font-medium text-danger">{(strategy.meta.mddLiquidate * 100).toFixed(0)}%</span></span>
                        </div>

                        {/* 태그 */}
                        <div className="flex flex-wrap gap-1.5">
                          {strategy.meta.tags.map((tag) => (
                            <Badge key={tag} variant="outline" className="text-[10px] px-2 py-0.5">
                              #{tag}
                            </Badge>
                          ))}
                        </div>

                        {/* 상세 설명 */}
                        <pre className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed font-sans border-t border-border/50 pt-3">
                          {strategy.description}
                        </pre>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
