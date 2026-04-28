import { useEffect, useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Wallet, TrendingUp, TrendingDown, PiggyBank, BarChart3, RefreshCw } from 'lucide-react'
import {
  GetAccountSummaryDocument,
  GetDashboardSummaryDocument,
  GetPositionsDocument,
  useGetAccountSummaryQuery,
  useGetPositionsQuery,
  useRefreshAccountStateMutation,
} from '@/graphql/generated'
import { formatCurrencyByCode, formatDate } from '@/lib/utils'
import {
  buildCountryPortfolioSummary,
  getDisplayCashAmount,
  useIsMobile,
} from './portfolio-helpers'
import { SectionToggleButton, SummaryMetricCard } from './PortfolioCommon'
import type { AccountSummaryCardProps } from './types'

// ── 계좌 요약 카드 ──

export function AccountSummaryCard({ countryFilter }: AccountSummaryCardProps) {
  const isMobile = useIsMobile()
  const [collapsed, setCollapsed] = useState(false)
  const { data, loading, refetch } = useGetAccountSummaryQuery()
  const { data: positionsData } = useGetPositionsQuery()
  const [refreshAccountState, { loading: refreshLoading }] = useRefreshAccountStateMutation({
    refetchQueries: [
      GetAccountSummaryDocument,
      GetPositionsDocument,
      GetDashboardSummaryDocument,
    ],
    awaitRefetchQueries: true,
  })
  const summary = data?.accountSummary
  const positions = positionsData?.positions ?? []
  const scopedSummary = summary
    ? buildCountryPortfolioSummary(
        countryFilter,
        positions,
        summary.cashBalances.map((cash) => ({
          market: cash.market,
          currencyCode: cash.currencyCode,
          amount: cash.amount,
          withdrawableAmount: cash.withdrawableAmount,
        })),
      )
    : null
  const overallDomesticCash = summary?.cashBalances
    .filter((cash) => cash.currencyCode === 'KRW')
    .reduce((sum, cash) => sum + getDisplayCashAmount(cash), 0) ?? 0
  const overallOverseasCurrencies = Array.from(
    new Set((summary?.cashBalances ?? []).filter((cash) => cash.currencyCode !== 'KRW').map((cash) => cash.currencyCode)),
  )

  useEffect(() => {
    setCollapsed(false)
  }, [isMobile])

  const handleRefresh = async () => {
    try {
      const result = await refreshAccountState()
      await refetch()
      alert(result.data?.refreshAccountState.message || '계좌 상태를 새로고침했습니다.')
    } catch (e: any) {
      alert(`계좌 상태 새로고침 실패: ${e.message}`)
    }
  }

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

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{scopedSummary ? '국가별 자산 요약' : '계좌 개요'}</CardTitle>
            <CardDescription>
              {scopedSummary
                ? `${scopedSummary.country.label} 탭 기준으로 ${scopedSummary.currencyCode} 통화 자산만 집계합니다.`
                : '전체 탭은 통화 혼합 총액 대신 계좌 전반 상태만 간단히 보여줍니다.'}
              {summary.lastSyncedAt ? ` 마지막 갱신 ${formatDate(summary.lastSyncedAt)}` : ' 아직 새로고침 이력이 없습니다.'}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isMobile ? (
              <SectionToggleButton
                collapsed={collapsed}
                onClick={() => setCollapsed((prev) => !prev)}
                label="계좌 요약"
              />
            ) : null}
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshLoading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshLoading ? 'animate-spin' : ''}`} />
              계좌 상태 새로고침
            </Button>
          </div>
        </div>
      </CardHeader>
      {!collapsed ? (
        <CardContent className="space-y-5">
          {scopedSummary ? (
            <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-5">
              <SummaryMetricCard
                icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
                label="예수금"
                tooltip="선택한 국가 탭 기준 현금입니다."
                value={formatCurrencyByCode(scopedSummary.cashBalance, scopedSummary.currencyCode)}
                subValue={`${scopedSummary.countryCashBalances.length}개 계좌 현금 항목`}
              />
              <SummaryMetricCard
                icon={<PiggyBank className="h-4 w-4 text-muted-foreground" />}
                label="매입원가"
                tooltip="선택한 국가 탭 포지션의 총 매수 금액입니다."
                value={formatCurrencyByCode(scopedSummary.costBasis, scopedSummary.currencyCode)}
                subValue={`${scopedSummary.countryPositions.length}개 종목 보유`}
              />
              <SummaryMetricCard
                icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
                label="평가자산"
                tooltip="선택한 국가 탭의 현금 + 보유 평가금액입니다."
                value={formatCurrencyByCode(scopedSummary.totalAssets, scopedSummary.currencyCode)}
                subValue={`보유 평가금액 ${formatCurrencyByCode(scopedSummary.currentValue, scopedSummary.currencyCode)}`}
              />
              <SummaryMetricCard
                icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
                label="미실현 손익"
                tooltip="선택한 국가 탭 포지션의 평가 손익입니다."
                value={formatCurrencyByCode(scopedSummary.totalProfitLoss, scopedSummary.currencyCode)}
                subValue={`${scopedSummary.profitRate >= 0 ? '+' : ''}${scopedSummary.profitRate.toFixed(2)}%`}
                tone={scopedSummary.totalProfitLoss >= 0 ? 'success' : 'danger'}
              />
              <SummaryMetricCard
                icon={<TrendingDown className="h-4 w-4 text-muted-foreground" />}
                label="통화 기준"
                tooltip="선택한 국가 탭의 기준 통화입니다."
                value={scopedSummary.currencyCode}
                subValue={`${scopedSummary.country.label} 시장 자산만 표시 중`}
                tone="default"
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 xl:grid-cols-4">
              <SummaryMetricCard
                icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
                label="국내 KRW 예수금"
                tooltip="전체 탭에서는 국내 원화 예수금만 별도로 보여줍니다."
                value={formatCurrencyByCode(overallDomesticCash, 'KRW')}
                subValue="국내 계좌 기준"
              />
              <SummaryMetricCard
                icon={<PiggyBank className="h-4 w-4 text-muted-foreground" />}
                label="보유 종목"
                tooltip="전체 포트폴리오의 보유 종목 수입니다."
                value={`${summary.positionCount}개 종목`}
                subValue="정확한 자산 금액은 국가 탭에서 확인하세요."
              />
              <SummaryMetricCard
                icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
                label="해외 예수금 통화"
                tooltip="전체 탭에서는 해외 예수금의 통화 종류만 요약합니다."
                value={`${overallOverseasCurrencies.length}개`}
                subValue={overallOverseasCurrencies.length > 0 ? overallOverseasCurrencies.join(', ') : '해외 예수금 없음'}
              />
              <SummaryMetricCard
                icon={<TrendingDown className="h-4 w-4 text-muted-foreground" />}
                label="마지막 갱신"
                tooltip="전체 탭은 통화 혼합 총액 대신 계좌 전반 상태만 보여줍니다."
                value={summary.lastSyncedAt ? formatDate(summary.lastSyncedAt) : '-'}
                tone="default"
              />
            </div>
          )}
        </CardContent>
      ) : null}
    </Card>
  )
}
