import {
  BrokerOrderCandidate,
  BrokerOrderRejectionState,
} from '../../kis/types/broker-order-candidate.type';
import { BrokerOrderCollisionType } from './broker-order-collision.type';

export interface BrokerOrderRecoveryCandidate
  extends Omit<
    BrokerOrderCandidate,
    'exchangeCode' | 'orderDate' | 'orderTime' | 'rejectionState'
  > {
  exchangeCode: string;
  orderDate: string;
  orderTime: string;
  rejectionState: BrokerOrderRejectionState;
  existingTradeRecordId?: string;
  collisionType?: BrokerOrderCollisionType;
}
