import { InputType, Field } from '@nestjs/graphql';
import { Market } from '@prisma/client';

@InputType()
export class RiskStateFilterInput {
  @Field(() => Market)
  market: Market;
}
