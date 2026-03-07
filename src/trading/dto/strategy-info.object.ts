import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
export class StrategyMetaType {
  @Field()
  riskLevel: string;

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
