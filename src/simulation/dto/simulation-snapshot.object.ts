import { ObjectType, Field, Float, Int, ID } from '@nestjs/graphql';

@ObjectType()
export class SimulationSnapshotType {
  @Field(() => ID)
  id: string;

  @Field()
  sessionId: string;

  @Field()
  snapshotDate: string;

  @Field(() => Float)
  portfolioValue: number;

  @Field(() => Float)
  cashBalance: number;

  @Field(() => Float)
  totalValue: number;

  @Field(() => Float)
  dailyPnl: number;

  @Field(() => Float)
  dailyPnlRate: number;

  @Field(() => Float)
  drawdown: number;

  @Field(() => Float)
  peakValue: number;

  @Field(() => Int)
  positionCount: number;

  @Field(() => Int)
  tradeCount: number;

  @Field()
  createdAt: Date;
}
