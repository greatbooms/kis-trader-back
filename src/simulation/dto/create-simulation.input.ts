import { InputType, Field, Float } from '@nestjs/graphql';
import { Market } from '@prisma/client';

@InputType()
export class WatchStockInput {
  @Field(() => Market)
  market: Market;

  @Field({ nullable: true })
  exchangeCode?: string;

  @Field()
  stockCode: string;

  @Field()
  stockName: string;

  @Field(() => Float, { nullable: true })
  quota?: number;

  @Field(() => Float, { nullable: true })
  stopLossRate?: number;

  @Field(() => Float, { nullable: true })
  maxPortfolioRate?: number;

  @Field({ nullable: true })
  strategyParams?: string;
}

@InputType()
export class CreateSimulationInput {
  @Field()
  name: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => Market)
  market: Market;

  @Field()
  strategyName: string;

  @Field(() => Float)
  initialCapital: number;

  @Field(() => [WatchStockInput], { nullable: true })
  watchStocks?: WatchStockInput[];
}
