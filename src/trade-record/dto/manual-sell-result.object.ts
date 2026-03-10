import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
export class ManualSellResult {
  @Field()
  success: boolean;

  @Field({ nullable: true })
  message?: string;

  @Field({ nullable: true })
  orderNo?: string;
}
