import { ObjectType, Field, Float, ID, registerEnumType } from '@nestjs/graphql';
import { Market, SimulationStatus } from '@prisma/client';
import { SimulationWatchStockType } from './simulation-watch-stock.object';

registerEnumType(SimulationStatus, { name: 'SimulationStatus' });

@ObjectType()
export class SimulationSessionType {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => Market)
  market: Market;

  @Field()
  strategyName: string;

  @Field(() => SimulationStatus)
  status: SimulationStatus;

  @Field(() => Float)
  initialCapital: number;

  @Field(() => Float)
  currentCash: number;

  @Field()
  startedAt: Date;

  @Field({ nullable: true })
  stoppedAt?: Date;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  @Field(() => [SimulationWatchStockType], { nullable: true })
  watchStocks?: SimulationWatchStockType[];
}
