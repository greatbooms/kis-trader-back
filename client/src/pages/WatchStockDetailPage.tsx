import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  useGetWatchStockQuery,
  useGetWatchStockExecutionLogsQuery,
  useResetWatchStockCarryMutation,
  useGetTradesQuery,
  useCancelTradeOrderMutation,
  useTriggerWatchStockNowMutation,
  useUpdateWatchStockMutation,
  useGetAvailableStrategiesQuery,
} from '@/graphql/generated'
import { EXCHANGE_LABELS } from '@/lib/market-constants'
import { canCancelTrade, getTradeRecordDisplayInfo } from '@/lib/trade-record'
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils'
import { getMutationErrorMessage } from '@/lib/apollo-utils'

function eventVariant(eventType: string): 'success' | 'danger' | 'warning' | 'info' | 'outline' {
  if (eventType === 'ORDER_FILLED') return 'success'
  if (eventType === 'ORDER_FAILED' || eventType === 'ERROR') return 'danger'
  if (eventType === 'ORDER_AWAITING_APPROVAL' || eventType === 'ORDER_CANCELLED') return 'warning'
  if (eventType === 'SIGNAL_CREATED') return 'info'
  return 'outline'
}

function eventLabel(eventType: string): string {
  switch (eventType) {
    case 'SKIPPED':
      return '스킵'
    case 'SIGNAL_CREATED':
      return '시그널'
    case 'ORDER_SUBMITTED':
      return '주문접수'
    case 'ORDER_FILLED':
      return '체결'
    case 'ORDER_FAILED':
      return '실패'
    case 'ORDER_AWAITING_APPROVAL':
      return '승인대기'
    case 'ORDER_CANCELLED':
      return '취소'
    case 'ERROR':
      return '오류'
    default:
      return eventType
  }
}

function formatCycleValue(value: number): string {
  return value.toFixed(1)
}

