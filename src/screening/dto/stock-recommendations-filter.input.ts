import { InputType, Field, Float } from '@nestjs/graphql';

@InputType()
export class StockRecommendationsFilterInput {
  @Field({ nullable: true })
  date?: string;

  @Field({ nullable: true })
  market?: string;

  @Field({ nullable: true })
  country?: string;

  @Field(() => Float, { nullable: true })
  limit?: number;
}
