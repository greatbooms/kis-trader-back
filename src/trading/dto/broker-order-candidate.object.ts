import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';
import { Side } from '@prisma/client';

@ObjectType()
export class BrokerOrderCandidateType {
  @Field()
  orderNo: string;

  @Field()
  stockCode: string;

  @Field(() => Side)
  side: Side;

  @Field(() => Int)
  orderQuantity: number;

  @Field(() => Int)
  filledQuantity: number;

  @Field(() => Int)
  remainingQuantity: number;

  @Field(() => Float, { nullable: true })
  orderPrice?: number;

  @Field(() => Float, { nullable: true })
  filledPrice?: number;

  @Field()
  exchangeCode: string;

  @Field()
  orderDate: string;

  @Field()
  orderTime: string;

  @Field()
  rejectionState: string;

  @Field({ nullable: true })
  rejected?: boolean;

  @Field({ nullable: true })
  rejectedReason?: string;

  @Field(() => ID, { nullable: true })
  existingTradeRecordId?: string;

  @Field({ nullable: true })
  collisionType?: string;
}
