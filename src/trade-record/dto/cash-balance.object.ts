import { Field, Float, ObjectType } from '@nestjs/graphql';
import { Market } from '@prisma/client';

@ObjectType()
export class CashBalanceType {
  @Field(() => Market)
  market: Market;

  @Field()
  currencyCode: string;

  @Field({ nullable: true })
  currencyName?: string;

  @Field(() => Float)
  amount: number;

  @Field(() => Float, { nullable: true })
  withdrawableAmount?: number;

  @Field(() => Float, { nullable: true, description: '주문가능금액' })
  orderableAmount?: number;

  @Field(() => Float, { nullable: true, description: '일반 주문가능금액' })
  generalOrderableAmount?: number;

  @Field(() => Float, { nullable: true, description: '통합 주문가능금액' })
  integratedOrderableAmount?: number;

  @Field(() => Float, { nullable: true, description: '미결제 매수금액' })
  pendingBuyAmount?: number;

  @Field(() => Float, { nullable: true, description: '미결제 매도금액' })
  pendingSellAmount?: number;

  @Field(() => Float, { nullable: true, description: '외화 미수금액' })
  receivableAmount?: number;

  @Field(() => Float, { nullable: true, description: '외화 증거금액' })
  marginAmount?: number;
}
