import { Field, Float, ObjectType } from '@nestjs/graphql';
import { Market } from '@prisma/client';

@ObjectType()
export class CashBalanceType {
  @Field(() => Market)
  market: Market;

  @Field()
  currencyCode: string;

  @Field({ nullable: true })
  currencyName?: string;

  @Field(() => Float)
  amount: number;

  @Field(() => Float, { nullable: true })
  withdrawableAmount?: number;
}
