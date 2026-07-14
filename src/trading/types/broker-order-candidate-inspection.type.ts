import { BrokerOrderRecoveryCandidate } from './broker-order-recovery-candidate.type';
import { BrokerOrderRecoveryItem } from './broker-order-recovery-item.type';

export interface BrokerOrderCandidateInspection {
  recoveryItem: BrokerOrderRecoveryItem;
  candidates: BrokerOrderRecoveryCandidate[];
  inspectedAt: Date;
}
