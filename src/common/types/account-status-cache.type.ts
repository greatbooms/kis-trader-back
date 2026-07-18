import { AccountCashBalance } from './account-cash-balance.type';

export interface AccountStatusCache {
  cashBalances: AccountCashBalance[];
  lastSyncedAt: string;
}
