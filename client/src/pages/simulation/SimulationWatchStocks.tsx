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
import type { SimulationWatchStocksProps } from '@/pages/simulation/types'

const EXCHANGE_LABELS: Record<string, string> = {
  KRX: '한국',
  NASD: '나스닥', NYSE: '뉴욕', AMEX: '아멕스',
  SEHK: '홍콩', SHAA: '상해', SZAA: '심천',
  TKSE: '일본', HASE: '하노이', VNSE: '호치민',
}

const COUNTRY_OPTIONS = [
  { value: 'KR', label: '한국', market: 'DOMESTIC' as Market, exchanges: ['KRX'] },
  { value: 'US', label: '미국', market: 'OVERSEAS' as Market, exchanges: ['NASD', 'NYSE', 'AMEX'] },
  { value: 'HK', label: '홍콩', market: 'OVERSEAS' as Market, exchanges: ['SEHK'] },
  { value: 'CN', label: '중국', market: 'OVERSEAS' as Market, exchanges: ['SHAA', 'SZAA'] },
  { value: 'JP', label: '일본', market: 'OVERSEAS' as Market, exchanges: ['TKSE'] },
  { value: 'VN', label: '베트남', market: 'OVERSEAS' as Market, exchanges: ['HASE', 'VNSE'] },
]

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

  // countryCode로 국가 결정 (없으면 market에서 유추)
  const country = COUNTRY_OPTIONS.find((c) => c.value === sessionCountryCode)
    ?? (sessionMarket === 'DOMESTIC' ? COUNTRY_OPTIONS[0] : COUNTRY_OPTIONS[1])

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
          market: (selectedStock.market as Market) || country.market || sessionMarket || 'DOMESTIC',
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4 p-3 rounded-lg border border-primary-300">
              <StockSearchInput
                market={country.market}
                exchangeCode={country.exchanges.length === 1 ? country.exchanges[0] : undefined}
                onSelect={handleStockSelect}
                placeholder={`${country.label} 종목 검색`}
              />
              <Input placeholder="투자금(quota)" type="number" value={quota} onChange={(e) => setQuota(e.target.value)} />
              <div className="flex items-center gap-2">
                {selectedStock && (
                  <Badge variant="outline" className="text-xs">
                    {selectedStock.stockCode} ({EXCHANGE_LABELS[selectedStock.exchangeCode ?? ''] ?? selectedStock.exchangeCode})
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
                          {stock.exchangeCode ? (EXCHANGE_LABELS[stock.exchangeCode] ?? stock.exchangeCode) : (stock.market === 'DOMESTIC' ? '국내' : '해외')}
                        </Badge>
                        <Badge variant={stock.isActive ? 'success' : 'outline'}>
                          {stock.isActive ? '활성' : '비활성'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
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
