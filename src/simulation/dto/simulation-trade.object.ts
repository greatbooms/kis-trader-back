import { ObjectType, Field, Float, Int, ID, registerEnumType } from '@nestjs/graphql';
import { Market, Side, SimulationTradeStatus } from '@prisma/client';

registerEnumType(SimulationTradeStatus, { name: 'SimulationTradeStatus' });

@ObjectType()
export class SimulationTradeType {
  @Field(() => ID)
  id: string;

  @Field()
  sessionId: string;

  @Field(() => Market)
  market: Market;

  @Field()
  exchangeCode: string;

  @Field()
  stockCode: string;

  @Field()
  stockName: string;

  @Field(() => Side)
  side: Side;

  @Field(() => Int)
  quantity: number;

  @Field(() => Float)
  price: number;

  @Field(() => Float)
  totalAmount: number;

  @Field(() => SimulationTradeStatus)
  tradeStatus: SimulationTradeStatus;

  @Field({ nullable: true })
  failReason?: string;

  @Field({ nullable: true })
  strategyName?: string;

  @Field({ nullable: true })
  reason?: string;

  @Field()
  createdAt: Date;
}
