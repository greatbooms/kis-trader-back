import { InputType, Field, Float } from '@nestjs/graphql';
import { Market } from '@prisma/client';

@InputType()
export class SetStrategyAllocationInput {
  @Field(() => Market)
  market: Market;

  @Field()
  strategyName: string;

  @Field(() => Float)
  allocationRate: number;

  @Field({ nullable: true })
  isActive?: boolean;
}
