import { ObjectType, Field, Float, Int } from '@nestjs/graphql';

@ObjectType()
export class SuggestedStrategyType {
  @Field() name: string;
  @Field() displayName: string;
  @Field(() => Int) matchScore: number;
  @Field() reason: string;
}

@ObjectType()
export class StockRecommendationType {
  @Field() id: string;
  @Field() screeningDate: string;
  @Field() market: string;
  @Field() exchangeCode: string;
  @Field() stockCode: string;
  @Field() stockName: string;
  @Field(() => Float) totalScore: number;
  @Field(() => Float) technicalScore: number;
  @Field(() => Float) fundamentalScore: number;
  @Field(() => Float) momentumScore: number;
  @Field(() => Int) rank: number;
  @Field() reasons: string; // JSON string
  @Field() indicators: string; // JSON string
  @Field(() => [SuggestedStrategyType]) suggestedStrategies: SuggestedStrategyType[];
  @Field(() => Float) currentPrice: number;
  @Field(() => Float) changeRate: number;
  @Field(() => Float) volume: number;
  @Field(() => Float) marketCap: number;
  @Field() createdAt: Date;
}
