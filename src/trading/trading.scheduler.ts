import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { TradingOrchestrator } from './trading-orchestrator.service';
import { MarketStateSyncService } from './market-state-sync.service';
import { TradingBrokerOrderRecoveryService } from './trading-broker-order-recovery.service';

/**
 * 거래 관련 cron 등록 전용 스케줄러.
 * 실제 비즈니스 로직은 `TradingOrchestrator`와 `MarketStateSyncService`에 위임한다.
 *
 * 또한 `SimulationScheduler` 등 외부 호출부를 위한 얇은 façade 메서드를 노출한다.
 */
@Injectable()
export class TradingScheduler implements OnModuleInit {
  private readonly logger = new Logger(TradingScheduler.name);
  private readonly tradingEnabled: boolean;
  private recoveryReady: Promise<boolean> = Promise.resolve(false);

  constructor(
    private orchestrator: TradingOrchestrator,
    private marketStateSync: MarketStateSyncService,
    private recoveryService: TradingBrokerOrderRecoveryService,
    private configService: ConfigService,
    private schedulerRegistry: SchedulerRegistry,
  ) {
    this.tradingEnabled = this.configService.get<boolean>('trading.enabled') === true;
  }

  async onModuleInit(): Promise<void> {
    this.recoveryReady = this.initializeRecovery();
    if (!this.tradingEnabled) {
      await this.recoveryReady;
      this.logger.warn(
        'Live trading disabled; TRADING_ENABLED must be explicitly set to true for trading cron jobs to be registered',
      );
      return;
    }

    // orchestrator의 isBusy 플래그를 전달해 동기화 루프와 거래 루프의 중복 실행 방지
    const orchestratorBusy = () => this.orchestrator.isBusy();

    // ========== 국내 시장 ==========

    // 국내 거래 루프: 매 1분, 09:00-15:29 KST
    const krJob = this.createRecoveryGuardedJob('*/1 9-14 * * 1-5', () => this.orchestrator.executeDomestic());
    this.schedulerRegistry.addCronJob('trading-domestic', krJob);
    krJob.start();

    const krCloseJob = this.createRecoveryGuardedJob('0-29 15 * * 1-5', () => this.orchestrator.executeDomestic());
    this.schedulerRegistry.addCronJob('trading-domestic-close', krCloseJob);
    krCloseJob.start();
    this.logger.log('Trading domestic cron registered: every 1min 09:00-15:29 KST');

    // 국내 미체결 주문 동기화: 매 10초
    const krOrderSyncJob = this.createRecoveryGuardedJob('*/10 * 9-14 * * 1-5', () => this.marketStateSync.syncDomesticOpenOrders(orchestratorBusy));
    this.schedulerRegistry.addCronJob('trading-domestic-order-sync', krOrderSyncJob);
    krOrderSyncJob.start();

    const krOrderSyncCloseJob = this.createRecoveryGuardedJob('*/10 * 15 * * 1-5', () => this.marketStateSync.syncDomesticOpenOrders(orchestratorBusy));
    this.schedulerRegistry.addCronJob('trading-domestic-order-sync-close', krOrderSyncCloseJob);
    krOrderSyncCloseJob.start();
    this.logger.log('Trading domestic order sync cron registered: every 10s 09:00-15:29 KST');

    // 국내 포트폴리오 동기화: 매 10분
    const krPortfolioSyncJob = this.createRecoveryGuardedJob('*/10 9-14 * * 1-5', () => this.marketStateSync.syncDomesticPortfolioState(orchestratorBusy));
    this.schedulerRegistry.addCronJob('trading-domestic-portfolio-sync', krPortfolioSyncJob);
    krPortfolioSyncJob.start();

    const krPortfolioSyncCloseJob = this.createRecoveryGuardedJob('0,10,20 15 * * 1-5', () => this.marketStateSync.syncDomesticPortfolioState(orchestratorBusy));
    this.schedulerRegistry.addCronJob('trading-domestic-portfolio-sync-close', krPortfolioSyncCloseJob);
    krPortfolioSyncCloseJob.start();
    this.logger.log('Trading domestic portfolio sync cron registered: every 10min 09:00-15:20 KST');

    const krDailySummaryJob = this.createRecoveryGuardedJob('40,45,50 15 * * 1-5', () => this.orchestrator.sendDomesticDailySummary());
    this.schedulerRegistry.addCronJob('daily-summary-domestic-close', krDailySummaryJob);
    krDailySummaryJob.start();
    this.logger.log('Daily summary domestic cron registered: 15:40/15:45/15:50 KST');

    // ========== 해외 시장 ==========

    // 해외 아시아 거래 루프: 매 1분, 09:00-16:59 KST
    const asiaJob = this.createRecoveryGuardedJob('*/1 9-16 * * 1-5', () => this.orchestrator.executeOverseas());
    this.schedulerRegistry.addCronJob('trading-overseas-asia', asiaJob);
    asiaJob.start();
    this.logger.log('Trading overseas-asia cron registered: every 1min 09:00-16:59 KST');

    // 해외 미국 거래 루프: 22:00-06:59 KST 범위 (DST 포함)
    const usNightJob = this.createRecoveryGuardedJob('*/1 22-23 * * 1-5', () => this.orchestrator.executeOverseas());
    this.schedulerRegistry.addCronJob('trading-overseas-us-night', usNightJob);
    usNightJob.start();

    const usMorningJob = this.createRecoveryGuardedJob('*/1 0-6 * * 2-6', () => this.orchestrator.executeOverseas());
    this.schedulerRegistry.addCronJob('trading-overseas-us-morning', usMorningJob);
    usMorningJob.start();
    this.logger.log('Trading overseas-us cron registered: every 1min 22:00-06:59 KST (DST aware)');

    // 해외 미체결 주문 동기화: 매 15초
    const asiaOrderSyncJob = this.createRecoveryGuardedJob('10,25,40,55 * 9-16 * * 1-5', () => this.marketStateSync.syncOverseasOpenOrders(orchestratorBusy));
    this.schedulerRegistry.addCronJob('trading-overseas-asia-order-sync', asiaOrderSyncJob);
    asiaOrderSyncJob.start();

    const usNightOrderSyncJob = this.createRecoveryGuardedJob('10,25,40,55 * 22-23 * * 1-5', () => this.marketStateSync.syncOverseasOpenOrders(orchestratorBusy));
    this.schedulerRegistry.addCronJob('trading-overseas-us-night-order-sync', usNightOrderSyncJob);
    usNightOrderSyncJob.start();

    const usMorningOrderSyncJob = this.createRecoveryGuardedJob('10,25,40,55 * 0-6 * * 2-6', () => this.marketStateSync.syncOverseasOpenOrders(orchestratorBusy));
    this.schedulerRegistry.addCronJob('trading-overseas-us-morning-order-sync', usMorningOrderSyncJob);
    usMorningOrderSyncJob.start();
    this.logger.log('Trading overseas order sync cron registered: every 15s during overseas sessions');

    // 해외 포트폴리오 동기화: 매 10분
    const asiaPortfolioSyncJob = this.createRecoveryGuardedJob('20 */10 9-16 * * 1-5', () => this.marketStateSync.syncOverseasPortfolioState(orchestratorBusy));
    this.schedulerRegistry.addCronJob('trading-overseas-asia-portfolio-sync', asiaPortfolioSyncJob);
    asiaPortfolioSyncJob.start();

    const usNightPortfolioSyncJob = this.createRecoveryGuardedJob('20 */10 22-23 * * 1-5', () => this.marketStateSync.syncOverseasPortfolioState(orchestratorBusy));
    this.schedulerRegistry.addCronJob('trading-overseas-us-night-portfolio-sync', usNightPortfolioSyncJob);
    usNightPortfolioSyncJob.start();

    const usMorningPortfolioSyncJob = this.createRecoveryGuardedJob('20 */10 0-6 * * 2-6', () => this.marketStateSync.syncOverseasPortfolioState(orchestratorBusy));
    this.schedulerRegistry.addCronJob('trading-overseas-us-morning-portfolio-sync', usMorningPortfolioSyncJob);
    usMorningPortfolioSyncJob.start();
    this.logger.log('Trading overseas portfolio sync cron registered: every 10min during overseas sessions');

    const usDailySummaryDstJob = this.createRecoveryGuardedJob('10,15,20 5 * * 2-6', () => this.orchestrator.sendUsDailySummary());
    this.schedulerRegistry.addCronJob('daily-summary-us-close-dst', usDailySummaryDstJob);
    usDailySummaryDstJob.start();

    const usDailySummaryStandardJob = this.createRecoveryGuardedJob('10,15,20 6 * * 2-6', () => this.orchestrator.sendUsDailySummary());
    this.schedulerRegistry.addCronJob('daily-summary-us-close-standard', usDailySummaryStandardJob);
    usDailySummaryStandardJob.start();
    this.logger.log('Daily summary US cron registered: 05:10/05:15/05:20 and 06:10/06:15/06:20 KST (DST aware)');

    // ========== 시장 레짐 판별 (각 시장 장전) ==========

    const regimeKrJob = this.createRecoveryGuardedJob('50 8 * * 1-5', () => this.orchestrator.runMarketRegimeDetection('DOMESTIC', 'KRX'));
    this.schedulerRegistry.addCronJob('regime-detect-kr', regimeKrJob);
    regimeKrJob.start();
    this.logger.log('Regime detect KR cron registered: 08:50 KST');

    // 아시아 조기 개장 (일본/베트남 09:00)
    const regimeAsiaEarlyJob = this.createRecoveryGuardedJob('50 8 * * 1-5', () => {
      this.orchestrator.runMarketRegimeDetectionForExchanges(['TKSE', 'HASE', 'VNSE']);
    });
    this.schedulerRegistry.addCronJob('regime-detect-asia-early', regimeAsiaEarlyJob);
    regimeAsiaEarlyJob.start();

    // 아시아 후기 개장 (홍콩/중국 10:30)
    const regimeAsiaLateJob = this.createRecoveryGuardedJob('20 10 * * 1-5', () => {
      this.orchestrator.runMarketRegimeDetectionForExchanges(['SEHK', 'SHAA', 'SZAA']);
    });
    this.schedulerRegistry.addCronJob('regime-detect-asia-late', regimeAsiaLateJob);
    regimeAsiaLateJob.start();

    this.logger.log('Regime detect Asia crons registered: 08:50, 10:20 KST');

    // 미국 개장 전 리짐 판별 (DST 포함)
    const regimeUsJob = this.createRecoveryGuardedJob('20 22,23 * * 1-5', () => {
      this.orchestrator.runMarketRegimeDetectionForExchanges(['NASD', 'NYSE', 'AMEX']);
    });
    this.schedulerRegistry.addCronJob('regime-detect-us', regimeUsJob);
    regimeUsJob.start();
    this.logger.log('Regime detect US cron registered: 22:20 and 23:20 KST (DST aware)');

    await this.recoveryReady;
  }

