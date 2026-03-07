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

const EXCHANGE_LABELS: Record<string, string> = {
  KRX: '한국',
  NASD: '미국(나스닥)', NYSE: '미국(뉴욕)', AMEX: '미국(아멕스)',
  SEHK: '홍콩', SHAA: '중국(상해)', SZAA: '중국(심천)',
  TKSE: '일본', HASE: '베트남(하노이)', VNSE: '베트남(호치민)',
}

const statusConfig: Record<string, { label: string; variant: 'success' | 'warning' | 'info' | 'outline' }> = {
  RUNNING: { label: '실행중', variant: 'success' },
  PAUSED: { label: '일시정지', variant: 'warning' },
  COMPLETED: { label: '완료', variant: 'info' },
  CREATED: { label: '생성됨', variant: 'outline' },
}

export function SimulationListSection({ onSelect }: { onSelect: (id: string) => void }) {
  const [statusFilter, setStatusFilter] = useState<SimulationStatus | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const { data, loading } = useGetSimulationSessionsQuery({
    variables: { status: statusFilter ?? undefined },
  })
  const { data: strategiesData } = useGetAvailableStrategiesQuery()
  const strategies = strategiesData?.availableStrategies ?? []
  const [createMutation] = useCreateSimulationMutation({
    refetchQueries: [{ query: GetSimulationSessionsDocument, variables: { status: statusFilter ?? undefined } }],
  })

  const sessions = data?.simulationSessions ?? []

  const [name, setName] = useState('')
  const [market, setMarket] = useState<Market>('DOMESTIC')
  const [strategyName, setStrategyName] = useState('')
  const [initialCapital, setInitialCapital] = useState('')

  const handleCreate = async () => {
    if (!name || !strategyName || !initialCapital) return
    await createMutation({
      variables: {
        input: {
          name,
          market,
          strategyName,
          initialCapital: Number(initialCapital),
        },
      },
    })
    setName('')
    setStrategyName('')
    setInitialCapital('')
    setShowCreate(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">시뮬레이션</h2>
          <p className="text-sm text-muted-foreground mt-1">가상 매매로 전략을 테스트하세요</p>
        </div>
        <Button onClick={() => setShowCreate(true)} disabled={showCreate}>
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

      {showCreate && (
        <Card className="border-primary-300">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">새 시뮬레이션 생성</CardTitle>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setShowCreate(false)}>
                <X size={14} />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Input placeholder="시뮬레이션 이름" value={name} onChange={(e) => setName(e.target.value)} />
              <Select
                value={market}
                onChange={(e) => setMarket(e.target.value as Market)}
              >
                <option value="DOMESTIC">국내</option>
                <option value="OVERSEAS">해외</option>
              </Select>
              <Select value={strategyName} onChange={(e) => setStrategyName(e.target.value)}>
                <option value="">전략 선택</option>
                {strategies.map((s) => (
                  <option key={s.name} value={s.name}>{s.displayName}</option>
                ))}
              </Select>
              <Input placeholder="초기 자본금" type="number" value={initialCapital} onChange={(e) => setInitialCapital(e.target.value)} />
              <Button onClick={handleCreate}>생성</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">로딩중...</div>
      ) : sessions.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">시뮬레이션이 없습니다</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sessions.map((session) => {
            const status = statusConfig[session.status] ?? { label: session.status, variant: 'outline' as const }
            const pnl = session.currentCash - session.initialCapital
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
    </div>
  )
}
