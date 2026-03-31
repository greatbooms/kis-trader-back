import { InputType, Field, Float, Int } from '@nestjs/graphql';

@InputType()
export class UpdateSimulationSettingsInput {
  @Field()
  id: string;

  @Field({ nullable: true })
  name?: string;

  @Field(() => Float, { nullable: true })
  stopLossRate?: number;

  @Field(() => Int, { nullable: true })
  maxCycles?: number;
}
