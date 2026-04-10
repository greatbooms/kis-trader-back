import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class QuoteHistoryPointType {
  @Field()
  date: string;

  @Field(() => Float)
  close: number;

  @Field(() => Float)
  open: number;

  @Field(() => Float)
  high: number;

  @Field(() => Float)
  low: number;

  @Field(() => Int)
  volume: number;
}
