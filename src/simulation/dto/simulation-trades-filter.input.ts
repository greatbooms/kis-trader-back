import { InputType, Field, Int } from '@nestjs/graphql';
import { SimulationTradeStatus } from '@prisma/client';

@InputType()
export class SimulationTradesFilterInput {
  @Field()
  sessionId: string;

  @Field(() => Int, { nullable: true })
  limit?: number;

  @Field(() => Int, { nullable: true })
  offset?: number;

  @Field(() => SimulationTradeStatus, { nullable: true })
  tradeStatus?: SimulationTradeStatus;
}
