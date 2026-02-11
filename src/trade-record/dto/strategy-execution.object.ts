import { ObjectType, Field, Float, Int, ID } from '@nestjs/graphql';
import { Market } from '@prisma/client';

@ObjectType()
export class StrategyExecutionType {
  @Field(() => ID)
  id: string;

  @Field(() => Market)
  market: Market;

  @Field()
  stockCode: string;

  @Field()
  strategyName: string;

  @Field()
  executedDate: string;

  @Field(() => Float)
  progress: number;

  @Field(() => Int)
  signalCount: number;

  @Field({ nullable: true })
  details?: string;

  @Field()
  createdAt: Date;
}
