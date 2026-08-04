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
  useConvertWatchStockToInfiniteBuyV4Mutation,
  usePreviewWatchStockExecutionLazyQuery,
} from '@/graphql/generated'
import type { ConvertWatchStockToInfiniteBuyV4Mutation, PreviewWatchStockExecutionQuery } from '@/graphql/generated'
import { EXCHANGE_LABELS } from '@/lib/market-constants'
import { canCancelTrade, getTradeRecordDisplayInfo } from '@/lib/trade-record'
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils'
import { getMutationErrorMessage } from '@/lib/apollo-utils'
import { STRATEGY_META, DEFAULT_STRATEGY_META } from '@/pages/watchlist/strategy-meta'
import type { InfiniteBuyV4Status } from '@/pages/types'

type V4Preview = ConvertWatchStockToInfiniteBuyV4Mutation['convertWatchStockToInfiniteBuyV4']
type ExecutionPreview = PreviewWatchStockExecutionQuery['previewWatchStockExecution']

const V4_PHASE_LABELS: Record<string, string> = {
  'v4-first-buy': '첫 매수',
  'v4-avg-buy': '평단 매수',
  'v4-star-buy': '별지점 매수',
  'v4-ladder-buy': '사다리 매수',
  'v4-quarter-sell': '쿼터매도',
  'v4-final-sell': '최종매도',
  'v4-reverse-sell': '리버스 매도',
  'v4-reverse-buy': '리버스 매수',
}

function phaseLabel(phase?: string | null): string {
  if (!phase) return '-'
  return V4_PHASE_LABELS[phase] ?? phase
}