  private createRecoveryGuardedJob(
    cronTime: string,
    action: () => unknown | Promise<unknown>,
  ): CronJob {
    return new CronJob(
      cronTime,
      () => this.runAfterRecovery(action),
      null,
      false,
      'Asia/Seoul',
    );
  }

  private async initializeRecovery(): Promise<boolean> {
    try {
      const summary = await this.recoveryService.takeOverStartupState();
      this.logger.log(
        `Broker recovery ready: submission unknown=${summary.submissionUnknown}, pre-submit cancelled=${summary.submissionCancelled}, cancellation unknown=${summary.cancellationUnknown}, unresolved=${summary.unresolvedCount}`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Broker recovery startup failed; trading cron callbacks remain blocked: ${this.errorMessage(error)}`,
      );
      return false;
    }
  }

  private async runAfterRecovery(
    action: () => unknown | Promise<unknown>,
  ): Promise<void> {
    if (!await this.recoveryReady) return;
    await action();
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  // ========== 외부 호출부용 façade (simulation scheduler 등) ==========

  /** @deprecated Use `TradingOrchestrator.isBusy()` directly */
  isBusy(): boolean {
    return this.orchestrator.isBusy();
  }

  /** @deprecated Use `MarketStateSyncService.isMarketOpen()` directly */
  isMarketOpen(exchangeCode: string): boolean {
    return this.marketStateSync.isMarketOpen(exchangeCode);
  }

  /** @deprecated Use `MarketStateSyncService.isExchangeHoliday()` directly */
  isExchangeHoliday(exchangeCode: string): Promise<boolean> {
    return this.marketStateSync.isExchangeHoliday(exchangeCode);
  }
}
