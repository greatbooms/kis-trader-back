import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { Market, WatchStockExecutionEventType } from '@prisma/client';

registerEnumType(WatchStockExecutionEventType, { name: 'WatchStockExecutionEventType' });

@ObjectType()
export class WatchStockExecutionLogType {
  @Field(() => ID)
  id: string;

  @Field()
  watchStockId: string;

  @Field({ nullable: true })
  tradeRecordId?: string;

  @Field(() => Market)
  market: Market;

  @Field()
  exchangeCode: string;

  @Field()
  stockCode: string;

  @Field()
  stockName: string;

  @Field({ nullable: true })
  strategyName?: string;

  @Field(() => WatchStockExecutionEventType)
  eventType: WatchStockExecutionEventType;

  @Field()
  message: string;

  @Field({ nullable: true })
  details?: string;

  @Field()
  createdAt: Date;
}
