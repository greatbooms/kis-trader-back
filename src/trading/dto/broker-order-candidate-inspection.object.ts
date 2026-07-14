import { Field, ObjectType } from '@nestjs/graphql';
import { BrokerOrderCandidateType } from './broker-order-candidate.object';
import { BrokerOrderRecoveryItemType } from './broker-order-recovery-item.object';

@ObjectType()
export class BrokerOrderCandidateInspectionType {
  @Field(() => BrokerOrderRecoveryItemType)
  recoveryItem: BrokerOrderRecoveryItemType;

  @Field(() => [BrokerOrderCandidateType])
  candidates: BrokerOrderCandidateType[];

  @Field()
  inspectedAt: Date;
}
