import { ObjectType, Field, Float, Int, ID, registerEnumType } from '@nestjs/graphql';
import {
  CancellationAttemptStatus,
  Broker,
  Market,
  Side,
  OrderType,
  OrderStatus,
} from '@prisma/client';

registerEnumType(Side, { name: 'Side' });
registerEnumType(OrderType, { name: 'OrderType' });
registerEnumType(OrderStatus, { name: 'OrderStatus' });

@ObjectType()
export class TradeRecordType {
  @Field(() => ID)
  id: string;

  @Field(() => Broker)
  broker: Broker;

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

  @Field({
    nullable: true,
    description: '체결 확인 시각. 브로커 체결 시각이 아니라 동기화가 체결을 관측한 시각.',
  })
  executedAt?: Date;

  @Field({ nullable: true })
  orderNo?: string;

  @Field(() => OrderStatus)
  status: OrderStatus;

  @Field({ nullable: true })
  strategyName?: string;

  @Field({ nullable: true })
  reason?: string;

  @Field(() => CancellationAttemptStatus, { nullable: true })
  cancellationStatus?: CancellationAttemptStatus;

  @Field({ nullable: true })
  cancellationMessage?: string;

  @Field({ nullable: true })
  brokerMessage?: string;

  @Field()
  createdAt: Date;
}