function fillConditionLabel(fillModel?: string | null, side?: string | null): string {
  if (fillModel === 'loc') {
    return side === 'SELL' ? 'LOC — 종가 ≥ 가격이면 체결' : 'LOC — 종가 ≤ 가격이면 체결'
  }
  if (fillModel === 'moc') return 'MOC — 장마감 시장가, 무조건 체결'
  if (fillModel === 'limit-touch') return '지정가 — 장중 해당 가격 터치 시 체결'
  return '-'
}

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
  const [convertToV4, { loading: v4Loading }] = useConvertWatchStockToInfiniteBuyV4Mutation()
  const [v4Preview, setV4Preview] = useState<V4Preview | null>(null)
  const [fetchExecutionPreview, { data: executionPreviewData, loading: executionPreviewLoading, error: executionPreviewError }] =
    usePreviewWatchStockExecutionLazyQuery({ fetchPolicy: 'network-only' })
  const [v4Error, setV4Error] = useState('')

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
  // viaParams 전략은 백엔드가 strategyParams.stopLossRate를 읽으므로, 있으면 그 값이 실제 적용값
  const effectiveStopLossFraction =
    (STRATEGY_META[stock?.strategyName ?? '']?.stopLossViaParams &&
      typeof strategyParams?.stopLossRate === 'number')
      ? (strategyParams.stopLossRate as number)
      : stock?.stopLossRate ?? 0

  const [isEditing, setIsEditing] = useState(false)
  const [isActive, setIsActive] = useState(true)
  const [quota, setQuota] = useState('')
  const [stopLossRate, setStopLossRate] = useState('')
  const [maxCycles, setMaxCycles] = useState('')
  const [rsiPolicy, setRsiPolicy] = useState<'hard-stop-70' | 'hard-stop-75' | 'hard-stop-80' | 'continuous' | 'none'>('hard-stop-70')
  const [maxDailyQuotaMultiple, setMaxDailyQuotaMultiple] = useState('3')
  const [error, setError] = useState('')
  const isInfiniteBuy = stock?.strategyName === 'infinite-buy'
  const isInfiniteBuyV4 = stock?.strategyName === 'infinite-buy-v4'
  const v4Status = isInfiniteBuyV4 ? (strategyParams?.v4 as InfiniteBuyV4Status | undefined) : undefined
  const meta = STRATEGY_META[stock?.strategyName ?? ''] ?? DEFAULT_STRATEGY_META
  const canConvertToV4 = isInfiniteBuy && stock?.market === 'OVERSEAS'
  const storedRsiPolicy = (strategyParams?.rsiPolicy as string) || 'hard-stop-70'
  const storedMaxDailyQuota = strategyParams?.maxDailyQuotaMultiple !== undefined
    ? String(strategyParams.maxDailyQuotaMultiple)
    : '3'

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
    setStopLossRate(String(Math.round(effectiveStopLossFraction * 100)))
    setMaxCycles(String(stock.maxCycles))
    setRsiPolicy(storedRsiPolicy as typeof rsiPolicy)
    setMaxDailyQuotaMultiple(storedMaxDailyQuota)
    setIsEditing(false)
    setError('')
  }, [stock, storedRsiPolicy, storedMaxDailyQuota, effectiveStopLossFraction])

  if (loading) {
    return <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">로딩중...</div>
  }

  if (!stock) {
    return <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">관심종목을 찾을 수 없습니다</div>
  }

  const resetForm = () => {
    setIsActive(stock.isActive)
    setQuota(stock.quota ? String(stock.quota) : '')
    setStopLossRate(String(Math.round(effectiveStopLossFraction * 100)))
    setMaxCycles(String(stock.maxCycles))
    setRsiPolicy(storedRsiPolicy as typeof rsiPolicy)
    setMaxDailyQuotaMultiple(storedMaxDailyQuota)
    setError('')
  }

  const isDirty =
    isActive !== stock.isActive ||
    quota !== (stock.quota ? String(stock.quota) : '') ||
    (!isInfiniteBuyV4 && Number(stopLossRate || 0) !== Math.round(effectiveStopLossFraction * 100)) ||
    (supportsCycles && Number(maxCycles || 0) !== stock.maxCycles) ||
    (isInfiniteBuy && rsiPolicy !== storedRsiPolicy) ||
    (isInfiniteBuy && maxDailyQuotaMultiple !== storedMaxDailyQuota)

  const handleSave = async () => {
    if (!quota || Number(quota) <= 0) {
      setError('투자금을 입력해주세요')
      return
    }

    // V4는 손절이 없음(REVERSE 모드가 대체) — 필드 숨김과 함께 검증도 건너뜀
    if (!isInfiniteBuyV4 && (!stopLossRate || Number(stopLossRate) < 0 || Number(stopLossRate) >= 100)) {
      setError('손절률은 0 이상 100 미만으로 입력해주세요')
      return
    }

    if (supportsCycles && (!maxCycles || Number(maxCycles) <= 0 || !Number.isInteger(Number(maxCycles)))) {
      setError('사이클은 1 이상의 정수로 입력해주세요')
      return
    }

    setError('')

    try {
      let strategyParamsJson: string | undefined
      if (isInfiniteBuy || meta.stopLossViaParams) {
        const nextParams: Record<string, unknown> = { ...(strategyParams ?? {}) }
        if (isInfiniteBuy) {
          nextParams.rsiPolicy = rsiPolicy
          const mdq = Number(maxDailyQuotaMultiple)
          if (mdq > 0) nextParams.maxDailyQuotaMultiple = mdq
          else delete nextParams.maxDailyQuotaMultiple
        }
        // momentum-breakout 등은 WatchStock.stopLossRate가 아닌 strategyParams.stopLossRate를 읽는다
        if (meta.stopLossViaParams) {
          if (stopLossRate && Number(stopLossRate) > 0) nextParams.stopLossRate = Number(stopLossRate) / 100
          else delete nextParams.stopLossRate
        }
        strategyParamsJson = JSON.stringify(nextParams)
      }
      await updateWatchStock({
        variables: {
          id: stock.id,
          input: {
            isActive,
            quota: Number(quota),
            stopLossRate: isInfiniteBuyV4 ? undefined : Number(stopLossRate) / 100,
            maxCycles: supportsCycles ? Number(maxCycles) : undefined,
            strategyParams: strategyParamsJson,
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

  const handlePreviewV4 = async () => {
    if (!stock) return
    setV4Error('')
    try {
      const { data: result } = await convertToV4({ variables: { watchStockId: stock.id, dryRun: true } })
      if (result) setV4Preview(result.convertWatchStockToInfiniteBuyV4)
    } catch (e: unknown) {
      setV4Error(getMutationErrorMessage(e, 'V4 전환 미리보기 중 오류가 발생했습니다'))
    }
  }

  const handleConfirmV4 = async () => {
    if (!stock) return
    setV4Error('')
    try {
      await convertToV4({
        variables: { watchStockId: stock.id, dryRun: false },
        refetchQueries: ['GetWatchStocks'],
      })
      setV4Preview(null)
      await refetch()
    } catch (e: unknown) {
      setV4Error(getMutationErrorMessage(e, 'V4 전환 중 오류가 발생했습니다'))
    }
  }

  const handlePreviewExecution = () => {
    if (!stock) return
    void fetchExecutionPreview({ variables: { watchStockId: stock.id } })
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
            {isInfiniteBuyV4 && (
              <p className="text-xs text-muted-foreground">
                quota 변경 시 증감분이 V4 장부 잔금에 자동 반영됩니다. 증액분은 실제 예수금 입금이 뒷받침되어야 합니다.
              </p>
            )}
          </div>
          {isInfiniteBuyV4 ? (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">손절률</label>
              <p className="text-sm text-muted-foreground pt-2">
                손절 없음 — 원금 소진 시 REVERSE 모드가 리스크 해소 담당
              </p>
            </div>
          ) : (
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
          )}
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
          {isInfiniteBuy && (
            <>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-foreground">RSI 과열 정책</label>
                <Select
                  value={rsiPolicy}
                  onChange={(e) => setRsiPolicy(e.target.value as typeof rsiPolicy)}
                  disabled={!isEditing}
                >
                  <option value="hard-stop-70">RSI ≥ 70 매수 중단 (권장)</option>
                  <option value="hard-stop-75">RSI ≥ 75 매수 중단</option>
                  <option value="hard-stop-80">RSI ≥ 80 매수 중단</option>
                  <option value="continuous">RSI 60~80 점진 감산</option>
                  <option value="none">RSI 미반영</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-foreground">일일 투입 상한 (배수)</label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={maxDailyQuotaMultiple}
                  onChange={(e) => setMaxDailyQuotaMultiple(e.target.value)}
                  readOnly={!isEditing}
                  disabled={!isEditing}
                />
              </div>
            </>
          )}
          {canConvertToV4 && (
            <div className="md:col-span-2 xl:col-span-4 rounded-md border border-primary-200 bg-primary-50/50 dark:bg-primary-950/20 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">무한매수법 V4로 전환</p>
                {!v4Preview && (
                  <Button size="sm" variant="outline" onClick={handlePreviewV4} disabled={v4Loading}>
                    {v4Loading ? '계산중...' : '전환 미리보기'}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                기존 사이클/보유수량을 그대로 이어받아 V4 방식(별지점·소진 후 REVERSE)으로 전환합니다. DB 값은 시딩 계산 결과이며, 확정 전까지는 아무것도 바뀌지 않습니다.
              </p>

              {v4Preview && (
                <div className="space-y-2 rounded-md bg-card border border-border p-3">
                  <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div>
                      <div className="text-xs text-muted-foreground">회차 (T)</div>
                      <div className="font-medium">{v4Preview.turn.toFixed(2)} / {stock.maxCycles}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">잔금</div>
                      <div className="font-medium">{formatCurrency(v4Preview.cashRemaining, stock.market, stock.exchangeCode)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">보유수량</div>
                      <div className="font-medium">{formatNumber(v4Preview.lastKnownHoldQty)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">별% 기준</div>
                      <div className="font-medium">{v4Preview.starBasePct}%</div>
                    </div>
                  </div>

                  {v4Preview.warnings.length > 0 && (
                    <div className="space-y-1">
                      {v4Preview.warnings.map((warning) => (
                        <Badge key={warning} variant="warning" className="block w-fit text-xs whitespace-normal text-left">
                          {warning}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={() => setV4Preview(null)} disabled={v4Loading}>
                      취소
                    </Button>
                    <Button size="sm" onClick={handleConfirmV4} disabled={v4Loading}>
                      {v4Loading ? '전환중...' : '전환 확정'}
                    </Button>
                  </div>
                </div>
              )}

              {v4Error && <p className="text-xs text-danger">{v4Error}</p>}
            </div>
          )}
          {error && <p className="text-sm text-danger md:col-span-2 xl:col-span-4">{error}</p>}
        </CardContent>
      </Card>

      <div className={`grid gap-4 sm:grid-cols-2 ${supportsCycles ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">투자금</CardTitle></CardHeader>
          <CardContent className="text-xl font-semibold">
            {stock.quota ? formatCurrency(stock.quota, stock.market, stock.exchangeCode) : '-'}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">손절률</CardTitle></CardHeader>
          <CardContent>
            {isInfiniteBuyV4 ? (
              <p className="text-sm text-muted-foreground">
                손절 없음 — 원금 소진 시 REVERSE 모드가 리스크 해소 담당
              </p>
            ) : (
              <div className="text-xl font-semibold">-{(effectiveStopLossFraction * 100).toFixed(1)}%</div>
            )}
          </CardContent>
        </Card>
        {isInfiniteBuyV4 && v4Status && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm text-muted-foreground">V4 상태</CardTitle>
                <Badge variant={v4Status.mode === 'REVERSE' ? 'warning' : 'info'}>
                  {v4Status.mode === 'REVERSE' ? 'REVERSE' : 'NORMAL'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">회차 (T)</div>
                  <div className="font-medium">{(v4Status.turn ?? 0).toFixed(2)} / {stock.maxCycles}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">잔금</div>
                  <div className="font-medium">
                    {formatCurrency(v4Status.cashRemaining ?? 0, stock.market, stock.exchangeCode)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">보유수량</div>
                  <div className="font-medium">{formatNumber(v4Status.lastKnownHoldQty ?? 0)}</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {v4Status.mode === 'REVERSE'
                  ? 'REVERSE: 원금이 소진되어(T > N-1) 리스크 해소 모드로 전환되었습니다. 매도로 T가 회복되면 NORMAL로 복귀합니다.'
                  : 'NORMAL: 정상 분할매수 진행 중입니다. 원금(T)이 모두 소진되면 REVERSE로 전환되어 리스크를 해소합니다.'}
              </p>
            </CardContent>
          </Card>
        )}
        {!isInfiniteBuyV4 && (
          <Card>
            <CardHeader><CardTitle className="text-sm text-muted-foreground">사이클</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              <div className="text-xl font-semibold">
                {formatCycleValue(stock.cycle)} / {stock.maxCycles}
              </div>
              {stock.strategyName === 'infinite-buy' && stock.cycle != null && stock.cycle >= stock.maxCycles && (
                <Badge variant="outline" className="text-xs">사이클 완주 · 청산 대기</Badge>
              )}
            </CardContent>
          </Card>
        )}
        {supportsCycles && (
          <Card>
            <CardHeader><CardTitle className="text-sm text-muted-foreground">이월금</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              <div className="text-xl font-semibold">
                {formatCurrency(accumulatedQuota, stock.market, stock.exchangeCode)}
              </div>
              <div className="text-xs text-muted-foreground">
                오늘 못 산 금액이 다음 회차에 합산됩니다.
              </div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">최근 상태</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            <div className="font-medium">{stock.lastExecutionStatus ?? '기록 없음'}</div>
            {stock.lastExecutionDate && <div className="text-xs text-muted-foreground">{stock.lastExecutionDate}</div>}
          </CardContent>
        </Card>
      </div>

      {isInfiniteBuyV4 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle>오늘 실행 미리보기</CardTitle>
              <Button size="sm" variant="outline" onClick={handlePreviewExecution} disabled={executionPreviewLoading}>
                {executionPreviewLoading ? '조회중...' : '지금 평가하면?'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              실제 전략 코드를 조회 시점 시세/가용자금 기준으로 평가만 합니다 — 주문 제출, 실행 로그, 전략 상태 저장이 없습니다 (브로커 잔고 동기화만 수행).
            </p>
            {executionPreviewError && (
              <p className="text-sm text-danger">
                {getMutationErrorMessage(executionPreviewError, '미리보기 조회 중 오류가 발생했습니다')}
              </p>
            )}
            {executionPreviewData?.previewWatchStockExecution && (() => {
              const preview: ExecutionPreview = executionPreviewData.previewWatchStockExecution
              const { context, signals, skipReasons } = preview
              const cappedByBuyable =
                context.dailyBuyBudget != null
                && context.dailyBuyBudgetCapped != null
                && context.dailyBuyBudgetCapped < context.dailyBuyBudget

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <div className="text-xs text-muted-foreground">현재가</div>
                      <div className="font-medium">
                        {formatCurrency(context.currentPrice, stock.market, stock.exchangeCode)}
                      </div>
                    </div>
                    {context.avgPrice != null && (
                      <div>
                        <div className="text-xs text-muted-foreground">평단가</div>
                        <div className="font-medium">
                          {formatCurrency(context.avgPrice, stock.market, stock.exchangeCode)}
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="text-xs text-muted-foreground">가용자금</div>
                      <div className="font-medium">
                        {formatCurrency(context.buyableAmount, stock.market, stock.exchangeCode)}
                      </div>
                    </div>
                    {context.dailyBuyBudget != null && (
                      <div>
                        <div className="text-xs text-muted-foreground">일일 매수 시도액 (D = 잔금÷남은회차)</div>
                        <div className="font-medium">
                          {formatCurrency(
                            context.dailyBuyBudgetCapped ?? context.dailyBuyBudget,
                            stock.market,
                            stock.exchangeCode,
                          )}
                        </div>
                        {cappedByBuyable && (
                          <div className="text-xs text-warning">
                            가용자금 제한 적용 (원래{' '}
                            {formatCurrency(context.dailyBuyBudget, stock.market, stock.exchangeCode)})
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {(context.starPrice != null || context.reverseStarPrice != null) && (
                    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                      {context.starPrice != null && (
                        <div>
                          <div className="text-xs text-muted-foreground">
                            별지점가{context.starPct != null ? ` (별% ${context.starPct.toFixed(2)}%)` : ''}
                          </div>
                          <div className="font-medium">
                            {formatCurrency(context.starPrice, stock.market, stock.exchangeCode)}
                          </div>
                        </div>
                      )}
                      {context.reverseStarPrice != null && (
                        <div>
                          <div className="text-xs text-muted-foreground">리버스 별지점 (최근 종가 평균)</div>
                          <div className="font-medium">
                            {formatCurrency(context.reverseStarPrice, stock.market, stock.exchangeCode)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {signals.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>구분</TableHead>
                          <TableHead>단계</TableHead>
                          <TableHead className="text-right">수량</TableHead>
                          <TableHead className="text-right">가격</TableHead>
                          <TableHead>체결 조건</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {signals.map((signal, index) => (
                          <TableRow key={index}>
                            <TableCell>
                              <Badge variant={signal.side === 'BUY' ? 'info' : 'danger'}>
                                {signal.side === 'BUY' ? '매수' : '매도'}
                              </Badge>
                            </TableCell>
                            <TableCell>{phaseLabel(signal.phase)}</TableCell>
                            <TableCell className="text-right">{formatNumber(signal.quantity)}</TableCell>
                            <TableCell className="text-right">
                              {signal.price != null
                                ? formatCurrency(signal.price, stock.market, stock.exchangeCode)
                                : '시장가'}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {fillConditionLabel(signal.fillModel, signal.side)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-sm text-muted-foreground">오늘 생성될 주문이 없습니다.</p>
                  )}

                  {skipReasons.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-foreground">스킵 사유</div>
                      <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                        {skipReasons.map((reason, index) => (
                          <li key={index}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )
            })()}
          </CardContent>
        </Card>
      )}

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
                <Table className="table-fixed [&_th]:px-2 [&_td]:px-2">
                  <colgroup>
                    <col className="w-40" />
                    <col className="w-24" />
                    <col />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-40">일시</TableHead>
                      <TableHead className="w-24">구분</TableHead>
                      <TableHead>메시지</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logsData?.watchStockExecutionLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="align-top whitespace-nowrap">{formatDate(log.createdAt)}</TableCell>
                        <TableCell className="align-top">
                          <Badge variant={eventVariant(log.eventType)}>{eventLabel(log.eventType)}</Badge>
                        </TableCell>
                        <TableCell className="align-top min-w-0">
                          <div className="font-medium break-words">{log.message}</div>
                          {log.details && (
                            <div className="mt-1 text-xs text-muted-foreground break-words whitespace-pre-wrap">
                              {log.details}
                            </div>
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
                <Table className="table-auto [&_th]:px-2 [&_td]:px-2">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[1%] whitespace-nowrap">일시</TableHead>
                      <TableHead className="w-[1%] whitespace-nowrap">구분</TableHead>
                      <TableHead className="w-[1%] whitespace-nowrap">상태</TableHead>
                      <TableHead className="w-[1%] whitespace-nowrap text-right">수량</TableHead>
                      <TableHead className="w-[1%] whitespace-nowrap pr-4 text-right">가격</TableHead>
                      <TableHead className="w-full border-l border-border/40 pl-4">사유</TableHead>
                      <TableHead className="w-[1%] whitespace-nowrap text-center">액션</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {actualTrades.map((trade) => (
                      <TableRow key={trade.id}>
                        <TableCell className="align-top whitespace-nowrap pr-3">{formatDate(trade.createdAt)}</TableCell>
                        <TableCell className="align-top whitespace-nowrap pr-3">
                          <Badge variant={trade.side === 'BUY' ? 'info' : 'danger'}>
                            {trade.side === 'BUY' ? '매수' : '매도'}
                          </Badge>
                        </TableCell>
                        <TableCell className="align-top whitespace-nowrap pr-3">
                          {(() => {
                            const info = getTradeRecordDisplayInfo(trade)
                            return (
                              <div className="flex flex-col items-start gap-1">
                                <Badge variant={info.variant} className="w-fit">
                                  {info.label}
                                </Badge>
                                {info.detail && <span className="text-xs text-muted-foreground">{info.detail}</span>}
                              </div>
                            )
                          })()}
                        </TableCell>
                        <TableCell className="align-top whitespace-nowrap pr-3 text-right">
                          <div>{formatNumber(trade.executedQty ?? trade.quantity)}</div>
                          {(trade.executedQty ?? 0) > 0 && (trade.executedQty ?? 0) !== trade.quantity && (
                            <div className="text-xs text-muted-foreground">주문 {formatNumber(trade.quantity)}</div>
                          )}
                        </TableCell>
                        <TableCell className="align-top whitespace-nowrap pr-4 text-right">
                          {formatCurrency(trade.executedPrice ?? trade.price, trade.market, trade.exchangeCode)}
                        </TableCell>
                        <TableCell className="align-top min-w-0 border-l border-border/30 pl-4 text-sm text-muted-foreground">
                          <div className="line-clamp-3 break-words" title={trade.reason ?? undefined}>{trade.reason ?? '-'}</div>
                        </TableCell>
                        <TableCell className="align-top text-center">
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
