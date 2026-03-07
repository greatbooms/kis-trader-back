import type { WatchStockType } from '@/graphql/generated'
import type { WatchStockUpdateInput } from './watch-stock-update-input.type'
import type { StrategyOption } from './add-watch-stock-form-props.type'

export interface WatchStockRowProps {
  stock: WatchStockType
  strategies: StrategyOption[]
  isEditing: boolean
  onEdit: () => void
  onCancelEdit: () => void
  onUpdate: (input: WatchStockUpdateInput) => Promise<void>
  onDelete: () => void
}
