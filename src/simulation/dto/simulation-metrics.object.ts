import { ObjectType, Field, Float, Int } from '@nestjs/graphql';

@ObjectType()
export class SimulationMetricsType {
  @Field(() => Float)
  totalReturn: number;

  @Field(() => Float)
  totalReturnAmount: number;

  @Field(() => Float, { description: '실현 손익 (매도 완료된 거래의 손익 합계)' })
  realizedPnL: number;

  @Field(() => Float, { description: '미실현 손익 (보유 포지션의 평가 손익 합계)' })
  unrealizedPnL: number;

  @Field(() => Float)
  maxDrawdown: number;

  @Field(() => Float)
  winRate: number;

  @Field(() => Int)
  totalTrades: number;

  @Field(() => Int)
  winTrades: number;

  @Field(() => Int)
  lossTrades: number;

  @Field(() => Float)
  sharpeRatio: number;

  @Field(() => Float)
  profitFactor: number;

  @Field(() => Float)
  currentCash: number;

  @Field(() => Float)
  currentPortfolioValue: number;
}
