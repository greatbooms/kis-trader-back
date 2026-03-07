import { ObjectType, Field, Float, Int } from '@nestjs/graphql';

@ObjectType()
export class SimulationMetricsType {
  @Field(() => Float)
  totalReturn: number;

  @Field(() => Float)
  totalReturnAmount: number;

  @Field(() => Float)
  maxDrawdown: number;

  @Field(() => Float)
  winRate: number;

  @Field(() => Int)
  totalTrades: number;

  @Field(() => Int)
  winTrades: number;

  @Field(() => Int)
  lossTrades: number;

  @Field(() => Float)
  sharpeRatio: number;

  @Field(() => Float)
  profitFactor: number;

  @Field(() => Float)
  currentCash: number;

  @Field(() => Float)
  currentPortfolioValue: number;
}
