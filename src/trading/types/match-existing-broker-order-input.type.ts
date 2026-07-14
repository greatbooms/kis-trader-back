import { BrokerOrderCandidateIdentityInput } from './broker-order-candidate-identity-input.type';

export interface MatchExistingBrokerOrderInput
  extends BrokerOrderCandidateIdentityInput {
  existingTradeRecordId: string;
}
