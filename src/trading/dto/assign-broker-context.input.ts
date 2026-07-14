import { Field, ID, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

@InputType()
export class AssignBrokerContextInput {
  @Field(() => ID)
  tradeRecordId: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  contextToken: string;
}
