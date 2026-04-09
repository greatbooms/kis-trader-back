import { Market } from '@prisma/client';

export interface AccountCashBalance {
  market: Market;
  currencyCode: string;
  currencyName?: string;
  amount: number;
  withdrawableAmount?: number;
}
