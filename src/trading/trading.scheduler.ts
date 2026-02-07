import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { TradingService } from './trading.service';
import { MarketAnalysisService } from './market-analysis.service';
import { InfiniteBuyStrategy } from './strategy/infinite-buy.strategy';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { PrismaService } from '../prisma.service';
import { MARKET_HOURS, MarketHours } from '../kis/types/kis-config.types';
import { HolidayItem } from '../kis/types/kis-api.types';
import { StockStrategyContext, WatchStockConfig } from './strategy/strategy.interface';
import { Market } from '@prisma/client';
import { SlackService } from '../notification/slack.service';
import { SlackCommandsService } from '../notification/slack-commands.service';

@Injectable()
export class TradingScheduler implements OnModuleInit {
  private readonly logger = new Logger(TradingScheduler.name);
  private readonly intervalMs: number;
  private readonly isPaper: boolean;
  private isRunning = false;

  // 휴장일 캐시 (일 1회)
  private holidayCache: { date: string; domestic: HolidayItem[]; overseas: HolidayItem[] } | null = null;

  constructor(
    private tradingService: TradingService,
    private marketAnalysis: MarketAnalysisService,
    private infiniteBuyStrategy: InfiniteBuyStrategy,
    private kisDomestic: KisDomesticService,
    private kisOverseas: KisOverseasService,
    private prisma: PrismaService,
    private configService: ConfigService,
    private schedulerRegistry: SchedulerRegistry,
    @Optional() private slackService?: SlackService,
    @Optional() private slackCommandsService?: SlackCommandsService,
  ) {
    this.intervalMs = this.configService.get<number>('trading.intervalMs')!;
    this.isPaper = this.configService.get<string>('kis.env') === 'paper';
  }

  onModuleInit() {
    // 기존 interval 기반 루프 (noop 전략 등 범용)
    const interval = setInterval(() => this.tick(), this.intervalMs);
    this.schedulerRegistry.addInterval('trading-loop', interval);
    this.logger.log(`Trading scheduler started (interval: ${this.intervalMs}ms)`);

    // 무한매수법 Cron 등록
    const usCron = this.configService.get<string>('trading.usMarketCron')!;
    const krCron = this.configService.get<string>('trading.krMarketCron')!;

    const usJob = new CronJob(usCron, () => this.executeInfiniteBuyOverseas());
    this.schedulerRegistry.addCronJob('infinite-buy-overseas', usJob);
    usJob.start();
    this.logger.log(`Infinite buy overseas cron registered: ${usCron}`);

    const krJob = new CronJob(krCron, () => this.executeInfiniteBuyDomestic());
    this.schedulerRegistry.addCronJob('infinite-buy-domestic', krJob);
    krJob.start();
    this.logger.log(`Infinite buy domestic cron registered: ${krCron}`);
  }

  // --- 기존 interval 루프 (범용 전략용, 유지) ---

  private async tick(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug('Previous tick still running, skipping');
      return;
    }

