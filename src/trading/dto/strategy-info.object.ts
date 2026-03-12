import { ObjectType, Field, Float } from '@nestjs/graphql';

@ObjectType()
export class StrategyMetaType {
  @Field()
  riskLevel: string;

  @Field(() => Float, { description: 'MDD 매수차단 임계값 (예: -0.10 = -10%)' })
  mddBuyBlock: number;

  @Field(() => Float, { description: 'MDD 전량청산 임계값 (예: -0.15 = -15%)' })
  mddLiquidate: number;

  @Field()
  expectedReturn: string;

  @Field()
  maxLoss: string;

  @Field()
  investmentPeriod: string;

  @Field()
  tradingFrequency: string;

  @Field(() => [String])
  suitableFor: string[];

  @Field(() => [String])
  tags: string[];
}

@ObjectType()
export class StrategyInfo {
  @Field()
  name: string;

  @Field()
  displayName: string;

  @Field()
  description: string;

  @Field(() => StrategyMetaType)
  meta: StrategyMetaType;
}
