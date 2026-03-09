import { InputType, Field } from '@nestjs/graphql';
import { Market } from '@prisma/client';

@InputType()
export class StrategyAllocationsFilterInput {
  @Field(() => Market)
  market: Market;
}
