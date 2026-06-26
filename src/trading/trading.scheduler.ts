import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { TradingOrchestrator } from './trading-orchestrator.service';
import { MarketStateSyncService } from './market-state-sync.service';

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

  constructor(
    private orchestrator: TradingOrchestrator,
    private marketStateSync: MarketStateSyncService,
    private configService: ConfigService,
    private schedulerRegistry: SchedulerRegistry,
  ) {
    this.tradingEnabled = this.configService.get<boolean>('trading.enabled') ?? true;
  }

  onModuleInit() {
    if (!this.tradingEnabled) {
      this.logger.warn('Live trading disabled by TRADING_ENABLED=false; trading cron jobs will not be registered');
      return;
    }

    // orchestrator의 isBusy 플래그를 전달해 동기화 루프와 거래 루프의 중복 실행 방지
    const orchestratorBusy = () => this.orchestrator.isBusy();

    // ========== 국내 시장 ==========

    // 국내 거래 루프: 매 1분, 09:00-15:29 KST
    const krJob = new CronJob('*/1 9-14 * * 1-5', () => this.orchestrator.executeDomestic(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-domestic', krJob);
    krJob.start();

    const krCloseJob = new CronJob('0-29 15 * * 1-5', () => this.orchestrator.executeDomestic(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-domestic-close', krCloseJob);
    krCloseJob.start();
    this.logger.log('Trading domestic cron registered: every 1min 09:00-15:29 KST');

    // 국내 미체결 주문 동기화: 매 10초
    const krOrderSyncJob = new CronJob('*/10 * 9-14 * * 1-5', () => this.marketStateSync.syncDomesticOpenOrders(orchestratorBusy), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-domestic-order-sync', krOrderSyncJob);
    krOrderSyncJob.start();

    const krOrderSyncCloseJob = new CronJob('*/10 * 15 * * 1-5', () => this.marketStateSync.syncDomesticOpenOrders(orchestratorBusy), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-domestic-order-sync-close', krOrderSyncCloseJob);
    krOrderSyncCloseJob.start();
    this.logger.log('Trading domestic order sync cron registered: every 10s 09:00-15:29 KST');

    // 국내 포트폴리오 동기화: 매 10분
    const krPortfolioSyncJob = new CronJob('*/10 9-14 * * 1-5', () => this.marketStateSync.syncDomesticPortfolioState(orchestratorBusy), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-domestic-portfolio-sync', krPortfolioSyncJob);
    krPortfolioSyncJob.start();

    const krPortfolioSyncCloseJob = new CronJob('0,10,20 15 * * 1-5', () => this.marketStateSync.syncDomesticPortfolioState(orchestratorBusy), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-domestic-portfolio-sync-close', krPortfolioSyncCloseJob);
    krPortfolioSyncCloseJob.start();
    this.logger.log('Trading domestic portfolio sync cron registered: every 10min 09:00-15:20 KST');

    const krDailySummaryJob = new CronJob('40 15 * * 1-5', () => this.orchestrator.sendDomesticDailySummary(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('daily-summary-domestic-close', krDailySummaryJob);
    krDailySummaryJob.start();
    this.logger.log('Daily summary domestic cron registered: 15:40 KST');

    // ========== 해외 시장 ==========

    // 해외 아시아 거래 루프: 매 1분, 09:00-16:59 KST
    const asiaJob = new CronJob('*/1 9-16 * * 1-5', () => this.orchestrator.executeOverseas(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-overseas-asia', asiaJob);
    asiaJob.start();
    this.logger.log('Trading overseas-asia cron registered: every 1min 09:00-16:59 KST');

    // 해외 미국 거래 루프: 22:00-06:59 KST 범위 (DST 포함)
    const usNightJob = new CronJob('*/1 22-23 * * 1-5', () => this.orchestrator.executeOverseas(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-overseas-us-night', usNightJob);
    usNightJob.start();

    const usMorningJob = new CronJob('*/1 0-6 * * 2-6', () => this.orchestrator.executeOverseas(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-overseas-us-morning', usMorningJob);
    usMorningJob.start();
    this.logger.log('Trading overseas-us cron registered: every 1min 22:00-06:59 KST (DST aware)');

    // 해외 미체결 주문 동기화: 매 15초
    const asiaOrderSyncJob = new CronJob('*/15 * 9-16 * * 1-5', () => this.marketStateSync.syncOverseasOpenOrders(orchestratorBusy), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-overseas-asia-order-sync', asiaOrderSyncJob);
    asiaOrderSyncJob.start();

    const usNightOrderSyncJob = new CronJob('*/15 * 22-23 * * 1-5', () => this.marketStateSync.syncOverseasOpenOrders(orchestratorBusy), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-overseas-us-night-order-sync', usNightOrderSyncJob);
    usNightOrderSyncJob.start();

    const usMorningOrderSyncJob = new CronJob('*/15 * 0-6 * * 2-6', () => this.marketStateSync.syncOverseasOpenOrders(orchestratorBusy), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-overseas-us-morning-order-sync', usMorningOrderSyncJob);
    usMorningOrderSyncJob.start();
    this.logger.log('Trading overseas order sync cron registered: every 15s during overseas sessions');

    // 해외 포트폴리오 동기화: 매 10분
    const asiaPortfolioSyncJob = new CronJob('*/10 9-16 * * 1-5', () => this.marketStateSync.syncOverseasPortfolioState(orchestratorBusy), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-overseas-asia-portfolio-sync', asiaPortfolioSyncJob);
    asiaPortfolioSyncJob.start();

    const usNightPortfolioSyncJob = new CronJob('*/10 22-23 * * 1-5', () => this.marketStateSync.syncOverseasPortfolioState(orchestratorBusy), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-overseas-us-night-portfolio-sync', usNightPortfolioSyncJob);
    usNightPortfolioSyncJob.start();

    const usMorningPortfolioSyncJob = new CronJob('*/10 0-6 * * 2-6', () => this.marketStateSync.syncOverseasPortfolioState(orchestratorBusy), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-overseas-us-morning-portfolio-sync', usMorningPortfolioSyncJob);
    usMorningPortfolioSyncJob.start();
    this.logger.log('Trading overseas portfolio sync cron registered: every 10min during overseas sessions');

    const usDailySummaryDstJob = new CronJob('10 5 * * 2-6', () => this.orchestrator.sendUsDailySummary(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('daily-summary-us-close-dst', usDailySummaryDstJob);
    usDailySummaryDstJob.start();

    const usDailySummaryStandardJob = new CronJob('10 6 * * 2-6', () => this.orchestrator.sendUsDailySummary(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('daily-summary-us-close-standard', usDailySummaryStandardJob);
    usDailySummaryStandardJob.start();
    this.logger.log('Daily summary US cron registered: 05:10/06:10 KST (DST aware)');

    // ========== 시장 레짐 판별 (각 시장 장전) ==========

    const regimeKrJob = new CronJob('50 8 * * 1-5', () => this.orchestrator.runMarketRegimeDetection('DOMESTIC', 'KRX'), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('regime-detect-kr', regimeKrJob);
    regimeKrJob.start();
    this.logger.log('Regime detect KR cron registered: 08:50 KST');

    // 아시아 조기 개장 (일본/베트남 09:00)
    const regimeAsiaEarlyJob = new CronJob('50 8 * * 1-5', () => {
      this.orchestrator.runMarketRegimeDetectionForExchanges(['TKSE', 'HASE', 'VNSE']);
    }, null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('regime-detect-asia-early', regimeAsiaEarlyJob);
    regimeAsiaEarlyJob.start();

    // 아시아 후기 개장 (홍콩/중국 10:30)
    const regimeAsiaLateJob = new CronJob('20 10 * * 1-5', () => {
      this.orchestrator.runMarketRegimeDetectionForExchanges(['SEHK', 'SHAA', 'SZAA']);
    }, null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('regime-detect-asia-late', regimeAsiaLateJob);
    regimeAsiaLateJob.start();

    this.logger.log('Regime detect Asia crons registered: 08:50, 10:20 KST');

    // 미국 개장 전 리짐 판별 (DST 포함)
    const regimeUsJob = new CronJob('20 22,23 * * 1-5', () => {
      this.orchestrator.runMarketRegimeDetectionForExchanges(['NASD', 'NYSE', 'AMEX']);
    }, null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('regime-detect-us', regimeUsJob);
    regimeUsJob.start();
    this.logger.log('Regime detect US cron registered: 22:20 and 23:20 KST (DST aware)');
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
