import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ChevronDown, ChevronUp, Plus, Trash2, Info } from 'lucide-react'
import {
  useGetSimulationSessionQuery,
  useAddSimulationWatchStockMutation,
  useRemoveSimulationWatchStockMutation,
  GetSimulationSessionDocument,
  type Market,
  type StockSearchResult,
} from '@/graphql/generated'
import { StockSearchInput } from '@/components/StockSearchInput'
import { Tooltip } from '@/components/ui/tooltip'
import { formatCurrency } from '@/lib/utils'
import { COUNTRY_OPTIONS, EXCHANGE_LABELS } from '@/lib/market-constants'
import type { SimulationWatchStocksProps } from '@/pages/simulation/types'

/** 무한매수법 전략인지 여부 */
const isInfiniteBuy = (name?: string | null) => name === 'infinite-buy'

/** 일별 분할매수 전략인지 여부 */
const isDailyDca = (name?: string | null) => name === 'daily-dca'

/** maxCycles 설정이 필요한 전략 */
const needsMaxCycles = (name?: string | null) => isInfiniteBuy(name) || isDailyDca(name)

export function SimulationWatchStocks({ sessionId }: SimulationWatchStocksProps) {
  const [expanded, setExpanded] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  const { data } = useGetSimulationSessionQuery({
    variables: { id: sessionId },
  })

  const refetchOptions = {
    refetchQueries: [{ query: GetSimulationSessionDocument, variables: { id: sessionId } }],
  }

  const [addMutation] = useAddSimulationWatchStockMutation(refetchOptions)
  const [removeMutation] = useRemoveSimulationWatchStockMutation(refetchOptions)

  const watchStocks = data?.simulationSession?.watchStocks ?? []
  const sessionMarket = data?.simulationSession?.market
  const sessionCountryCode = data?.simulationSession?.countryCode
  const strategyName = data?.simulationSession?.strategyName

  // countryCode로 국가 결정 (없으면 market에서 유추)
  const country = COUNTRY_OPTIONS.find((c) => c.value === sessionCountryCode)
    ?? (sessionMarket === 'DOMESTIC' ? COUNTRY_OPTIONS[0] : COUNTRY_OPTIONS[1])

  const [selectedStock, setSelectedStock] = useState<StockSearchResult | null>(null)
  const [quota, setQuota] = useState('')
  const [maxCycles, setMaxCycles] = useState('40')
  const [stopLossRate, setStopLossRate] = useState('30')

  const handleStockSelect = (stock: StockSearchResult) => {
    setSelectedStock(stock)
  }

  const resetForm = () => {
    setSelectedStock(null)
    setQuota('')
    setMaxCycles('40')
    setStopLossRate('30')
    setShowAdd(false)
  }

  const handleAdd = async () => {
    if (!selectedStock) return

    await addMutation({
      variables: {
        input: {
          sessionId,
          stockCode: selectedStock.stockCode,
          stockName: selectedStock.stockName,
          market: (selectedStock.market as Market) || country.market || sessionMarket || 'DOMESTIC',
          exchangeCode: selectedStock.exchangeCode || undefined,
          quota: quota ? Number(quota) : undefined,
          maxCycles: needsMaxCycles(strategyName) && maxCycles ? Number(maxCycles) : undefined,
          stopLossRate: stopLossRate ? Number(stopLossRate) / 100 : undefined,
        },
      },
    })
    resetForm()
  }

  const handleRemove = async (id: string, name: string) => {
    if (!confirm(`${name}을(를) 삭제하시겠습니까?`)) return
    await removeMutation({ variables: { id } })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <div className="flex items-center gap-1">
            <CardTitle>관심종목 ({watchStocks.length})</CardTitle>
            <Tooltip text="전략이 매매할 대상 종목 목록입니다. 각 종목에 투자금(quota)을 배정하면 전략이 해당 금액 범위 내에서 자동으로 매수/매도합니다.">
              <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
            </Tooltip>
          </div>
          <div className="flex items-center gap-2">
            {expanded && (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowAdd(!showAdd)
                }}
              >
                <Plus size={14} /> 추가
              </Button>
            )}
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent>
          {showAdd && (
            <div className="mb-4 p-3 rounded-lg border border-primary-300 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <StockSearchInput
                  market={country.market}
                  exchangeCode={country.exchanges.length === 1 ? country.exchanges[0] : undefined}
                  onSelect={handleStockSelect}
                  placeholder={`${country.label} 종목 검색`}
                />
                {selectedStock && (
                  <Badge variant="outline" className="text-xs self-center w-fit">
                    {selectedStock.stockCode} ({EXCHANGE_LABELS[selectedStock.exchangeCode ?? ''] ?? selectedStock.exchangeCode})
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">투자금 (quota)</label>
                  <Input placeholder="예: 1000" type="number" value={quota} onChange={(e) => setQuota(e.target.value)} />
                </div>

                {needsMaxCycles(strategyName) && (
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">최대 사이클 (기본: 40)</label>
                    <Input placeholder="40" type="number" value={maxCycles} onChange={(e) => setMaxCycles(e.target.value)} />
                  </div>
                )}

                <div>
                  <label className="block text-xs text-muted-foreground mb-1">손절률 % (기본: 30)</label>
                  <Input placeholder="30" type="number" value={stopLossRate} onChange={(e) => setStopLossRate(e.target.value)} />
                </div>
              </div>


              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={resetForm}>취소</Button>
                <Button size="sm" onClick={handleAdd} disabled={!selectedStock}>추가</Button>
              </div>
            </div>
          )}

          {watchStocks.length === 0 ? (
            <div className="flex items-center justify-center h-16 text-muted-foreground text-sm">등록된 관심종목이 없습니다</div>
          ) : (
            <div className="space-y-2">
              {watchStocks.map((stock) => (
                  <div key={stock.id} className="flex items-center justify-between rounded-lg border border-border/50 p-3">
                    <div className="flex items-center gap-3">
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
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                          {stock.quota && <span>투자금: {formatCurrency(stock.quota, stock.market)}</span>}
                          <span>사이클: {stock.cycle}/{stock.maxCycles}</span>
                          {stock.stopLossRate !== undefined && stock.stopLossRate > 0 && <span>손절: -{(stock.stopLossRate * 100).toFixed(0)}%</span>}
                        </div>
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-danger"
                      onClick={() => handleRemove(stock.id, stock.stockName)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}
