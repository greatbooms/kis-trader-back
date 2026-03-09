import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

@ObjectType()
export class ScreeningCountrySummary {
  @Field() country: string;
  @Field() label: string;
  @Field(() => Int) count: number;
  @Field(() => Float) avgScore: number;
}

@ObjectType()
export class ScreeningDateSummary {
  @Field() date: string;
  @Field(() => [ScreeningCountrySummary]) countries: ScreeningCountrySummary[];
  @Field(() => Int) totalCount: number;
}
