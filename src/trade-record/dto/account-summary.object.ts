import { ObjectType, Field, Float, Int } from '@nestjs/graphql';

@ObjectType()
export class AccountSummaryType {
  @Field(() => Float)
  cashBalance: number;

  @Field(() => Float)
  totalInvested: number;

  @Field(() => Float)
  totalAssets: number;

  @Field(() => Float, { description: '미실현 손익 (보유 포지션 평가 손익)' })
  totalProfitLoss: number;

  @Field(() => Float, { description: '실현 손익 (매도 완료된 거래의 손익 합계)' })
  realizedPnL: number;

  @Field(() => Float)
  profitRate: number;

  @Field(() => Int)
  positionCount: number;
}
