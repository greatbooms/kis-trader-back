import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
export class MarketRegimeType {
  @Field()
  regime: string;

  @Field()
  market: string;

  @Field()
  exchangeCode: string;
}
