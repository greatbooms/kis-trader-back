import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
export class StockSearchResult {
  @Field()
  stockCode: string;

  @Field()
  stockName: string;

  @Field({ nullable: true })
  englishName?: string;

  @Field()
  market: string;

  @Field()
  exchangeCode: string;
}
