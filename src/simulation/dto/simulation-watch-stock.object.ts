import { ObjectType, Field, Float, Int, ID } from '@nestjs/graphql';
import { Market } from '@prisma/client';

@ObjectType()
export class SimulationWatchStockType {
  @Field(() => ID)
  id: string;

  @Field()
  sessionId: string;

  @Field(() => Market)
  market: Market;

  @Field()
  exchangeCode: string;

  @Field()
  stockCode: string;

  @Field()
  stockName: string;

  @Field(() => Float, { nullable: true })
  quota?: number;

  @Field(() => Float)
  cycle: number;

  @Field(() => Int)
  maxCycles: number;

  @Field(() => Float)
  stopLossRate: number;

  @Field(() => Float)
  maxPortfolioRate: number;

  @Field({ nullable: true })
  strategyParams?: string;

  @Field()
  isActive: boolean;
}
