export type OrderOutcome = 'ACCEPTED' | 'REJECTED' | 'UNKNOWN';

export interface OrderResult {
  outcome: OrderOutcome;
  success: boolean;
  orderNo?: string;
  brokerOrderDate?: string;
  orderTime?: string;
  message: string;
}

export interface BalanceItem {
  stockCode: string;
  stockName: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  profitLoss: number;
  profitRate: number;
  exchangeCode?: string;
}

export interface OverseasCashBalance {
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

export interface OverseasAccountSnapshot {
  balance: BalanceItem[];
  cashBalances: OverseasCashBalance[];
}

export interface UnfilledOrder {
  orderNo: string;
  stockCode: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  exchangeCode?: string;
}

export type BrokerOrderRejectionState = 'REJECTED' | 'NOT_REJECTED' | 'UNKNOWN';

export interface BrokerOrderCandidate {
  orderNo: string;
  stockCode: string;
  side: 'BUY' | 'SELL';
  orderQuantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  orderPrice?: number;
  filledPrice?: number;
  exchangeCode?: string;
  orderDate?: string;
  orderTime?: string;
  rejectionState: BrokerOrderRejectionState;
  /** 기존 소비자 호환용. UNKNOWN일 때는 값을 만들지 않는다. */
  rejected?: boolean;
  rejectedReason?: string;
}

export interface BrokerOrderStatus
  extends Omit<BrokerOrderCandidate, 'rejectionState'> {
  /** 신규 broker 조회는 항상 채우며, 기존 내부 fixture 호환을 위해 optional로 둔다. */
  rejectionState?: BrokerOrderRejectionState;
}
