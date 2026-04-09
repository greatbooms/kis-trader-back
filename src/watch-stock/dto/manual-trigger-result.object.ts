import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class ManualTriggerResult {
  @Field()
  success: boolean;

  @Field()
  message: string;
}
