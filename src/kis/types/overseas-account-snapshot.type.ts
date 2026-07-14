import type {
  BalanceItem,
  OverseasCashBalance,
} from './kis-api.types';

export interface OverseasAccountSnapshot {
  balance: BalanceItem[];
  cashBalances: OverseasCashBalance[];
}
