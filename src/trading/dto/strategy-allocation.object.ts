import { ObjectType, Field, Float, ID } from '@nestjs/graphql';
import { Market } from '@prisma/client';

@ObjectType()
export class StrategyAllocationType {
  @Field(() => ID)
  id: string;

  @Field(() => Market)
  market: Market;

  @Field()
  strategyName: string;

  @Field(() => Float)
  allocationRate: number;

  @Field()
  isActive: boolean;
}
