import { ObjectType, Field, Float, ID, registerEnumType } from '@nestjs/graphql';
import { Market, SimulationStatus } from '@prisma/client';

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
  exchangeCode: string;

  @Field()
  stockCode: string;

  @Field()
  stockName: string;

  @Field({ nullable: true })
  countryCode?: string;

  @Field()
  strategyName: string;

  @Field(() => SimulationStatus)
  status: SimulationStatus;

  @Field(() => Float)
  currentCash: number;

  @Field(() => Float)
  quota: number;

  @Field(() => Float)
  cycle: number;

  @Field(() => Float)
  maxCycles: number;

  @Field(() => Float)
  stopLossRate: number;

  @Field(() => Float)
  maxPortfolioRate: number;

  @Field({ nullable: true })
  strategyParams?: string;

  @Field({ nullable: true })
  lastExecutionStatus?: string;

  @Field({ nullable: true })
  lastExecutionDate?: string;

  @Field({ nullable: true })
  lastExecutionDetails?: string;

  @Field(() => Float, { nullable: true, description: '포지션 평가금 합계' })
  portfolioValue?: number;

  @Field()
  startedAt: Date;

  @Field({ nullable: true })
  stoppedAt?: Date;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}
