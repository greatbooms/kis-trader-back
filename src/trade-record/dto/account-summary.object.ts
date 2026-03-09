import { ObjectType, Field, Float, Int } from '@nestjs/graphql';

@ObjectType()
export class AccountSummaryType {
  @Field(() => Float)
  cashBalance: number;

  @Field(() => Float)
  totalInvested: number;

  @Field(() => Float)
  totalAssets: number;

  @Field(() => Float)
  totalProfitLoss: number;

  @Field(() => Float)
  profitRate: number;

  @Field(() => Int)
  positionCount: number;
}
