import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { ScreeningService } from './screening.service';
import { SlackService } from '../notification/slack.service';

@Injectable()
export class ScreeningScheduler implements OnModuleInit {
  private readonly logger = new Logger(ScreeningScheduler.name);
  private isRunning = false;

  constructor(
    private screeningService: ScreeningService,
    private schedulerRegistry: SchedulerRegistry,
    private slackService: SlackService,
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
    this.isRunning = true;

    try {
      const date = this.todayStr();
      for (const exchange of exchanges) {
        try {
          const scores = await this.screeningService.screenOverseas(exchange);
          if (scores.length > 0) {
            await this.screeningService.saveResults(date, scores);
            this.logger.log(`${exchange} screening saved: ${scores.length} stocks`);
            await this.slackService.sendScreeningResult('OVERSEAS', date, scores);
          }
        } catch (e) {
          this.logger.error(`${exchange} screening error: ${e.message}`);
        }
      }
    } catch (e) {
      this.logger.error(`Overseas screening error: ${e.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  private todayStr(): string {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10).replace(/-/g, '');
  }
}
