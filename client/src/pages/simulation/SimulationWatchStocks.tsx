import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import {
  useGetSimulationSessionQuery,
  useAddSimulationWatchStockMutation,
  useRemoveSimulationWatchStockMutation,
  GetSimulationSessionDocument,
  type Market,
  type StockSearchResult,
} from '@/graphql/generated'
import { StockSearchInput } from '@/components/StockSearchInput'
import { formatCurrency } from '@/lib/utils'
import type { SimulationWatchStocksProps } from '@/pages/simulation/types'

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

  const [selectedStock, setSelectedStock] = useState<StockSearchResult | null>(null)
  const [quota, setQuota] = useState('')

  const handleStockSelect = (stock: StockSearchResult) => {
    setSelectedStock(stock)
  }

  const handleAdd = async () => {
    if (!selectedStock) return
    await addMutation({
      variables: {
        input: {
          sessionId,
          stockCode: selectedStock.stockCode,
          stockName: selectedStock.stockName,
          market: (selectedStock.market as Market) || sessionMarket || 'DOMESTIC',
          exchangeCode: selectedStock.exchangeCode || undefined,
          quota: quota ? Number(quota) : undefined,
        },
      },
    })
    setSelectedStock(null)
    setQuota('')
    setShowAdd(false)
  }

  const handleRemove = async (id: string, name: string) => {
    if (!confirm(`${name}을(를) 삭제하시겠습니까?`)) return
    await removeMutation({ variables: { id } })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <CardTitle>관심종목 ({watchStocks.length})</CardTitle>
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4 p-3 rounded-lg border border-primary-300">
              <StockSearchInput
                market={sessionMarket as Market}
                onSelect={handleStockSelect}
                placeholder="종목명 또는 코드 검색"
              />
              <Input placeholder="투자금(quota)" type="number" value={quota} onChange={(e) => setQuota(e.target.value)} />
              <div className="flex items-center gap-2">
                {selectedStock && (
                  <Badge variant="outline" className="text-xs">
                    {selectedStock.stockCode} ({selectedStock.exchangeCode})
                  </Badge>
                )}
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
                          {stock.market === 'DOMESTIC' ? '국내' : '해외'}
                        </Badge>
                        <Badge variant={stock.isActive ? 'success' : 'outline'}>
                          {stock.isActive ? '활성' : '비활성'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        {stock.quota && <span>투자금: {formatCurrency(stock.quota, stock.market)}</span>}
                        <span>사이클: {stock.cycle}/{stock.maxCycles}</span>
                        {stock.stopLossRate !== undefined && <span>손절: {stock.stopLossRate}%</span>}
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
