import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Plus, X } from 'lucide-react'
import {
  useGetSimulationSessionsQuery,
  useCreateSimulationMutation,
  useGetAvailableStrategiesQuery,
  GetSimulationSessionsDocument,
  type SimulationStatus,
  type Market,
} from '@/graphql/generated'
import { formatCurrency } from '@/lib/utils'
import { EXCHANGE_LABELS } from '@/lib/market-constants'

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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">시뮬레이션</h2>
          <p className="text-sm text-muted-foreground mt-1">가상 매매로 전략을 테스트하세요</p>
        </div>
        <Button onClick={() => setShowModal(true)}>
          <Plus size={16} /> 새 시뮬레이션
        </Button>
      </div>

      <div className="flex gap-2">
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
            const pnl = totalAssets - session.initialCapital
            return (
              <Card
                key={session.id}
                className="cursor-pointer hover:border-primary-300 transition-colors"
                onClick={() => onSelect(session.id)}
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{session.name}</CardTitle>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge>{strategies.find((s) => s.name === session.strategyName)?.displayName ?? session.strategyName}</Badge>
                    {(() => {
                      const codes = [...new Set((session.watchStocks ?? []).map((ws) => ws.exchangeCode).filter((c): c is string => !!c))]
                      return codes.length > 0
                        ? codes.map((code) => (
                            <Badge key={code} variant="info">{EXCHANGE_LABELS[code] ?? code}</Badge>
                          ))
                        : (
                            <Badge variant={session.market === 'DOMESTIC' ? 'default' : 'info'}>
                              {session.market === 'DOMESTIC' ? '국내' : '해외'}
                            </Badge>
                          )
                    })()}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">초기 자본</span>
                      <span className="font-medium">{formatCurrency(session.initialCapital, session.market)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">현재 현금</span>
                      <span className="font-medium">{formatCurrency(session.currentCash, session.market)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">손익</span>
                      <span className={`font-medium ${pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                        {formatCurrency(pnl, session.market)}
                      </span>
                    </div>
                    {session.watchStocks && session.watchStocks.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-1">
                        관심종목 {session.watchStocks.length}개
                      </div>
                    )}
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

const COUNTRY_OPTIONS = [
  { value: 'KR', label: '한국', market: 'DOMESTIC' as Market, exchanges: ['KRX'] },
  { value: 'US', label: '미국', market: 'OVERSEAS' as Market, exchanges: ['NASD', 'NYSE', 'AMEX'] },
  { value: 'HK', label: '홍콩', market: 'OVERSEAS' as Market, exchanges: ['SEHK'] },
  { value: 'CN', label: '중국', market: 'OVERSEAS' as Market, exchanges: ['SHAA', 'SZAA'] },
  { value: 'JP', label: '일본', market: 'OVERSEAS' as Market, exchanges: ['TKSE'] },
  { value: 'VN', label: '베트남', market: 'OVERSEAS' as Market, exchanges: ['HASE', 'VNSE'] },
]

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
  const [strategyName, setStrategyName] = useState('')
  const [initialCapital, setInitialCapital] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const selectedCountry = COUNTRY_OPTIONS.find((c) => c.value === country)
  const market = selectedCountry?.market ?? 'DOMESTIC'

  const [createMutation] = useCreateSimulationMutation({
    refetchQueries: [{ query: GetSimulationSessionsDocument, variables: { input: statusFilter ? { status: statusFilter } : undefined } }],
  })

  const handleCreate = async () => {
    const missing: string[] = []
    if (!name.trim()) missing.push('이름')
    if (!strategyName) missing.push('전략')
    if (!initialCapital || Number(initialCapital) <= 0) missing.push('초기 자본금')

    if (missing.length > 0) {
      setError(`${missing.join(', ')}을(를) 입력해주세요`)
      return
    }

    setError('')
    setSubmitting(true)
    try {
      await createMutation({
        variables: {
          input: {
            name: name.trim(),
            market,
            countryCode: country,
            strategyName,
            initialCapital: Number(initialCapital),
          },
        },
      })
      onClose()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '생성 중 오류가 발생했습니다'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-card border border-border rounded-xl shadow-lg w-full max-w-md mx-4 p-6">
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
            <Select value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">전략</label>
            <Select value={strategyName} onChange={(e) => setStrategyName(e.target.value)}>
              <option value="">전략을 선택하세요</option>
              {strategies.map((s) => (
                <option key={s.name} value={s.name}>{s.displayName}</option>
              ))}
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">초기 자본금</label>
            <Input
              placeholder="예: 10000000"
              type="number"
              value={initialCapital}
              onChange={(e) => setInitialCapital(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-sm text-danger">{error}</p>
          )}

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
