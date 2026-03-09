import { InputType, Field } from '@nestjs/graphql';
import { Market } from '@prisma/client';

@InputType()
export class WatchStocksFilterInput {
  @Field(() => Market, { nullable: true })
  market?: Market;
}
