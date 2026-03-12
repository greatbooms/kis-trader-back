import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Tooltip as InfoTooltip } from '@/components/ui/tooltip'
import { Info } from 'lucide-react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { useGetSimulationSnapshotsQuery } from '@/graphql/generated'
import { formatCurrency } from '@/lib/utils'
import type { SimulationEquityChartProps } from '@/pages/simulation/types'

export function SimulationEquityChart({ sessionId, market, exchangeCode }: SimulationEquityChartProps) {
  const { data, loading } = useGetSimulationSnapshotsQuery({
    variables: { sessionId },
  })

  const snapshots = data?.simulationSnapshots ?? []

  const chartData = snapshots.map((s) => ({
    date: new Date(s.snapshotDate).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }),
    totalValue: s.totalValue,
    cashBalance: s.cashBalance,
    dailyPnl: s.dailyPnl,
    drawdown: s.drawdown,
  }))

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1">
          <CardTitle>자산 추이</CardTitle>
          <InfoTooltip text="시간에 따른 총 자산(현금 + 보유 종목 평가액)의 변화를 보여줍니다. 점선은 현금 잔고이며, 실선과의 차이가 주식 평가액입니다.">
            <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
          </InfoTooltip>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">로딩중...</div>
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">데이터가 없습니다</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12 }}
                stroke="var(--color-muted-foreground)"
              />
              <YAxis
                tick={{ fontSize: 12 }}
                stroke="var(--color-muted-foreground)"
                tickFormatter={(v) => formatCurrency(v, market, exchangeCode)}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--color-card)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                formatter={(value, name) => {
                  const label = name === 'totalValue' ? '총 자산' : '현금'
                  return [formatCurrency(value as number, market, exchangeCode), label]
                }}
                labelFormatter={(label) => `날짜: ${label}`}
              />
              <Line
                type="monotone"
                dataKey="totalValue"
                stroke="var(--color-primary-500)"
                strokeWidth={2}
                dot={false}
                name="totalValue"
              />
              <Line
                type="monotone"
                dataKey="cashBalance"
                stroke="var(--color-muted-foreground)"
                strokeWidth={1}
                strokeDasharray="5 5"
                dot={false}
                name="cashBalance"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
