import { Field, ID, InputType } from '@nestjs/graphql';

@InputType()
export class BrokerOrderRecoveryTradeInput {
  @Field(() => ID)
  tradeRecordId: string;
}
