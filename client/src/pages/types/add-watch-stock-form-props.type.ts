import type { AddWatchStockFormInput } from './add-watch-stock-form-input.type'

export interface StrategyOption {
  name: string
  displayName: string
}

export interface AddWatchStockFormProps {
  strategies: StrategyOption[]
  onSave: (input: AddWatchStockFormInput) => Promise<void>
  onCancel: () => void
}
