import { Field, Float, Int, ObjectType } from '@nestjs/graphql';
import { Side } from '@prisma/client';

@ObjectType()
export class WatchStockExecutionPreviewContextType {
  @Field(() => Float)
  currentPrice: number;

  @Field(() => Float, { nullable: true })
  avgPrice?: number;

  @Field(() => Int)
  holdQty: number;

  @Field(() => Float)
  buyableAmount: number;

  // --- infinite-buy-v4 전용 (다른 전략이면 모두 null) ---
  @Field(() => Float, { nullable: true, description: '무한매수 V4 회차 (T)' })
  turn?: number;

  @Field(() => Int, { nullable: true, description: '최대 사이클 (N)' })
  maxCycles?: number;

  @Field(() => Float, { nullable: true })
  cashRemaining?: number;

  @Field({ nullable: true, description: 'V4 모드: NORMAL | REVERSE' })
  mode?: string;

  @Field(() => Float, { nullable: true, description: 'V4 일일 매수 시도액(D), 가용자금 clamp 전' })
  dailyBuyBudget?: number;

  @Field(() => Float, { nullable: true, description: 'V4 일일 매수 시도액(D), 가용자금 clamp 후' })
  dailyBuyBudgetCapped?: number;

  @Field(() => Float, { nullable: true, description: '별% = starBasePct × (1 − 2T/N)' })
  starPct?: number;

  @Field(() => Float, { nullable: true })
  starPrice?: number;

  @Field(() => Float, { nullable: true })
  buyLimitPrice?: number;

  @Field(() => Float, { nullable: true })
  sellLimitPrice?: number;

  @Field(() => Float, { nullable: true, description: 'REVERSE 모드 리버스 별지점(최근 종가 평균)' })
  reverseStarPrice?: number;
}

@ObjectType()
export class WatchStockExecutionPreviewSignalType {
  @Field(() => Side)
  side: Side;

  @Field({ nullable: true, description: "예: 'v4-first-buy', 'v4-quarter-sell', 'take-profit-1'" })
  phase?: string;

  @Field(() => Int)
  quantity: number;

  @Field(() => Float, { nullable: true })
  price?: number;

  @Field({ nullable: true, description: 'KIS ord_dvsn 코드 (00=지정가, 34=LOC, 33=MOC)' })
  orderDivision?: string;

  @Field({ nullable: true, description: '체결 조건: loc | moc | limit-touch' })
  fillModel?: string;

  @Field()
  reason: string;
}

@ObjectType()
export class WatchStockExecutionPreviewResultType {
  @Field(() => WatchStockExecutionPreviewContextType)
  context: WatchStockExecutionPreviewContextType;

  @Field(() => [WatchStockExecutionPreviewSignalType])
  signals: WatchStockExecutionPreviewSignalType[];

  @Field(() => [String])
  skipReasons: string[];
}
