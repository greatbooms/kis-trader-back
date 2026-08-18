import { InputType, Field, Int } from '@nestjs/graphql';
import { Broker, Market, Side } from '@prisma/client';

@InputType()
export class TradeFilterInput {
  @Field(() => Broker, { nullable: true })
  broker?: Broker;

  @Field(() => Market, { nullable: true })
  market?: Market;

  @Field(() => Side, { nullable: true })
  side?: Side;

  @Field({ nullable: true })
  stockCode?: string;

  @Field({ nullable: true })
  exchangeCode?: string;

  @Field({ nullable: true })
  dateFrom?: string;

  @Field({ nullable: true })
  dateTo?: string;

  @Field(() => Int, { nullable: true })
  limit?: number;

  @Field(() => Int, { nullable: true })
  offset?: number;
}
