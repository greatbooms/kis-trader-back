import { InputType, Field, Int } from '@nestjs/graphql';
import { Market } from '@prisma/client';

@InputType()
export class SearchStocksInput {
  @Field()
  keyword: string;

  @Field(() => Market, { nullable: true })
  market?: Market;

  @Field(() => Int, { nullable: true })
  limit?: number;

  @Field({ nullable: true })
  exchangeCode?: string;
}
