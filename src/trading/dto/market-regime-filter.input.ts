import { InputType, Field } from '@nestjs/graphql';
import { Market } from '@prisma/client';

@InputType()
export class MarketRegimeFilterInput {
  @Field(() => Market)
  market: Market;

  @Field()
  exchangeCode: string;
}
