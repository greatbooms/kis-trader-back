import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2, Pencil, X, Power } from 'lucide-react'
import {
  useGetWatchStocksQuery,
  useCreateWatchStockMutation,
  useUpdateWatchStockMutation,
  useDeleteWatchStockMutation,
  useGetAvailableStrategiesQuery,
  GetWatchStocksDocument,
  type Market,
  type StockSearchResult,
} from '@/graphql/generated'
import { StockSearchInput } from '@/components/StockSearchInput'
import { formatCurrency } from '@/lib/utils'
import { COUNTRY_OPTIONS, EXCHANGE_LABELS } from '@/lib/market-constants'
import type { WatchStockUpdateInput } from '@/pages/types'

export function WatchlistPage() {
  const [countryFilter, setCountryFilter] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingStock, setEditingStock] = useState<typeof allStocks[number] | null>(null)

  const selectedCountry = COUNTRY_OPTIONS.find((c) => c.value === countryFilter)
  const marketFilter: Market | undefined = selectedCountry?.market ?? undefined

  const { data, loading } = useGetWatchStocksQuery({
    variables: { input: marketFilter ? { market: marketFilter } : undefined },
  })
  const { data: strategiesData } = useGetAvailableStrategiesQuery()
  const strategies = strategiesData?.availableStrategies ?? []
  const allStocks = data?.watchStocks ?? []

  // 국가 필터 적용 (exchangeCode 기준)
  const watchStocks = countryFilter
    ? allStocks.filter((s) => selectedCountry?.exchanges.includes(s.exchangeCode ?? '') ?? false)
    : allStocks

  const refetchOptions = {
    refetchQueries: [{ query: GetWatchStocksDocument, variables: { input: marketFilter ? { market: marketFilter } : undefined } }],
  }

  const [createMutation] = useCreateWatchStockMutation(refetchOptions)
  const [updateMutation] = useUpdateWatchStockMutation(refetchOptions)
  const [deleteMutation] = useDeleteWatchStockMutation(refetchOptions)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">관심종목</h2>
          <p className="text-sm text-muted-foreground mt-1">관심종목을 관리하고 매매 전략을 설정하세요</p>
        </div>
        <Button onClick={() => setShowAddModal(true)}>
          <Plus size={16} /> 종목 추가
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button
          variant={countryFilter === null ? 'default' : 'outline'}
          size="sm"
          onClick={() => setCountryFilter(null)}
        >
          전체
        </Button>
        {COUNTRY_OPTIONS.map((c) => {
          const count = allStocks.filter((s) => c.exchanges.includes(s.exchangeCode ?? '')).length
          return (
            <Button
              key={c.value}
              variant={countryFilter === c.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setCountryFilter(c.value)}
            >
              {c.label} {count > 0 && <span className="ml-1 text-xs opacity-70">({count})</span>}
            </Button>
          )
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>종목 목록 ({watchStocks.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">로딩중...</div>
          ) : watchStocks.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">등록된 관심종목이 없습니다</div>
          ) : (
            <div className="space-y-3">
              {watchStocks.map((stock) => (
                <WatchStockRow
                  key={stock.id}
                  stock={stock}
                  strategies={strategies}
                  onEdit={() => setEditingStock(stock)}
                  onToggleActive={async () => {
                    await updateMutation({ variables: { id: stock.id, input: { isActive: !stock.isActive } } })
                  }}
                  onDelete={async () => {
                    if (confirm(`${stock.stockName}을(를) 삭제하시겠습니까?`)) {
                      await deleteMutation({ variables: { id: stock.id } })
                    }
                  }}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showAddModal && (
        <AddWatchStockModal
          strategies={strategies}
          onSave={async (input) => {
            await createMutation({ variables: { input } })
            setShowAddModal(false)
          }}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {editingStock && (
        <EditWatchStockModal
          stock={editingStock}
          strategies={strategies}
          onSave={async (input) => {
            await updateMutation({ variables: { id: editingStock.id, input } })
            setEditingStock(null)
          }}
          onClose={() => setEditingStock(null)}
        />
      )}
    </div>
  )
}

// ── 종목 추가 모달 ──

function AddWatchStockModal({
  strategies,
  onSave,
  onClose,
}: {
  strategies: { name: string; displayName: string }[]
  onSave: (input: {
    market: Market; stockCode: string; stockName: string; exchangeCode?: string
    strategyName?: string; quota?: number; maxCycles?: number; stopLossRate?: number
    strategyParams?: string
  }) => Promise<void>
  onClose: () => void
}) {
  const [step, setStep] = useState(1)
  const [country, setCountry] = useState('')
  const [selectedStock, setSelectedStock] = useState<StockSearchResult | null>(null)
  const [strategyName, setStrategyName] = useState('')
  const [quota, setQuota] = useState('')
  const [maxCycles, setMaxCycles] = useState('40')
  const [stopLossRate, setStopLossRate] = useState('30')
  const [sell1Rate, setSell1Rate] = useState('')
  const [sell2Rate, setSell2Rate] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const selectedCountry = COUNTRY_OPTIONS.find((c) => c.value === country)
  const meta = STRATEGY_META[strategyName] ?? DEFAULT_STRATEGY_META

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
      const params: Record<string, number> = {}
      if (sell1Rate && Number(sell1Rate) > 0) params.sell1Rate = Number(sell1Rate) / 100
      if (sell2Rate && Number(sell2Rate) > 0) params.sell2Rate = Number(sell2Rate) / 100

      await onSave({
        market: (selectedStock.market as Market) || selectedCountry?.market || 'DOMESTIC',
        stockCode: selectedStock.stockCode,
        stockName: selectedStock.stockName,
        exchangeCode: selectedStock.exchangeCode || undefined,
        strategyName,
        quota: Number(quota),
        maxCycles: meta.hasMaxCycles && maxCycles ? Number(maxCycles) : undefined,
        stopLossRate: stopLossRate ? Number(stopLossRate) / 100 : undefined,
        strategyParams: Object.keys(params).length > 0 ? JSON.stringify(params) : undefined,
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '추가 중 오류가 발생했습니다')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-xl shadow-lg w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto">
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

// ── 종목 행 ──

interface WatchStockItem {
  id: string
  stockName: string
  stockCode: string
  market: string
  exchangeCode?: string | null
  isActive: boolean
  strategyName?: string | null
  quota?: number | null
  cycle: number
  maxCycles: number
  stopLossRate: number
  strategyParams?: string | null
  lastExecutionStatus?: string | null
  lastExecutionDate?: string | null
}

function WatchStockRow({
  stock,
  strategies,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  stock: WatchStockItem
  strategies: { name: string; displayName: string }[]
  onEdit: () => void
  onToggleActive: () => Promise<void>
  onDelete: () => void
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/50 p-3 hover:border-primary-200 transition-colors">
      <div className="flex items-center gap-4 flex-1">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{stock.stockName}</span>
            <span className="text-xs text-muted-foreground">{stock.stockCode}</span>
            <Badge variant={stock.market === 'DOMESTIC' ? 'default' : 'info'}>
              {stock.exchangeCode ? (EXCHANGE_LABELS[stock.exchangeCode] ?? stock.exchangeCode) : (stock.market === 'DOMESTIC' ? '국내' : '해외')}
            </Badge>
            <Badge variant={stock.isActive ? 'success' : 'outline'}>
              {stock.isActive ? '활성' : '비활성'}
            </Badge>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            {stock.strategyName && <span>전략: {strategies.find((s) => s.name === stock.strategyName)?.displayName ?? stock.strategyName}</span>}
            {stock.quota && <span>투자금: {formatCurrency(stock.quota, stock.market)}</span>}
            {stock.strategyName === 'infinite-buy' && <span>사이클: {stock.cycle}/{stock.maxCycles}</span>}
            <span>손절: -{(stock.stopLossRate * 100).toFixed(0)}%</span>
          </div>
          {stock.lastExecutionStatus && (
            <div className="flex items-center gap-2 mt-1.5">
              <Badge variant={stock.lastExecutionStatus.includes('시그널 생성') ? 'success' : 'outline'} className="text-[11px]">
                {stock.lastExecutionStatus}
              </Badge>
              {stock.lastExecutionDate && (
                <span className="text-[11px] text-muted-foreground">{stock.lastExecutionDate}</span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant={stock.isActive ? 'default' : 'outline'}
          className={`h-8 px-3 text-xs gap-1 ${stock.isActive ? 'bg-success hover:bg-success/80' : ''}`}
          onClick={onToggleActive}
        >
          <Power size={12} />
          {stock.isActive ? '활성' : '비활성'}
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onEdit}>
          <Pencil size={14} />
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 text-danger" onClick={onDelete}>
          <Trash2 size={14} />
        </Button>
      </div>
    </div>
  )
}

// ── 전략별 메타 정보 ──

const STRATEGY_META: Record<string, {
  defaultStopLoss: number
  hasMaxCycles: boolean
  hasSellRates: boolean
  quotaDesc: string
  stopLossDesc: string
}> = {
  'infinite-buy': {
    defaultStopLoss: 30,
    hasMaxCycles: true,
    hasSellRates: false,
    quotaDesc: '이 종목에 배정할 총 투자 금액입니다. 최대 사이클에 걸쳐 분할 매수합니다.',
    stopLossDesc: '평균 매수가 대비 이 비율만큼 하락하면 전량 손절 매도합니다.',
  },
  'grid-mean-reversion': {
    defaultStopLoss: 8,
    hasMaxCycles: false,
    hasSellRates: false,
    quotaDesc: '이 종목에 배정할 투자 금액입니다. 그리드 3단계(-2%, -4%, -6%)로 분할 매수합니다.',
    stopLossDesc: '평균 매수가 대비 이 비율만큼 하락하면 손절 매도합니다.',
  },
  'momentum-breakout': {
    defaultStopLoss: 3,
    hasMaxCycles: false,
    hasSellRates: false,
    quotaDesc: '이 종목에 배정할 투자 금액입니다. 돌파 시그널 발생 시 한 번에 매수합니다.',
    stopLossDesc: '진입가 대비 이 비율만큼 하락하면 손절합니다. 단기 전략이므로 낮은 손절률을 권장합니다.',
  },
  'conservative': {
    defaultStopLoss: 5,
    hasMaxCycles: false,
    hasSellRates: false,
    quotaDesc: '이 종목에 배정할 투자 금액입니다. 극단적 과매도 시 투자금의 30%만 사용합니다.',
    stopLossDesc: '평균 매수가 대비 이 비율만큼 하락하면 손절합니다.',
  },
  'trend-following': {
    defaultStopLoss: 7,
    hasMaxCycles: false,
    hasSellRates: false,
    quotaDesc: '이 종목에 배정할 투자 금액입니다. 추세 진입 시 한 번에 매수하고, 수익 5% 이상 시 50%를 추가 매수(피라미딩)합니다.',
    stopLossDesc: '진입가 대비 이 비율만큼 하락하면 손절합니다. 추세 소멸(데드크로스, ADX<20) 시에도 자동 청산됩니다.',
  },
  'value-factor': {
    defaultStopLoss: 10,
    hasMaxCycles: false,
    hasSellRates: false,
    quotaDesc: '이 종목에 배정할 투자 금액입니다. 재무 지표(PER, PBR, EPS, ROE, 부채비율, EV/EBITDA 등) 조건 충족 시 매수합니다. 해외 종목은 PER+PBR+EPS+RSI로 판단하며, ROE/부채비율/EV/EBITDA/증가율 지표는 국내 전용입니다. 투자유의/시장경고 종목은 자동 차단됩니다.',
    stopLossDesc: '평균 매수가 대비 이 비율만큼 하락하면 손절합니다. +15% 수익 또는 RSI > 70 과열 시에도 자동 청산됩니다.',
  },
}

const DEFAULT_STRATEGY_META = {
  defaultStopLoss: 30,
  hasMaxCycles: false,
  hasSellRates: false,
  quotaDesc: '이 종목에 배정할 최대 투자 금액입니다.',
  stopLossDesc: '평균 매수가 대비 이 비율만큼 하락하면 손절 매도합니다.',
}

// ── 종목 수정 모달 ──

function EditWatchStockModal({
  stock,
  strategies,
  onSave,
  onClose,
}: {
  stock: WatchStockItem
  strategies: { name: string; displayName: string }[]
  onSave: (input: WatchStockUpdateInput) => Promise<void>
  onClose: () => void
}) {
  const [strategyName] = useState(stock.strategyName ?? '')
  const [quota, setQuota] = useState(String(stock.quota ?? ''))
  const [maxCycles, setMaxCycles] = useState(String(stock.maxCycles))
  const [stopLossRate, setStopLossRate] = useState(String(Math.round(stock.stopLossRate * 100)))
  const existingParams = stock.strategyParams ? JSON.parse(stock.strategyParams) : {}
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
      const params = { ...existingParams }
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
      setError(e instanceof Error ? e.message : '수정 중 오류가 발생했습니다')
    } finally {
      setSubmitting(false)
    }
  }

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
