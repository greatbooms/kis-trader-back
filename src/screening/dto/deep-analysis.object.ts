import { Field, Float, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class StockDeepAnalysisType {
  @Field() id: string;
  @Field() screeningDate: string;
  @Field() stockCode: string;
  @Field() stockName: string;
  @Field() exchangeCode: string;
  @Field(() => Float, { nullable: true }) intrinsicValue?: number;
  @Field(() => Float, { nullable: true }) marginOfSafety?: number;
  @Field({ nullable: true }) riskGrade?: string;
  @Field(() => Float, { nullable: true }) volatility30d?: number;
  @Field(() => Float, { nullable: true }) maxDrawdown90d?: number;
  @Field({ nullable: true }) trendDirection?: string;
  @Field(() => Float, { nullable: true }) dividendYield?: number;
  @Field(() => Float, { nullable: true }) targetPrice?: number;
  @Field(() => Float, { nullable: true }) targetUpside?: number;
  @Field({ nullable: true }) consensusRating?: string;
  @Field({ nullable: true }) reportSummary?: string;
  @Field({ nullable: true }) dcfDetail?: string;
  @Field({ nullable: true }) riskDetail?: string;
  @Field({ nullable: true }) technicalDetail?: string;
  @Field({ nullable: true }) dividendDetail?: string;
  @Field({ nullable: true }) consensusDetail?: string;
}
