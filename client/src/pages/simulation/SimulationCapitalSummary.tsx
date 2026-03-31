import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Tooltip } from '@/components/ui/tooltip'
import { Wallet, PiggyBank, BarChart3, CircleDollarSign, Info } from 'lucide-react'
import { useGetSimulationPositionsQuery } from '@/graphql/generated'
import { formatCurrency } from '@/lib/utils'
import type { SimulationCapitalSummaryProps } from '@/pages/simulation/types'

export function SimulationCapitalSummary({
  sessionId,
  stockName,
  currentCash,
  market,
  exchangeCode,
  quota,
}: SimulationCapitalSummaryProps) {
  const { data } = useGetSimulationPositionsQuery({
    variables: { sessionId },
  })

  const positions = data?.simulationPositions ?? []
  const totalInvested = positions.reduce((sum, p) => sum + p.totalInvested, 0)
  const totalPortfolioValue = positions.reduce((sum, p) => sum + (p.quantity * p.currentPrice), 0)
  const totalAssets = currentCash + totalPortfolioValue

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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
