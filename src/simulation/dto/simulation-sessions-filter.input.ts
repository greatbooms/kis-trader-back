import { InputType, Field } from '@nestjs/graphql';
import { SimulationStatus } from '@prisma/client';

@InputType()
export class SimulationSessionsFilterInput {
  @Field(() => SimulationStatus, { nullable: true })
  status?: SimulationStatus;
}
