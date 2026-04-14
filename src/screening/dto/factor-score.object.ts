import { Field, Float, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class FactorScoreType {
  @Field(() => Float, { nullable: true }) trend?: number;
  @Field(() => Float, { nullable: true }) timing?: number;
  @Field(() => Float, { nullable: true }) riskSupply?: number;
  @Field(() => Float, { nullable: true }) valuation?: number;
  @Field(() => Float, { nullable: true }) growth?: number;
  @Field(() => Float, { nullable: true }) profitability?: number;
  @Field(() => Float, { nullable: true }) risk?: number;
  @Field(() => Float, { nullable: true }) supplyDemand?: number;
  @Field(() => Float, { nullable: true }) dividend?: number;
  @Field(() => Float, { nullable: true }) consensus?: number;
  @Field(() => Float, { nullable: true }) fundamental?: number;
}
