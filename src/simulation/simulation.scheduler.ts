import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { SimulationService } from './simulation.service';
import { TradingScheduler } from '../trading/trading.scheduler';
import { PrismaService } from '../prisma.service';
import { SimulationStatus, Market } from '@prisma/client';
import { MARKET_HOURS } from '../kis/types/kis-config.types';

/** 국가코드 → 대표 거래소코드 (MARKET_HOURS 키) */
const COUNTRY_EXCHANGE_MAP: Record<string, string> = {
  US: 'NASD',
  HK: 'SEHK',
  CN: 'SHAA',
  JP: 'TKSE',
  VN: 'HASE',
};

@Injectable()
export class SimulationScheduler implements OnModuleInit {
  private readonly logger = new Logger(SimulationScheduler.name);
  private isSimRunning = false;

  constructor(
    private simulationService: SimulationService,
    private tradingScheduler: TradingScheduler,
    private prisma: PrismaService,
    private schedulerRegistry: SchedulerRegistry,
  ) {}

  /** 실거래 스케줄러가 작업 중이면 끝날 때까지 대기 (최대 50초) */
  private async waitForTradingScheduler(): Promise<void> {
    const maxWait = 50_000;
    const interval = 1_000;
    let waited = 0;
    while (this.tradingScheduler.isBusy() && waited < maxWait) {
      await new Promise((r) => setTimeout(r, interval));
      waited += interval;
    }
    if (waited > 0) {
      this.logger.debug(`Waited ${waited}ms for trading scheduler to finish`);
    }
  }

  onModuleInit() {
    // 국내 시장: 09:00-15:29 KST
    const simKrJob = new CronJob(
      '*/1 9-14 * * 1-5',
      () => this.executeSimulationsDomestic(),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('sim-domestic', simKrJob);
    simKrJob.start();

    const simKrJob2 = new CronJob(
      '0-29 15 * * 1-5',
      () => this.executeSimulationsDomestic(),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('sim-domestic-close', simKrJob2);
    simKrJob2.start();

    // 해외 아시아 시장: 09:00-16:59 KST (일본/베트남/홍콩/중국)
    const simAsiaJob = new CronJob(
      '*/1 9-16 * * 1-5',
      () => this.executeSimulationsOverseas(),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('sim-overseas-asia', simAsiaJob);
    simAsiaJob.start();

    // 해외 미국 시장: 23:00-05:59 KST
    const simUsJob = new CronJob(
      '*/1 23 * * 1-5',
      () => this.executeSimulationsOverseas(),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('sim-overseas-us-night', simUsJob);
    simUsJob.start();

    const simUsJob2 = new CronJob(
      '*/1 0-5 * * 2-6',
      () => this.executeSimulationsOverseas(),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('sim-overseas-us-morning', simUsJob2);
    simUsJob2.start();

    // 스냅샷: 국내 장마감 (15:30 KST)
    const snapKrJob = new CronJob(
      '30 15 * * 1-5',
      () => this.takeSnapshotsDomestic(),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('sim-snapshot-domestic', snapKrJob);
    snapKrJob.start();

    // 스냅샷: 아시아 장마감 (17:00 KST — 가장 늦은 홍콩 마감 후)
    const snapAsiaJob = new CronJob(
      '0 17 * * 1-5',
      () => this.takeSnapshotsOverseas(),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('sim-snapshot-overseas-asia', snapAsiaJob);
    snapAsiaJob.start();

    // 스냅샷: 미국 장마감 (06:00 KST)
    const snapUsJob = new CronJob(
      '0 6 * * 2-6',
      () => this.takeSnapshotsOverseas(),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('sim-snapshot-overseas-us', snapUsJob);
    snapUsJob.start();

    this.logger.log('Simulation scheduler registered');
  }

  private async executeSimulationsDomestic(): Promise<void> {
    if (!this.tradingScheduler.isMarketOpen('KRX')) return;
    await this.executeSimulations(Market.DOMESTIC);
  }

  private async executeSimulationsOverseas(): Promise<void> {
    const overseasExchanges = Object.keys(MARKET_HOURS).filter((ex) => ex !== 'KRX');
    const anyOpen = overseasExchanges.some((ex) => this.tradingScheduler.isMarketOpen(ex));
    if (!anyOpen) return;
    await this.executeSimulations(Market.OVERSEAS);
  }

  private async executeSimulations(market: Market): Promise<void> {
    if (this.isSimRunning) return;
    this.isSimRunning = true;

    try {
      await this.waitForTradingScheduler();
      const sessions = await this.prisma.simulationSession.findMany({
        where: { status: SimulationStatus.RUNNING, market },
      });

      for (const session of sessions) {
        try {
          // 해외 세션: 세션의 국가코드로 거래소 장 오픈 여부 확인
          if (market === Market.OVERSEAS) {
            const exchangeCode = COUNTRY_EXCHANGE_MAP[session.countryCode || ''] || 'NASD';
            if (!this.tradingScheduler.isMarketOpen(exchangeCode)) continue;
          }

          await this.simulationService.updatePositionPrices(session.id);
          await this.simulationService.executeSimulationTick(session.id);
        } catch (e) {
          this.logger.error(`Simulation tick error for session ${session.id}: ${e.message}`);
        }
      }
    } catch (e) {
      this.logger.error(`Simulation scheduler error (${market}): ${e.message}`);
    } finally {
      this.isSimRunning = false;
    }
  }

  private async takeSnapshotsDomestic(): Promise<void> {
    try {
      const sessions = await this.prisma.simulationSession.findMany({
        where: { status: SimulationStatus.RUNNING, market: Market.DOMESTIC },
      });

      for (const session of sessions) {
        try {
          await this.simulationService.takeSnapshot(session.id);
        } catch (e) {
          this.logger.error(`Snapshot error for session ${session.id}: ${e.message}`);
        }
      }
    } catch (e) {
      this.logger.error(`Snapshot domestic error: ${e.message}`);
    }
  }

  private async takeSnapshotsOverseas(): Promise<void> {
    try {
      const sessions = await this.prisma.simulationSession.findMany({
        where: { status: SimulationStatus.RUNNING, market: Market.OVERSEAS },
      });

      for (const session of sessions) {
        try {
          await this.simulationService.takeSnapshot(session.id);
        } catch (e) {
          this.logger.error(`Snapshot error for session ${session.id}: ${e.message}`);
        }
      }
    } catch (e) {
      this.logger.error(`Snapshot overseas error: ${e.message}`);
    }
  }
}
