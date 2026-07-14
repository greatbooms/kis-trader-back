import { Field, ObjectType } from '@nestjs/graphql';
import { BrokerEnvironment } from '@prisma/client';

@ObjectType()
export class BrokerContextPreviewType {
  @Field(() => BrokerEnvironment)
  environment: BrokerEnvironment;

  @Field()
  maskedAccount: string;

  @Field()
  contextToken: string;
}
