import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { WatchStockRow } from './WatchStockRow'
import type { WatchlistTableProps } from './types'

// ── 관심종목 카드 + 종목 행 리스트 ──

export function WatchlistTable({
  loading,
  watchStocks,
  strategies,
  onOpenDetail,
  onToggleActive,
  onDelete,
}: WatchlistTableProps) {
  return (
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
                onOpenDetail={() => onOpenDetail(stock.id)}
                onToggleActive={() => onToggleActive(stock)}
                onDelete={() => onDelete(stock)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
