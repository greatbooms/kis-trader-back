import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip } from '@/components/ui/tooltip'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Info } from 'lucide-react'
import { useGetSimulationTradesQuery, type SimulationTradeStatus } from '@/graphql/generated'
import { formatCurrency, formatNumber, formatDate } from '@/lib/utils'
import type { SimulationTradesTableProps } from '@/pages/simulation/types'

const PAGE_SIZE = 20
type TradeFilter = 'ALL' | SimulationTradeStatus

export function SimulationTradesTable({ sessionId }: SimulationTradesTableProps) {
  const [offset, setOffset] = useState(0)
  const [filter, setFilter] = useState<TradeFilter>('ALL')
  const { data, loading } = useGetSimulationTradesQuery({
    variables: {
      input: {
        sessionId,
        limit: PAGE_SIZE,
        offset,
        tradeStatus: filter === 'ALL' ? undefined : filter,
      },
    },
  })

  const trades = data?.simulationTrades ?? []

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            <CardTitle>거래 내역</CardTitle>
            <Tooltip text="전략이 실행한 모든 매수/매도 기록입니다. 각 거래의 시점, 가격, 수량과 매매 사유를 확인할 수 있습니다.">
              <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
            </Tooltip>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant={filter === 'ALL' ? 'default' : 'outline'} onClick={() => {
              setFilter('ALL')
              setOffset(0)
            }}>
              전체
            </Button>
            <Button size="sm" variant={filter === 'EXECUTED' ? 'default' : 'outline'} onClick={() => {
              setFilter('EXECUTED')
              setOffset(0)
            }}>
              체결만
            </Button>
            <Button size="sm" variant={filter === 'FAILED' ? 'default' : 'outline'} onClick={() => {
              setFilter('FAILED')
              setOffset(0)
            }}>
              실패만
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">로딩중...</div>
        ) : trades.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">거래 내역이 없습니다</div>
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {trades.map((trade) => (
                <div key={trade.id} className={`rounded-lg border border-border p-4 space-y-3 ${trade.tradeStatus === 'FAILED' ? 'bg-red-50/60' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{trade.stockName}</div>
                      <div className="text-xs text-muted-foreground">{trade.stockCode}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{formatDate(trade.createdAt)}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={trade.side === 'BUY' ? 'info' : 'danger'}>
                        {trade.side === 'BUY' ? '매수' : '매도'}
                      </Badge>
                      <Badge variant={trade.tradeStatus === 'EXECUTED' ? 'success' : 'danger'}>
                        {trade.tradeStatus === 'EXECUTED' ? '체결' : '실패'}
                      </Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <MetricItem label="수량" value={formatNumber(trade.quantity)} />
                    <MetricItem label="가격" value={formatCurrency(trade.price, trade.market)} />
                    <MetricItem label="금액" value={trade.tradeStatus === 'FAILED' ? '-' : formatCurrency(trade.totalAmount, trade.market)} />
                    <MetricItem label="사유" value={trade.reason ?? '-'} />
                  </div>
                  {trade.failReason && (
                    <div className="text-xs text-danger">{trade.failReason}</div>
                  )}
                </div>
              ))}
            </div>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border">
                    <TableHead>일시</TableHead>
                    <TableHead>종목</TableHead>
                    <TableHead>구분</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead className="text-right">수량</TableHead>
                    <TableHead className="text-right">가격</TableHead>
                    <TableHead className="text-right">금액</TableHead>
                    <TableHead>사유</TableHead>
                    <TableHead>실패 사유</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trades.map((trade) => (
                    <TableRow key={trade.id} className={trade.tradeStatus === 'FAILED' ? 'bg-red-50/60' : undefined}>
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
                      <TableCell className="py-2">
                        <Badge variant={trade.tradeStatus === 'EXECUTED' ? 'success' : 'danger'}>
                          {trade.tradeStatus === 'EXECUTED' ? '체결' : '실패'}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2 text-right">{formatNumber(trade.quantity)}</TableCell>
                      <TableCell className="py-2 text-right">{formatCurrency(trade.price, trade.market)}</TableCell>
                      <TableCell className="py-2 text-right">
                        {trade.tradeStatus === 'FAILED' ? '-' : formatCurrency(trade.totalAmount, trade.market)}
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground max-w-[200px] truncate">
                        {trade.reason ?? '-'}
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground max-w-[160px] truncate">
                        {trade.failReason ?? '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
                {trades.length === 0 ? 0 : offset + 1} - {offset + trades.length}
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

function MetricItem({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div>{value}</div>
    </div>
  )
}
