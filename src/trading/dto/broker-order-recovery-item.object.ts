import {
  Field,
  Float,
  ID,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import {
  Broker,
  BrokerEnvironment,
  CancellationAttemptStatus,
  Market,
  OrderStatus,
  OrderType,
  Side,
  SubmissionResolution,
} from '@prisma/client';

@ObjectType()
export class BrokerOrderRecoveryItemType {
  @Field(() => ID)
  tradeRecordId: string;

  @Field(() => Broker)
  broker: Broker;

  @Field()
  lifecycle: string;

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

  @Field(() => String, { nullable: true })
  orderNo: string | null;

  @Field(() => OrderStatus)
  status: OrderStatus;

  @Field(() => Date, { nullable: true })
  submissionStartedAt: Date | null;

  @Field(() => String, { nullable: true })
  brokerOrderDate: string | null;

  @Field(() => String, { nullable: true })
  brokerOrderTime: string | null;

  @Field(() => Date, { nullable: true })
  submissionResolvedAt: Date | null;

  @Field(() => String, { nullable: true })
  submissionResolvedBy: string | null;

  @Field(() => SubmissionResolution, { nullable: true })
  submissionResolution: SubmissionResolution | null;

  @Field(() => CancellationAttemptStatus, { nullable: true })
  cancellationStatus: CancellationAttemptStatus | null;

  @Field(() => Date, { nullable: true })
  cancellationStartedAt: Date | null;

  @Field(() => Date, { nullable: true })
  cancellationResolvedAt: Date | null;

  @Field(() => String, { nullable: true })
  cancellationResolvedBy: string | null;

  @Field(() => String, { nullable: true })
  cancellationMessage: string | null;

  @Field()
  brokerContextAssigned: boolean;

  @Field(() => BrokerEnvironment, { nullable: true })
  currentBrokerEnvironment: BrokerEnvironment | null;

  @Field(() => String, { nullable: true })
  maskedCurrentAccount: string | null;

  @Field(() => Boolean, { nullable: true })
  brokerContextMatchesCurrent: boolean | null;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}

registerEnumType(BrokerEnvironment, { name: 'BrokerEnvironment' });
registerEnumType(SubmissionResolution, { name: 'SubmissionResolution' });
registerEnumType(CancellationAttemptStatus, { name: 'CancellationAttemptStatus' });
