import { Field, ObjectType } from '@nestjs/graphql';
import { TechnicalIndicatorType } from './technical-indicator.object';
import { TechnicalRatingSummaryType } from './technical-rating-summary.object';

@ObjectType()
export class TechnicalRatingsType {
  @Field()
  timeframe: string;

  @Field(() => [TechnicalIndicatorType])
  oscillators: TechnicalIndicatorType[];

  @Field(() => [TechnicalIndicatorType])
  movingAverages: TechnicalIndicatorType[];

  @Field(() => TechnicalRatingSummaryType)
  oscillatorSummary: TechnicalRatingSummaryType;

  @Field(() => TechnicalRatingSummaryType)
  movingAverageSummary: TechnicalRatingSummaryType;

  @Field(() => TechnicalRatingSummaryType)
  overallSummary: TechnicalRatingSummaryType;
}
