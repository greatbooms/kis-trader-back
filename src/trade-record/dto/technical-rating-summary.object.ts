import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class TechnicalRatingSummaryType {
  @Field(() => Float)
  score: number;

  @Field()
  recommendation: string;

  @Field(() => Int)
  buyCount: number;

  @Field(() => Int)
  neutralCount: number;

  @Field(() => Int)
  sellCount: number;
}
