import { ObjectType, Field, Float, Int, ID, registerEnumType } from '@nestjs/graphql';
import { Market, Side, OrderType, OrderStatus } from '@prisma/client';

registerEnumType(Side, { name: 'Side' });
registerEnumType(OrderType, { name: 'OrderType' });
registerEnumType(OrderStatus, { name: 'OrderStatus' });

@ObjectType()
export class TradeRecordType {
  @Field(() => ID)
  id: string;

  @Field(() => Market)
  market: Market;

  @Field({ nullable: true })
  exchangeCode?: string;

  @Field()
  stockCode: string;

  @Field()
  stockName: string;

  @Field(() => Side)
  side: Side;

  @Field(() => OrderType)
  orderType: OrderType;

  @Field(() => Int)
  quantity: number;

  @Field(() => Float)
  price: number;

  @Field(() => Float, { nullable: true })
  executedPrice?: number;

  @Field(() => Int, { nullable: true })
  executedQty?: number;

  @Field({ nullable: true })
  orderNo?: string;

  @Field(() => OrderStatus)
  status: OrderStatus;

  @Field({ nullable: true })
  strategyName?: string;

  @Field({ nullable: true })
  reason?: string;

  @Field()
  createdAt: Date;
}
