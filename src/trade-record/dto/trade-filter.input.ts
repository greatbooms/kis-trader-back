import { InputType, Field, Int } from '@nestjs/graphql';
import { Market, Side } from '@prisma/client';

@InputType()
export class TradeFilterInput {
  @Field(() => Market, { nullable: true })
  market?: Market;

  @Field(() => Side, { nullable: true })
  side?: Side;

  @Field({ nullable: true })
  dateFrom?: string;

  @Field({ nullable: true })
  dateTo?: string;

  @Field(() => Int, { nullable: true })
  limit?: number;

  @Field(() => Int, { nullable: true })
  offset?: number;
}
