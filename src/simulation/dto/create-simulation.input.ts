import { InputType, Field, Float } from '@nestjs/graphql';
import { Market } from '@prisma/client';

@InputType()
export class CreateSimulationInput {
  @Field()
  name: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => Market)
  market: Market;

  @Field()
  exchangeCode: string;

  @Field()
  stockCode: string;

  @Field()
  stockName: string;

  @Field({ nullable: true })
  countryCode?: string;

  @Field()
  strategyName: string;

  @Field(() => Float)
  quota: number;

  @Field(() => Float, { nullable: true })
  stopLossRate?: number;

  @Field(() => Float, { nullable: true })
  maxPortfolioRate?: number;

  @Field({ nullable: true })
  strategyParams?: string;
}
