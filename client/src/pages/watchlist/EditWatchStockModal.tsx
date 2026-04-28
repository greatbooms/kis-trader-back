import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { X } from 'lucide-react'
import { EXCHANGE_LABELS } from '@/lib/market-constants'
import { getMutationErrorMessage } from '@/lib/apollo-utils'
import { STRATEGY_META, DEFAULT_STRATEGY_META, parseStrategyParams } from './strategy-meta'
import type { EditWatchStockModalProps } from './types'

// ── 종목 설정 수정 모달 ──

export function EditWatchStockModal({ stock, strategies, onSave, onClose }: EditWatchStockModalProps) {
  const [strategyName] = useState(stock.strategyName ?? '')
  const [quota, setQuota] = useState(String(stock.quota ?? ''))
  const [maxCycles, setMaxCycles] = useState(String(stock.maxCycles))
  const [stopLossRate, setStopLossRate] = useState(String(Math.round(stock.stopLossRate * 100)))
  const existingParams = parseStrategyParams(stock.strategyParams) as Record<string, number | undefined>
  const [sell1Rate, setSell1Rate] = useState(existingParams.sell1Rate ? String(Math.round(existingParams.sell1Rate * 100)) : '')
  const [sell2Rate, setSell2Rate] = useState(existingParams.sell2Rate ? String(Math.round(existingParams.sell2Rate * 100)) : '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const meta = STRATEGY_META[strategyName] ?? DEFAULT_STRATEGY_META

  const handleSubmit = async () => {
    setError('')
    setSubmitting(true)
    try {
      // 기존 strategyParams 유지하면서 sell rate만 업데이트
      const params: Record<string, unknown> = { ...existingParams }
      if (meta.hasSellRates) {
        if (sell1Rate && Number(sell1Rate) > 0) params.sell1Rate = Number(sell1Rate) / 100
        else delete params.sell1Rate
        if (sell2Rate && Number(sell2Rate) > 0) params.sell2Rate = Number(sell2Rate) / 100
        else delete params.sell2Rate
      }
      const strategyParams = Object.keys(params).length > 0 ? JSON.stringify(params) : undefined

      await onSave({
        quota: quota ? Number(quota) : undefined,
        stopLossRate: stopLossRate ? Number(stopLossRate) / 100 : undefined,
        strategyParams,
      })
    } catch (e: unknown) {
      setError(getMutationErrorMessage(e, '수정 중 오류가 발생했습니다'))
    } finally {
      setSubmitting(false)
    }
  }

  // maxCycles는 표시 전용 (편집 미지원이지만 UI 보존)
  void maxCycles
  void setMaxCycles

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-xl shadow-lg w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-lg font-bold text-foreground">종목 설정 수정</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {stock.stockName} ({stock.stockCode})
              <Badge variant="info" className="ml-2">
                {stock.exchangeCode ? (EXCHANGE_LABELS[stock.exchangeCode] ?? stock.exchangeCode) : (stock.market === 'DOMESTIC' ? '국내' : '해외')}
              </Badge>
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted text-muted-foreground cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">매매 전략</label>
            <p className="text-xs text-muted-foreground mb-1.5">
              전략은 변경할 수 없습니다. 변경이 필요하면 종목을 삭제 후 다시 등록하세요.
            </p>
            <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">
              {strategies.find((s) => s.name === strategyName)?.displayName ?? (strategyName || '전략 없음')}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">투자금 (quota)</label>
            <p className="text-xs text-muted-foreground mb-1.5">{meta.quotaDesc}</p>
            <Input
              placeholder="예: 1000000"
              type="number"
              value={quota}
              onChange={(e) => setQuota(e.target.value)}
            />
          </div>

          {meta.hasMaxCycles && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">최대 사이클</label>
              <p className="text-xs text-muted-foreground mb-1.5">투자금을 이 횟수에 걸쳐 분할 매수합니다. 횟수를 초과하면 더 이상 매수하지 않습니다.</p>
              <Input
                placeholder="예: 40"
                type="number"
                value={maxCycles}
                onChange={(e) => setMaxCycles(e.target.value)}
              />
            </div>
          )}

          {meta.hasSellRates && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  1차 익절률 (%)
                  <span className="ml-2 text-xs font-normal text-muted-foreground">기본: 동적 max(10-T/2, 3)%</span>
                </label>
                <p className="text-xs text-muted-foreground mb-1.5">고정 익절률을 지정합니다. 비워두면 T에 따라 동적 계산 (초기 10% → 후반 3%).</p>
                <Input
                  placeholder="예: 5"
                  type="number"
                  value={sell1Rate}
                  onChange={(e) => setSell1Rate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  2차 익절률 (%)
                  <span className="ml-2 text-xs font-normal text-muted-foreground">기본: 동적 max(15-T/3, 8)%</span>
                </label>
                <p className="text-xs text-muted-foreground mb-1.5">평균단가 대비 이 비율 상승 시 나머지 전량을 매도합니다. 비워두면 사이클(T)에 따라 자동 적용.</p>
                <Input
                  placeholder="예: 10"
                  type="number"
                  value={sell2Rate}
                  onChange={(e) => setSell2Rate(e.target.value)}
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              손절률 (%)
              <span className="ml-2 text-xs font-normal text-muted-foreground">기본값: {meta.defaultStopLoss}%</span>
            </label>
            <p className="text-xs text-muted-foreground mb-1.5">{meta.stopLossDesc}</p>
            <Input
              placeholder={`예: ${meta.defaultStopLoss}`}
              type="number"
              value={stopLossRate}
              onChange={(e) => setStopLossRate(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>취소</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? '저장중...' : '저장'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
