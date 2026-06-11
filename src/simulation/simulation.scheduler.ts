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
  // 마켓별 독립 mutex — 국내/해외 cron이 같은 분에 동시 발화해도 서로를 막지 않는다.
  // 단일 플래그 공유 시 세션 0개인 해외 run이 국내 틱을 통째로 누락시킴 (2026-06-11 장애)
  private readonly runningMarkets = new Set<Market>();

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

    // 해외 미국 시장: 22:00-06:59 KST 범위에서 실행 후 실제 장시간으로 필터링 (DST 포함)
    const simUsJob = new CronJob(
      '*/1 22-23 * * 1-5',
      () => this.executeSimulationsOverseas(),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('sim-overseas-us-night', simUsJob);
    simUsJob.start();

    const simUsJob2 = new CronJob(
      '*/1 0-6 * * 2-6',
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
    if (await this.tradingScheduler.isExchangeHoliday('KRX')) return;
    await this.executeSimulations(Market.DOMESTIC);
  }

  private async executeSimulationsOverseas(): Promise<void> {
    const overseasExchanges = Object.keys(MARKET_HOURS).filter((ex) => ex !== 'KRX');
    const anyOpen = overseasExchanges.some((ex) => this.tradingScheduler.isMarketOpen(ex));
    if (!anyOpen) return;
    await this.executeSimulations(Market.OVERSEAS);
  }

  private async executeSimulations(market: Market): Promise<void> {
    if (this.runningMarkets.has(market)) {
      // 같은 마켓 직전 run이 1분 넘게 진행 중 — KIS 혼잡 등 이상 징후이므로 가시화
      this.logger.warn(`Simulation tick skipped: previous ${market} run still in progress`);
      return;
    }
    this.runningMarkets.add(market);

    try {
      // 세션 조회를 대기보다 먼저 — 실행할 세션이 없으면 mutex를 들고 최대 50초
      // 대기하지 않고 즉시 종료한다 (틱 신선도는 tick engine의 RUNNING 재검증이 보장)
      const sessions = await this.prisma.simulationSession.findMany({
        where: { status: SimulationStatus.RUNNING, market },
      });
      if (sessions.length === 0) return;

      await this.waitForTradingScheduler();

      for (const session of sessions) {
        try {
          // 해외 세션: 세션의 국가코드로 거래소 장 오픈 여부 확인
          if (market === Market.OVERSEAS) {
            const exchangeCode = COUNTRY_EXCHANGE_MAP[session.countryCode || ''] || 'NASD';
            if (!this.tradingScheduler.isMarketOpen(exchangeCode)) continue;
          }

          await this.simulationService.updatePositionPrices(session.id);
          // 1) pending order 체결 체크 (매 1분마다)
          await this.simulationService.checkPendingOrders(session.id);
          // 2) 전략 실행 → 새 신호 생성 (전략별 once-daily 등 자체 제어)
          await this.simulationService.executeSimulationTick(session.id);
        } catch (e) {
          this.logger.error(`Simulation tick error for session ${session.id}: ${e.message}`);
        }
      }
    } catch (e) {
      this.logger.error(`Simulation scheduler error (${market}): ${e.message}`);
    } finally {
      this.runningMarkets.delete(market);
    }
  }

  private async takeSnapshotsDomestic(): Promise<void> {
    try {
      const sessions = await this.prisma.simulationSession.findMany({
        where: { status: SimulationStatus.RUNNING, market: Market.DOMESTIC },
      });

      for (const session of sessions) {
        try {
          // 장 마감: 미체결 pending order 취소 후 스냅샷
          this.simulationService.cancelPendingOrders(session.id);
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
          // 장 마감: 미체결 pending order 취소 후 스냅샷
          this.simulationService.cancelPendingOrders(session.id);
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
