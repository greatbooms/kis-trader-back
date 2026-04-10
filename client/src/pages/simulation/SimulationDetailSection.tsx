import { useEffect, useMemo, useState } from 'react'
import {
  useGetSimulationSessionQuery,
  useGetAvailableStrategiesQuery,
  useTriggerSimulationNowMutation,
  useUpdateSimulationSettingsMutation,
} from '@/graphql/generated'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SimulationControls } from '@/pages/simulation/SimulationControls'
import { SimulationMetricsCards } from '@/pages/simulation/SimulationMetricsCards'
import { SimulationPositionsTable } from '@/pages/simulation/SimulationPositionsTable'
import { SimulationTradesTable } from '@/pages/simulation/SimulationTradesTable'
import type { SimulationDetailSectionProps } from '@/pages/simulation/types'
import { EXCHANGE_LABELS } from '@/lib/market-constants'
import { formatCurrency } from '@/lib/utils'
import { getMutationErrorMessage } from '@/lib/apollo-utils'

function supportsCycleSettings(strategyName: string): boolean {
  return strategyName === 'infinite-buy' || strategyName === 'daily-dca'
}

export function SimulationDetailSection({ sessionId, onBack }: SimulationDetailSectionProps) {
  const { data, loading, refetch } = useGetSimulationSessionQuery({
    variables: { id: sessionId },
  })
  const { data: strategiesData } = useGetAvailableStrategiesQuery()
  const [updateSettings, { loading: saving }] = useUpdateSimulationSettingsMutation()
  const [triggerSimulationNow, { loading: triggering }] = useTriggerSimulationNowMutation()

  const session = data?.simulationSession
  const strategies = strategiesData?.availableStrategies ?? []
  const strategyDisplayName = session
    ? strategies.find((s) => s.name === session.strategyName)?.displayName ?? session.strategyName
    : ''

  const [name, setName] = useState('')
  const [quota, setQuota] = useState('')
  const [stopLossRate, setStopLossRate] = useState('')
  const [maxCycles, setMaxCycles] = useState('')
  const [error, setError] = useState('')
  const [isEditing, setIsEditing] = useState(false)

  const lastExecutionDetails = useMemo(() => {
    if (!session?.lastExecutionDetails) return null
    try {
      return JSON.parse(session.lastExecutionDetails) as {
        carryAmountToday?: number
        nextAccumulatedQuota?: number
        adjustedQuota?: number
        minimumExecutablePrice?: number
        quotaAdjustments?: Array<{ label?: string; multiplier?: number }>
      }
    } catch {
      return null
    }
  }, [session?.lastExecutionDetails])

  useEffect(() => {
    if (!session) return
    setName(session.name)
    setQuota(String(session.quota))
    setStopLossRate(String(Math.round(Math.abs(session.stopLossRate) * 100)))
    setMaxCycles(String(session.maxCycles))
    setError('')
    setIsEditing(false)
  }, [session])

  const exchangeCodes = session?.exchangeCode ? [session.exchangeCode] : []
  const primaryExchangeCode = exchangeCodes[0]
  const cycleEnabled = session ? supportsCycleSettings(session.strategyName) : false

  if (loading) {
    return <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">로딩중...</div>
  }

  if (!session) {
    return <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">세션을 찾을 수 없습니다</div>
  }

  const isDirty =
    name.trim() !== session.name ||
    Number(quota || 0) !== session.quota ||
    Number(stopLossRate || 0) !== Math.round(Math.abs(session.stopLossRate) * 100) ||
    (cycleEnabled && Number(maxCycles || 0) !== session.maxCycles)

  const resetForm = () => {
    setName(session.name)
    setQuota(String(session.quota))
    setStopLossRate(String(Math.round(Math.abs(session.stopLossRate) * 100)))
    setMaxCycles(String(session.maxCycles))
    setError('')
  }

  const handleSaveSettings = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('시뮬레이션 이름을 입력해주세요')
      return
    }

    if (!quota || Number(quota) <= 0) {
      setError('투자금은 0보다 크게 입력해주세요')
      return
    }

    if (!stopLossRate || Number(stopLossRate) < 0 || Number(stopLossRate) >= 100) {
      setError('손절률은 0 이상 100 미만으로 입력해주세요')
      return
    }

    if (cycleEnabled && (!maxCycles || Number(maxCycles) <= 0 || !Number.isInteger(Number(maxCycles)))) {
      setError('사이클 수는 1 이상의 정수로 입력해주세요')
      return
    }

    setError('')

    try {
      await updateSettings({
        variables: {
          input: {
            id: sessionId,
            name: trimmedName,
            quota: Number(quota),
            stopLossRate: Number(stopLossRate) / 100,
            maxCycles: cycleEnabled ? Number(maxCycles) : undefined,
          },
        },
      })
      await refetch()
      setIsEditing(false)
    } catch (e: unknown) {
      setError(getMutationErrorMessage(e, '설정 저장 중 오류가 발생했습니다'))
    }
  }

  const handleManualTrigger = async () => {
    try {
      const result = await triggerSimulationNow({
        variables: { id: sessionId },
      })
      alert(result.data?.triggerSimulationNow.message || '시뮬레이션 수동 실행을 완료했습니다.')
      await refetch()
    } catch (e: unknown) {
      alert(getMutationErrorMessage(e, '시뮬레이션 수동 실행 중 오류가 발생했습니다'))
    }
  }

  return (
    <div className="space-y-6">
      <SimulationControls
        sessionId={sessionId}
        status={session.status}
        sessionName={session.name}
        stockName={session.stockName}
        strategyDisplayName={strategyDisplayName}
        market={session.market}
        exchangeCodes={exchangeCodes}
        onBack={onBack}
        onStatusChange={() => refetch()}
      />

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>시뮬레이션 설정</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                1종목 시뮬레이션에 맞게 핵심 설정만 바로 수정할 수 있습니다.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={session.market === 'DOMESTIC' ? 'default' : 'info'}>
                {EXCHANGE_LABELS[session.exchangeCode] ?? session.exchangeCode}
              </Badge>
              <Badge variant="info">{strategyDisplayName}</Badge>
              <Badge variant="outline">{session.stockCode}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">시뮬레이션 이름</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!isEditing}
                readOnly={!isEditing}
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">투자금</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={quota}
                onChange={(e) => setQuota(e.target.value)}
                disabled={!isEditing}
                readOnly={!isEditing}
              />
              <p className="text-xs text-muted-foreground">
                총 투자금 변경 시 무한매수는 기존 보유 기준으로 사이클과 이월금을 다시 계산합니다.
              </p>
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
                disabled={!isEditing}
                readOnly={!isEditing}
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">
                {cycleEnabled ? '분할매수 사이클' : '현재 사이클'}
              </label>
              {cycleEnabled ? (
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={maxCycles}
                  onChange={(e) => setMaxCycles(e.target.value)}
                  disabled={!isEditing}
                  readOnly={!isEditing}
                />
              ) : (
                <>
                  <Input value={`${session.cycle}`} readOnly disabled />
                  <p className="text-xs text-muted-foreground">이 전략은 사이클 설정을 직접 사용하지 않습니다.</p>
                </>
              )}
            </div>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              현재 현금 {formatCurrency(session.currentCash, session.market, primaryExchangeCode)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={handleManualTrigger} disabled={triggering}>
                {triggering ? '실행중...' : '지금 1회 실행'}
              </Button>
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
                  <Button onClick={handleSaveSettings} disabled={!isDirty || saving}>
                    {saving ? '저장중...' : '저장'}
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    resetForm()
                    setIsEditing(true)
                  }}
                >
                  수정
                </Button>
              )}
            </div>
          </div>

          {session.lastExecutionStatus && (
            <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3 space-y-1.5">
              <div className="text-sm font-medium text-foreground">최근 평가</div>
              <div className="text-sm text-foreground">{session.lastExecutionStatus}</div>
              {session.lastExecutionDate && (
                <div className="text-xs text-muted-foreground">{session.lastExecutionDate}</div>
              )}
              {lastExecutionDetails && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {typeof lastExecutionDetails.carryAmountToday === 'number' && (
                    <span>오늘 이월 {formatCurrency(lastExecutionDetails.carryAmountToday, session.market, primaryExchangeCode)}</span>
                  )}
                  {typeof lastExecutionDetails.nextAccumulatedQuota === 'number' && (
                    <span>누적 {formatCurrency(lastExecutionDetails.nextAccumulatedQuota, session.market, primaryExchangeCode)}</span>
                  )}
                  {typeof lastExecutionDetails.adjustedQuota === 'number' && (
                    <span>조정 할당금 {formatCurrency(lastExecutionDetails.adjustedQuota, session.market, primaryExchangeCode)}</span>
                  )}
                  {typeof lastExecutionDetails.minimumExecutablePrice === 'number' && (
                    <span>1주 가능 기준가 {formatCurrency(lastExecutionDetails.minimumExecutablePrice, session.market, primaryExchangeCode)}</span>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <SimulationMetricsCards sessionId={sessionId} market={session.market} exchangeCode={primaryExchangeCode} />
      <SimulationPositionsTable sessionId={sessionId} />
      <SimulationTradesTable sessionId={sessionId} />
    </div>
  )
}
