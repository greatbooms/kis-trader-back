import { ObjectType, Field, Float, Int, ID } from '@nestjs/graphql';
import { Market, Side } from '@prisma/client';

@ObjectType()
export class SimulationTradeType {
  @Field(() => ID)
  id: string;

  @Field()
  sessionId: string;

  @Field(() => Market)
  market: Market;

  @Field({ nullable: true })
  exchangeCode?: string;

  @Field()
  stockCode: string;

  @Field()
  stockName: string;

  @Field(() => Side)
  side: Side;

  @Field(() => Int)
  quantity: number;

  @Field(() => Float)
  price: number;

  @Field(() => Float)
  totalAmount: number;

  @Field({ nullable: true })
  strategyName?: string;

  @Field({ nullable: true })
  reason?: string;

  @Field()
  createdAt: Date;
}
