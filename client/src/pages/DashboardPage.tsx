import { useState, type ReactNode } from 'react'
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
import { formatCurrencyByCode, formatPercent, formatNumber } from '@/lib/utils'
import { COUNTRY_OPTIONS, type CountryOption } from '@/lib/market-constants'
import type {
  CapitalSummaryCardProps,
  DashboardAccountSummary,
  DashboardCapitalSummary,
  DashboardPosition,
  PositionInsightsCardProps,
} from '@/pages/types/dashboard.types'

const COUNTRY_CURRENCY: Record<string, string> = {
  KR: 'KRW',
  US: 'USD',
  HK: 'HKD',
  CN: 'CNY',
  JP: 'JPY',
  VN: 'VND',
}

function getCurrencyCodeByCountry(country: CountryOption): string {
  return COUNTRY_CURRENCY[country.value] ?? 'KRW'
}

function getCurrencyCodeByExchange(exchangeCode?: string | null): string {
  if (!exchangeCode) return 'KRW'
  const country = COUNTRY_OPTIONS.find((option) => option.exchanges.includes(exchangeCode))
  return country ? getCurrencyCodeByCountry(country) : 'KRW'
}

function getDisplayCashAmount(balance: {
  amount: number
  withdrawableAmount?: number | null
}): number {
  return balance.withdrawableAmount ?? balance.amount
}

function buildCountryCapitalSummary(
  country: CountryOption,
  account?: DashboardAccountSummary,
  positions: DashboardPosition[] = [],
): DashboardCapitalSummary | undefined {
  if (!account) return undefined

  const currencyCode = getCurrencyCodeByCountry(country)
  const countryPositions = positions.filter((position) =>
    country.exchanges.includes(position.exchangeCode ?? ''),
  )
  const countryCashBalances = account.cashBalances.filter(
    (balance) => balance.currencyCode === currencyCode,
  )

  const costBasis = countryPositions.reduce((sum, position) => sum + position.totalInvested, 0)
  const totalProfitLoss = countryPositions.reduce((sum, position) => sum + position.profitLoss, 0)
  const currentValue = costBasis + totalProfitLoss
  const cashBalance = countryCashBalances.reduce((sum, balance) => sum + getDisplayCashAmount(balance), 0)
  const totalAssets = currentValue + cashBalance

  return {
    currencyCode,
    cashBalance,
    currentValue,
    costBasis,
    totalAssets,
    totalProfitLoss,
    positionCount: countryPositions.length,
    cashBalanceCount: countryCashBalances.length,
  }
}

