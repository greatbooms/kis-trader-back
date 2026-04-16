import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Tooltip } from '@/components/ui/tooltip'
import { Wallet, PiggyBank, BarChart3, CircleDollarSign, Info, Layers3, Coins, ArrowRightLeft } from 'lucide-react'
import { useGetSimulationPositionsQuery } from '@/graphql/generated'
import { formatCurrency } from '@/lib/utils'
import type { SimulationCapitalSummaryProps } from '@/pages/simulation/types'

function supportsCarrySummary(strategyName: string): boolean {
  return strategyName === 'infinite-buy' || strategyName === 'daily-dca'
}

export function SimulationCapitalSummary({
  sessionId,
  stockName,
  currentCash,
  market,
  exchangeCode,
  quota,
  strategyName,
  maxCycles,
  accumulatedQuota = 0,
}: SimulationCapitalSummaryProps) {
  const { data } = useGetSimulationPositionsQuery({
    variables: { sessionId },
  })

  const positions = data?.simulationPositions ?? []
  const totalInvested = positions.reduce((sum, p) => sum + p.totalInvested, 0)
  const totalPortfolioValue = positions.reduce((sum, p) => sum + (p.quantity * p.currentPrice), 0)
  const totalAssets = currentCash + totalPortfolioValue
  const showCarrySummary = supportsCarrySummary(strategyName) && maxCycles > 0
  const perCycleQuota = showCarrySummary ? quota / maxCycles : 0
  const remainingQuota = showCarrySummary ? Math.max(0, quota - totalInvested) : 0
  const nextCycleBudget = showCarrySummary
    ? Math.min(remainingQuota, perCycleQuota + accumulatedQuota)
    : 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1">
          <CardTitle>자본 현황</CardTitle>
          <Tooltip text="시뮬레이션의 단일 투자금 기준 현황입니다. 투자금, 남은 현금, 실제 매수에 사용된 금액과 평가액을 확인할 수 있습니다.">
            <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
          </Tooltip>
        </div>
      </CardHeader>
      <CardContent>
        <div className={showCarrySummary ? 'grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4' : 'grid grid-cols-2 gap-4 md:grid-cols-4'}>
          <div className="flex items-start gap-3">
            <Wallet className="h-5 w-5 text-primary-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">투자금</p>
              <p className="text-sm font-semibold">{formatCurrency(quota, market, exchangeCode)}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <CircleDollarSign className="h-5 w-5 text-success mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">현재 현금</p>
              <p className="text-sm font-semibold">{formatCurrency(currentCash, market, exchangeCode)}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <PiggyBank className="h-5 w-5 text-warning mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">총 자산</p>
              <p className="text-sm font-semibold">{formatCurrency(totalAssets, market, exchangeCode)}</p>
              <p className="text-xs text-muted-foreground">현금 + 평가액</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <BarChart3 className="h-5 w-5 text-info mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">총 투자금 (포지션)</p>
              <p className="text-sm font-semibold">{formatCurrency(totalInvested, market, exchangeCode)}</p>
              <p className="text-xs text-muted-foreground">평가액: {formatCurrency(totalPortfolioValue, market, exchangeCode)}</p>
            </div>
          </div>
        </div>

        {showCarrySummary && (
          <div className="mt-4 grid gap-3 border-t pt-4 md:grid-cols-3">
            <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
              <div className="flex items-start gap-3">
                <ArrowRightLeft className="mt-0.5 h-4.5 w-4.5 shrink-0 text-warning" />
                <div>
                  <p className="text-xs text-muted-foreground">이월금</p>
                  <p className="text-sm font-semibold">{formatCurrency(accumulatedQuota, market, exchangeCode)}</p>
                  <p className="text-xs text-muted-foreground">오늘 못 산 금액이 다음 회차로 누적됩니다.</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-info/30 bg-info/5 px-4 py-3">
              <div className="flex items-start gap-3">
                <Layers3 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-info" />
                <div>
                  <p className="text-xs text-muted-foreground">1회 기본분</p>
                  <p className="text-sm font-semibold">{formatCurrency(perCycleQuota, market, exchangeCode)}</p>
                  <p className="text-xs text-muted-foreground">
                    총 투자금 ÷ {maxCycles}회 기준입니다.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
              <div className="flex items-start gap-3">
                <Coins className="mt-0.5 h-4.5 w-4.5 shrink-0 text-primary-500" />
                <div>
                  <p className="text-xs text-muted-foreground">다음 회차 예산</p>
                  <p className="text-sm font-semibold">{formatCurrency(nextCycleBudget, market, exchangeCode)}</p>
                  <p className="text-xs text-muted-foreground">
                    기본분 + 이월금, 남은 투자한도 반영 전/후 기준
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {stockName && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-xs text-muted-foreground mb-2">종목 투자금</p>
            <div className="rounded border border-border/50 px-3 py-2 flex items-center justify-between">
              <span className="text-xs font-medium truncate mr-2">{stockName}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {formatCurrency(quota, market, exchangeCode)}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
