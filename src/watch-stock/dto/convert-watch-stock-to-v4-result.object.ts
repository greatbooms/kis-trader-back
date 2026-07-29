import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class ConvertWatchStockToInfiniteBuyV4Result {
  @Field(() => ID)
  watchStockId: string;

  @Field()
  dryRun: boolean;

  @Field({ description: '실제로 strategyName/strategyParams가 갱신되었는지 (dryRun=true면 항상 false)' })
  applied: boolean;

  @Field()
  isActive: boolean;

  @Field(() => Float)
  starBasePct: number;

  @Field(() => Float)
  turn: number;

  @Field(() => Float)
  cashRemaining: number;

  @Field(() => Int)
  lastKnownHoldQty: number;

  @Field()
  mode: string;

  @Field(() => Int)
  cycleSeq: number;

  @Field(() => [String])
  warnings: string[];
}
