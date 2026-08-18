import { Broker } from '@prisma/client';

export interface AccountCashBalance {
  broker?: Broker;
  market: 'DOMESTIC' | 'OVERSEAS';
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
