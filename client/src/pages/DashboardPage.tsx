import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TrendingUp, Activity, Wallet, PieChart, BarChart3, Trophy, AlertTriangle } from 'lucide-react'
import {
  useGetAccountSummaryQuery,
  useGetDashboardSummaryQuery,
  useGetPositionsQuery,
  useGetMarketRegimeQuery,
} from '@/graphql/generated'
import { formatCurrency, formatPercent, formatNumber } from '@/lib/utils'
import { COUNTRY_OPTIONS, type CountryOption } from '@/lib/market-constants'
import type { CapitalSummaryCardProps, PositionInsightsCardProps } from '@/pages/types/dashboard.types'

export function DashboardPage() {
  const [selectedCountry, setSelectedCountry] = useState<CountryOption>(COUNTRY_OPTIONS[0])
  const { data: accountData, loading: accountLoading } = useGetAccountSummaryQuery()
  const { data: summaryData, loading: summaryLoading } = useGetDashboardSummaryQuery()
  const { data: positionsData, loading: positionsLoading } = useGetPositionsQuery()

  const account = accountData?.accountSummary
  const summary = summaryData?.dashboardSummary
  const positions = positionsData?.positions ?? []
  const totalAssets = account?.totalAssets ?? 0
  const cashBalance = account?.cashBalance ?? 0
  const totalProfitLoss = account?.totalProfitLoss ?? 0
  const profitRate = account?.profitRate ?? 0
  const cashRatio = totalAssets > 0 ? cashBalance / totalAssets : 0
  const investedRatio = totalAssets > 0 ? (account?.totalInvested ?? 0) / totalAssets : 0
  const winningCount = positions.filter((p) => p.profitLoss > 0).length
  const losingCount = positions.filter((p) => p.profitLoss < 0).length

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">대시보드</h2>
        <p className="text-sm text-muted-foreground mt-1">자동매매 현황과 포지션 상태를 한눈에 확인하세요</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">총 자산</CardTitle>
              <Wallet className="h-4 w-4 text-primary-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {accountLoading ? '--' : formatCurrency(totalAssets)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {accountLoading ? '로딩중...' : `${account?.positionCount ?? 0}개 종목 보유`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">평가 손익</CardTitle>
              <TrendingUp className="h-4 w-4 text-success" />
            </div>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${accountLoading ? '' : totalProfitLoss >= 0 ? 'text-success' : 'text-danger'}`}>
              {accountLoading ? '--' : formatCurrency(totalProfitLoss)}
            </div>
            {!accountLoading && (
              <Badge variant={profitRate >= 0 ? 'success' : 'danger'} className="mt-1">
                {formatPercent(profitRate)}
              </Badge>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">투자 여력</CardTitle>
              <PieChart className="h-4 w-4 text-info" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {accountLoading ? '--' : formatPercent(cashRatio)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {accountLoading ? '로딩중...' : `투자 비중 ${formatPercent(investedRatio)}`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">거래 효율</CardTitle>
              <Activity className="h-4 w-4 text-warning" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summaryLoading ? '--' : formatPercent(summary?.winRate ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {summaryLoading ? '로딩중...' : `오늘 ${formatNumber(summary?.todayTradeCount ?? 0)}건 / 누적 ${formatNumber(summary?.totalTradeCount ?? 0)}건`}
            </p>
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

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <MarketRegimeCard country={selectedCountry} />
        <CapitalSummaryCard loading={accountLoading} summary={account} />
      </div>

      <PositionInsightsCard
        loading={positionsLoading || accountLoading}
        positions={positions}
        totalAssets={totalAssets}
        winningCount={winningCount}
        losingCount={losingCount}
      />
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

function CapitalSummaryCard({ loading, summary }: CapitalSummaryCardProps) {
  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">로딩중...</CardContent>
      </Card>
    )
  }

  if (!summary) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">계좌 정보를 불러올 수 없습니다</CardContent>
      </Card>
    )
  }

  const investedRatio = summary.totalAssets > 0 ? summary.totalInvested / summary.totalAssets : 0
  const cashRatio = summary.totalAssets > 0 ? summary.cashBalance / summary.totalAssets : 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <PieChart className="h-5 w-5 text-primary-500" />
          <CardTitle>계좌 배분</CardTitle>
        </div>
        <CardDescription>예수금과 투자금, 실현 손익을 같이 확인할 수 있는 자금 요약입니다</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg border border-border/50 p-4">
            <p className="text-xs text-muted-foreground">예수금</p>
            <p className="mt-2 text-xl font-bold">{formatCurrency(summary.cashBalance)}</p>
          </div>
          <div className="rounded-lg border border-border/50 p-4">
            <p className="text-xs text-muted-foreground">총 투자금</p>
            <p className="mt-2 text-xl font-bold">{formatCurrency(summary.totalInvested)}</p>
          </div>
          <div className="rounded-lg border border-border/50 p-4">
            <p className="text-xs text-muted-foreground">실현 손익</p>
            <p className={`mt-2 text-xl font-bold ${summary.realizedPnL >= 0 ? 'text-success' : 'text-danger'}`}>
              {formatCurrency(summary.realizedPnL)}
            </p>
          </div>
          <div className="rounded-lg border border-border/50 p-4">
            <p className="text-xs text-muted-foreground">보유 종목 수</p>
            <p className="mt-2 text-xl font-bold">{formatNumber(summary.positionCount)}</p>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>총 자산</span>
            <span>{formatCurrency(summary.totalAssets)}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-muted">
            <div className="flex h-full">
              <div className="bg-primary-500" style={{ width: `${Math.max(0, Math.min(100, investedRatio * 100))}%` }} />
              <div className="bg-emerald-500/70" style={{ width: `${Math.max(0, Math.min(100, cashRatio * 100))}%` }} />
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>투자 비중 {formatPercent(investedRatio)}</span>
            <span>현금 비중 {formatPercent(cashRatio)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function PositionInsightsCard({
  loading,
  positions,
  totalAssets,
  winningCount,
  losingCount,
}: PositionInsightsCardProps) {
  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">로딩중...</CardContent>
      </Card>
    )
  }

  if (positions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary-500" />
            <CardTitle>포지션 인사이트</CardTitle>
          </div>
          <CardDescription>보유 포지션이 생기면 수익률과 비중 요약을 보여줍니다</CardDescription>
        </CardHeader>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">보유 중인 포지션이 없습니다</CardContent>
      </Card>
    )
  }

  const best = positions.reduce((top, current) => current.profitRate > top.profitRate ? current : top, positions[0])
  const worst = positions.reduce((bottom, current) => current.profitRate < bottom.profitRate ? current : bottom, positions[0])
  const largest = positions.reduce((top, current) => current.totalInvested > top.totalInvested ? current : top, positions[0])
  const largestWeight = totalAssets > 0 ? largest.totalInvested / totalAssets : 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary-500" />
          <CardTitle>포지션 인사이트</CardTitle>
        </div>
        <CardDescription>현재 보유 종목 중 수익률과 비중 관점에서 바로 확인할 만한 정보입니다</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="success">수익 {winningCount}개</Badge>
          <Badge variant="danger">손실 {losingCount}개</Badge>
          <Badge variant="outline">보합 {Math.max(0, positions.length - winningCount - losingCount)}개</Badge>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="rounded-lg border border-border/50 p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Trophy className="h-4 w-4 text-success" />
              최고 수익
            </div>
            <p className="mt-3 font-semibold">{best.stockName}</p>
            <p className="text-xs text-muted-foreground">{best.stockCode}</p>
            <p className={`mt-2 text-lg font-bold ${best.profitRate >= 0 ? 'text-success' : 'text-danger'}`}>
              {formatPercent(best.profitRate)}
            </p>
          </div>
          <div className="rounded-lg border border-border/50 p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4 text-danger" />
              최저 수익
            </div>
            <p className="mt-3 font-semibold">{worst.stockName}</p>
            <p className="text-xs text-muted-foreground">{worst.stockCode}</p>
            <p className={`mt-2 text-lg font-bold ${worst.profitRate >= 0 ? 'text-success' : 'text-danger'}`}>
              {formatPercent(worst.profitRate)}
            </p>
          </div>
          <div className="rounded-lg border border-border/50 p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <PieChart className="h-4 w-4 text-warning" />
              최대 비중
            </div>
            <p className="mt-3 font-semibold">{largest.stockName}</p>
            <p className="text-xs text-muted-foreground">{largest.stockCode}</p>
            <p className="mt-2 text-lg font-bold">{formatCurrency(largest.totalInvested)}</p>
            <p className="text-xs text-muted-foreground mt-1">총 자산 대비 {formatPercent(largestWeight)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
