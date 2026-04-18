import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { StockSearchInput } from '@/components/StockSearchInput'
import { Plus, X } from 'lucide-react'
import {
  useGetSimulationSessionsQuery,
  useCreateSimulationMutation,
  useGetAvailableStrategiesQuery,
  GetSimulationSessionsDocument,
  type SimulationStatus,
  type Market,
  type StockSearchResult,
} from '@/graphql/generated'
import { formatCurrency } from '@/lib/utils'
import { COUNTRY_OPTIONS, EXCHANGE_LABELS } from '@/lib/market-constants'
import { getMutationErrorMessage } from '@/lib/apollo-utils'

const statusConfig: Record<string, { label: string; variant: 'success' | 'warning' | 'info' | 'outline' }> = {
  RUNNING: { label: '실행중', variant: 'success' },
  PAUSED: { label: '일시정지', variant: 'warning' },
  COMPLETED: { label: '완료', variant: 'info' },
  CREATED: { label: '생성됨', variant: 'outline' },
}

export function SimulationListSection({ onSelect }: { onSelect: (id: string) => void }) {
  const [statusFilter, setStatusFilter] = useState<SimulationStatus | null>(null)
  const [showModal, setShowModal] = useState(false)

  const { data, loading } = useGetSimulationSessionsQuery({
    variables: { input: statusFilter ? { status: statusFilter } : undefined },
  })
  const sessions = data?.simulationSessions ?? []
  const { data: strategiesData } = useGetAvailableStrategiesQuery()
  const strategies = strategiesData?.availableStrategies ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">시뮬레이션</h2>
          <p className="text-sm text-muted-foreground mt-1">가상 매매로 전략을 테스트하세요</p>
        </div>
        <Button onClick={() => setShowModal(true)}>
          <Plus size={16} /> 새 시뮬레이션
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {([null, 'RUNNING', 'PAUSED', 'COMPLETED'] as const).map((s) => (
          <Button
            key={s ?? 'all'}
            variant={statusFilter === s ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter(s)}
          >
            {s === null ? '전체' : statusConfig[s]?.label ?? s}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">로딩중...</div>
      ) : sessions.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">시뮬레이션이 없습니다</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sessions.map((session) => {
            const status = statusConfig[session.status] ?? { label: session.status, variant: 'outline' as const }
            const totalAssets = session.currentCash + (session.portfolioValue ?? 0)
            const pnl = totalAssets - session.quota
            const strategyDisplayName = strategies.find((s) => s.name === session.strategyName)?.displayName ?? session.strategyName

            return (
              <Card
                key={session.id}
                className="cursor-pointer hover:border-primary-300 transition-colors"
                onClick={() => onSelect(session.id)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">{session.stockName}</CardTitle>
                      <div className="mt-1">
                        <Badge variant="info">{strategyDisplayName}</Badge>
                      </div>
                      <CardDescription className="mt-2">{session.name}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      <Badge variant="outline">{EXCHANGE_LABELS[session.exchangeCode] ?? session.exchangeCode}</Badge>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">{session.stockCode}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">투자금</span>
                      <span className="font-medium">{formatCurrency(session.quota, session.market, session.exchangeCode)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">현재 현금</span>
                      <span className="font-medium">{formatCurrency(session.currentCash, session.market, session.exchangeCode)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">손익</span>
                      <span className={`font-medium ${pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                        {formatCurrency(pnl, session.market, session.exchangeCode)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {showModal && (
        <CreateSimulationModal
          strategies={strategies}
          statusFilter={statusFilter}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  )
}

function CreateSimulationModal({
  strategies,
  statusFilter,
  onClose,
}: {
  strategies: { name: string; displayName: string }[]
  statusFilter: SimulationStatus | null
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [country, setCountry] = useState('KR')
  const [selectedStock, setSelectedStock] = useState<StockSearchResult | null>(null)
  const [strategyName, setStrategyName] = useState('')
  const [investmentAmount, setInvestmentAmount] = useState('')
  const [stopLossRate, setStopLossRate] = useState('')
  const [strategyParams, setStrategyParams] = useState('')
  const [rsiPolicy, setRsiPolicy] = useState<'hard-stop-70' | 'hard-stop-75' | 'hard-stop-80' | 'continuous' | 'none'>('hard-stop-70')
  const [maxDailyQuotaMultiple, setMaxDailyQuotaMultiple] = useState('3')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const selectedCountry = COUNTRY_OPTIONS.find((item) => item.value === country)
  const market = (selectedStock?.market as Market | undefined) ?? selectedCountry?.market ?? 'DOMESTIC'
  const isInfiniteBuy = strategyName === 'infinite-buy'

  const [createMutation] = useCreateSimulationMutation({
    refetchQueries: [{ query: GetSimulationSessionsDocument, variables: { input: statusFilter ? { status: statusFilter } : undefined } }],
  })

  const handleCreate = async () => {
    const missing: string[] = []
    if (!name.trim()) missing.push('이름')
    if (!selectedStock) missing.push('종목')
    if (!strategyName) missing.push('전략')
    if (!investmentAmount || Number(investmentAmount) <= 0) missing.push('투자금')

    if (missing.length > 0) {
      setError(`${missing.join(', ')}을(를) 입력해주세요`)
      return
    }

    setError('')
    setSubmitting(true)

    if (!selectedStock) {
      setError('종목을 입력해주세요')
      setSubmitting(false)
      return
    }

    // 고급 설정 JSON과 RSI 정책을 합쳐서 strategyParams 구성
    let combinedParams: string | undefined = undefined
    const existingParams: Record<string, unknown> = {}
    if (strategyParams.trim()) {
      try {
        Object.assign(existingParams, JSON.parse(strategyParams.trim()))
      } catch {
        setError('고급 설정이 유효한 JSON이 아닙니다')
        setSubmitting(false)
        return
      }
    }
    if (isInfiniteBuy) {
      existingParams.rsiPolicy = rsiPolicy
      const mdq = Number(maxDailyQuotaMultiple)
      if (mdq > 0) existingParams.maxDailyQuotaMultiple = mdq
    }
    if (Object.keys(existingParams).length > 0) {
      combinedParams = JSON.stringify(existingParams)
    }

    try {
      await createMutation({
        variables: {
          input: {
            name: name.trim(),
            market,
            exchangeCode: selectedStock.exchangeCode,
            stockCode: selectedStock.stockCode,
            stockName: selectedStock.stockName,
            countryCode: country,
            strategyName,
            quota: Number(investmentAmount),
            stopLossRate: stopLossRate ? Number(stopLossRate) / 100 : undefined,
            strategyParams: combinedParams,
          },
        },
      })
      onClose()
    } catch (e: unknown) {
      setError(getMutationErrorMessage(e, '생성 중 오류가 발생했습니다'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative bg-card border border-border rounded-xl shadow-lg w-full max-w-lg mx-4 p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-foreground">새 시뮬레이션</h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted text-muted-foreground cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">이름</label>
            <Input
              placeholder="예: 나스닥 테스트"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">시장</label>
            <Select
              value={country}
              onChange={(e) => {
                setCountry(e.target.value)
                setSelectedStock(null)
              }}
            >
              {COUNTRY_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </Select>
          </div>

          {selectedCountry && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">종목 검색</label>
              <StockSearchInput
                market={selectedCountry.market}
                exchangeCode={selectedCountry.exchanges.length === 1 ? selectedCountry.exchanges[0] : undefined}
                onSelect={setSelectedStock}
                placeholder={`${selectedCountry.label} 종목명 또는 코드 검색`}
              />
              {selectedStock && (
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Badge variant="info">{EXCHANGE_LABELS[selectedStock.exchangeCode ?? ''] ?? selectedStock.exchangeCode}</Badge>
                  <span className="text-sm font-medium">{selectedStock.stockName}</span>
                  <span className="text-xs text-muted-foreground">{selectedStock.stockCode}</span>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">전략</label>
            <Select value={strategyName} onChange={(e) => setStrategyName(e.target.value)}>
              <option value="">전략을 선택하세요</option>
              {strategies.map((strategy) => (
                <option key={strategy.name} value={strategy.name}>{strategy.displayName}</option>
              ))}
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">투자금</label>
            <Input
              placeholder="예: 10000000"
              type="number"
              value={investmentAmount}
              onChange={(e) => setInvestmentAmount(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">손절률 (%)</label>
              <Input
                placeholder="예: 30"
                type="number"
                value={stopLossRate}
                onChange={(e) => setStopLossRate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">고급 설정 (strategyParams)</label>
              <Input
                placeholder='예: {"sell1Rate":0.05}'
                value={strategyParams}
                onChange={(e) => setStrategyParams(e.target.value)}
              />
            </div>
          </div>

          {isInfiniteBuy && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">RSI 과열 정책</label>
                <Select value={rsiPolicy} onChange={(e) => setRsiPolicy(e.target.value as typeof rsiPolicy)}>
                  <option value="hard-stop-70">RSI ≥ 70 매수 중단 (권장)</option>
                  <option value="hard-stop-75">RSI ≥ 75 매수 중단</option>
                  <option value="hard-stop-80">RSI ≥ 80 매수 중단</option>
                  <option value="continuous">RSI 60~80 점진 감산</option>
                  <option value="none">RSI 미반영</option>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">일일 투입 상한 (배수)</label>
                <Input
                  type="number"
                  min="1"
                  value={maxDailyQuotaMultiple}
                  onChange={(e) => setMaxDailyQuotaMultiple(e.target.value)}
                  placeholder="예: 3"
                />
              </div>
            </div>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>취소</Button>
            <Button onClick={handleCreate} disabled={submitting}>
              {submitting ? '생성중...' : '생성'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
