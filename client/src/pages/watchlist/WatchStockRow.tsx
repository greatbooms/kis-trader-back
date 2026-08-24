import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Trash2, Power } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { brokerLabel, EXCHANGE_LABELS } from '@/lib/market-constants'
import { parseStrategyParams, formatCycleValue } from './strategy-meta'
import type { WatchStockRowProps } from './types'

// ── 관심종목 한 행: 종목 정보 + 토글/삭제 액션 (수정은 상세 페이지에서) ──

export function WatchStockRow({
  stock,
  strategies,
  onOpenDetail,
  onToggleActive,
  onDelete,
}: WatchStockRowProps) {
  const strategyParams = parseStrategyParams(stock.strategyParams)
  const accumulatedQuota = Number(strategyParams.accumulatedQuota || 0)

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border/50 p-3 transition-colors hover:border-primary-200 cursor-pointer sm:flex-row sm:items-center sm:justify-between"
      onClick={onOpenDetail}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center sm:gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium break-words">{stock.stockName}</span>
            <span className="text-xs text-muted-foreground">{stock.stockCode}</span>
            <Badge variant="outline">{brokerLabel(stock.broker)}</Badge>
            <Badge variant={stock.market === 'DOMESTIC' ? 'default' : 'info'}>
              {stock.exchangeCode ? (EXCHANGE_LABELS[stock.exchangeCode] ?? stock.exchangeCode) : (stock.market === 'DOMESTIC' ? '국내' : '해외')}
            </Badge>
            <Badge variant={stock.isActive ? 'success' : 'outline'}>
              {stock.isActive ? '활성' : '비활성'}
            </Badge>
            {accumulatedQuota > 0 && (
              <Badge variant="warning">
                이월 {formatCurrency(accumulatedQuota, stock.market, stock.exchangeCode ?? undefined)}
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {stock.strategyName && <span>전략: {strategies.find((s) => s.name === stock.strategyName)?.displayName ?? stock.strategyName}</span>}
            {stock.quota && <span>투자금: {formatCurrency(stock.quota, stock.market)}</span>}
            {['infinite-buy', 'daily-dca'].includes(stock.strategyName ?? '') && <span>사이클: {formatCycleValue(stock.cycle)}/{stock.maxCycles}</span>}
            {stock.strategyName === 'infinite-buy' && stock.cycle != null && stock.cycle >= stock.maxCycles && (
              <span className="font-medium text-amber-600 dark:text-amber-400">사이클 완주 · 청산 대기</span>
            )}
            <span>손절: -{(stock.stopLossRate * 100).toFixed(0)}%</span>
          </div>
          {stock.lastExecutionStatus && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
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
      <div className="flex w-full items-center justify-end gap-1 sm:w-auto sm:flex-none">
        <Button
          size="sm"
          variant={stock.isActive ? 'default' : 'outline'}
          className={`h-8 px-3 text-xs gap-1 sm:flex-none ${stock.isActive ? 'bg-success hover:bg-success/80' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            void onToggleActive()
          }}
        >
          <Power size={12} />
          {stock.isActive ? '활성' : '비활성'}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 text-danger"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </div>
  )
}
