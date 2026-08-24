import { useEffect, useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import {
  useGetTradesQuery,
  useCancelTradeOrderMutation,
  type Side,
} from '@/graphql/generated'
import { canCancelTrade, getTradeRecordDisplayInfo } from '@/lib/trade-record'
import { formatCurrency, formatNumber, formatDateInputInTimeZone } from '@/lib/utils'
import { TradeTimestamps } from '@/components/TradeTimestamps'
import { filterByCountry } from '@/lib/market-constants'
import { useIsMobile } from './portfolio-helpers'
import { SectionToggleButton, MetricItem } from './PortfolioCommon'
import type { PortfolioCardScopeProps } from './types'

// ── 매매 기록 카드: 필터 + 페이지네이션 + 주문 취소 ──

export function TradesCard({ market, countryFilter }: PortfolioCardScopeProps) {
  const isMobile = useIsMobile()
  const [sideFilter, setSideFilter] = useState<Side | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const today = formatDateInputInTimeZone(new Date())
  const weekAgo = formatDateInputInTimeZone(new Date(new Date().getTime() - 7 * 24 * 60 * 60 * 1000))
  const [dateFrom, setDateFrom] = useState<string>(weekAgo)
  const [dateTo, setDateTo] = useState<string>(today)
  const [page, setPage] = useState(0)
  const limit = 20

  const { data, loading } = useGetTradesQuery({
    variables: {
      input: {
        market,
        side: sideFilter,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        limit,
        offset: page * limit,
      },
    },
  })
  const [cancelTradeOrder, { loading: cancelLoading }] = useCancelTradeOrderMutation()
  const allTrades = data?.trades ?? []
  const trades = filterByCountry(allTrades, countryFilter)

  const handleCancelTrade = async (tradeId: string) => {
    if (!window.confirm('이 미체결 주문을 취소할까요?')) {
      return
    }

    try {
      const { data: result } = await cancelTradeOrder({
        variables: {
          input: {
            tradeRecordId: tradeId,
          },
        },
        refetchQueries: ['GetTrades', 'GetBrokerOrderRecoveryItems'],
        awaitRefetchQueries: true,
      })

      if (result?.cancelTradeOrder.success) {
        alert(result.cancelTradeOrder.message || '주문 취소 요청을 접수했습니다.')
        return
      }

      alert(result?.cancelTradeOrder.message || '주문 취소 실패')
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류'
      alert(`주문 취소 실패: ${message}`)
    }
  }

  useEffect(() => {
    setCollapsed(isMobile)
  }, [isMobile])

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <CardTitle>매매 기록</CardTitle>
              {isMobile ? (
                <SectionToggleButton
                  collapsed={collapsed}
                  onClick={() => setCollapsed((prev) => !prev)}
                  label="매매 기록"
                />
              ) : null}
            </div>
            {!collapsed ? (
              <div className="flex gap-2 flex-wrap">
                {([null, 'BUY', 'SELL'] as const).map((s) => (
                  <Button key={s ?? 'all'} variant={sideFilter === s ? 'default' : 'outline'} size="sm" onClick={() => { setSideFilter(s); setPage(0) }}>
                    {s === null ? '전체' : s === 'BUY' ? '매수' : '매도'}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
          {!collapsed ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(0) }}
                className="w-full sm:w-40"
              />
              <span className="text-sm text-muted-foreground">~</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(0) }}
                className="w-full sm:w-40"
              />
              {(dateFrom || dateTo) ? (
                <Button variant="outline" size="sm" onClick={() => { setDateFrom(weekAgo); setDateTo(today); setPage(0) }}>
                  초기화
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardHeader>
      {!collapsed ? (
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-8">로딩중...</p>
          ) : trades.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">매매 기록이 없습니다</p>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {trades.map((trade) => {
                  const info = getTradeRecordDisplayInfo(trade)
                  return (
                    <div
                      key={trade.id}
                      className={`rounded-lg border border-border p-4 space-y-3 ${trade.status === 'FAILED' ? 'bg-red-50/60' : trade.status === 'PARTIAL' ? 'bg-amber-50/40' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <div className="font-medium">{trade.stockName}</div>
                            <Badge variant="outline">{trade.broker}</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">{trade.stockCode}</div>
                          <div className="mt-1"><TradeTimestamps createdAt={trade.createdAt} executedAt={trade.executedAt} /></div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant={trade.side === 'BUY' ? 'danger' : 'info'}>
                            {trade.side === 'BUY' ? '매수' : '매도'}
                          </Badge>
                          <Badge variant={info.variant}>{info.label}</Badge>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <MetricItem label="수량" value={formatNumber(trade.quantity)} />
                        <MetricItem label="가격" value={formatCurrency(trade.executedPrice ?? trade.price, trade.market)} />
                        <MetricItem label="전략" value={trade.strategyName ?? '-'} />
                        <MetricItem label="상세" value={info.detail ?? '-'} />
                      </div>
                      <div className="text-xs text-muted-foreground">{trade.reason ?? '-'}</div>
                      {canCancelTrade(trade) ? (
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={cancelLoading}
                            onClick={() => handleCancelTrade(trade.id)}
                          >
                            주문 취소
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
              <div className="hidden md:block">
                <Table className="table-fixed [&_th]:px-2 [&_td]:px-2">
                  <colgroup>
                    <col className="w-44" /> {/* 일시 */}
                    <col className="w-32" /> {/* 종목 */}
                    <col className="w-16" /> {/* 구분 */}
                    <col className="w-16" /> {/* 수량 */}
                    <col className="w-24" /> {/* 가격 */}
                    <col className="w-24" /> {/* 주문 상태 */}
                    <col className="w-28" /> {/* 상세 */}
                    <col className="w-24" /> {/* 전략 */}
                    <col />                  {/* 사유 */}
                    <col className="w-16" /> {/* 액션 */}
                  </colgroup>
                  <TableHeader>
                    <TableRow className="border-b border-border">
                      <TableHead>일시</TableHead>
                      <TableHead>종목</TableHead>
                      <TableHead>구분</TableHead>
                      <TableHead className="text-right">수량</TableHead>
                      <TableHead className="text-right">가격</TableHead>
                      <TableHead className="text-center">주문 상태</TableHead>
                      <TableHead>상세</TableHead>
                      <TableHead>전략</TableHead>
                      <TableHead>사유</TableHead>
                      <TableHead className="text-center">액션</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trades.map((trade) => {
                      const info = getTradeRecordDisplayInfo(trade)

                      return (
                        <TableRow
                          key={trade.id}
                          className={trade.status === 'FAILED' ? 'bg-red-50/60' : trade.status === 'PARTIAL' ? 'bg-amber-50/40' : undefined}
                        >
                          <TableCell className="align-top py-2"><TradeTimestamps createdAt={trade.createdAt} executedAt={trade.executedAt} /></TableCell>
                          <TableCell className="align-top py-2 min-w-0">
                            <div className="font-medium truncate">{trade.stockName}</div>
                            <div className="flex items-center gap-1">
                              <div className="text-xs text-muted-foreground truncate">{trade.stockCode}</div>
                              <Badge variant="outline">{trade.broker}</Badge>
                            </div>
                          </TableCell>
                          <TableCell className="align-top py-2">
                            <Badge variant={trade.side === 'BUY' ? 'danger' : 'info'}>
                              {trade.side === 'BUY' ? '매수' : '매도'}
                            </Badge>
                          </TableCell>
                          <TableCell className="align-top py-2 text-right whitespace-nowrap">
                            <div>{formatNumber(trade.quantity)}</div>
                            {(trade.executedQty ?? 0) > 0 && (trade.executedQty ?? 0) !== trade.quantity ? (
                              <div className="text-xs text-muted-foreground">체결 {formatNumber(trade.executedQty ?? 0)}</div>
                            ) : null}
                          </TableCell>
                          <TableCell className="align-top py-2 text-right whitespace-nowrap">
                            {formatCurrency(trade.executedPrice ?? trade.price, trade.market)}
                          </TableCell>
                          <TableCell className="align-top py-2 text-center">
                            <div className="flex justify-center">
                              <Badge variant={info.variant} className="whitespace-nowrap">
                                {info.label}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="align-top py-2 text-xs text-muted-foreground break-words">
                            {info.detail ?? '-'}
                          </TableCell>
                          <TableCell className="align-top py-2 text-xs text-muted-foreground truncate">{trade.strategyName ?? '-'}</TableCell>
                          <TableCell className="align-top py-2 text-xs text-muted-foreground min-w-0 border-l border-border/30 pl-3">
                            <div className="line-clamp-3 break-words" title={trade.reason ?? undefined}>{trade.reason ?? '-'}</div>
                          </TableCell>
                          <TableCell className="align-top py-2 text-center">
                            {canCancelTrade(trade) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={cancelLoading}
                                onClick={() => handleCancelTrade(trade.id)}
                              >
                                취소
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-between items-center mt-4">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  이전
                </Button>
                <span className="text-sm text-muted-foreground">페이지 {page + 1}</span>
                <Button size="sm" variant="outline" disabled={trades.length < limit} onClick={() => setPage(page + 1)}>
                  다음
                </Button>
              </div>
            </>
          )}
        </CardContent>
      ) : null}
    </Card>
  )
}
