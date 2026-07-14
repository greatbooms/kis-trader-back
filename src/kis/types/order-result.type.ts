import { OrderOutcome } from './order-outcome.type';

export interface OrderResult {
  outcome: OrderOutcome;
  success: boolean;
  orderNo?: string;
  brokerOrderDate?: string;
  orderTime?: string;
  message: string;
}
