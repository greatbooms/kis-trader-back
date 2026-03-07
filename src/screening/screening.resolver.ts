import { Resolver, Query, Args } from '@nestjs/graphql';
import { ScreeningService } from './screening.service';
import { ScreeningScheduler } from './screening.scheduler';
import { StockRecommendationType } from './dto';

@Resolver()
export class ScreeningResolver {
  constructor(
    private screeningService: ScreeningService,
    private screeningScheduler: ScreeningScheduler,
  ) {}

  @Query(() => [StockRecommendationType])
  async stockRecommendations(
    @Args('date', { nullable: true }) date?: string,
    @Args('market', { nullable: true }) market?: string,
    @Args('limit', { nullable: true, defaultValue: 20 }) limit?: number,
  ): Promise<StockRecommendationType[]> {
    let targetDate = date;
    if (!targetDate) {
      const dates = await this.screeningService.getScreeningDates(1);
      targetDate = dates[0];
    }
    if (!targetDate) return [];

    const results = await this.screeningService.getRecommendations(targetDate, market, limit);
    return results.map((r) => ({
      id: r.id,
      screeningDate: r.screeningDate,
      market: r.market,
      exchangeCode: r.exchangeCode,
      stockCode: r.stockCode,
      stockName: r.stockName,
      totalScore: Number(r.totalScore),
      technicalScore: Number(r.technicalScore),
      fundamentalScore: Number(r.fundamentalScore),
      momentumScore: Number(r.momentumScore),
      rank: r.rank,
      reasons: JSON.stringify(r.reasons),
      indicators: JSON.stringify(r.indicators),
      currentPrice: Number(r.currentPrice),
      changeRate: Number(r.changeRate),
      volume: Number(r.volume),
      marketCap: Number(r.marketCap),
      createdAt: r.createdAt,
    }));
  }

  @Query(() => [String])
  async screeningDates(
    @Args('limit', { nullable: true, defaultValue: 10 }) limit?: number,
  ): Promise<string[]> {
    return this.screeningService.getScreeningDates(limit);
  }

  @Query(() => Boolean)
  async runScreeningNow(
    @Args('market') market: string,
    @Args('exchangeCode', { nullable: true }) exchangeCode?: string,
  ): Promise<boolean> {
    if (market === 'DOMESTIC') {
      await this.screeningScheduler.runDomesticScreening();
    } else if (exchangeCode) {
      await this.screeningScheduler.runOverseasScreening([exchangeCode]);
    } else {
      await this.screeningScheduler.runOverseasScreening(['NASD', 'NYSE', 'AMEX']);
    }
    return true;
  }
}
