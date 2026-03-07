import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { useGetSimulationPositionsQuery } from '@/graphql/generated'
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils'
import type { SimulationPositionsTableProps } from '@/pages/simulation/types'

export function SimulationPositionsTable({ sessionId }: SimulationPositionsTableProps) {
  const { data, loading } = useGetSimulationPositionsQuery({
    variables: { sessionId },
  })

  const positions = data?.simulationPositions ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>보유 포지션</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">로딩중...</div>
        ) : positions.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">보유 중인 포지션이 없습니다</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border">
                <TableHead>종목</TableHead>
                <TableHead className="text-right">수량</TableHead>
                <TableHead className="text-right">평균가</TableHead>
                <TableHead className="text-right">현재가</TableHead>
                <TableHead className="text-right">투자금액</TableHead>
                <TableHead className="text-right">손익</TableHead>
                <TableHead className="text-right">수익률</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.map((pos) => (
                <TableRow key={pos.id}>
                  <TableCell>
                    <div className="font-medium">{pos.stockName}</div>
                    <div className="text-xs text-muted-foreground">{pos.stockCode}</div>
                  </TableCell>
                  <TableCell className="text-right">{formatNumber(pos.quantity)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(pos.avgPrice, pos.market)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(pos.currentPrice, pos.market)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(pos.totalInvested, pos.market)}</TableCell>
                  <TableCell className={`text-right font-medium ${pos.profitLoss >= 0 ? 'text-success' : 'text-danger'}`}>
                    {formatCurrency(pos.profitLoss, pos.market)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant={pos.profitRate >= 0 ? 'success' : 'danger'}>
                      {formatPercent(pos.profitRate)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
