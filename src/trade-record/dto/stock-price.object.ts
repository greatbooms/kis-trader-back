import { ObjectType, Field, Float, Int } from '@nestjs/graphql';
import { TechnicalRatingsType } from './technical-ratings.object';

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

  @Field(() => Float, { nullable: true })
  changeRate?: number;

  @Field(() => TechnicalRatingsType, { nullable: true })
  technicalRatings?: TechnicalRatingsType;
}
