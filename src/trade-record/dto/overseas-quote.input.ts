import { InputType, Field } from '@nestjs/graphql';

@InputType()
export class OverseasQuoteInput {
  @Field()
  exchangeCode: string;

  @Field()
  symbol: string;
}
