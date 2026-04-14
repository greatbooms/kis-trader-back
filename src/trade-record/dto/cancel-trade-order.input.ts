import { Field, ID, InputType } from '@nestjs/graphql';

@InputType()
export class CancelTradeOrderInput {
  @Field(() => ID)
  tradeRecordId: string;
}
