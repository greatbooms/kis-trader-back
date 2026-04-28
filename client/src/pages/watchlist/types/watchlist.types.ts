import type { Market, StockSearchResult } from '@/graphql/generated'
import type { WatchStockUpdateInput } from '@/pages/types'

// ── 관심종목 도메인 타입 ──

export interface WatchStockItem {
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

export interface StrategyOption {
  name: string
  displayName: string
}

export interface AddWatchStockInput {
  market: Market
  stockCode: string
  stockName: string
  exchangeCode: string
  strategyName?: string
  quota?: number
  maxCycles?: number
  stopLossRate?: number
  strategyParams?: string
}

// ── 컴포넌트 props ──

export interface WatchlistFiltersProps {
  countryFilter: string | null
  allStocks: WatchStockItem[]
  onChange: (value: string | null) => void
}

export interface WatchlistTableProps {
  loading: boolean
  watchStocks: WatchStockItem[]
  strategies: StrategyOption[]
  onOpenDetail: (stockId: string) => void
  onEdit: (stock: WatchStockItem) => void
  onToggleActive: (stock: WatchStockItem) => Promise<void>
  onDelete: (stock: WatchStockItem) => Promise<void>
}

export interface WatchStockRowProps {
  stock: WatchStockItem
  strategies: StrategyOption[]
  onOpenDetail: () => void
  onEdit: () => void
  onToggleActive: () => Promise<void>
  onDelete: () => void
}

export interface AddWatchStockModalProps {
  strategies: StrategyOption[]
  onSave: (input: AddWatchStockInput) => Promise<void>
  onClose: () => void
}

export interface EditWatchStockModalProps {
  stock: WatchStockItem
  strategies: StrategyOption[]
  onSave: (input: WatchStockUpdateInput) => Promise<void>
  onClose: () => void
}

// 모달 전용으로 export 편의를 위해 재선언
export type { StockSearchResult }
