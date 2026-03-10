import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { ScreeningService } from './screening.service';
import { SlackService } from '../notification/slack.service';
import { PrismaService } from '../prisma.service';

const SCREENING_SETTINGS_KEY = 'screening-countries';

interface CountryConfig {
  country: string;
  exchanges: string[];
}

const COUNTRY_EXCHANGE_MAP: CountryConfig[] = [
  { country: 'KR', exchanges: ['KRX'] },
  { country: 'US', exchanges: ['NASD', 'NYSE', 'AMEX'] },
  { country: 'HK', exchanges: ['SEHK'] },
  { country: 'CN', exchanges: ['SHAA', 'SZAA'] },
  { country: 'JP', exchanges: ['TKSE'] },
  { country: 'VN', exchanges: ['HASE', 'VNSE'] },
];

@Injectable()
export class ScreeningScheduler implements OnModuleInit {
  private readonly logger = new Logger(ScreeningScheduler.name);
  private isRunning = false;

  constructor(
    private screeningService: ScreeningService,
    private schedulerRegistry: SchedulerRegistry,
    private slackService: SlackService,
    private prisma: PrismaService,
  ) {}

  onModuleInit() {
    // 국내: 08:00 KST (장 시작 1시간 전)
    const domesticJob = new CronJob(
      '0 8 * * 1-5',
      () => this.runDomesticScreening(),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('screening-domestic', domesticJob);
    domesticJob.start();

    // 해외 미국: 22:30 KST (미국 장 시작 1시간 전)
    const usJob = new CronJob(
      '30 22 * * 1-5',
      () => this.runOverseasScreening(['NASD', 'NYSE', 'AMEX']),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('screening-overseas-us', usJob);
    usJob.start();

    // 해외 아시아: 08:00 KST (일본/홍콩/중국 장 시작 전)
    const asiaJob = new CronJob(
      '0 8 * * 1-5',
      () => this.runOverseasScreening(['TKSE', 'SEHK', 'SHAA', 'SZAA', 'HASE', 'VNSE']),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('screening-overseas-asia', asiaJob);
    asiaJob.start();

    this.logger.log('Screening scheduler registered (domestic: 08:00, US: 22:30, Asia: 08:00 KST)');
  }

  async runDomesticScreening(): Promise<void> {
    if (this.isRunning) return;

    const enabled = await this.getEnabledCountries();
    if (!enabled.has('KR')) {
      this.logger.log('KR screening disabled, skipping');
      return;
    }

    this.isRunning = true;
    try {
      const date = this.todayStr();
      const scores = await this.screeningService.screenDomestic();
      if (scores.length > 0) {
        await this.screeningService.saveResults(date, scores);
        this.logger.log(`Domestic screening saved: ${scores.length} stocks (top: ${scores[0].stockName} ${scores[0].totalScore.toFixed(1)})`);
        await this.slackService.sendScreeningResult('DOMESTIC', date, scores);
      }
    } catch (e) {
      this.logger.error(`Domestic screening error: ${e.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  async runOverseasScreening(exchanges: string[]): Promise<void> {
    if (this.isRunning) return;

    const enabled = await this.getEnabledCountries();
    const filteredExchanges = exchanges.filter((ex) => {
      const country = COUNTRY_EXCHANGE_MAP.find((c) => c.exchanges.includes(ex));
      return country && enabled.has(country.country);
    });

    if (filteredExchanges.length === 0) {
      this.logger.log(`Overseas screening skipped (no enabled countries for exchanges: ${exchanges.join(', ')})`);
      return;
    }

    this.isRunning = true;
    try {
      const date = this.todayStr();
      const allScores: Awaited<ReturnType<typeof this.screeningService.screenOverseas>> = [];

      for (const exchange of filteredExchanges) {
        try {
          const scores = await this.screeningService.screenOverseas(exchange);
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
      this.isRunning = false;
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

  private todayStr(): string {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10).replace(/-/g, '');
  }
}
