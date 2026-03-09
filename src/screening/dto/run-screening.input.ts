import { InputType, Field } from '@nestjs/graphql';

@InputType()
export class RunScreeningInput {
  @Field()
  market: string;

  @Field({ nullable: true })
  exchangeCode?: string;
}
