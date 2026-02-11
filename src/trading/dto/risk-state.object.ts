import { ObjectType, Field, Float } from '@nestjs/graphql';

@ObjectType()
export class RiskStateType {
  @Field()
  buyBlocked: boolean;

  @Field()
  liquidateAll: boolean;

  @Field()
  positionCount: number;

  @Field(() => Float)
  investedRate: number;

  @Field(() => Float)
  dailyPnlRate: number;

  @Field(() => Float)
  drawdown: number;

  @Field(() => [String])
  reasons: string[];
}
