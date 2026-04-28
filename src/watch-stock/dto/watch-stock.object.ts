import { ObjectType, Field, ID, Float, Int } from '@nestjs/graphql';
import { Market } from '@prisma/client';

@ObjectType()
export class WatchStockType {
  @Field(() => ID)
  id: string;

  @Field(() => Market)
  market: Market;

  @Field()
  exchangeCode: string;

  @Field()
  stockCode: string;

  @Field()
  stockName: string;

  @Field()
  isActive: boolean;

  @Field({ nullable: true })
  strategyName?: string;

  @Field(() => Float, { nullable: true })
  quota?: number;

  @Field(() => Float)
  cycle: number;

  @Field(() => Int)
  maxCycles: number;

  @Field(() => Float)
  stopLossRate: number;

  @Field(() => Float)
  maxPortfolioRate: number;

  @Field({ nullable: true })
  strategyParams?: string;

  @Field({ nullable: true, description: '마지막 전략 실행 상태 (예: "3 시그널 생성", "지수 MA200 아래 — 매수 중단")' })
  lastExecutionStatus?: string;

  @Field({ nullable: true, description: '마지막 전략 실행 날짜' })
  lastExecutionDate?: string;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}