export function DashboardPage() {
  const [selectedCountry, setSelectedCountry] = useState<CountryOption>(COUNTRY_OPTIONS[0])
  const { data: accountData, loading: accountLoading } = useGetAccountSummaryQuery()
  const { data: summaryData, loading: summaryLoading } = useGetDashboardSummaryQuery()
  const { data: positionsData, loading: positionsLoading } = useGetPositionsQuery()

  const account = accountData?.accountSummary
  const summary = summaryData?.dashboardSummary
  const positions = positionsData?.positions ?? []
  const selectedPositions = positions.filter((position) =>
    selectedCountry.exchanges.includes(position.exchangeCode ?? ''),
  )
  const capitalSummary = buildCountryCapitalSummary(selectedCountry, account, positions)
  const totalAssets = capitalSummary?.totalAssets ?? 0
  const currentValue = capitalSummary?.currentValue ?? 0
  const cashBalance = capitalSummary?.cashBalance ?? 0
  const totalProfitLoss = capitalSummary?.totalProfitLoss ?? 0
  const profitRate = capitalSummary?.costBasis ? (totalProfitLoss / capitalSummary.costBasis) * 100 : 0
  const cashRatio = totalAssets > 0 ? cashBalance / totalAssets : 0
  const investedRatio = totalAssets > 0 ? currentValue / totalAssets : 0
  const winningCount = selectedPositions.filter((position) => position.profitLoss > 0).length
  const losingCount = selectedPositions.filter((position) => position.profitLoss < 0).length
  const displayCurrency = capitalSummary?.currencyCode ?? getCurrencyCodeByCountry(selectedCountry)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">대시보드</h2>
        <p className="text-sm text-muted-foreground mt-1">자동매매 현황과 포지션 상태를 한눈에 확인하세요</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {COUNTRY_OPTIONS.map((country) => (
          <Button
            key={country.value}
            variant={selectedCountry.value === country.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedCountry(country)}
          >
            {country.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">현재 평가자산</CardTitle>
              <Wallet className="h-4 w-4 text-primary-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {accountLoading ? '--' : formatCurrencyByCode(totalAssets, displayCurrency)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {accountLoading ? '로딩중...' : `${selectedCountry.label} ${capitalSummary?.positionCount ?? 0}개 종목 보유`}
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
              {accountLoading ? '--' : formatCurrencyByCode(totalProfitLoss, displayCurrency)}
            </div>
            {!accountLoading && (
              <Badge variant={profitRate >= 0 ? 'success' : 'danger'} className="mt-1">
                {profitRate >= 0 ? '+' : ''}{profitRate.toFixed(2)}%
              </Badge>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">현금 비중</CardTitle>
              <PieChart className="h-4 w-4 text-info" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {accountLoading ? '--' : formatPercent(cashRatio)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {accountLoading ? '로딩중...' : `보유 평가 비중 ${formatPercent(investedRatio)}`}
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
              {summaryLoading ? '--' : `${(summary?.winRate ?? 0).toFixed(2)}%`}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {summaryLoading ? '로딩중...' : `전체 기준 오늘 ${formatNumber(summary?.todayTradeCount ?? 0)}건 / 누적 ${formatNumber(summary?.totalTradeCount ?? 0)}건`}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <MarketRegimeCard country={selectedCountry} />
        <CapitalSummaryCard loading={accountLoading} countryLabel={selectedCountry.label} summary={capitalSummary} />
      </div>

      <PositionInsightsCard
        loading={positionsLoading || accountLoading}
        positions={selectedPositions}
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

function CapitalSummaryCard({ loading, countryLabel, summary }: CapitalSummaryCardProps) {
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

  const investedRatio = summary.totalAssets > 0 ? summary.currentValue / summary.totalAssets : 0
  const cashRatio = summary.totalAssets > 0 ? summary.cashBalance / summary.totalAssets : 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <PieChart className="h-5 w-5 text-primary-500" />
          <CardTitle>계좌 배분</CardTitle>
        </div>
        <CardDescription>{countryLabel} 시장 기준 통화별 자금 요약입니다</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg border border-border/50 p-4">
            <p className="text-xs text-muted-foreground">예수금</p>
            <p className="mt-2 text-xl font-bold">{formatCurrencyByCode(summary.cashBalance, summary.currencyCode)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{summary.cashBalanceCount}개 현금 항목</p>
          </div>
          <div className="rounded-lg border border-border/50 p-4">
            <p className="text-xs text-muted-foreground">현재 평가금액</p>
            <p className="mt-2 text-xl font-bold">{formatCurrencyByCode(summary.currentValue, summary.currencyCode)}</p>
            <p className="text-xs text-muted-foreground mt-1">{summary.positionCount}개 종목 보유</p>
          </div>
          <div className="rounded-lg border border-border/50 p-4">
            <p className="text-xs text-muted-foreground">매입원가</p>
            <p className="mt-2 text-xl font-bold">{formatCurrencyByCode(summary.costBasis, summary.currencyCode)}</p>
          </div>
          <div className="rounded-lg border border-border/50 p-4">
            <p className="text-xs text-muted-foreground">평가 손익</p>
            <p className={`mt-2 text-xl font-bold ${summary.totalProfitLoss >= 0 ? 'text-success' : 'text-danger'}`}>
              {formatCurrencyByCode(summary.totalProfitLoss, summary.currencyCode)}
            </p>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>현재 평가자산</span>
            <span>{formatCurrencyByCode(summary.totalAssets, summary.currencyCode)}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-muted">
            <div className="flex h-full">
              <div className="bg-primary-500" style={{ width: `${Math.max(0, Math.min(100, investedRatio * 100))}%` }} />
              <div className="bg-emerald-500/70" style={{ width: `${Math.max(0, Math.min(100, cashRatio * 100))}%` }} />
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>보유 평가 비중 {formatPercent(investedRatio)}</span>
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
          <CardDescription>선택한 국가의 보유 포지션이 생기면 수익률과 비중 요약을 보여줍니다</CardDescription>
        </CardHeader>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">보유 중인 포지션이 없습니다</CardContent>
      </Card>
    )
  }

  const best = positions.reduce((top, current) => current.profitRate > top.profitRate ? current : top, positions[0])
  const worst = positions.reduce((bottom, current) => current.profitRate < bottom.profitRate ? current : bottom, positions[0])
  const largest = positions.reduce((top, current) => current.totalInvested > top.totalInvested ? current : top, positions[0])
  const largestWeight = totalAssets > 0 ? (largest.totalInvested + largest.profitLoss) / totalAssets : 0

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
          <InsightMetricCard
            icon={<Trophy className="h-4 w-4 text-success" />}
            label="최고 수익"
            stockName={best.stockName}
            stockCode={best.stockCode}
            value={`${best.profitRate >= 0 ? '+' : ''}${best.profitRate.toFixed(2)}%`}
            valueClassName={best.profitRate >= 0 ? 'text-success' : 'text-danger'}
          />
          <InsightMetricCard
            icon={<AlertTriangle className="h-4 w-4 text-danger" />}
            label="최저 수익"
            stockName={worst.stockName}
            stockCode={worst.stockCode}
            value={`${worst.profitRate >= 0 ? '+' : ''}${worst.profitRate.toFixed(2)}%`}
            valueClassName={worst.profitRate >= 0 ? 'text-success' : 'text-danger'}
          />
          <InsightMetricCard
            icon={<PieChart className="h-4 w-4 text-warning" />}
            label="최대 비중"
            stockName={largest.stockName}
            stockCode={largest.stockCode}
            value={formatCurrencyByCode(largest.totalInvested + largest.profitLoss, getCurrencyCodeByExchange(largest.exchangeCode))}
            valueClassName="text-foreground"
            subValue={`평가자산 대비 ${formatPercent(largestWeight)}`}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function InsightMetricCard({
  icon,
  label,
  stockName,
  stockCode,
  value,
  valueClassName,
  subValue,
}: {
  icon: ReactNode
  label: string
  stockName: string
  stockCode: string
  value: string
  valueClassName: string
  subValue?: string
}) {
  return (
    <div className="rounded-lg border border-border/50 p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-3">
        <p className="font-semibold">{stockName}</p>
        <p className="text-xs text-muted-foreground">{stockCode}</p>
      </div>
      <p className={`mt-2 text-lg font-bold ${valueClassName}`}>{value}</p>
      {subValue && <p className="mt-1 text-xs text-muted-foreground">{subValue}</p>}
    </div>
  )
}