export function WatchStockDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  const { data, loading, refetch } = useGetWatchStockQuery({
    variables: { id: id ?? '' },
    skip: !id,
  })
  const { data: strategiesData } = useGetAvailableStrategiesQuery()
  const [updateWatchStock, { loading: saving }] = useUpdateWatchStockMutation()
  const [triggerWatchStockNow, { loading: triggering }] = useTriggerWatchStockNowMutation()
  const [resetWatchStockCarry, { loading: resettingCarry }] = useResetWatchStockCarryMutation()

  const stock = data?.watchStock
  const strategies = strategiesData?.availableStrategies ?? []
  const strategyDisplayName = stock?.strategyName
    ? strategies.find((strategy) => strategy.name === stock.strategyName)?.displayName ?? stock.strategyName
    : undefined
  const supportsCycles = ['infinite-buy', 'daily-dca'].includes(stock?.strategyName ?? '')
  const strategyParams = useMemo(() => {
    if (!stock?.strategyParams) return null
    try {
      return JSON.parse(stock.strategyParams) as Record<string, unknown>
    } catch {
      return null
    }
  }, [stock?.strategyParams])
  const accumulatedQuota = Number(strategyParams?.accumulatedQuota || 0)

  const [isEditing, setIsEditing] = useState(false)
  const [isActive, setIsActive] = useState(true)
  const [quota, setQuota] = useState('')
  const [stopLossRate, setStopLossRate] = useState('')
  const [maxCycles, setMaxCycles] = useState('')
  const [error, setError] = useState('')

  const { data: logsData, loading: logsLoading, refetch: logsRefetch } = useGetWatchStockExecutionLogsQuery({
    variables: { watchStockId: id ?? '', limit: 50 },
    skip: !id,
  })

  const { data: tradesData, loading: tradesLoading, refetch: tradesRefetch } = useGetTradesQuery({
    variables: {
      input: stock
        ? {
            stockCode: stock.stockCode,
            exchangeCode: stock.exchangeCode,
            limit: 20,
          }
        : undefined,
    },
    skip: !stock,
  })
  const [cancelTradeOrder, { loading: cancelTradeLoading }] = useCancelTradeOrderMutation()

  const actualTrades = useMemo(
    () => tradesData?.trades ?? [],
    [tradesData],
  )

  useEffect(() => {
    if (!stock) return
    setIsActive(stock.isActive)
    setQuota(stock.quota ? String(stock.quota) : '')
    setStopLossRate(String(Math.round(stock.stopLossRate * 100)))
    setMaxCycles(String(stock.maxCycles))
    setIsEditing(false)
    setError('')
  }, [stock])

  if (loading) {
    return <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">로딩중...</div>
  }

  if (!stock) {
    return <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">관심종목을 찾을 수 없습니다</div>
  }

  const resetForm = () => {
    setIsActive(stock.isActive)
    setQuota(stock.quota ? String(stock.quota) : '')
    setStopLossRate(String(Math.round(stock.stopLossRate * 100)))
    setMaxCycles(String(stock.maxCycles))
    setError('')
  }

  const isDirty =
    isActive !== stock.isActive ||
    quota !== (stock.quota ? String(stock.quota) : '') ||
    Number(stopLossRate || 0) !== Math.round(stock.stopLossRate * 100) ||
    (supportsCycles && Number(maxCycles || 0) !== stock.maxCycles)

  const handleSave = async () => {
    if (!quota || Number(quota) <= 0) {
      setError('투자금을 입력해주세요')
      return
    }

    if (!stopLossRate || Number(stopLossRate) < 0 || Number(stopLossRate) >= 100) {
      setError('손절률은 0 이상 100 미만으로 입력해주세요')
      return
    }

    if (supportsCycles && (!maxCycles || Number(maxCycles) <= 0 || !Number.isInteger(Number(maxCycles)))) {
      setError('사이클은 1 이상의 정수로 입력해주세요')
      return
    }

    setError('')

    try {
      await updateWatchStock({
        variables: {
          id: stock.id,
          input: {
            isActive,
            quota: Number(quota),
            stopLossRate: Number(stopLossRate) / 100,
            maxCycles: supportsCycles ? Number(maxCycles) : undefined,
          },
        },
      })
      await refetch()
      setIsEditing(false)
    } catch (e: unknown) {
      setError(getMutationErrorMessage(e, '설정 저장 중 오류가 발생했습니다'))
    }
  }

  const handleCancelTrade = async (tradeId: string) => {
    if (!window.confirm('이 미체결 주문을 취소할까요?')) {
      return
    }

    try {
      const { data: result } = await cancelTradeOrder({
        variables: {
          input: { tradeRecordId: tradeId },
        },
      })

      if (result?.cancelTradeOrder.success) {
        await tradesRefetch()
        alert(result.cancelTradeOrder.message || '주문 취소 요청을 접수했습니다.')
        return
      }

      alert(result?.cancelTradeOrder.message || '주문 취소 실패')
    } catch (e: unknown) {
      alert(getMutationErrorMessage(e, '주문 취소 중 오류가 발생했습니다'))
    }
  }

  const handleManualTrigger = async () => {
    if (!stock) return

    try {
      const result = await triggerWatchStockNow({
        variables: { id: stock.id },
      })
      alert(result.data?.triggerWatchStockNow.message || '전략 수동 실행을 완료했습니다.')
      await Promise.all([
        refetch(),
        id ? logsRefetch() : Promise.resolve(),
      ])
    } catch (e: unknown) {
      alert(getMutationErrorMessage(e, '전략 수동 실행 중 오류가 발생했습니다'))
    }
  }

  const handleResetCarry = async () => {
    if (!stock) return

    try {
      const result = await resetWatchStockCarry({
        variables: { id: stock.id },
      })
      alert(result.data?.resetWatchStockCarry.message || '이월 금액을 초기화했습니다.')
      await Promise.all([
        refetch(),
        id ? logsRefetch() : Promise.resolve(),
      ])
    } catch (e: unknown) {
      alert(getMutationErrorMessage(e, '이월 금액 초기화 중 오류가 발생했습니다'))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/watchlist')}
            aria-label="관심종목 목록으로 이동"
            title="관심종목 목록으로 이동"
          >
            <ArrowLeft size={16} />
          </Button>
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold text-foreground break-words">{stock.stockName}</h2>
            <p className="text-sm text-muted-foreground mt-1 break-all">
              {stock.stockCode} · {EXCHANGE_LABELS[stock.exchangeCode] ?? stock.exchangeCode}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={stock.isActive ? 'success' : 'outline'}>
            {stock.isActive ? '활성' : '비활성'}
          </Badge>
          {stock.strategyName && <Badge variant="info">{stock.strategyName}</Badge>}
          {stock.isActive && stock.strategyName && (
            <Button variant="outline" onClick={handleManualTrigger} disabled={triggering}>
              {triggering ? '실행중...' : '전략 수동 실행'}
            </Button>
          )}
          {stock.isActive && ['infinite-buy', 'daily-dca'].includes(stock.strategyName ?? '') && accumulatedQuota > 0 && (
            <Button variant="outline" onClick={handleResetCarry} disabled={resettingCarry}>
              {resettingCarry ? '초기화중...' : `이월금 초기화 (${formatCurrency(accumulatedQuota, stock.market)})`}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle>종목 설정</CardTitle>
            <div className="flex items-center gap-2">
              {isEditing ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      resetForm()
                      setIsEditing(false)
                    }}
                  >
                    취소
                  </Button>
                  <Button onClick={handleSave} disabled={!isDirty || saving}>
                    {saving ? '저장중...' : '저장'}
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={() => setIsEditing(true)}>
                  수정
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">상태</label>
            <Select
              value={isActive ? 'ACTIVE' : 'INACTIVE'}
              onChange={(e) => setIsActive(e.target.value === 'ACTIVE')}
              disabled={!isEditing}
            >
              <option value="ACTIVE">활성</option>
              <option value="INACTIVE">비활성</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">전략</label>
            <Input value={strategyDisplayName ?? '-'} readOnly disabled />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">투자금</label>
            <Input
              type="number"
              value={quota}
              onChange={(e) => setQuota(e.target.value)}
              readOnly={!isEditing}
              disabled={!isEditing}
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">손절률 (%)</label>
            <Input
              type="number"
              min="0"
              max="99.99"
              step="0.1"
              value={stopLossRate}
              onChange={(e) => setStopLossRate(e.target.value)}
              readOnly={!isEditing}
              disabled={!isEditing}
            />
          </div>
          {supportsCycles && (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">최대 사이클</label>
              <Input
                type="number"
                min="1"
                step="1"
                value={maxCycles}
                onChange={(e) => setMaxCycles(e.target.value)}
                readOnly={!isEditing}
                disabled={!isEditing}
              />
            </div>
          )}
          {error && <p className="text-sm text-danger md:col-span-2 xl:col-span-4">{error}</p>}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">투자금</CardTitle></CardHeader>
          <CardContent className="text-xl font-semibold">
            {stock.quota ? formatCurrency(stock.quota, stock.market, stock.exchangeCode) : '-'}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">손절률</CardTitle></CardHeader>
          <CardContent className="text-xl font-semibold">-{(stock.stopLossRate * 100).toFixed(1)}%</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">사이클</CardTitle></CardHeader>
          <CardContent className="text-xl font-semibold">{formatCycleValue(stock.cycle)} / {stock.maxCycles}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">최근 상태</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            <div className="font-medium">{stock.lastExecutionStatus ?? '기록 없음'}</div>
            {stock.lastExecutionDate && <div className="text-xs text-muted-foreground">{stock.lastExecutionDate}</div>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>운용 로그</CardTitle>
        </CardHeader>
        <CardContent>
          {logsLoading ? (
            <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">로딩중...</div>
          ) : (logsData?.watchStockExecutionLogs ?? []).length === 0 ? (
            <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">저장된 실행 로그가 없습니다</div>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {logsData?.watchStockExecutionLogs.map((log) => (
                  <div key={log.id} className="rounded-lg border border-border p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-xs text-muted-foreground">{formatDate(log.createdAt)}</div>
                      <Badge variant={eventVariant(log.eventType)}>{eventLabel(log.eventType)}</Badge>
                    </div>
                    <div className="font-medium">{log.message}</div>
                    {log.details && (
                      <div className="text-xs text-muted-foreground break-all">{log.details}</div>
                    )}
                  </div>
                ))}
              </div>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>일시</TableHead>
                      <TableHead>구분</TableHead>
                      <TableHead>메시지</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logsData?.watchStockExecutionLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="whitespace-nowrap">{formatDate(log.createdAt)}</TableCell>
                        <TableCell>
                          <Badge variant={eventVariant(log.eventType)}>{eventLabel(log.eventType)}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{log.message}</div>
                          {log.details && (
                            <div className="mt-1 text-xs text-muted-foreground break-all">{log.details}</div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>실제 체결 기록</CardTitle>
        </CardHeader>
        <CardContent>
          {tradesLoading ? (
            <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">로딩중...</div>
          ) : actualTrades.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">체결된 실제 매매가 없습니다</div>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {actualTrades.map((trade) => {
                  const info = getTradeRecordDisplayInfo(trade)
                  return (
                    <div key={trade.id} className="rounded-lg border border-border p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-xs text-muted-foreground">{formatDate(trade.createdAt)}</div>
                        <div className="flex gap-2">
                          <Badge variant={trade.side === 'BUY' ? 'info' : 'danger'}>
                            {trade.side === 'BUY' ? '매수' : '매도'}
                          </Badge>
                          <Badge variant={info.variant}>{info.label}</Badge>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-xs text-muted-foreground">수량</div>
                          <div>{formatNumber(trade.executedQty ?? trade.quantity)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">가격</div>
                          <div>{formatCurrency(trade.executedPrice ?? trade.price, trade.market, trade.exchangeCode)}</div>
                        </div>
                      </div>
                      <div className="text-sm text-muted-foreground">{trade.reason ?? '-'}</div>
                      {canCancelTrade(trade) ? (
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={cancelTradeLoading}
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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>일시</TableHead>
                      <TableHead>구분</TableHead>
                      <TableHead>상태</TableHead>
                      <TableHead className="text-right">수량</TableHead>
                      <TableHead className="text-right">가격</TableHead>
                      <TableHead>사유</TableHead>
                      <TableHead className="text-center">액션</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {actualTrades.map((trade) => (
                      <TableRow key={trade.id}>
                        <TableCell className="whitespace-nowrap">{formatDate(trade.createdAt)}</TableCell>
                        <TableCell>
                          <Badge variant={trade.side === 'BUY' ? 'info' : 'danger'}>
                            {trade.side === 'BUY' ? '매수' : '매도'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const info = getTradeRecordDisplayInfo(trade)
                            return (
                              <div className="flex flex-col gap-1">
                                <Badge variant={info.variant}>{info.label}</Badge>
                                {info.detail && <span className="text-xs text-muted-foreground">{info.detail}</span>}
                              </div>
                            )
                          })()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div>{formatNumber(trade.executedQty ?? trade.quantity)}</div>
                          {(trade.executedQty ?? 0) > 0 && (trade.executedQty ?? 0) !== trade.quantity && (
                            <div className="text-xs text-muted-foreground">주문 {formatNumber(trade.quantity)}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(trade.executedPrice ?? trade.price, trade.market, trade.exchangeCode)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <div className="line-clamp-2" title={trade.reason ?? undefined}>{trade.reason ?? '-'}</div>
                        </TableCell>
                        <TableCell className="text-center">
                          {canCancelTrade(trade) ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={cancelTradeLoading}
                              onClick={() => handleCancelTrade(trade.id)}
                            >
                              취소
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
