export type BrokerOrderRejectionState =
  | 'REJECTED'
  | 'NOT_REJECTED'
  | 'UNKNOWN';

/** KIS 주문 이력에서 복구 후보로 사용할 수 있는 정규화된 주문 행. */
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
