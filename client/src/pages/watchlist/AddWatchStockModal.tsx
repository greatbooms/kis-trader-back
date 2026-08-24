import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { X } from 'lucide-react'
import { type Broker, type Market, type StockSearchResult } from '@/graphql/generated'
import { StockSearchInput } from '@/components/StockSearchInput'
import { brokerLabel, COUNTRY_OPTIONS, EXCHANGE_LABELS } from '@/lib/market-constants'
import { getMutationErrorMessage } from '@/lib/apollo-utils'
import { STRATEGY_META, DEFAULT_STRATEGY_META } from './strategy-meta'
import type { AddWatchStockModalProps } from './types'

// ── 종목 추가 모달 (multi-step 폼) ──

export function AddWatchStockModal({ strategies, onSave, onClose }: AddWatchStockModalProps) {
  const [step, setStep] = useState(1)
  const [broker, setBroker] = useState<Broker>('KIS')
  const [country, setCountry] = useState('')
  const [selectedStock, setSelectedStock] = useState<StockSearchResult | null>(null)
  const [strategyName, setStrategyName] = useState('')
  const [quota, setQuota] = useState('')
  const [maxCycles, setMaxCycles] = useState('40')
  const [stopLossRate, setStopLossRate] = useState('30')
  const [sell1Rate, setSell1Rate] = useState('')
  const [sell2Rate, setSell2Rate] = useState('')
  const [rsiPolicy, setRsiPolicy] = useState<'hard-stop-70' | 'hard-stop-75' | 'hard-stop-80' | 'continuous' | 'none'>('hard-stop-70')
  const [maxDailyQuotaMultiple, setMaxDailyQuotaMultiple] = useState('3')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const selectedCountry = COUNTRY_OPTIONS.find((c) => c.value === country)
  const meta = STRATEGY_META[strategyName] ?? DEFAULT_STRATEGY_META
  const isInfiniteBuy = strategyName === 'infinite-buy'

  const handleStrategyChange = (value: string) => {
    setStrategyName(value)
    if (value) {
      const newMeta = STRATEGY_META[value] ?? DEFAULT_STRATEGY_META
      setStopLossRate(String(newMeta.defaultStopLoss))
      if (newMeta.hasMaxCycles) setMaxCycles('40')
      setSell1Rate('')
      setSell2Rate('')
      setStep(4)
    }
  }

  const handleSubmit = async () => {
    if (!selectedStock) {
      setError('종목을 선택해주세요')
      return
    }
    if (!strategyName) {
      setError('전략을 선택해주세요')
      return
    }
    if (!quota || Number(quota) <= 0) {
      setError('투자금을 입력해주세요')
      return
    }

    setError('')
    setSubmitting(true)
    try {
      // strategyParams 구성 (익절률 커스텀)
      const params: Record<string, number | string> = {}
      if (sell1Rate && Number(sell1Rate) > 0) params.sell1Rate = Number(sell1Rate) / 100
      if (sell2Rate && Number(sell2Rate) > 0) params.sell2Rate = Number(sell2Rate) / 100
      if (isInfiniteBuy) {
        params.rsiPolicy = rsiPolicy
        const mdq = Number(maxDailyQuotaMultiple)
        if (mdq > 0) params.maxDailyQuotaMultiple = mdq
      }
      // momentum-breakout 등은 WatchStock.stopLossRate가 아닌 strategyParams.stopLossRate를 읽는다
      if (meta.stopLossViaParams && stopLossRate && Number(stopLossRate) > 0) {
        params.stopLossRate = Number(stopLossRate) / 100
      }

      await onSave({
        broker,
        market: (selectedStock.market as Market) || selectedCountry?.market || 'DOMESTIC',
        stockCode: selectedStock.stockCode,
        stockName: selectedStock.stockName,
        exchangeCode: selectedStock.exchangeCode,
        strategyName,
        quota: Number(quota),
        maxCycles: meta.hasMaxCycles && maxCycles ? Number(maxCycles) : undefined,
        stopLossRate: stopLossRate ? Number(stopLossRate) / 100 : undefined,
        strategyParams: Object.keys(params).length > 0 ? JSON.stringify(params) : undefined,
      })
    } catch (e: unknown) {
      setError(getMutationErrorMessage(e, '추가 중 오류가 발생했습니다'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-xl shadow-lg w-full max-w-md mx-4 p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-foreground">종목 추가</h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted text-muted-foreground cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">증권사</label>
            <Select value={broker} onChange={(e) => setBroker(e.target.value as Broker)}>
              <option value="KIS">{brokerLabel('KIS')}</option>
              <option value="TOSS">{brokerLabel('TOSS')}</option>
            </Select>
          </div>

          {/* Step 1: 국가 선택 */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              1. 시장 선택
            </label>
            <p className="text-xs text-muted-foreground mb-1.5">매매할 종목이 상장된 시장을 선택합니다.</p>
            <div className="grid grid-cols-3 gap-2">
              {COUNTRY_OPTIONS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => {
                    setCountry(c.value)
                    setSelectedStock(null)
                    setStep(2)
                  }}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors cursor-pointer ${
                    country === c.value
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-border hover:border-primary-300 text-foreground'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: 종목 검색 */}
          {step >= 2 && selectedCountry && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                2. 종목 검색
              </label>
              <p className="text-xs text-muted-foreground mb-1.5">종목명 또는 종목코드로 검색하세요.</p>
              <StockSearchInput
                market={selectedCountry.market}
                exchangeCode={selectedCountry.exchanges.length === 1 ? selectedCountry.exchanges[0] : undefined}
                onSelect={(stock) => {
                  setSelectedStock(stock)
                  setStep(3)
                }}
                placeholder={`${selectedCountry.label} 종목명 또는 코드 검색`}
              />
              {selectedStock && (
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="info">
                    {EXCHANGE_LABELS[selectedStock.exchangeCode ?? ''] ?? selectedStock.exchangeCode}
                  </Badge>
                  <span className="text-sm font-medium">{selectedStock.stockName}</span>
                  <span className="text-xs text-muted-foreground">{selectedStock.stockCode}</span>
                </div>
              )}
            </div>
          )}

          {/* Step 3: 전략 선택 */}
          {step >= 3 && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                3. 전략 선택
              </label>
              <p className="text-xs text-muted-foreground mb-1.5">적용할 자동매매 전략을 선택합니다. 등록 후에는 변경할 수 없습니다.</p>
              <Select
                value={strategyName}
                onChange={(e) => handleStrategyChange(e.target.value)}
              >
                <option value="">전략을 선택하세요</option>
                {strategies.map((s) => (
                  <option key={s.name} value={s.name}>{s.displayName}</option>
                ))}
              </Select>
            </div>
          )}

          {/* Step 4: 상세 설정 */}
          {step >= 4 && (
            <>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  4. 투자금 (quota)
                </label>
                <p className="text-xs text-muted-foreground mb-1.5">{meta.quotaDesc}</p>
                <Input
                  placeholder="예: 1000000"
                  type="number"
                  value={quota}
                  onChange={(e) => setQuota(e.target.value)}
                  autoFocus
                />
              </div>

              {meta.hasMaxCycles && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    5. 최대 사이클
                    <span className="ml-2 text-xs font-normal text-muted-foreground">기본값: 40</span>
                  </label>
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
                      {meta.hasMaxCycles ? '6' : '5'}. 1차 익절률 (%)
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
                      {meta.hasMaxCycles ? '7' : '6'}. 2차 익절률 (%)
                      <span className="ml-2 text-xs font-normal text-muted-foreground">기본: 동적 max(15-T/3, 8)%</span>
                    </label>
                    <p className="text-xs text-muted-foreground mb-1.5">고정 익절률을 지정합니다. 비워두면 T에 따라 동적 계산 (초기 15% → 후반 8%).</p>
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
                  {meta.hasSellRates ? (meta.hasMaxCycles ? '8' : '7') : (meta.hasMaxCycles ? '6' : '5')}. 손절률 (%)
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

              {isInfiniteBuy && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">
                      RSI 과열 정책
                      <span className="ml-2 text-xs font-normal text-muted-foreground">기본: RSI 70 이상 매수 중단 (권장)</span>
                    </label>
                    <p className="text-xs text-muted-foreground mb-1.5">
                      과열 구간에서 매수를 어떻게 제한할지 결정합니다. "매수 중단" 옵션은 해당 구간 매수금액을 다음 회차로 이월하여 눌림목에서 더 큰 포지션을 잡도록 합니다.
                    </p>
                    <Select
                      value={rsiPolicy}
                      onChange={(e) => setRsiPolicy(e.target.value as typeof rsiPolicy)}
                    >
                      <option value="hard-stop-70">RSI ≥ 70 매수 중단 (권장, 백테스트 CAGR +0.5%p)</option>
                      <option value="hard-stop-75">RSI ≥ 75 매수 중단 (완화)</option>
                      <option value="hard-stop-80">RSI ≥ 80 매수 중단 (보수)</option>
                      <option value="continuous">RSI 60~80 점진적 감산 (이전 정책)</option>
                      <option value="none">RSI 미반영 (순수 DCA)</option>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">
                      일일 투입 상한 (perCycle 배수)
                      <span className="ml-2 text-xs font-normal text-muted-foreground">기본: 3</span>
                    </label>
                    <p className="text-xs text-muted-foreground mb-1.5">
                      이월된 누적 quota가 한 번에 투입되는 것을 방지합니다. 예: 3 = 하루 최대 3회분 투입. 장기 과열 후 점진적으로 포지션을 쌓습니다.
                    </p>
                    <Input
                      placeholder="예: 3"
                      type="number"
                      min="1"
                      value={maxDailyQuotaMultiple}
                      onChange={(e) => setMaxDailyQuotaMultiple(e.target.value)}
                    />
                  </div>
                </>
              )}
            </>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>취소</Button>
            <Button onClick={handleSubmit} disabled={submitting || step < 4}>
              {submitting ? '추가중...' : '추가'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
