import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { TrendingUp, TrendingDown, Target, BarChart3 } from 'lucide-react'
import { useGetSimulationMetricsQuery } from '@/graphql/generated'
import { formatCurrency, formatPercent } from '@/lib/utils'
import type { SimulationMetricsCardsProps } from '@/pages/simulation/types'

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
            <CardTitle className="text-sm font-medium text-muted-foreground">총 수익률</CardTitle>
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
            <CardTitle className="text-sm font-medium text-muted-foreground">최대 낙폭</CardTitle>
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
            <CardTitle className="text-sm font-medium text-muted-foreground">승률</CardTitle>
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
            <CardTitle className="text-sm font-medium text-muted-foreground">샤프 비율</CardTitle>
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
