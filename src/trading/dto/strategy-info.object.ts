import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
export class StrategyInfo {
  @Field()
  name: string;

  @Field()
  displayName: string;

  @Field()
  description: string;
}
