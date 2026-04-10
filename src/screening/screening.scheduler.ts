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
const SCREENING_SCHEDULER_RUN_LOG_KEY = 'screening-scheduler-runs';

const COUNTRY_EXCHANGE_MAP: CountryConfig[] = [
  { country: 'KR', exchanges: ['KRX'] },
  { country: 'US', exchanges: ['NASD', 'NYSE', 'AMEX'] },
  { country: 'HK', exchanges: ['SEHK'] },
  { country: 'CN', exchanges: ['SHAA', 'SZAA'] },
  { country: 'JP', exchanges: ['TKSE'] },
  { country: 'VN', exchanges: ['HASE', 'VNSE'] },
];

type DeepAnalysisPayload = Parameters<SlackService['sendDeepAnalysisReport']>[1];
type ScreeningSchedulerJobStatus = 'started' | 'success' | 'failed' | 'skipped';
type ScreeningSchedulerJobKey =
  | 'domestic-fast'
  | 'overseas-us-fast'
  | 'overseas-asia-fast'
  | 'domestic-deep'
  | 'overseas-us-deep'
  | 'overseas-deep';

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
    // 1차 스크리닝: 국내 09:10 KST (장 시작 후)
    const domesticJob = new CronJob(
      '10 9 * * 1-5',
      () => this.runDomesticScreening(),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('screening-domestic', domesticJob);
    domesticJob.start();

    // 1차 스크리닝: 미국 00:10 KST (미국장 시작 40분 후)
    const usJob = new CronJob(
      '10 0 * * 2-6',
      () => this.runOverseasScreening(['NASD', 'NYSE', 'AMEX'], 'overseas-us-fast'),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('screening-overseas-us', usJob);
    usJob.start();

    // 1차 스크리닝: 아시아 10:50 KST (홍콩/중국 개장 20분 후)
    const asiaJob = new CronJob(
      '50 10 * * 1-5',
      () => this.runOverseasScreening(['TKSE', 'SEHK', 'SHAA', 'SZAA', 'HASE', 'VNSE'], 'overseas-asia-fast'),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('screening-overseas-asia', asiaJob);
    asiaJob.start();

    // 2차 딥 분석: 국내 09:40 KST
    const domesticDeepJob = new CronJob(
      '40 9 * * 1-5',
      () => this.runDomesticDeepAnalysis(),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('screening-domestic-deep', domesticDeepJob);
    domesticDeepJob.start();

    // 2차 딥 분석: 미국 00:50 KST
    const usDeepJob = new CronJob(
      '50 0 * * 2-6',
      () => this.runOverseasDeepAnalysis(['NASD', 'NYSE', 'AMEX'], 'overseas-us-deep'),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('screening-overseas-us-deep', usDeepJob);
    usDeepJob.start();

    this.logger.log('Screening scheduler registered (fast: domestic 09:10, Asia 10:50, US 00:10 / deep: domestic 09:40, US 00:50 KST)');
  }

  async runDomesticScreening(): Promise<void> {
    const jobKey: ScreeningSchedulerJobKey = 'domestic-fast';
    const date = kstTodayStr();
    if (this.isFastRunning || this.isDeepRunning) {
      await this.recordSchedulerRun(jobKey, {
        status: 'skipped',
        date,
        message: '다른 스크리닝 작업이 실행 중입니다.',
      });
      return;
    }

    const enabled = await this.getEnabledCountries();
    if (!enabled.has('KR')) {
      this.logger.log('KR screening disabled, skipping');
      await this.recordSchedulerRun(jobKey, {
        status: 'skipped',
        date,
        message: 'KR 스크리닝이 비활성화되어 있습니다.',
      });
      return;
    }

    this.isFastRunning = true;
    await this.recordSchedulerRun(jobKey, { status: 'started', date });
    try {
      const scores = await this.screeningService.screenDomestic('FULL');
      if (scores.length > 0) {
        await this.screeningService.saveResults(date, scores);
        this.logger.log(`Domestic screening saved: ${scores.length} stocks (top: ${scores[0].stockName} ${scores[0].totalScore.toFixed(1)})`);
        await this.slackService.sendScreeningResult('DOMESTIC', date, scores);
        await this.recordSchedulerRun(jobKey, {
          status: 'success',
          date,
          count: scores.length,
          message: `${scores[0].stockName} ${scores[0].totalScore.toFixed(1)}`,
        });
      } else {
        await this.recordSchedulerRun(jobKey, {
          status: 'success',
          date,
          count: 0,
          message: '추천 종목이 없습니다.',
        });
      }
    } catch (e) {
      this.logger.error(`Domestic screening error: ${e.message}`);
      await this.recordSchedulerRun(jobKey, {
        status: 'failed',
        date,
        message: e.message,
      });
    } finally {
      this.isFastRunning = false;
    }
  }

  async runOverseasScreening(
    exchanges: string[],
    jobKey?: ScreeningSchedulerJobKey,
  ): Promise<void> {
    const resolvedJobKey = jobKey ?? this.resolveFastJobKey(exchanges);
    const date = kstTodayStr();
    if (this.isFastRunning || this.isDeepRunning) {
      await this.recordSchedulerRun(resolvedJobKey, {
        status: 'skipped',
        date,
        exchanges,
        message: '다른 스크리닝 작업이 실행 중입니다.',
      });
      return;
    }

    const enabled = await this.getEnabledCountries();
    const filteredExchanges = exchanges.filter((ex) => {
      const country = COUNTRY_EXCHANGE_MAP.find((c) => c.exchanges.includes(ex));
      return country && enabled.has(country.country);
    });

    if (filteredExchanges.length === 0) {
      this.logger.log(`Overseas screening skipped (no enabled countries for exchanges: ${exchanges.join(', ')})`);
      await this.recordSchedulerRun(resolvedJobKey, {
        status: 'skipped',
        date,
        exchanges,
        message: '활성화된 국가가 없습니다.',
      });
      return;
    }

    this.isFastRunning = true;
    await this.recordSchedulerRun(resolvedJobKey, {
      status: 'started',
      date,
      exchanges: filteredExchanges,
    });
    try {
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
        await this.recordSchedulerRun(resolvedJobKey, {
          status: 'success',
          date,
          exchanges: filteredExchanges,
          count: allScores.length,
          message: `${allScores[0].stockName} ${allScores[0].totalScore.toFixed(1)}`,
        });
      } else {
        await this.recordSchedulerRun(resolvedJobKey, {
          status: 'success',
          date,
          exchanges: filteredExchanges,
          count: 0,
          message: '추천 종목이 없습니다.',
        });
      }
    } catch (e) {
      this.logger.error(`Overseas screening error: ${e.message}`);
      await this.recordSchedulerRun(resolvedJobKey, {
        status: 'failed',
        date,
        exchanges: filteredExchanges,
        message: e.message,
      });
    } finally {
      this.isFastRunning = false;
    }
  }

  async runDomesticDeepAnalysis(): Promise<void> {
    const jobKey: ScreeningSchedulerJobKey = 'domestic-deep';
    if (this.isFastRunning || this.isDeepRunning) {
      await this.recordSchedulerRun(jobKey, {
        status: 'skipped',
        message: '다른 스크리닝 작업이 실행 중입니다.',
      });
      return;
    }

    const enabled = await this.getEnabledCountries();
    if (!enabled.has('KR')) {
      await this.recordSchedulerRun(jobKey, {
        status: 'skipped',
        message: 'KR 스크리닝이 비활성화되어 있습니다.',
      });
      return;
    }

    this.isDeepRunning = true;
    await this.recordSchedulerRun(jobKey, { status: 'started' });
    try {
      const date = await this.screeningService.getLatestRecommendationDate('DOMESTIC', ['KRX']);
      if (!date) {
        await this.recordSchedulerRun(jobKey, {
          status: 'skipped',
          message: '딥분석 대상 추천 결과가 없습니다.',
        });
        return;
      }
      const completed = await this.screeningService.runDeepAnalysisForMarket(date, 'DOMESTIC', ['KRX']);
      this.logger.log(`Domestic deep analysis saved: ${completed} stocks`);
      await this.sendTopDeepAnalysisReports(date, 'DOMESTIC', ['KRX']);
      await this.recordSchedulerRun(jobKey, {
        status: 'success',
        date,
        exchanges: ['KRX'],
        count: completed,
      });
    } catch (e) {
      this.logger.error(`Domestic deep analysis error: ${e.message}`);
      await this.recordSchedulerRun(jobKey, {
        status: 'failed',
        message: e.message,
      });
    } finally {
      this.isDeepRunning = false;
    }
  }

  async runOverseasDeepAnalysis(
    exchanges: string[],
    jobKey?: ScreeningSchedulerJobKey,
  ): Promise<void> {
    const resolvedJobKey = jobKey ?? this.resolveDeepJobKey(exchanges);
    if (this.isFastRunning || this.isDeepRunning) {
      await this.recordSchedulerRun(resolvedJobKey, {
        status: 'skipped',
        exchanges,
        message: '다른 스크리닝 작업이 실행 중입니다.',
      });
      return;
    }

    const enabled = await this.getEnabledCountries();
    const filteredExchanges = exchanges.filter((ex) => {
      const country = COUNTRY_EXCHANGE_MAP.find((c) => c.exchanges.includes(ex));
      return country && enabled.has(country.country);
    });
    if (filteredExchanges.length === 0) {
      await this.recordSchedulerRun(resolvedJobKey, {
        status: 'skipped',
        exchanges,
        message: '활성화된 국가가 없습니다.',
      });
      return;
    }

    this.isDeepRunning = true;
    await this.recordSchedulerRun(resolvedJobKey, {
      status: 'started',
      exchanges: filteredExchanges,
    });
    try {
      const date = await this.screeningService.getLatestRecommendationDate('OVERSEAS', filteredExchanges);
      if (!date) {
        await this.recordSchedulerRun(resolvedJobKey, {
          status: 'skipped',
          exchanges: filteredExchanges,
          message: '딥분석 대상 추천 결과가 없습니다.',
        });
        return;
      }
      const completed = await this.screeningService.runDeepAnalysisForMarket(date, 'OVERSEAS', filteredExchanges);
      this.logger.log(`Overseas deep analysis saved: ${completed} stocks`);
      await this.sendTopDeepAnalysisReports(date, 'OVERSEAS', filteredExchanges);
      await this.recordSchedulerRun(resolvedJobKey, {
        status: 'success',
        date,
        exchanges: filteredExchanges,
        count: completed,
      });
    } catch (e) {
      this.logger.error(`Overseas deep analysis error: ${e.message}`);
      await this.recordSchedulerRun(resolvedJobKey, {
        status: 'failed',
        exchanges: filteredExchanges,
        message: e.message,
      });
    } finally {
      this.isDeepRunning = false;
    }
  }

  private resolveFastJobKey(exchanges: string[]): ScreeningSchedulerJobKey {
    const normalized = [...new Set(exchanges)].sort().join(',');
    return normalized === 'AMEX,NASD,NYSE' ? 'overseas-us-fast' : 'overseas-asia-fast';
  }

  private resolveDeepJobKey(exchanges: string[]): ScreeningSchedulerJobKey {
    const normalized = [...new Set(exchanges)].sort().join(',');
    return normalized === 'AMEX,NASD,NYSE' ? 'overseas-us-deep' : 'overseas-deep';
  }

  private async recordSchedulerRun(
    jobKey: ScreeningSchedulerJobKey,
    entry: {
      status: ScreeningSchedulerJobStatus;
      date?: string;
      exchanges?: string[];
      count?: number;
      message?: string;
    },
  ): Promise<void> {
    const now = new Date().toISOString();

    try {
      const saved = await this.prisma.appSetting.findUnique({
        where: { key: SCREENING_SCHEDULER_RUN_LOG_KEY },
      });
      const current = (saved?.value as Record<string, any>) ?? {};

      await this.prisma.appSetting.upsert({
        where: { key: SCREENING_SCHEDULER_RUN_LOG_KEY },
        update: {
          value: {
            ...current,
            [jobKey]: {
              ...current[jobKey],
              ...entry,
              updatedAt: now,
            },
          } as any,
        },
        create: {
          key: SCREENING_SCHEDULER_RUN_LOG_KEY,
          value: {
            [jobKey]: {
              ...entry,
              updatedAt: now,
            },
          } as any,
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to persist screening scheduler run for ${jobKey}: ${e.message}`);
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