    this.isRunning = true;
    try {
      await this.processDomestic();
      await this.processOverseas();
    } catch (e) {
      this.logger.error(`Scheduler tick error: ${e.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  private async processDomestic(): Promise<void> {
    if (!this.isMarketOpen('KRX')) return;

    const watchStocks = await this.prisma.watchStock.findMany({
      where: { market: Market.DOMESTIC, isActive: true, strategyName: null },
    });

    if (watchStocks.length === 0) return;

    const stockCodes = watchStocks.map((w) => w.stockCode);
    const prices = await this.tradingService.fetchDomesticPrices(stockCodes);

    try {
      const balance = await this.kisDomestic.getBalance();
      await this.tradingService.syncPositions('DOMESTIC', balance);
      await this.tradingService.executeStrategy('DOMESTIC', prices, balance);
    } catch (e) {
      this.logger.error(`Domestic balance/strategy error: ${e.message}`);
    }
  }

  private async processOverseas(): Promise<void> {
    const watchStocks = await this.prisma.watchStock.findMany({
      where: { market: Market.OVERSEAS, isActive: true, strategyName: null },
    });

    if (watchStocks.length === 0) return;

    const byExchange = new Map<string, typeof watchStocks>();
    for (const w of watchStocks) {
      const ex = w.exchangeCode || 'NASD';
      if (!byExchange.has(ex)) byExchange.set(ex, []);
      byExchange.get(ex)!.push(w);
    }

    for (const [exchangeCode, stocks] of byExchange) {
      if (!this.isMarketOpen(exchangeCode)) continue;

      const stockInputs = stocks.map((s) => ({
        exchangeCode: s.exchangeCode || exchangeCode,
        stockCode: s.stockCode,
      }));
      const prices = await this.tradingService.fetchOverseasPrices(stockInputs);

      try {
        const balance = await this.kisOverseas.getBalance();
        await this.tradingService.syncPositions('OVERSEAS', balance);
        await this.tradingService.executeStrategy('OVERSEAS', prices, balance);
      } catch (e) {
        this.logger.error(`Overseas balance/strategy error (${exchangeCode}): ${e.message}`);
      }
    }
  }

  // --- 무한매수법 Cron 실행 ---

  private async executeInfiniteBuyOverseas(): Promise<void> {
    this.logger.log('=== Infinite Buy Overseas: Cron triggered ===');

    try {
      // 휴장일 체크
      if (await this.isHoliday('OVERSEAS')) {
        this.logger.log('Overseas market holiday, skipping');
        return;
      }

      // 미체결 주문 정리 (개선 F)
      await this.cancelUnfilledOrders('OVERSEAS');

      // 전략 대상 종목 조회
      const watchStocks = await this.prisma.watchStock.findMany({
        where: { market: Market.OVERSEAS, isActive: true, strategyName: 'infinite-buy' },
      });

      if (watchStocks.length === 0) {
        this.logger.log('No overseas infinite-buy watch stocks');
        return;
      }

      // 잔고 동기화
      const balance = await this.kisOverseas.getBalance();
      await this.tradingService.syncPositions('OVERSEAS', balance);

      // 포지션 DB 조회
      const positions = await this.prisma.position.findMany({
        where: { market: Market.OVERSEAS },
      });

      // 전체 포트폴리오 가치 (해외)
      const totalPortfolioValue = positions.reduce(
        (sum, p) => sum + Number(p.quantity) * Number(p.currentPrice),
        0,
      );

      // 거래소별 그룹
      const byExchange = new Map<string, typeof watchStocks>();
      for (const w of watchStocks) {
        const ex = w.exchangeCode || 'NASD';
        if (!byExchange.has(ex)) byExchange.set(ex, []);
        byExchange.get(ex)!.push(w);
      }

      let lastMarketCondition: Awaited<ReturnType<typeof this.marketAnalysis.getMarketCondition>> | undefined;

      for (const [exchangeCode, stocks] of byExchange) {
        // 시장 상황 (거래소별 참조 지수)
        const marketCondition = await this.marketAnalysis.getMarketCondition(exchangeCode);
        lastMarketCondition = marketCondition;

        const contexts: StockStrategyContext[] = [];

        for (const ws of stocks) {
          try {
            // 시세 조회
            const price = await this.kisOverseas.getPrice(ws.exchangeCode || exchangeCode, ws.stockCode);

            // 포지션 매칭
            const pos = positions.find((p) => p.stockCode === ws.stockCode);

            // 기술 지표
            const stockIndicators = await this.marketAnalysis.getStockIndicators(
              'OVERSEAS',
              ws.exchangeCode || exchangeCode,
              ws.stockCode,
              price.currentPrice,
            );

            // 매수 가능 금액
            let buyableAmount = 0;
            try {
              const buyable = await this.kisOverseas.getBuyableAmount(
                ws.exchangeCode || exchangeCode,
                ws.stockCode,
                price.currentPrice,
              );
              buyableAmount = buyable.foreignCurrencyAvailable;
            } catch (e) {
              this.logger.warn(`Failed to get buyable amount for ${ws.stockCode}: ${e.message}`);
            }

            // 오늘 이미 실행 여부
            const today = new Date().toISOString().slice(0, 10);
            const existing = await this.prisma.strategyExecution.findUnique({
              where: {
                market_stockCode_strategyName_executedDate: {
                  market: Market.OVERSEAS,
                  stockCode: ws.stockCode,
                  strategyName: 'infinite-buy',
                  executedDate: today,
                },
              },
            });

            const watchStockConfig: WatchStockConfig = {
              id: ws.id,
              market: 'OVERSEAS',
              exchangeCode: ws.exchangeCode || exchangeCode,
              stockCode: ws.stockCode,
              stockName: ws.stockName,
              strategyName: ws.strategyName || undefined,
              quota: ws.quota ? Number(ws.quota) : undefined,
              cycle: ws.cycle,
              maxCycles: ws.maxCycles,
              stopLossRate: Number(ws.stopLossRate),
              maxPortfolioRate: Number(ws.maxPortfolioRate),
            };

            contexts.push({
              watchStock: watchStockConfig,
              price,
              position: pos
                ? {
                    stockCode: pos.stockCode,
                    quantity: pos.quantity,
                    avgPrice: Number(pos.avgPrice),
                    currentPrice: Number(pos.currentPrice),
                    totalInvested: Number(pos.totalInvested),
                  }
                : undefined,
              alreadyExecutedToday: !!existing,
              marketCondition,
              stockIndicators,
              buyableAmount,
              totalPortfolioValue,
            });
          } catch (e) {
            this.logger.error(`Error building context for ${ws.stockCode}: ${e.message}`);
          }
        }

        if (contexts.length > 0) {
          await this.tradingService.executePerStockStrategy(this.infiniteBuyStrategy, contexts);
        }
      }

      // Send daily summary via Slack
      if (this.slackService?.isEnabled() && this.slackCommandsService) {
        try {
          const summary = await this.slackCommandsService.buildDailySummary();
          if (lastMarketCondition) summary.marketCondition = lastMarketCondition;
          await this.slackService.sendDailySummary(summary);
        } catch (e) {
          this.logger.warn(`Failed to send overseas daily summary to Slack: ${e.message}`);
        }
      }

      this.logger.log('=== Infinite Buy Overseas: Done ===');
    } catch (e) {
      this.logger.error(`Infinite buy overseas error: ${e.message}`);
    }
  }

  private async executeInfiniteBuyDomestic(): Promise<void> {
    this.logger.log('=== Infinite Buy Domestic: Cron triggered ===');

    try {
      // 휴장일 체크
      if (await this.isHoliday('DOMESTIC')) {
        this.logger.log('Domestic market holiday, skipping');
        return;
      }

      // 미체결 주문 정리
      await this.cancelUnfilledOrders('DOMESTIC');

      const watchStocks = await this.prisma.watchStock.findMany({
        where: { market: Market.DOMESTIC, isActive: true, strategyName: 'infinite-buy' },
      });

      if (watchStocks.length === 0) {
        this.logger.log('No domestic infinite-buy watch stocks');
        return;
      }

      // 잔고 동기화
      const balance = await this.kisDomestic.getBalance();
      await this.tradingService.syncPositions('DOMESTIC', balance);

      const positions = await this.prisma.position.findMany({
        where: { market: Market.DOMESTIC },
      });

      const totalPortfolioValue = positions.reduce(
        (sum, p) => sum + Number(p.quantity) * Number(p.currentPrice),
        0,
      );

      // 시장 상황
      const marketCondition = await this.marketAnalysis.getMarketCondition('KRX');

      // 매수 가능 금액 (국내는 전체 계좌)
      let cashAvailable = 0;
      try {
        const buyable = await this.kisDomestic.getBuyableAmount();
        cashAvailable = buyable.cashAvailable;
      } catch (e) {
        this.logger.warn(`Failed to get domestic buyable amount: ${e.message}`);
      }

      const contexts: StockStrategyContext[] = [];
      const today = new Date().toISOString().slice(0, 10);

      for (const ws of watchStocks) {
        try {
          const price = await this.kisDomestic.getPrice(ws.stockCode);
          const pos = positions.find((p) => p.stockCode === ws.stockCode);

          const stockIndicators = await this.marketAnalysis.getStockIndicators(
            'DOMESTIC',
            'KRX',
            ws.stockCode,
            price.currentPrice,
          );

          const existing = await this.prisma.strategyExecution.findUnique({
            where: {
              market_stockCode_strategyName_executedDate: {
                market: Market.DOMESTIC,
                stockCode: ws.stockCode,
                strategyName: 'infinite-buy',
                executedDate: today,
              },
            },
          });

          const watchStockConfig: WatchStockConfig = {
            id: ws.id,
            market: 'DOMESTIC',
            exchangeCode: 'KRX',
            stockCode: ws.stockCode,
            stockName: ws.stockName,
            strategyName: ws.strategyName || undefined,
            quota: ws.quota ? Number(ws.quota) : undefined,
            cycle: ws.cycle,
            maxCycles: ws.maxCycles,
            stopLossRate: Number(ws.stopLossRate),
            maxPortfolioRate: Number(ws.maxPortfolioRate),
          };

          contexts.push({
            watchStock: watchStockConfig,
            price,
            position: pos
              ? {
                  stockCode: pos.stockCode,
                  quantity: pos.quantity,
                  avgPrice: Number(pos.avgPrice),
                  currentPrice: Number(pos.currentPrice),
                  totalInvested: Number(pos.totalInvested),
                }
              : undefined,
            alreadyExecutedToday: !!existing,
            marketCondition,
            stockIndicators,
            buyableAmount: cashAvailable,
            totalPortfolioValue,
          });
        } catch (e) {
          this.logger.error(`Error building context for ${ws.stockCode}: ${e.message}`);
        }
      }

      if (contexts.length > 0) {
        await this.tradingService.executePerStockStrategy(this.infiniteBuyStrategy, contexts);
      }

      // Send daily summary via Slack
      if (this.slackService?.isEnabled() && this.slackCommandsService) {
        try {
          const summary = await this.slackCommandsService.buildDailySummary();
          summary.marketCondition = marketCondition;
          await this.slackService.sendDailySummary(summary);
        } catch (e) {
          this.logger.warn(`Failed to send domestic daily summary to Slack: ${e.message}`);
        }
      }

      this.logger.log('=== Infinite Buy Domestic: Done ===');
    } catch (e) {
      this.logger.error(`Infinite buy domestic error: ${e.message}`);
    }
  }

  // --- 미체결 주문 정리 (개선 F) ---

  private async cancelUnfilledOrders(marketType: 'DOMESTIC' | 'OVERSEAS'): Promise<void> {
    try {
      if (marketType === 'OVERSEAS') {
        const orders = await this.kisOverseas.getUnfilledOrders();
        for (const order of orders) {
          this.logger.log(`Cancelling overseas unfilled order: ${order.stockCode} #${order.orderNo}`);
          await this.kisOverseas.cancelOrder(
            order.exchangeCode || 'NASD',
            order.orderNo,
            order.stockCode,
            order.quantity,
            order.price,
          );
        }
        if (orders.length > 0) {
          this.logger.log(`Cancelled ${orders.length} overseas unfilled orders`);
        }
      } else {
        const orders = await this.kisDomestic.getUnfilledOrders();
        for (const order of orders) {
          this.logger.log(`Cancelling domestic unfilled order: ${order.stockCode} #${order.orderNo}`);
          await this.kisDomestic.cancelOrder(order.orderNo, order.stockCode, order.quantity);
        }
        if (orders.length > 0) {
          this.logger.log(`Cancelled ${orders.length} domestic unfilled orders`);
        }
      }
    } catch (e) {
      this.logger.error(`Failed to cancel unfilled orders (${marketType}): ${e.message}`);
    }
  }

  // --- 휴장일 체크 ---

  private async isHoliday(marketType: 'DOMESTIC' | 'OVERSEAS'): Promise<boolean> {
    // 모의투자에서는 휴장일 API 미지원 → 주말만 체크
    const now = new Date();
    const day = now.getDay();
    if (day === 0 || day === 6) return true;

    if (this.isPaper) return false;

    const todayStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    await this.ensureHolidayCache(todayStr);

    if (!this.holidayCache) return false;

    if (marketType === 'DOMESTIC') {
      const holiday = this.holidayCache.domestic.find((h) => h.date === todayStr);
      return holiday ? !holiday.isOpen : false;
    } else {
      const holiday = this.holidayCache.overseas.find((h) => h.date === todayStr);
      return holiday ? !holiday.isOpen : false;
    }
  }

  private async ensureHolidayCache(todayStr: string): Promise<void> {
    if (this.holidayCache?.date === todayStr) return;

    try {
      const [domestic, overseas] = await Promise.all([
        this.kisDomestic.getHolidays(todayStr),
        this.kisOverseas.getOverseasHolidays(todayStr),
      ]);
      this.holidayCache = { date: todayStr, domestic, overseas };
    } catch (e) {
      this.logger.warn(`Failed to fetch holidays: ${e.message}`);
    }
  }

  // --- 기존 유틸 ---

  isMarketOpen(exchangeCode: string): boolean {
    const hours = MARKET_HOURS[exchangeCode];
    if (!hours) return false;

    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const day = kst.getUTCDay();

    if (!hours.overnight && (day === 0 || day === 6)) return false;

    if (hours.overnight) {
      if (day === 0) return false;
      if (day === 6) {
        const currentMin = kst.getUTCHours() * 60 + kst.getUTCMinutes();
        const closeMin = hours.close.hour * 60 + hours.close.minute;
        return currentMin < closeMin;
      }
    }

    return this.isWithinHours(kst, hours);
  }

  private isWithinHours(kst: Date, hours: MarketHours): boolean {
    const currentMin = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    const openMin = hours.open.hour * 60 + hours.open.minute;
    const closeMin = hours.close.hour * 60 + hours.close.minute;

    if (hours.overnight) {
      return currentMin >= openMin || currentMin < closeMin;
    }

    return currentMin >= openMin && currentMin < closeMin;
  }
}
