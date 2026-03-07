import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { useGetSimulationTradesQuery } from '@/graphql/generated'
import { formatCurrency, formatNumber, formatDate } from '@/lib/utils'
import type { SimulationTradesTableProps } from '@/pages/simulation/types'

const PAGE_SIZE = 20

export function SimulationTradesTable({ sessionId }: SimulationTradesTableProps) {
  const [offset, setOffset] = useState(0)
  const { data, loading } = useGetSimulationTradesQuery({
    variables: { sessionId, limit: PAGE_SIZE, offset },
  })

  const trades = data?.simulationTrades ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>거래 내역</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">로딩중...</div>
        ) : trades.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">거래 내역이 없습니다</div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border">
                  <TableHead>일시</TableHead>
                  <TableHead>종목</TableHead>
                  <TableHead>구분</TableHead>
                  <TableHead className="text-right">수량</TableHead>
                  <TableHead className="text-right">가격</TableHead>
                  <TableHead className="text-right">금액</TableHead>
                  <TableHead>사유</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map((trade) => (
                  <TableRow key={trade.id}>
                    <TableCell className="py-2 whitespace-nowrap">{formatDate(trade.createdAt)}</TableCell>
                    <TableCell className="py-2">
                      <div className="font-medium">{trade.stockName}</div>
                      <div className="text-xs text-muted-foreground">{trade.stockCode}</div>
                    </TableCell>
                    <TableCell className="py-2">
                      <Badge variant={trade.side === 'BUY' ? 'info' : 'danger'}>
                        {trade.side === 'BUY' ? '매수' : '매도'}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2 text-right">{formatNumber(trade.quantity)}</TableCell>
                    <TableCell className="py-2 text-right">{formatCurrency(trade.price, trade.market)}</TableCell>
                    <TableCell className="py-2 text-right">{formatCurrency(trade.totalAmount, trade.market)}</TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground max-w-[200px] truncate">
                      {trade.reason ?? '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between mt-4">
              <Button
                size="sm"
                variant="outline"
                disabled={offset === 0}
                onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
              >
                이전
              </Button>
              <span className="text-sm text-muted-foreground">
                {offset + 1} - {offset + trades.length}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={trades.length < PAGE_SIZE}
                onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
              >
                다음
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
