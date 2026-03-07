import type { Side } from '@/graphql/generated'
import type { MarketFilterState } from './market-filter-state.type'

export interface TradeFilterState extends MarketFilterState {
  side: Side | null
}
