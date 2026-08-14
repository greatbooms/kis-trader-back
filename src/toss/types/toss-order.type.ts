import type { BrokerOrderStatus } from '../../common/types';

export type TossOrderStatus =
  | 'PENDING'
  | 'PENDING_CANCEL'
  | 'PENDING_REPLACE'
  | 'PARTIAL_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'REJECTED'
  | 'CANCEL_REJECTED'
  | 'REPLACE_REJECTED'
  | 'REPLACED'
  | (string & {});

export interface TossOrderExecution {
  filledQuantity: string;
  averageFilledPrice: string | null;
  filledAmount: string | null;
  commission: string | null;
  tax: string | null;
  filledAt: string | null;
  settlementDate: string | null;
}

export interface TossOrder {
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'LIMIT' | 'MARKET' | (string & {});
  timeInForce: 'DAY' | 'CLS' | 'OPG' | (string & {});
  status: TossOrderStatus;
  price: string | null;
  quantity: string;
  orderAmount: string | null;
  currency: 'KRW' | 'USD' | (string & {});
  orderedAt: string;
  canceledAt: string | null;
  execution: TossOrderExecution;
}

export interface TossOrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'LIMIT' | 'MARKET';
  quantity: string;
  timeInForce?: 'DAY' | 'CLS';
  price?: string;
}

export interface TossOrderOperationResponse {
  orderId: string;
  clientOrderId?: string;
}

export interface TossOrdersResult {
  orders: TossOrder[];
  nextCursor: string | null;
  hasNext: boolean;
}

export type TossMappedOrderStatus =
  | 'FILLED'
  | 'PARTIAL'
  | 'PENDING'
  | 'CANCELLED'
  | 'FAILED';

export interface TossBrokerOrderStatus extends BrokerOrderStatus {
  status: TossMappedOrderStatus;
}
