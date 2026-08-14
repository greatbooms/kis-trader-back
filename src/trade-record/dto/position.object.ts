import { ObjectType, Field, Float, Int, ID } from '@nestjs/graphql';
import { Broker, Market } from '@prisma/client';

@ObjectType()
export class PositionType {
  @Field(() => ID)
  id: string;

  @Field(() => Broker)
  broker: Broker;

  @Field(() => Market)
  market: Market;

  @Field()
  exchangeCode: string;

  @Field()
  stockCode: string;

  @Field()
  stockName: string;

  @Field(() => Int)
  quantity: number;

  @Field(() => Float)
  avgPrice: number;

  @Field(() => Float)
  currentPrice: number;

  @Field(() => Float)
  profitLoss: number;

  @Field(() => Float)
  profitRate: number;

  @Field(() => Float)
  totalInvested: number;
}
