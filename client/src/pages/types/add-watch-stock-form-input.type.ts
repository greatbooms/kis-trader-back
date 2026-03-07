import type { Market } from '@/graphql/generated'

export interface AddWatchStockFormInput {
  market: Market
  stockCode: string
  stockName: string
  exchangeCode?: string
  strategyName?: string
  quota?: number
}
