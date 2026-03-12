import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { TrendingUp, Activity, Wallet, BarChart3, ShieldAlert, Info } from 'lucide-react'
import {
  useGetDashboardSummaryQuery,
  useGetPositionsQuery,
  useGetMarketRegimeQuery,
  useGetRiskStateQuery,
  type Market,
} from '@/graphql/generated'
import { formatCurrency, formatPercent, formatNumber } from '@/lib/utils'
import { COUNTRY_OPTIONS, type CountryOption } from '@/lib/market-constants'

export function DashboardPage() {
  const [selectedCountry, setSelectedCountry] = useState<CountryOption>(COUNTRY_OPTIONS[0])
  const { data: summaryData, loading: summaryLoading } = useGetDashboardSummaryQuery()
  const { data: positionsData, loading: positionsLoading } = useGetPositionsQuery()

  const summary = summaryData?.dashboardSummary
  const positions = positionsData?.positions ?? []
  const totalInvested = positions.reduce((sum, p) => sum + p.totalInvested, 0)
  const totalPnl = positions.reduce((sum, p) => sum + p.profitLoss, 0)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">대시보드</h2>
        <p className="text-sm text-muted-foreground mt-1">자동매매 현황을 한눈에 확인하세요</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">총 투자금</CardTitle>
              <Wallet className="h-4 w-4 text-primary-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {positionsLoading ? '--' : formatCurrency(totalInvested)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{positions.length}개 종목 보유</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">총 손익</CardTitle>
              <TrendingUp className="h-4 w-4 text-success" />
            </div>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${summaryLoading ? '' : (summary?.totalProfitLoss ?? 0) >= 0 ? 'text-success' : 'text-danger'}`}>
              {summaryLoading ? '--' : formatCurrency(summary?.totalProfitLoss ?? 0)}
            </div>
            {!positionsLoading && totalInvested > 0 && (
              <Badge variant={totalPnl >= 0 ? 'success' : 'danger'} className="mt-1">
                {formatPercent(totalPnl / totalInvested)}
              </Badge>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">거래 현황</CardTitle>
              <BarChart3 className="h-4 w-4 text-info" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summaryLoading ? '--' : formatNumber(summary?.todayTradeCount ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              오늘 / 전체 {formatNumber(summary?.totalTradeCount ?? 0)}건
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">승률</CardTitle>
              <Activity className="h-4 w-4 text-warning" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summaryLoading ? '--' : formatPercent(summary?.winRate ?? 0)}
            </div>
            <Badge variant={(summary?.winRate ?? 0) >= 0.5 ? 'success' : 'warning'} className="mt-1">
              {(summary?.winRate ?? 0) >= 0.5 ? '양호' : '주의'}
            </Badge>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2 flex-wrap">
        {COUNTRY_OPTIONS.map((c) => (
          <Button
            key={c.value}
            variant={selectedCountry.value === c.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedCountry(c)}
          >
            {c.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MarketRegimeCard country={selectedCountry} />
        <RiskStateCard market={selectedCountry.market} />
      </div>
    </div>
  )
}

function MarketRegimeCard({ country }: { country: CountryOption }) {
  const { data, loading } = useGetMarketRegimeQuery({
    variables: { input: { market: country.market, exchangeCode: country.regimeExchangeCode } },
  })
  const regime = data?.marketRegime
  const regimeColor = regime?.regime === 'TRENDING_UP' ? 'success' : regime?.regime === 'TRENDING_DOWN' ? 'danger' : 'warning'
  const regimeLabel = regime?.regime === 'TRENDING_UP' ? '상승 추세' : regime?.regime === 'TRENDING_DOWN' ? '하락 추세' : '횡보'

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary-500" />
          <CardTitle>시장 상태</CardTitle>
        </div>
        <CardDescription>{country.label} 시장 체제 분석</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">로딩중...</p>
        ) : regime ? (
          <div className="flex items-center gap-3">
            <Badge variant={regimeColor} className="text-base px-4 py-1">{regimeLabel}</Badge>
            <span className="text-sm text-muted-foreground">거래소: {regime.exchangeCode}</span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">데이터 없음</p>
        )}
      </CardContent>
    </Card>
  )
}

function RiskStateCard({ market }: { market: Market }) {
  const { data, loading } = useGetRiskStateQuery({ variables: { input: { market } } })
  const risk = data?.riskState

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-warning" />
          <CardTitle>리스크 상태</CardTitle>
        </div>
        <CardDescription>매매 위험 평가</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">로딩중...</p>
        ) : risk ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">매수 차단</span>
                <Badge variant={risk.buyBlocked ? 'danger' : 'success'}>{risk.buyBlocked ? 'YES' : 'NO'}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">전량 청산</span>
                <Badge variant={risk.liquidateAll ? 'danger' : 'success'}>{risk.liquidateAll ? 'YES' : 'NO'}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="flex items-center gap-1 text-muted-foreground">
                  포지션 수
                  <Tooltip text="6개 이상 보유 시 신규 매수 차단">
                    <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
                  </Tooltip>
                </span>
                <span className={`font-medium ${risk.positionCount >= 6 ? 'text-danger' : ''}`}>{risk.positionCount} / 6</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="flex items-center gap-1 text-muted-foreground">
                  투자비율
                  <Tooltip text="80% 이상이면 신규 매수 차단">
                    <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
                  </Tooltip>
                </span>
                <span className={`font-medium ${risk.investedRate >= 0.8 ? 'text-danger' : ''}`}>{formatPercent(risk.investedRate)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="flex items-center gap-1 text-muted-foreground">
                  일간 PnL
                  <Tooltip text="-2% 이하면 당일 신규 매수 차단">
                    <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
                  </Tooltip>
                </span>
                <span className={`font-medium ${risk.dailyPnlRate >= 0 ? 'text-success' : 'text-danger'}`}>
                  {formatPercent(risk.dailyPnlRate)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="flex items-center gap-1 text-muted-foreground">
                  낙폭
                  <Tooltip text="전략별 MDD 임계값이 다르게 적용됩니다. 전략 가이드에서 확인하세요.">
                    <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
                  </Tooltip>
                </span>
                <span className={`font-medium ${risk.drawdown <= -0.1 ? 'text-danger' : 'text-warning'}`}>{formatPercent(risk.drawdown)}</span>
              </div>
            </div>
            {risk.reasons.length > 0 && (
              <div className="mt-2 rounded-lg bg-red-50 dark:bg-red-950/30 p-2">
                <p className="text-xs font-medium text-danger mb-1">경고 사유:</p>
                {risk.reasons.map((r, i) => (
                  <p key={i} className="text-xs text-danger/80">- {r}</p>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">데이터 없음</p>
        )}
      </CardContent>
    </Card>
  )
}
