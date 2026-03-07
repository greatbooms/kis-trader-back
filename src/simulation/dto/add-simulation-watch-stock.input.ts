import { InputType, Field, Float } from '@nestjs/graphql';
import { Market } from '@prisma/client';

@InputType()
export class AddSimulationWatchStockInput {
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

  @Field(() => Float, { nullable: true })
  quota?: number;

  @Field(() => Float, { nullable: true })
  stopLossRate?: number;

  @Field(() => Float, { nullable: true })
  maxPortfolioRate?: number;

  @Field({ nullable: true })
  strategyParams?: string;
}
