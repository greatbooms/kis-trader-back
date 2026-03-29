import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { CronJob } from 'cron';
import { ScreeningService } from './screening.service';
import { SlackService } from '../notification/slack.service';
import { PrismaService } from '../prisma.service';
import { kstTodayStr } from './utils/date.util';
import { CountryConfig } from './types';

const SCREENING_SETTINGS_KEY = 'screening-countries';

const COUNTRY_EXCHANGE_MAP: CountryConfig[] = [
  { country: 'KR', exchanges: ['KRX'] },
  { country: 'US', exchanges: ['NASD', 'NYSE', 'AMEX'] },
  { country: 'HK', exchanges: ['SEHK'] },
  { country: 'CN', exchanges: ['SHAA', 'SZAA'] },
  { country: 'JP', exchanges: ['TKSE'] },
  { country: 'VN', exchanges: ['HASE', 'VNSE'] },
];

type DeepAnalysisPayload = Parameters<SlackService['sendDeepAnalysisReport']>[1];

@Injectable()
export class ScreeningScheduler implements OnModuleInit {
  private readonly logger = new Logger(ScreeningScheduler.name);
  private isFastRunning = false;
  private isDeepRunning = false;

  constructor(
    private screeningService: ScreeningService,
    private schedulerRegistry: SchedulerRegistry,
    private slackService: SlackService,
    private prisma: PrismaService,
  ) {}

