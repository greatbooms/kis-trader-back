import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Tooltip } from '@/components/ui/tooltip'
import { TrendingUp, TrendingDown, Target, BarChart3, Info } from 'lucide-react'
import { useGetSimulationMetricsQuery } from '@/graphql/generated'
import { formatCurrency, formatPercent } from '@/lib/utils'
import type { SimulationMetricsCardsProps } from '@/pages/simulation/types'

function MetricTitle({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <div className="flex items-center gap-1">
      <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      <Tooltip text={tooltip}>
        <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
      </Tooltip>
    </div>
  )
}

export function SimulationMetricsCards({ sessionId, market }: SimulationMetricsCardsProps) {
  const { data, loading } = useGetSimulationMetricsQuery({
    variables: { sessionId },
  })

  const metrics = data?.simulationMetrics

  if (loading) {
    return <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">로딩중...</div>
  }

  if (!metrics) {
    return null
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <MetricTitle label="총 수익률" tooltip="초기 자본 대비 현재 총 자산의 변화율입니다. 실현 손익과 미실현 평가 손익을 모두 포함합니다." />
            <TrendingUp className="h-4 w-4 text-primary-500" />
          </div>
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${metrics.totalReturn >= 0 ? 'text-success' : 'text-danger'}`}>
            {formatPercent(metrics.totalReturn)}
          </div>
          <p className={`text-xs mt-1 ${metrics.totalReturnAmount >= 0 ? 'text-success' : 'text-danger'}`}>
            {formatCurrency(metrics.totalReturnAmount, market)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <MetricTitle label="최대 낙폭" tooltip="고점 대비 최대 하락 폭입니다. 투자 기간 중 최악의 손실 구간을 나타내며, 값이 작을수록 안정적입니다." />
            <TrendingDown className="h-4 w-4 text-danger" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-danger">
            {formatPercent(-Math.abs(metrics.maxDrawdown))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <MetricTitle label="승률" tooltip="수익으로 마감한 거래의 비율입니다. 50% 이상이면 양호하며, 높을수록 안정적인 전략입니다." />
            <Target className="h-4 w-4 text-warning" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatPercent(metrics.winRate)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {metrics.winTrades}승 / {metrics.lossTrades}패 (총 {metrics.totalTrades}건)
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <MetricTitle label="샤프 비율" tooltip="위험 대비 수익률 지표입니다. 변동성이 적으면서 수익이 높을수록 값이 큽니다. 1 이상 양호, 2 이상 우수입니다." />
            <BarChart3 className="h-4 w-4 text-info" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {metrics.sharpeRatio.toFixed(2)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Profit Factor: {metrics.profitFactor.toFixed(2)}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
