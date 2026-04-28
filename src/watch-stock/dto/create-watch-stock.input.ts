import { InputType, Field, Float, Int } from '@nestjs/graphql';
import { Market } from '@prisma/client';

@InputType()
export class CreateWatchStockInput {
  @Field(() => Market)
  market: Market;

  @Field()
  exchangeCode: string;

  @Field()
  stockCode: string;

  @Field()
  stockName: string;

  @Field({ nullable: true })
  strategyName?: string;

  @Field(() => Float, { nullable: true })
  quota?: number;

  @Field(() => Int, { nullable: true })
  maxCycles?: number;

  @Field(() => Float, { nullable: true })
  stopLossRate?: number;

  @Field(() => Float, { nullable: true })
  maxPortfolioRate?: number;

  @Field({ nullable: true })
  strategyParams?: string;
}
