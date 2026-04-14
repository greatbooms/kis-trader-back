import { Field, Float, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class TechnicalIndicatorType {
  @Field()
  key: string;

  @Field()
  label: string;

  @Field(() => Float, { nullable: true })
  value?: number;

  @Field()
  action: string;
}
