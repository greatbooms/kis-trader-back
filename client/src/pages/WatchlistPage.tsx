import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2, Pencil, X, Check } from 'lucide-react'
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
import type { AddWatchStockFormProps, WatchStockRowProps } from '@/pages/types'

export function WatchlistPage() {
  const [marketFilter, setMarketFilter] = useState<Market | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const { data, loading } = useGetWatchStocksQuery({
    variables: { market: marketFilter },
  })
  const { data: strategiesData } = useGetAvailableStrategiesQuery()
  const strategies = strategiesData?.availableStrategies ?? []
  const watchStocks = data?.watchStocks ?? []

  const refetchOptions = {
    refetchQueries: [{ query: GetWatchStocksDocument, variables: { market: marketFilter } }],
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
        <Button onClick={() => setShowAdd(true)} disabled={showAdd}>
          <Plus size={16} /> 종목 추가
        </Button>
      </div>

      <div className="flex gap-2">
        {([null, 'DOMESTIC', 'OVERSEAS'] as const).map((m) => (
          <Button key={m ?? 'all'} variant={marketFilter === m ? 'default' : 'outline'} size="sm" onClick={() => setMarketFilter(m)}>
            {m === null ? '전체' : m === 'DOMESTIC' ? '국내' : '해외'}
          </Button>
        ))}
      </div>

      {showAdd && (
        <AddWatchStockForm
          strategies={strategies}
          onSave={async (input) => {
            await createMutation({ variables: { input } })
            setShowAdd(false)
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

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
                  isEditing={editingId === stock.id}
                  onEdit={() => setEditingId(stock.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onUpdate={async (input) => {
                    await updateMutation({ variables: { id: stock.id, input } })
                    setEditingId(null)
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
    </div>
  )
}

function AddWatchStockForm({ strategies, onSave, onCancel }: AddWatchStockFormProps) {
  const [selectedStock, setSelectedStock] = useState<StockSearchResult | null>(null)
  const [strategyName, setStrategyName] = useState('')
  const [quota, setQuota] = useState('')

  const handleSubmit = () => {
    if (!selectedStock) return
    onSave({
      market: selectedStock.market as Market,
      stockCode: selectedStock.stockCode,
      stockName: selectedStock.stockName,
      exchangeCode: selectedStock.exchangeCode || undefined,
      strategyName: strategyName || undefined,
      quota: quota ? Number(quota) : undefined,
    })
  }

  return (
    <Card className="border-primary-300">
      <CardContent className="pt-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StockSearchInput onSelect={setSelectedStock} placeholder="종목명 또는 코드 검색" />
          {selectedStock && (
            <div className="flex items-center gap-2 text-sm">
              <Badge variant={selectedStock.market === 'DOMESTIC' ? 'default' : 'info'}>
                {selectedStock.market === 'DOMESTIC' ? '국내' : '해외'}
              </Badge>
              <span>{selectedStock.stockCode}</span>
              <span className="text-muted-foreground">{selectedStock.exchangeCode}</span>
            </div>
          )}
          <Select
            value={strategyName}
            onChange={(e) => setStrategyName(e.target.value)}
          >
            <option value="">전략 선택</option>
            {strategies.map((s) => (
              <option key={s.name} value={s.name}>{s.displayName}</option>
            ))}
          </Select>
          <Input placeholder="투자금(quota)" type="number" value={quota} onChange={(e) => setQuota(e.target.value)} />
          <div className="flex gap-2 col-span-1">
            <Button size="sm" onClick={handleSubmit} disabled={!selectedStock}><Check size={14} /> 저장</Button>
            <Button size="sm" variant="ghost" onClick={onCancel}><X size={14} /> 취소</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function WatchStockRow({
  stock,
  strategies,
  isEditing,
  onEdit,
  onCancelEdit,
  onUpdate,
  onDelete,
}: WatchStockRowProps) {
  const [strategyName, setStrategyName] = useState(stock.strategyName ?? '')
  const [quota, setQuota] = useState(String(stock.quota ?? ''))
  const [stopLoss, setStopLoss] = useState(String(stock.stopLossRate))

  if (isEditing) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-primary-300 p-3">
        <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="text-sm font-medium">{stock.stockName} ({stock.stockCode})</div>
          <Select
            value={strategyName}
            onChange={(e) => setStrategyName(e.target.value)}
            size="sm"
            className="px-2"
          >
            <option value="">전략 없음</option>
            {strategies.map((s) => (
              <option key={s.name} value={s.name}>{s.displayName}</option>
            ))}
          </Select>
          <Input className="h-8" placeholder="투자금" type="number" value={quota} onChange={(e) => setQuota(e.target.value)} />
          <Input className="h-8" placeholder="손절률(%)" type="number" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
        </div>
        <div className="flex gap-1">
          <Button size="icon" className="h-8 w-8" onClick={() =>
            onUpdate({
              strategyName: strategyName || undefined,
              quota: quota ? Number(quota) : undefined,
              stopLossRate: stopLoss ? Number(stopLoss) : undefined,
            })
          }>
            <Check size={14} />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onCancelEdit}>
            <X size={14} />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-border/50 p-3 hover:border-primary-200 transition-colors">
      <div className="flex items-center gap-4 flex-1">
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
            {stock.strategyName && <span>전략: {strategies.find((s) => s.name === stock.strategyName)?.displayName ?? stock.strategyName}</span>}
            {stock.quota && <span>투자금: {formatCurrency(stock.quota, stock.market)}</span>}
            <span>사이클: {stock.cycle}/{stock.maxCycles}</span>
            <span>손절: {stock.stopLossRate}%</span>
          </div>
        </div>
      </div>
      <div className="flex gap-1">
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onUpdate({ isActive: !stock.isActive })}>
          <Badge variant={stock.isActive ? 'success' : 'outline'} className="cursor-pointer text-[10px]">
            {stock.isActive ? 'ON' : 'OFF'}
          </Badge>
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