  onModuleInit() {
    // 1차 스크리닝: 국내 08:00 KST
    const domesticJob = new CronJob(
      '0 8 * * 1-5',
      () => this.runDomesticScreening(),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('screening-domestic', domesticJob);
    domesticJob.start();

    // 1차 스크리닝: 미국 22:30 KST
    const usJob = new CronJob(
      '30 22 * * 1-5',
      () => this.runOverseasScreening(['NASD', 'NYSE', 'AMEX']),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('screening-overseas-us', usJob);
    usJob.start();

    // 1차 스크리닝: 아시아 08:00 KST
    const asiaJob = new CronJob(
      '0 8 * * 1-5',
      () => this.runOverseasScreening(['TKSE', 'SEHK', 'SHAA', 'SZAA', 'HASE', 'VNSE']),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('screening-overseas-asia', asiaJob);
    asiaJob.start();

    // 2차 딥 분석: 국내 09:30 KST
    const domesticDeepJob = new CronJob(
      '30 9 * * 1-5',
      () => this.runDomesticDeepAnalysis(),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('screening-domestic-deep', domesticDeepJob);
    domesticDeepJob.start();

    // 2차 딥 분석: 미국 00:00 KST
    const usDeepJob = new CronJob(
      '0 0 * * 2-6',
      () => this.runOverseasDeepAnalysis(['NASD', 'NYSE', 'AMEX']),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('screening-overseas-us-deep', usDeepJob);
    usDeepJob.start();

    this.logger.log('Screening scheduler registered (fast: domestic 08:00, US 22:30, Asia 08:00 / deep: domestic 09:30, US 00:00 KST)');
  }

  async runDomesticScreening(): Promise<void> {
    if (this.isFastRunning || this.isDeepRunning) return;

    const enabled = await this.getEnabledCountries();
    if (!enabled.has('KR')) {
      this.logger.log('KR screening disabled, skipping');
      return;
    }

    this.isFastRunning = true;
    try {
      const date = kstTodayStr();
      const scores = await this.screeningService.screenDomestic('FULL');
      if (scores.length > 0) {
        await this.screeningService.saveResults(date, scores);
        this.logger.log(`Domestic screening saved: ${scores.length} stocks (top: ${scores[0].stockName} ${scores[0].totalScore.toFixed(1)})`);
        await this.slackService.sendScreeningResult('DOMESTIC', date, scores);
      }
    } catch (e) {
      this.logger.error(`Domestic screening error: ${e.message}`);
    } finally {
      this.isFastRunning = false;
    }
  }

  async runOverseasScreening(exchanges: string[]): Promise<void> {
    if (this.isFastRunning || this.isDeepRunning) return;

    const enabled = await this.getEnabledCountries();
    const filteredExchanges = exchanges.filter((ex) => {
      const country = COUNTRY_EXCHANGE_MAP.find((c) => c.exchanges.includes(ex));
      return country && enabled.has(country.country);
    });

    if (filteredExchanges.length === 0) {
      this.logger.log(`Overseas screening skipped (no enabled countries for exchanges: ${exchanges.join(', ')})`);
      return;
    }

    this.isFastRunning = true;
    try {
      const date = kstTodayStr();
      const allScores: Awaited<ReturnType<typeof this.screeningService.screenOverseas>> = [];

      for (const exchange of filteredExchanges) {
        try {
          const scores = await this.screeningService.screenOverseas(exchange, 'FULL');
          if (scores.length > 0) {
            allScores.push(...scores);
            this.logger.log(`${exchange} screening done: ${scores.length} stocks`);
          }
        } catch (e) {
          this.logger.error(`${exchange} screening error: ${e.message}`);
        }
      }

      if (allScores.length > 0) {
        // 전체 거래소 결과를 통합 정렬 후 저장 (rank 중복 방지)
        allScores.sort((a, b) => b.totalScore - a.totalScore);
        await this.screeningService.saveResults(date, allScores);
        this.logger.log(`Overseas screening saved: ${allScores.length} stocks total`);
        await this.slackService.sendScreeningResult('OVERSEAS', date, allScores);
      }
    } catch (e) {
      this.logger.error(`Overseas screening error: ${e.message}`);
    } finally {
      this.isFastRunning = false;
    }
  }

  async runDomesticDeepAnalysis(): Promise<void> {
    if (this.isFastRunning || this.isDeepRunning) return;

    const enabled = await this.getEnabledCountries();
    if (!enabled.has('KR')) return;

    this.isDeepRunning = true;
    try {
      const date = kstTodayStr();
      const completed = await this.screeningService.runDeepAnalysisForMarket(date, 'DOMESTIC', ['KRX']);
      this.logger.log(`Domestic deep analysis saved: ${completed} stocks`);
      await this.sendTopDeepAnalysisReports(date, 'DOMESTIC', ['KRX']);
    } catch (e) {
      this.logger.error(`Domestic deep analysis error: ${e.message}`);
    } finally {
      this.isDeepRunning = false;
    }
  }

  async runOverseasDeepAnalysis(exchanges: string[]): Promise<void> {
    if (this.isFastRunning || this.isDeepRunning) return;

    const enabled = await this.getEnabledCountries();
    const filteredExchanges = exchanges.filter((ex) => {
      const country = COUNTRY_EXCHANGE_MAP.find((c) => c.exchanges.includes(ex));
      return country && enabled.has(country.country);
    });
    if (filteredExchanges.length === 0) return;

    this.isDeepRunning = true;
    try {
      const date = kstTodayStr();
      const completed = await this.screeningService.runDeepAnalysisForMarket(date, 'OVERSEAS', filteredExchanges);
      this.logger.log(`Overseas deep analysis saved: ${completed} stocks`);
      await this.sendTopDeepAnalysisReports(date, 'OVERSEAS', filteredExchanges);
    } catch (e) {
      this.logger.error(`Overseas deep analysis error: ${e.message}`);
    } finally {
      this.isDeepRunning = false;
    }
  }

  private async getEnabledCountries(): Promise<Set<string>> {
    const defaults: Record<string, boolean> = {
      KR: true, US: true, HK: false, CN: false, JP: false, VN: false,
    };
    try {
      const saved = await this.prisma.appSetting.findUnique({
        where: { key: SCREENING_SETTINGS_KEY },
      });
      const settings = (saved?.value as Record<string, { enabled: boolean }>) ?? {};
      const merged = { ...defaults };
      for (const [k, v] of Object.entries(settings)) {
        if (k in merged) merged[k] = v.enabled;
      }
      return new Set(Object.entries(merged).filter(([, v]) => v).map(([k]) => k));
    } catch {
      return new Set(Object.entries(defaults).filter(([, v]) => v).map(([k]) => k));
    }
  }

  private async sendTopDeepAnalysisReports(
    date: string,
    market: 'DOMESTIC' | 'OVERSEAS',
    exchanges?: string[],
  ): Promise<void> {
    const recommendations = await this.prisma.stockRecommendation.findMany({
      where: {
        screeningDate: date,
        market: market as any,
        deepAnalysisId: { not: null },
        ...(exchanges?.length ? { exchangeCode: { in: exchanges } } : {}),
      },
      orderBy: { rank: 'asc' },
      take: 3,
    });

    for (const recommendation of recommendations) {
      if (!recommendation.deepAnalysisId) continue;
      const analysis = await this.prisma.stockDeepAnalysis.findUnique({
        where: { id: recommendation.deepAnalysisId },
      });
      if (!analysis) continue;

      await this.slackService.sendDeepAnalysisReport(recommendation.stockCode, {
        stockName: recommendation.stockName,
        exchangeCode: recommendation.exchangeCode,
        dcfValuation: this.mapDcfValuation(analysis.dcfDetail),
        riskProfile: this.mapRiskProfile(analysis.riskDetail),
        technicalDetail: this.mapTechnicalDetail(analysis.technicalDetail),
        dividendAnalysis: this.mapDividendAnalysis(analysis.dividendDetail),
        consensusData: this.mapConsensusData(analysis.consensusDetail),
      });
    }
  }

  private mapDcfValuation(value: Prisma.JsonValue | null): DeepAnalysisPayload['dcfValuation'] {
    const data = this.asObject(value);
    const intrinsicValue = this.readNumber(data, 'intrinsicValue');
    const currentPrice = this.readNumber(data, 'currentPrice');
    const marginOfSafety = this.readNumber(data, 'marginOfSafety');
    const wacc = this.readNumber(data, 'wacc');
    const terminalGrowthRate = this.readNumber(data, 'terminalGrowthRate');

    if (
      intrinsicValue === undefined ||
      currentPrice === undefined ||
      marginOfSafety === undefined ||
      wacc === undefined ||
      terminalGrowthRate === undefined
    ) {
      return undefined;
    }

    return {
      intrinsicValue,
      currentPrice,
      marginOfSafety,
      wacc,
      terminalGrowthRate,
    };
  }

  private mapRiskProfile(value: Prisma.JsonValue | null): DeepAnalysisPayload['riskProfile'] {
    const data = this.asObject(value);
    const riskGrade = this.readString(data, 'riskGrade');
    const volatility30d = this.readNumber(data, 'volatility30d');
    const maxDrawdown90d = this.readNumber(data, 'maxDrawdown90d');

    if (!riskGrade || volatility30d === undefined || maxDrawdown90d === undefined) {
      return undefined;
    }

    return {
      riskGrade,
      volatility30d,
      maxDrawdown90d,
    };
  }

  private mapTechnicalDetail(value: Prisma.JsonValue | null): DeepAnalysisPayload['technicalDetail'] {
    const data = this.asObject(value);
    const trendDirection = this.readString(data, 'trendDirection');
    const support = this.readNumberArray(data, 'support');
    const resistance = this.readNumberArray(data, 'resistance');
    const adx = this.readNumber(data, 'adx');
    const macd = this.asObject(data?.macd);
    const histogram = this.readNumber(macd, 'histogram');

    if (!trendDirection || !support || !resistance || adx === undefined || histogram === undefined) {
      return undefined;
    }

    return {
      trendDirection,
      support,
      resistance,
      adx,
      macd: { histogram },
    };
  }

  private mapDividendAnalysis(value: Prisma.JsonValue | null): DeepAnalysisPayload['dividendAnalysis'] {
    const data = this.asObject(value);
    const currentYield = this.readNumber(data, 'currentYield');
    const consecutiveDividendYears = this.readNumber(data, 'consecutiveDividendYears');
    const payoutRatio = this.readNumber(data, 'payoutRatio');

    if (
      currentYield === undefined ||
      consecutiveDividendYears === undefined ||
      payoutRatio === undefined
    ) {
      return undefined;
    }

    return {
      currentYield,
      consecutiveDividendYears: Math.trunc(consecutiveDividendYears),
      payoutRatio,
    };
  }

  private mapConsensusData(value: Prisma.JsonValue | null): DeepAnalysisPayload['consensusData'] {
    const data = this.asObject(value);
    const targetPrice = this.readNumber(data, 'targetPrice');
    const rating = this.readString(data, 'rating');
    const earningsSurprise = this.readNumberArray(data, 'earningsSurprise');

    if (targetPrice === undefined || !rating || !earningsSurprise) {
      return undefined;
    }

    return {
      targetPrice,
      rating,
      earningsSurprise,
    };
  }

  private asObject(value: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return value as Record<string, Prisma.JsonValue>;
  }

  private readNumber(
    value: Record<string, Prisma.JsonValue> | undefined,
    key: string,
  ): number | undefined {
    const target = value?.[key];
    if (typeof target === 'number' && Number.isFinite(target)) return target;
    if (typeof target === 'string') {
      const parsed = Number(target);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private readString(
    value: Record<string, Prisma.JsonValue> | undefined,
    key: string,
  ): string | undefined {
    const target = value?.[key];
    return typeof target === 'string' && target.length > 0 ? target : undefined;
  }

  private readNumberArray(
    value: Record<string, Prisma.JsonValue> | undefined,
    key: string,
  ): number[] | undefined {
    const target = value?.[key];
    if (!Array.isArray(target)) return undefined;

    const numbers = target
      .map((item) => {
        if (typeof item === 'number' && Number.isFinite(item)) return item;
        if (typeof item === 'string') {
          const parsed = Number(item);
          return Number.isFinite(parsed) ? parsed : undefined;
        }
        return undefined;
      })
      .filter((item): item is number => item !== undefined);

    return numbers.length === target.length ? numbers : undefined;
  }

}
