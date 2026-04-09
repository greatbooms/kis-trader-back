import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { ScreeningService } from './screening.service';
import { ScreeningScheduler } from './screening.scheduler';
import {
  StockRecommendationType,
  StockDeepAnalysisType,
  ScreeningSettingsType,
  UpdateScreeningSettingsInput,
  ScreeningDateSummary,
  StockRecommendationsFilterInput,
  ScreeningListFilterInput,
  RunScreeningInput,
} from './dto';
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
    @Args('input', { nullable: true }) input?: StockRecommendationsFilterInput,
  ): Promise<StockRecommendationType[]> {
    let targetDate = input?.date;
    const market = input?.market;
    const country = input?.country;
    const limit = input?.limit ?? 20;
    if (!targetDate) {
      const dates = await this.screeningService.getScreeningDates(1);
      targetDate = dates[0];
    }
    if (!targetDate) return [];

    const results = await this.screeningService.getRecommendations(targetDate, market, country, limit);
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
      isEtf: r.isEtf,
      factorScores: r.factorScores ? (r.factorScores as Record<string, number>) : undefined,
      deepAnalysisStatus: r.deepAnalysisStatus ?? undefined,
      deepAnalysisMessage: r.deepAnalysisMessage ?? undefined,
      deepAnalysisUpdatedAt: r.deepAnalysisUpdatedAt ?? undefined,
      createdAt: r.createdAt,
    }));
  }

  @Query(() => StockDeepAnalysisType, { nullable: true })
  async stockDeepAnalysis(
    @Args('stockCode') stockCode: string,
    @Args('date', { nullable: true }) date?: string,
    @Args('exchangeCode', { nullable: true }) exchangeCode?: string,
  ): Promise<StockDeepAnalysisType | null> {
    let targetDate = date;
    if (!targetDate) {
      const dates = await this.screeningService.getScreeningDates(1);
      targetDate = dates[0];
    }
    if (!targetDate) return null;

    const analysis = await this.screeningService.getStockDeepAnalysis(targetDate, stockCode, exchangeCode);
    if (!analysis) return null;

    return {
      id: analysis.id,
      screeningDate: analysis.screeningDate,
      stockCode: analysis.stockCode,
      stockName: analysis.stockName,
      exchangeCode: analysis.exchangeCode,
      intrinsicValue: analysis.intrinsicValue !== null && analysis.intrinsicValue !== undefined ? Number(analysis.intrinsicValue) : undefined,
      marginOfSafety: analysis.marginOfSafety !== null && analysis.marginOfSafety !== undefined ? Number(analysis.marginOfSafety) : undefined,
      riskGrade: analysis.riskGrade ?? undefined,
      volatility30d: analysis.volatility30d !== null && analysis.volatility30d !== undefined ? Number(analysis.volatility30d) : undefined,
      maxDrawdown90d: analysis.maxDrawdown90d !== null && analysis.maxDrawdown90d !== undefined ? Number(analysis.maxDrawdown90d) : undefined,
      trendDirection: analysis.trendDirection ?? undefined,
      dividendYield: analysis.dividendYield !== null && analysis.dividendYield !== undefined ? Number(analysis.dividendYield) : undefined,
      targetPrice: analysis.targetPrice !== null && analysis.targetPrice !== undefined ? Number(analysis.targetPrice) : undefined,
      targetUpside: analysis.targetUpside !== null && analysis.targetUpside !== undefined ? Number(analysis.targetUpside) : undefined,
      consensusRating: analysis.consensusRating ?? undefined,
      reportSummary: analysis.reportSummary ?? undefined,
      dcfDetail: analysis.dcfDetail ? JSON.stringify(analysis.dcfDetail) : undefined,
      riskDetail: analysis.riskDetail ? JSON.stringify(analysis.riskDetail) : undefined,
      technicalDetail: analysis.technicalDetail ? JSON.stringify(analysis.technicalDetail) : undefined,
      dividendDetail: analysis.dividendDetail ? JSON.stringify(analysis.dividendDetail) : undefined,
      consensusDetail: analysis.consensusDetail ? JSON.stringify(analysis.consensusDetail) : undefined,
    };
  }

  @Query(() => [String])
  async screeningDates(
    @Args('input', { nullable: true }) input?: ScreeningListFilterInput,
  ): Promise<string[]> {
    return this.screeningService.getScreeningDates(input?.limit ?? 10);
  }

  @Query(() => [ScreeningDateSummary])
  async screeningDateSummaries(
    @Args('input', { nullable: true }) input?: ScreeningListFilterInput,
  ): Promise<ScreeningDateSummary[]> {
    return this.screeningService.getScreeningDateSummaries(input?.limit ?? 10);
  }

  @Mutation(() => Boolean)
  async runScreeningNow(
    @Args('input') input: RunScreeningInput,
  ): Promise<boolean> {
    if (input.market === 'DOMESTIC') {
      await this.screeningScheduler.runDomesticScreening();
      await this.screeningScheduler.runDomesticDeepAnalysis();
    } else if (input.exchangeCode) {
      await this.screeningScheduler.runOverseasScreening([input.exchangeCode]);
      await this.screeningScheduler.runOverseasDeepAnalysis([input.exchangeCode]);
    } else {
      await this.screeningScheduler.runOverseasScreening(['NASD', 'NYSE', 'AMEX']);
      await this.screeningScheduler.runOverseasDeepAnalysis(['NASD', 'NYSE', 'AMEX']);
    }
    return true;
  }

  @Mutation(() => Boolean)
  async runDeepAnalysisNow(
    @Args('input') input: RunScreeningInput,
  ): Promise<boolean> {
    if (input.market === 'DOMESTIC') {
      await this.screeningScheduler.runDomesticDeepAnalysis();
    } else if (input.exchangeCode) {
      await this.screeningScheduler.runOverseasDeepAnalysis([input.exchangeCode]);
    } else {
      await this.screeningScheduler.runOverseasDeepAnalysis(['NASD', 'NYSE', 'AMEX']);
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
