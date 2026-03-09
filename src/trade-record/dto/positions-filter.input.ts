import { InputType, Field } from '@nestjs/graphql';
import { Market } from '@prisma/client';

@InputType()
export class PositionsFilterInput {
  @Field(() => Market, { nullable: true })
  market?: Market;
}
