import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class CancelTradeOrderResult {
  @Field()
  success: boolean;

  @Field({ nullable: true })
  message?: string;

  @Field({ nullable: true })
  orderNo?: string;
}
