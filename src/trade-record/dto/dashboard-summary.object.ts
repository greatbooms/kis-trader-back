import { ObjectType, Field, Float, Int } from '@nestjs/graphql';

@ObjectType()
export class DashboardSummaryType {
  @Field(() => Float)
  totalProfitLoss: number;

  @Field(() => Int)
  totalTradeCount: number;

  @Field(() => Int)
  todayTradeCount: number;

  @Field(() => Float)
  winRate: number;
}
