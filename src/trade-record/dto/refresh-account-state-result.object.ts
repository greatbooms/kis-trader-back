import { Field, ObjectType } from '@nestjs/graphql';
import { AccountSummaryType } from './account-summary.object';

@ObjectType()
export class RefreshAccountStateResult {
  @Field()
  success: boolean;

  @Field()
  message: string;

  @Field(() => AccountSummaryType)
  accountSummary: AccountSummaryType;
}
