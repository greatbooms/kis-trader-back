import { ObjectType, Field, Float, Int } from '@nestjs/graphql';

@ObjectType()
export class StockPriceType {
  @Field()
  stockCode: string;

  @Field()
  stockName: string;

  @Field(() => Float)
  currentPrice: number;

  @Field(() => Float, { nullable: true })
  openPrice?: number;

  @Field(() => Float, { nullable: true })
  highPrice?: number;

  @Field(() => Float, { nullable: true })
  lowPrice?: number;

  @Field(() => Int, { nullable: true })
  volume?: number;
}
