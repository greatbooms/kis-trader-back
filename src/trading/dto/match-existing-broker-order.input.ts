import { Field, ID, InputType } from '@nestjs/graphql';

@InputType()
export class MatchExistingBrokerOrderInput {
  @Field(() => ID)
  tradeRecordId: string;

  @Field()
  brokerOrderDate: string;

  @Field()
  exchangeCode: string;

  @Field()
  orderNo: string;

  @Field(() => ID)
  existingTradeRecordId: string;
}
