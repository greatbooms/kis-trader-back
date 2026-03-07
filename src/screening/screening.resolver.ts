import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { ScreeningService } from './screening.service';
import { ScreeningScheduler } from './screening.scheduler';
import { StockRecommendationType, ScreeningSettingsType, UpdateScreeningSettingsInput } from './dto';
import { PrismaService } from '../prisma.service';

const SCREENING_SETTINGS_KEY = 'screening-countries';

const DEFAULT_COUNTRY_SETTINGS: Record<string, { label: string; enabled: boolean }> = {
  KR: { label: '한국', enabled: true },
  US: { label: '미국', enabled: true },
  HK: { label: '홍콩', enabled: false },
  CN: { label: '중국', enabled: false },
  JP: { label: '일본', enabled: false },
  VN: { label: '베트남', enabled: false },
};

@Resolver()
export class ScreeningResolver {
  constructor(
    private screeningService: ScreeningService,
    private screeningScheduler: ScreeningScheduler,
    private prisma: PrismaService,
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
      suggestedStrategies: (r.suggestedStrategies as any[]) ?? [],
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

  @Query(() => ScreeningSettingsType, { name: 'screeningSettings' })
  async getScreeningSettings(): Promise<ScreeningSettingsType> {
    const saved = await this.prisma.appSetting.findUnique({
      where: { key: SCREENING_SETTINGS_KEY },
    });
    const settings = (saved?.value as Record<string, { label: string; enabled: boolean }>) ?? {};
    const merged = { ...DEFAULT_COUNTRY_SETTINGS, ...settings };

    return {
      countries: Object.entries(merged).map(([country, v]) => ({
        country,
        label: v.label,
        enabled: v.enabled,
      })),
    };
  }

  @Mutation(() => ScreeningSettingsType)
  async updateScreeningSettings(
    @Args('input') input: UpdateScreeningSettingsInput,
  ): Promise<ScreeningSettingsType> {
    const saved = await this.prisma.appSetting.findUnique({
      where: { key: SCREENING_SETTINGS_KEY },
    });
    const current = (saved?.value as Record<string, { label: string; enabled: boolean }>) ?? {};
    const merged = { ...DEFAULT_COUNTRY_SETTINGS, ...current };

    if (merged[input.country]) {
      merged[input.country].enabled = input.enabled;
    }

    await this.prisma.appSetting.upsert({
      where: { key: SCREENING_SETTINGS_KEY },
      update: { value: merged as any },
      create: { key: SCREENING_SETTINGS_KEY, value: merged as any },
    });

    return {
      countries: Object.entries(merged).map(([country, v]) => ({
        country,
        label: v.label,
        enabled: v.enabled,
      })),
    };
  }
}
