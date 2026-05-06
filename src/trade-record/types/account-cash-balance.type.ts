import { Market } from '@prisma/client';

export interface AccountCashBalance {
  market: Market;
  currencyCode: string;
  currencyName?: string;
  amount: number;
  withdrawableAmount?: number;
  orderableAmount?: number;
  generalOrderableAmount?: number;
  integratedOrderableAmount?: number;
  pendingBuyAmount?: number;
  pendingSellAmount?: number;
  receivableAmount?: number;
  marginAmount?: number;
}
