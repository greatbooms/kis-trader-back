import { InputType, Field, Float } from '@nestjs/graphql';

@InputType()
export class ScreeningListFilterInput {
  @Field(() => Float, { nullable: true })
  limit?: number;
}
