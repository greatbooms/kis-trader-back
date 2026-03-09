import { InputType, Field } from '@nestjs/graphql';
import { SimulationStatus } from '@prisma/client';

@InputType()
export class UpdateSimulationStatusInput {
  @Field()
  id: string;

  @Field(() => SimulationStatus)
  status: SimulationStatus;
}
