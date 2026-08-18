import { Field, ObjectType } from '@nestjs/graphql';
import { Broker, BrokerEnvironment } from '@prisma/client';

@ObjectType()
export class BrokerContextPreviewType {
  @Field(() => Broker)
  broker: Broker;

  @Field(() => BrokerEnvironment)
  environment: BrokerEnvironment;

  @Field()
  maskedAccount: string;

  @Field()
  contextToken: string;
}
