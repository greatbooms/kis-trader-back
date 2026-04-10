import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { PrismaService } from '../prisma.service';
import {
  TradingSignal,
  PerStockTradingStrategy,
  StockStrategyContext,
  InfiniteBuyStrategyParams,
  MomentumBreakoutStrategyParams,
  GridMeanReversionStrategyParams,
  PositionQuantitySnapshot,
} from './types';
import { BalanceItem, BrokerOrderStatus, UnfilledOrder } from '../kis/types/kis-api.types';
import { Market, Side, OrderType, OrderStatus, ApprovalStatus, Prisma, WatchStockExecutionEventType } from '@prisma/client';
import { SlackService } from '../notification/slack.service';

@Injectable()
export class TradingService {
  private readonly logger = new Logger(TradingService.name);
  private readonly tradingEnabled: boolean;

  constructor(
    private kisDomestic: KisDomesticService,
    private kisOverseas: KisOverseasService,
    private prisma: PrismaService,
    private configService: ConfigService,
    @Optional() private slackService?: SlackService,
  ) {
    this.tradingEnabled = this.configService.get<boolean>('trading.enabled') ?? true;
  }

  private async logWatchStockExecution(
    ctx: StockStrategyContext | undefined,
    eventType: WatchStockExecutionEventType,
    message: string,
    details?: Record<string, any>,
    tradeRecordId?: string,
  ): Promise<void> {
    if (!ctx?.watchStock?.id) return;

    await this.prisma.watchStockExecutionLog.create({
      data: {
        watchStockId: ctx.watchStock.id,
        tradeRecordId,
        market: ctx.watchStock.market as Market,
        exchangeCode: ctx.watchStock.exchangeCode,
        stockCode: ctx.watchStock.stockCode,
        stockName: ctx.watchStock.stockName,
        strategyName: ctx.watchStock.strategyName,
        eventType,
        message,
        details,
      },
    });
  }

  private buildSkipExecutionMessage(
    strategyName: string,
    ctx: StockStrategyContext,
    skipReasons: string[],
    details?: Record<string, any>,
  ): string {
    if (skipReasons.length === 0) return '시그널 없음';

    if (
      ['infinite-buy', 'daily-dca'].includes(strategyName)
      && this.isQuotaCarryEligible(skipReasons)
      && ctx.watchStock.quota
    ) {
      const perCycleQuota = Number(ctx.watchStock.quota) / ctx.watchStock.maxCycles;
      const accumulatedQuota = Number((ctx.watchStock.strategyParams as Record<string, any> | undefined)?.accumulatedQuota || 0);
      const remainingQuota = Math.max(0, Number(ctx.watchStock.quota) - Number(ctx.position?.totalInvested || 0));
      const nextAccumulated = Math.min(accumulatedQuota + perCycleQuota, remainingQuota);
      const adjustedQuota = Number(details?.adjustedQuota || 0);
      const minimumExecutablePrice = Number(details?.minimumExecutablePrice || adjustedQuota || 0);
      const adjustments = Array.isArray(details?.quotaAdjustments)
        ? details.quotaAdjustments
          .map((item: { label?: string; multiplier?: number }) =>
            item?.label ? `${item.label}${item.multiplier ? ` (${item.multiplier}x)` : ''}` : null)
          .filter(Boolean)
          .join(', ')
        : '';

      return [
        skipReasons[0],
        `오늘 이월 ${perCycleQuota.toFixed(0)}`,
        `누적 예정 ${nextAccumulated.toFixed(0)}`,
        adjustedQuota > 0 ? `조정 할당금 ${adjustedQuota.toFixed(0)}` : null,
        minimumExecutablePrice > 0 ? `${minimumExecutablePrice.toFixed(0)} 이하에서 1주 가능` : null,
        adjustments ? `감산/가산: ${adjustments}` : null,
      ].filter(Boolean).join(' | ');
    }

    return skipReasons.join('; ');
  }

  private buildSkipExecutionDetails(
    ctx: StockStrategyContext,
    skipReasons: string[],
    details?: Record<string, any>,
  ): Record<string, any> {
    const perCycleQuota = ctx.watchStock.quota ? Number(ctx.watchStock.quota) / ctx.watchStock.maxCycles : undefined;
    const accumulatedQuota = Number((ctx.watchStock.strategyParams as Record<string, any> | undefined)?.accumulatedQuota || 0);
    const remainingQuota = ctx.watchStock.quota
      ? Math.max(0, Number(ctx.watchStock.quota) - Number(ctx.position?.totalInvested || 0))
      : undefined;

    return {
      skipReasons,
      marketCondition: ctx.marketCondition.referenceIndexName,
      referenceIndexAboveMa200: ctx.marketCondition.referenceIndexAboveMA200,
      alreadyExecutedToday: ctx.alreadyExecutedToday,
      hasPosition: !!ctx.position,
      rsi14: ctx.stockIndicators.rsi14,
      ma200: ctx.stockIndicators.ma200,
      buyableAmount: ctx.buyableAmount,
      preCashCappedQuota: details?.preCashCappedQuota,
      adjustedQuota: details?.adjustedQuota,
      minimumExecutablePrice: details?.minimumExecutablePrice,
      perCycleQuota,
      accumulatedQuota,
      remainingQuota,
      carryAmountToday: this.isQuotaCarryEligible(skipReasons) ? perCycleQuota : undefined,
      nextAccumulatedQuota: this.isQuotaCarryEligible(skipReasons) && perCycleQuota !== undefined
        ? Math.min(accumulatedQuota + perCycleQuota, remainingQuota ?? accumulatedQuota + perCycleQuota)
        : undefined,
      quotaAdjustments: details?.quotaAdjustments,
    };
  }

  private isActualCashShortageSkip(
    ctx: StockStrategyContext,
    skipReasons: string[],
    details?: Record<string, any>,
  ): boolean {
    if (!this.isQuotaCarryEligible(skipReasons)) return false;
    if (ctx.buyableAmount <= 0) return true;

    const preCashCappedQuota = Number(details?.preCashCappedQuota ?? 0);
    const adjustedQuota = Number(details?.adjustedQuota ?? 0);
    const currentPrice = Number(ctx.price.currentPrice ?? 0);

    return (
      preCashCappedQuota > 0
      && preCashCappedQuota > ctx.buyableAmount
      && adjustedQuota > 0
      && adjustedQuota < currentPrice
    );
  }

  private async notifyInsufficientFundsIfNeeded(
    ctx: StockStrategyContext,
    reason: string,
    skipReasons: string[],
    details?: Record<string, any>,
  ): Promise<void> {
    if (!this.slackService?.isEnabled()) return;
    if (!this.isActualCashShortageSkip(ctx, skipReasons, details)) return;

    const todayStart = new Date(this.getTodayDate() + 'T00:00:00+09:00');
    const todayEnd = new Date(this.getTodayDate() + 'T23:59:59+09:00');
    const alreadySent = await this.prisma.watchStockExecutionLog.findFirst({
      where: {
        watchStockId: ctx.watchStock.id,
        eventType: WatchStockExecutionEventType.SKIPPED,
        message: { contains: '실예수금 부족 알림 전송' },
        createdAt: { gte: todayStart, lte: todayEnd },
      },
    });
    if (alreadySent) return;

    const carryAmountToday = this.isQuotaCarryEligible(skipReasons) && ctx.watchStock.quota
      ? Number(ctx.watchStock.quota) / ctx.watchStock.maxCycles
      : undefined;
    const accumulatedQuota = Number((ctx.watchStock.strategyParams as Record<string, any> | undefined)?.accumulatedQuota || 0);
    const remainingQuota = ctx.watchStock.quota
      ? Math.max(0, Number(ctx.watchStock.quota) - Number(ctx.position?.totalInvested || 0))
      : undefined;
    const nextAccumulatedQuota = carryAmountToday !== undefined
      ? Math.min(accumulatedQuota + carryAmountToday, remainingQuota ?? accumulatedQuota + carryAmountToday)
      : undefined;

    await this.slackService.sendInsufficientFundsAlert({
      stockCode: ctx.watchStock.stockCode,
      stockName: ctx.watchStock.stockName,
      exchangeCode: ctx.watchStock.exchangeCode,
      market: ctx.watchStock.market,
      strategyName: ctx.watchStock.strategyName,
      reason,
      buyableAmount: ctx.buyableAmount,
      plannedAmount: details?.preCashCappedQuota,
      adjustedQuota: details?.adjustedQuota,
      currentPrice: ctx.price.currentPrice,
      minimumExecutablePrice: details?.minimumExecutablePrice,
      carryAmountToday,
      nextAccumulatedQuota,
    });

    await this.logWatchStockExecution(
      ctx,
      WatchStockExecutionEventType.SKIPPED,
      `실예수금 부족 알림 전송 | ${reason}`,
      {
        buyableAmount: ctx.buyableAmount,
        preCashCappedQuota: details?.preCashCappedQuota,
        adjustedQuota: details?.adjustedQuota,
        minimumExecutablePrice: details?.minimumExecutablePrice,
        carryAmountToday,
        nextAccumulatedQuota,
      },
    );
  }

  /** 종목별 전략 실행 */
  async executePerStockStrategy(
    strategy: PerStockTradingStrategy,
    contexts: StockStrategyContext[],
  ): Promise<void> {
    if (!this.tradingEnabled) {
      this.logger.warn(`Skipping live trading strategy execution because TRADING_ENABLED=false (${strategy.name})`);
      return;
    }

    const skipQuotaAccumulationIds = new Set<string>();
    const quotaCarryEligibleIds = new Set<string>();

    for (const ctx of contexts) {
      try {
        const { signals, skipReasons, details } = await strategy.evaluateStock(ctx);

        if (signals.length === 0) {
          if (this.isQuotaCarryEligible(skipReasons)) {
            quotaCarryEligibleIds.add(ctx.watchStock.id);
          }

          if (this.isRoutineAlreadyExecutedSkip(skipReasons)) {
            continue;
          }

          const reason = this.buildSkipExecutionMessage(strategy.name, ctx, skipReasons, details);

          await this.logWatchStockExecution(
            ctx,
            WatchStockExecutionEventType.SKIPPED,
            reason,
            this.buildSkipExecutionDetails(ctx, skipReasons, details),
          );

          // Send filter skip log to Slack
          if (this.slackService?.isEnabled()) {
            this.slackService.sendFilterLog({
              stockCode: ctx.watchStock.stockCode,
              exchangeCode: ctx.watchStock.exchangeCode,
              reason,
              details: {
                marketCondition: `${ctx.marketCondition.referenceIndexName} MA200 ${ctx.marketCondition.referenceIndexAboveMA200 ? '위' : '아래'}`,
                rsi: ctx.stockIndicators.rsi14?.toFixed(1) ?? 'N/A',
                ma200: ctx.stockIndicators.ma200?.toFixed(2) ?? 'N/A',
                position: ctx.position ? `${ctx.position.quantity}주` : '없음',
              },
            });
          }

          await this.notifyInsufficientFundsIfNeeded(ctx, reason, skipReasons, details);
          continue;
        }

        this.logger.log(
          `Strategy "${strategy.name}" generated ${signals.length} signal(s) for ${ctx.watchStock.stockCode}`,
        );

        await this.logWatchStockExecution(
          ctx,
          WatchStockExecutionEventType.SIGNAL_CREATED,
          `${signals.length}개 시그널 생성`,
          {
            signals: signals.map((signal) => ({
              side: signal.side,
              quantity: signal.quantity,
              price: signal.price,
              reason: signal.reason,
            })),
          },
        );

        for (const signal of signals) {
          await this.executeSignal(signal, strategy.name, ctx);
        }

        if (
          strategy.name === 'infinite-buy'
          && signals.some((signal) => signal.metadata?.phase === 'take-profit-2')
        ) {
          skipQuotaAccumulationIds.add(ctx.watchStock.id);
        }

        // 분할매수 전략: 매수 시그널 성공 시 누적 quota 리셋
        if (['infinite-buy', 'daily-dca'].includes(strategy.name)) {
          const hasBuySignal = signals.some((s) => s.side === 'BUY');
          if (hasBuySignal) {
            await this.resetAccumulatedQuota(ctx.watchStock.id);
          }
        }
      } catch (e) {
        await this.logWatchStockExecution(
          ctx,
          WatchStockExecutionEventType.ERROR,
          `전략 실행 오류: ${e.message}`,
          { error: e.message },
        );
        this.logger.error(
          `Error executing strategy for ${ctx.watchStock.stockCode}: ${e.message}`,
        );
      }
    }

    // 분할매수 전략: 매수 시그널 없었던 종목에 대해 quota 누적
    if (['infinite-buy', 'daily-dca'].includes(strategy.name)) {
      await this.accumulateUnusedQuotas(
        strategy.name,
        contexts,
        quotaCarryEligibleIds,
        skipQuotaAccumulationIds,
      );
    }
  }

  /** 손절 시그널 여부 판별 */
  private isStopLossSignal(signal: TradingSignal): boolean {
    return signal.side === 'SELL' && (signal.reason?.toLowerCase().includes('stop loss') ?? false);
  }

  /** 승인된 손절 주문 실행 (SlackCommandsService에서 호출) */
  async executeApprovedStopLoss(approvalId: string): Promise<void> {
    if (!this.tradingEnabled) {
      this.logger.warn(`Skipping approved stop-loss execution because TRADING_ENABLED=false (${approvalId})`);
      return;
    }

    const approval = await this.prisma.stopLossApproval.findUnique({
      where: { id: approvalId },
      include: { tradeRecord: true },
    });

    if (!approval || approval.status !== ApprovalStatus.APPROVED) {
      this.logger.warn(`Stop-loss approval ${approvalId} not found or not approved`);
      return;
    }

    const record = approval.tradeRecord;
    const signal = approval.signal as any as TradingSignal;

    try {
      let result;
      if (signal.market === 'DOMESTIC') {
        result = await this.kisDomestic.orderSell(signal.stockCode, signal.quantity, signal.price, signal.orderDivision);
      } else {
        result = await this.kisOverseas.orderSell(signal.exchangeCode!, signal.stockCode, signal.quantity, signal.price!, signal.orderDivision);
      }

      await this.prisma.tradeRecord.update({
        where: { id: record.id },
        data: {
          status: result.success ? OrderStatus.PENDING : OrderStatus.FAILED,
          orderNo: result.orderNo,
          reason: result.message,
        },
      });

      if (result.success) {
        this.logger.log(`Stop-loss order submitted (approved): SELL ${signal.stockCode} x ${signal.quantity}`);
      } else {
        this.logger.error(`Stop-loss order failed: ${result.message}`);
      }
    } catch (e) {
      await this.prisma.tradeRecord.update({
        where: { id: record.id },
        data: { status: OrderStatus.FAILED, reason: e.message },
      });
      this.logger.error(`Stop-loss execution exception: ${e.message}`);
    }
  }

  /** 주문 실행 */
  private async executeSignal(signal: TradingSignal, strategyName?: string, ctx?: StockStrategyContext): Promise<void> {
    await this.refreshMarketPositionsBeforeOrder(signal.market as 'DOMESTIC' | 'OVERSEAS');

    // OrderType 결정
    let orderType: OrderType;
    if (signal.orderDivision === '34') {
      orderType = OrderType.LOC;
    } else if (signal.price) {
      orderType = OrderType.LIMIT;
    } else {
      orderType = OrderType.MARKET;
    }

    // 손절 시그널 → 승인 요청 플로우
    if (this.isStopLossSignal(signal) && this.slackService?.isEnabled()) {
      const record = await this.prisma.tradeRecord.create({
        data: {
          market: signal.market as Market,
          exchangeCode: signal.exchangeCode,
          stockCode: signal.stockCode,
          stockName: signal.stockCode,
          side: signal.side as Side,
          orderType,
          quantity: signal.quantity,
          price: new Prisma.Decimal(signal.price || 0),
          status: OrderStatus.AWAITING_APPROVAL,
          strategyName: strategyName || 'unknown',
          reason: signal.reason,
        },
      });

      const avgPrice = ctx?.position?.avgPrice || Number(signal.price);
      const currentPrice = ctx?.price?.currentPrice || Number(signal.price);
      const lossRate = avgPrice > 0 ? (avgPrice - currentPrice) / avgPrice : 0;

      await this.logWatchStockExecution(
        ctx,
        WatchStockExecutionEventType.ORDER_AWAITING_APPROVAL,
        `손절 승인 대기: ${signal.side} ${signal.quantity}주`,
        {
          side: signal.side,
          quantity: signal.quantity,
          price: signal.price,
          reason: signal.reason,
          lossRate,
        },
        record.id,
      );

      const approval = await this.prisma.stopLossApproval.create({
        data: {
          tradeRecordId: record.id,
          market: signal.market as Market,
          exchangeCode: signal.exchangeCode,
          stockCode: signal.stockCode,
          stockName: ctx?.watchStock?.stockName || signal.stockCode,
          strategyName: strategyName,
          signal: signal as any,
          currentPrice: new Prisma.Decimal(currentPrice),
          avgPrice: new Prisma.Decimal(avgPrice),
          quantity: signal.quantity,
          lossRate: new Prisma.Decimal(lossRate),
          timeoutMinutes: 10,
        },
      });

      const msgResult = await this.slackService.sendStopLossApproval({
        approvalId: approval.id,
        tradeRecordId: record.id,
        stockCode: signal.stockCode,
        stockName: ctx?.watchStock?.stockName || signal.stockCode,
        exchangeCode: signal.exchangeCode,
        market: signal.market,
        strategyName,
        quantity: signal.quantity,
        currentPrice,
        avgPrice,
        lossRate,
        timeoutMinutes: 10,
      });

      if (msgResult) {
        await this.prisma.stopLossApproval.update({
          where: { id: approval.id },
          data: { slackMessageTs: msgResult.ts, slackChannel: msgResult.channel },
        });
      }

      this.logger.log(`Stop-loss approval requested for ${signal.stockCode} (${approval.id})`);

      // 타임아웃 스케줄: 5분 후 미응답이면 자동 스킵
      setTimeout(async () => {
        try {
          const current = await this.prisma.stopLossApproval.findUnique({ where: { id: approval.id } });
          if (current && current.status === ApprovalStatus.PENDING) {
            await this.prisma.stopLossApproval.update({
              where: { id: approval.id },
              data: { status: ApprovalStatus.EXPIRED, respondedAt: new Date() },
            });
            await this.prisma.tradeRecord.update({
              where: { id: record.id },
              data: { status: OrderStatus.CANCELLED, reason: 'Stop-loss approval timed out (auto-skipped)' },
            });
            await this.prisma.watchStockExecutionLog.create({
              data: {
                watchStockId: ctx!.watchStock.id,
                tradeRecordId: record.id,
                market: ctx!.watchStock.market as Market,
                exchangeCode: ctx!.watchStock.exchangeCode,
                stockCode: ctx!.watchStock.stockCode,
                stockName: ctx!.watchStock.stockName,
                strategyName: strategyName || 'unknown',
                eventType: WatchStockExecutionEventType.ORDER_CANCELLED,
                message: '손절 승인 시간 초과로 주문 취소',
                details: { reason: 'approval timeout' },
              },
            });

            if (current.slackMessageTs && current.slackChannel) {
              await this.slackService!.updateStopLossApprovalMessage(
                current.slackChannel, current.slackMessageTs, signal.stockCode, 'EXPIRED',
              );
            }

            this.logger.log(`Stop-loss approval expired for ${signal.stockCode} (${approval.id})`);
          }
        } catch (e) {
          this.logger.error(`Stop-loss timeout handler error: ${e.message}`);
        }
      }, 10 * 60 * 1000);

      return; // 즉시 실행하지 않음
    }

    const record = await this.prisma.tradeRecord.create({
      data: {
        market: signal.market as Market,
        exchangeCode: signal.exchangeCode,
        stockCode: signal.stockCode,
        stockName: signal.stockCode,
        side: signal.side as Side,
        orderType,
        quantity: signal.quantity,
        price: new Prisma.Decimal(signal.price || 0),
        status: OrderStatus.PENDING,
        strategyName: strategyName || 'unknown',
        reason: signal.reason,
      },
    });

    await this.logWatchStockExecution(
      ctx,
      WatchStockExecutionEventType.ORDER_SUBMITTED,
      `주문 제출: ${signal.side} ${signal.quantity}주`,
      {
        side: signal.side,
        quantity: signal.quantity,
        price: signal.price,
        reason: signal.reason,
        orderType,
        metadata: signal.metadata,
      },
      record.id,
    );

    if (strategyName === 'infinite-buy' && signal.metadata?.phase === 'take-profit-2' && ctx?.watchStock?.id) {
      await this.markInfiniteBuySecondTargetAttempted(ctx.watchStock.id);
    }

    try {
      let result;
      if (signal.market === 'DOMESTIC') {
        result =
          signal.side === 'BUY'
            ? await this.kisDomestic.orderBuy(signal.stockCode, signal.quantity, signal.price, signal.orderDivision)
            : await this.kisDomestic.orderSell(signal.stockCode, signal.quantity, signal.price, signal.orderDivision);
      } else {
        result =
          signal.side === 'BUY'
            ? await this.kisOverseas.orderBuy(signal.exchangeCode!, signal.stockCode, signal.quantity, signal.price!, signal.orderDivision)
            : await this.kisOverseas.orderSell(signal.exchangeCode!, signal.stockCode, signal.quantity, signal.price!, signal.orderDivision);
      }

      await this.prisma.tradeRecord.update({
        where: { id: record.id },
        data: {
          status: result.success ? OrderStatus.PENDING : OrderStatus.FAILED,
          orderNo: result.orderNo,
          reason: result.message,
        },
      });

      await this.logWatchStockExecution(
        ctx,
        result.success ? WatchStockExecutionEventType.ORDER_SUBMITTED : WatchStockExecutionEventType.ORDER_FAILED,
        result.success
          ? `주문 접수: ${signal.side} ${signal.quantity}주`
          : `주문 실패: ${result.message ?? '실패'}`,
        {
          side: signal.side,
          quantity: signal.quantity,
          price: signal.price,
          orderNo: result.orderNo,
          reason: signal.reason,
          brokerMessage: result.message,
        },
        record.id,
      );

      if (result.success) {
        this.logger.log(`Order submitted: ${signal.side} ${signal.stockCode} x ${signal.quantity}`);
      } else {
        this.logger.error(`Order failed: ${result.message}`);
      }
    } catch (e) {
      await this.prisma.tradeRecord.update({
        where: { id: record.id },
        data: { status: OrderStatus.FAILED, reason: e.message },
      });
      await this.logWatchStockExecution(
        ctx,
        WatchStockExecutionEventType.ORDER_FAILED,
        `주문 예외: ${e.message}`,
        {
          side: signal.side,
          quantity: signal.quantity,
          price: signal.price,
          reason: signal.reason,
          error: e.message,
        },
        record.id,
      );
      this.logger.error(`Order exception: ${e.message}`);
    }
  }

  private async refreshMarketPositionsBeforeOrder(market: 'DOMESTIC' | 'OVERSEAS'): Promise<void> {
    try {
      const balance = market === 'DOMESTIC'
        ? await this.kisDomestic.getBalance()
        : await this.kisOverseas.getBalance();
      await this.syncPositions(market, balance);
    } catch (e) {
      this.logger.warn(`Failed to refresh ${market} positions before order: ${e.message}`);
    }
  }

  /** 포지션 동기화 (DB) */
  async syncPositions(market: 'DOMESTIC' | 'OVERSEAS', items: BalanceItem[]): Promise<void> {
    for (const item of items) {
      // totalInvested = quantity × avgPrice
      const totalInvested = item.quantity * item.avgPrice;

      await this.prisma.position.upsert({
        where: {
          market_exchangeCode_stockCode: {
            market: market as Market,
            exchangeCode: item.exchangeCode ?? (market === 'DOMESTIC' ? 'KRX' : ''),
            stockCode: item.stockCode,
          },
        },
        create: {
          market: market as Market,
          exchangeCode: item.exchangeCode ?? (market === 'DOMESTIC' ? 'KRX' : ''),
          stockCode: item.stockCode,
          stockName: item.stockName,
          quantity: item.quantity,
          avgPrice: new Prisma.Decimal(item.avgPrice),
          currentPrice: new Prisma.Decimal(item.currentPrice),
          profitLoss: new Prisma.Decimal(item.profitLoss),
          profitRate: new Prisma.Decimal(item.profitRate),
          totalInvested: new Prisma.Decimal(totalInvested),
        },
        update: {
          quantity: item.quantity,
          avgPrice: new Prisma.Decimal(item.avgPrice),
          currentPrice: new Prisma.Decimal(item.currentPrice),
          profitLoss: new Prisma.Decimal(item.profitLoss),
          profitRate: new Prisma.Decimal(item.profitRate),
          stockName: item.stockName,
          exchangeCode: item.exchangeCode ?? (market === 'DOMESTIC' ? 'KRX' : ''),
          totalInvested: new Prisma.Decimal(totalInvested),
        },
      });
    }

    // 보유하지 않는 포지션 삭제
    const stockCodes = items.map((i) => i.stockCode);
    if (stockCodes.length > 0) {
      await this.prisma.position.deleteMany({
        where: {
          market: market as Market,
          stockCode: { notIn: stockCodes },
        },
      });
    }
  }

  async reconcileOpenOrders(
    market: 'DOMESTIC' | 'OVERSEAS',
    currentPositions: PositionQuantitySnapshot[],
    unfilledOrders: UnfilledOrder[],
    brokerOrders: BrokerOrderStatus[],
  ): Promise<void> {
    const openRecords = await this.prisma.tradeRecord.findMany({
      where: {
        market: market as Market,
        status: { in: [OrderStatus.PENDING, OrderStatus.PARTIAL] },
        orderNo: { not: null },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (openRecords.length === 0) return;

    const currentPositionMap = new Map<string, number>();
    for (const position of currentPositions) {
      currentPositionMap.set(
        this.getPositionKey(position.market, position.exchangeCode, position.stockCode),
        position.quantity,
      );
    }

    const brokerOrderMap = this.groupBrokerOrdersByOrderNo(brokerOrders);
    const unfilledOrderNos = new Set(unfilledOrders.map((order) => order.orderNo));
    const cancelGraceMs = 2 * 60 * 1000;
    const now = Date.now();

    for (const record of openRecords) {
      const exchangeCode = record.exchangeCode || (record.market === Market.DOMESTIC ? 'KRX' : '');
      const key = this.getPositionKey(record.market as 'DOMESTIC' | 'OVERSEAS', exchangeCode, record.stockCode);
      const currentPositionQty = currentPositionMap.get(key) || 0;
      const executedQty = record.executedQty || 0;
      const brokerOrder = record.orderNo ? brokerOrderMap.get(record.orderNo) : undefined;

      if (brokerOrder) {
        const totalExecutedQty = Math.min(record.quantity, brokerOrder.filledQuantity);
        const filledNowQty = Math.max(0, totalExecutedQty - executedQty);
        const nextStatus = this.getBrokerOrderStatus(record.quantity, totalExecutedQty, brokerOrder);
        const nextExecutedPrice = brokerOrder.filledPrice ?? record.executedPrice ?? record.price;
        const nextReason = this.buildBrokerOrderReason(record.reason, brokerOrder, nextStatus);

        if (
          filledNowQty > 0
          || nextStatus !== record.status
          || Number(record.executedPrice ?? 0) !== Number(nextExecutedPrice ?? 0)
        ) {
          await this.prisma.tradeRecord.update({
            where: { id: record.id },
            data: {
              status: nextStatus,
              executedQty: totalExecutedQty,
              executedPrice: nextExecutedPrice,
              reason: nextReason,
            },
          });

          if (filledNowQty > 0) {
            const qtyBeforeFill = record.side === Side.BUY
              ? Math.max(0, currentPositionQty - filledNowQty)
              : currentPositionQty + filledNowQty;
            await this.applyReconciledStrategyFill(record.id, nextStatus, qtyBeforeFill, filledNowQty);
          }

          await this.logReconciledOrder(record.id, nextStatus, totalExecutedQty);
        }
        continue;
      }

      if (record.orderNo && unfilledOrderNos.has(record.orderNo)) {
        continue;
      }

      if (now - new Date(record.createdAt).getTime() < cancelGraceMs) {
        continue;
      }

      if (record.status === OrderStatus.PARTIAL) {
        await this.prisma.tradeRecord.update({
          where: { id: record.id },
          data: {
            orderNo: null,
            reason: record.reason ? `${record.reason} | 잔량 미체결 종료` : '잔량 미체결 종료',
          },
        });
        await this.logReconciledOrder(record.id, OrderStatus.CANCELLED, executedQty);
        continue;
      }

      if (record.status === OrderStatus.PENDING) {
        await this.prisma.tradeRecord.update({
          where: { id: record.id },
          data: {
            status: OrderStatus.CANCELLED,
            reason: record.reason ? `${record.reason} | 미체결 종료` : '미체결 종료',
          },
        });
        await this.logReconciledOrder(record.id, OrderStatus.CANCELLED, executedQty);
      }
    }
  }

  async markOpenOrderCancelled(
    market: 'DOMESTIC' | 'OVERSEAS',
    orderNo: string,
    reason: string,
  ): Promise<void> {
    const records = await this.prisma.tradeRecord.findMany({
      where: {
        market: market as Market,
        orderNo,
        status: { in: [OrderStatus.PENDING, OrderStatus.PARTIAL] },
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const record of records) {
      const nextReason = record.reason ? `${record.reason} | ${reason}` : reason;

      if (record.status === OrderStatus.PARTIAL) {
        await this.prisma.tradeRecord.update({
          where: { id: record.id },
          data: {
            orderNo: null,
            reason: nextReason,
          },
        });
        await this.logReconciledOrder(record.id, OrderStatus.CANCELLED, record.executedQty || 0);
        continue;
      }

      await this.prisma.tradeRecord.update({
        where: { id: record.id },
        data: {
          status: OrderStatus.CANCELLED,
          reason: nextReason,
        },
      });
      await this.logReconciledOrder(record.id, OrderStatus.CANCELLED, record.executedQty || 0);
    }
  }

  // ── Quota 이월 (분할매수 전략) ──

  /** 매수 성공 시 누적 quota 리셋 */
  private async resetAccumulatedQuota(watchStockId: string): Promise<void> {
    try {
      const ws = await this.prisma.watchStock.findUnique({ where: { id: watchStockId } });
      if (!ws) return;
      const params = (ws.strategyParams as Record<string, any>) || {};
      const today = this.getTodayDate();
      await this.prisma.watchStock.update({
        where: { id: watchStockId },
        data: { strategyParams: { ...params, accumulatedQuota: 0, lastAccumulatedDate: today } },
      });
      if (params.accumulatedQuota) {
        this.logger.log(`[${ws.stockCode}] Accumulated quota reset after buy`);
      }
    } catch (e) {
      this.logger.warn(`Failed to reset accumulated quota: ${e.message}`);
    }
  }

  /** 매수 시그널이 없었던 종목에 대해 quota 누적 (1주 가격 부족 시 이월) */
  private async accumulateUnusedQuotas(
    strategyName: string,
    contexts: StockStrategyContext[],
    eligibleWatchStockIds: Set<string>,
    skipWatchStockIds: Set<string> = new Set(),
  ): Promise<void> {
    const today = this.getTodayDate();

    for (const ctx of contexts) {
      if (!eligibleWatchStockIds.has(ctx.watchStock.id)) continue;
      if (ctx.alreadyExecutedToday) continue;
      if (skipWatchStockIds.has(ctx.watchStock.id)) continue;
      if (strategyName === 'infinite-buy' && this.hasActiveInfiniteBuySecondTarget(ctx.watchStock.strategyParams)) continue;

      const ws = await this.prisma.watchStock.findUnique({ where: { id: ctx.watchStock.id } });
      if (!ws || !ws.quota) continue;

      const params = (ws.strategyParams as Record<string, any>) || {};
      if (params.lastAccumulatedDate === today) continue; // 오늘 이미 누적됨

      // 이 종목에 대해 매수 시그널이 있었는지 확인 (executeSignal에서 리셋했으면 skip)
      const updatedWs = await this.prisma.watchStock.findUnique({ where: { id: ctx.watchStock.id } });
      const updatedParams = (updatedWs?.strategyParams as Record<string, any>) || {};
      if (updatedParams.lastAccumulatedDate === today) continue; // 리셋 후 이미 처리됨

      const perCycleQuota = Number(ws.quota) / ws.maxCycles;
      if (perCycleQuota <= 0) continue;

      const remainingQuota = Math.max(0, Number(ws.quota) - Number(ctx.position?.totalInvested || 0));
      if (remainingQuota <= 0) continue;

      const newAccumulated = Math.min((updatedParams.accumulatedQuota || 0) + perCycleQuota, remainingQuota);
      await this.prisma.watchStock.update({
        where: { id: ws.id },
        data: {
          strategyParams: {
            ...updatedParams,
            accumulatedQuota: newAccumulated,
            lastAccumulatedDate: today,
          },
        },
      });
      this.logger.log(
        `[${ws.stockCode}] Accumulated quota: ${newAccumulated.toFixed(2)} (insufficient quantity only)`,
      );
    }
  }

  private isQuotaCarryEligible(skipReasons: string[]): boolean {
    return skipReasons.some((reason) => reason.startsWith('매수 수량 부족:'));
  }

  private isRoutineAlreadyExecutedSkip(skipReasons: string[]): boolean {
    return skipReasons.length > 0 && skipReasons.every((reason) => reason.startsWith('오늘 이미 실행됨'));
  }

  private getTodayDate(): string {
    return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  private getPositionKey(
    market: 'DOMESTIC' | 'OVERSEAS',
    exchangeCode: string,
    stockCode: string,
  ): string {
    return `${market}:${exchangeCode}:${stockCode}`;
  }

  private groupBrokerOrdersByOrderNo(orders: BrokerOrderStatus[]): Map<string, BrokerOrderStatus> {
    const grouped = new Map<string, BrokerOrderStatus>();

    for (const order of orders) {
      const existing = grouped.get(order.orderNo);
      if (!existing) {
        grouped.set(order.orderNo, order);
        continue;
      }

      grouped.set(order.orderNo, {
        ...existing,
        filledQuantity: Math.max(existing.filledQuantity, order.filledQuantity),
        remainingQuantity: Math.min(existing.remainingQuantity, order.remainingQuantity),
        filledPrice: order.filledPrice ?? existing.filledPrice,
        rejected: existing.rejected || order.rejected,
        rejectedReason: order.rejectedReason || existing.rejectedReason,
        orderTime: order.orderTime || existing.orderTime,
      });
    }

    return grouped;
  }

  private getBrokerOrderStatus(
    requestedQuantity: number,
    executedQuantity: number,
    brokerOrder: BrokerOrderStatus,
  ): OrderStatus {
    if (brokerOrder.rejected) return OrderStatus.FAILED;
    if (executedQuantity <= 0) return OrderStatus.PENDING;
    if (executedQuantity >= requestedQuantity || brokerOrder.remainingQuantity <= 0) {
      return OrderStatus.FILLED;
    }
    return OrderStatus.PARTIAL;
  }

  private buildBrokerOrderReason(
    existingReason: string | null | undefined,
    brokerOrder: BrokerOrderStatus,
    nextStatus: OrderStatus,
  ): string | undefined {
    const baseReason = existingReason || undefined;
    const brokerDetails = this.formatBrokerOrderDetails(brokerOrder, nextStatus);
    if (!brokerDetails) return baseReason;
    if (!baseReason) return brokerDetails;
    if (baseReason.includes(brokerDetails)) return baseReason;
    return `${baseReason} | ${brokerDetails}`;
  }

  private formatBrokerOrderDetails(
    brokerOrder: BrokerOrderStatus,
    nextStatus: OrderStatus,
  ): string | undefined {
    if (nextStatus === OrderStatus.FAILED) {
      if (brokerOrder.rejectedReason) {
        return `브로커 거부: ${brokerOrder.rejectedReason}`;
      }
      return '브로커 거부';
    }

    if (nextStatus === OrderStatus.PARTIAL) {
      const fragments = [`부분체결 ${brokerOrder.filledQuantity}/${brokerOrder.orderQuantity}주`];
      if (brokerOrder.remainingQuantity > 0) {
        fragments.push(`잔량 ${brokerOrder.remainingQuantity}주`);
      }
      if (brokerOrder.filledPrice) {
        fragments.push(`평균체결가 ${brokerOrder.filledPrice}`);
      }
      return fragments.join(', ');
    }

    if (nextStatus === OrderStatus.FILLED && brokerOrder.filledPrice) {
      return `평균체결가 ${brokerOrder.filledPrice}`;
    }

    return undefined;
  }


  private async getSubmittedSignal(tradeRecordId: string): Promise<TradingSignal | undefined> {
    const executionLog = await this.prisma.watchStockExecutionLog.findFirst({
      where: {
        tradeRecordId,
        eventType: WatchStockExecutionEventType.ORDER_SUBMITTED,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!executionLog) return undefined;

    const details = (executionLog.details as Record<string, any> | null) || {};
    if (!details.side || !details.quantity) return undefined;

    return {
      market: executionLog.market as 'DOMESTIC' | 'OVERSEAS',
      exchangeCode: executionLog.exchangeCode,
      stockCode: executionLog.stockCode,
      side: details.side as 'BUY' | 'SELL',
      quantity: Number(details.quantity),
      price: details.price !== undefined ? Number(details.price) : undefined,
      reason: details.reason || executionLog.message,
      metadata: details.metadata as Record<string, any> | undefined,
    };
  }

  private async applyReconciledStrategyFill(
    tradeRecordId: string,
    status: OrderStatus,
    currentPositionQty: number,
    filledNowQty: number,
  ): Promise<void> {
    const record = await this.prisma.tradeRecord.findUnique({
      where: { id: tradeRecordId },
    });
    if (!record?.strategyName) return;

    const watchStock = await this.prisma.watchStock.findUnique({
      where: {
        market_exchangeCode_stockCode: {
          market: record.market,
          exchangeCode: record.exchangeCode,
          stockCode: record.stockCode,
        },
      },
    });
    if (!watchStock) return;

    const signal = await this.getSubmittedSignal(tradeRecordId);
    if (!signal) return;

    if (record.side === Side.BUY && filledNowQty > 0) {
      await this.handleStrategySignalFill(
        record.strategyName,
        watchStock.id,
        {
          ...signal,
          quantity: filledNowQty,
        },
        currentPositionQty,
      );
      return;
    }

    if (record.side === Side.SELL && status === OrderStatus.FILLED) {
      await this.handleStrategySignalFill(
        record.strategyName,
        watchStock.id,
        signal,
        currentPositionQty,
      );
    }
  }

  private async logReconciledOrder(
    tradeRecordId: string,
    status: OrderStatus,
    executedQty: number,
  ): Promise<void> {
    const record = await this.prisma.tradeRecord.findUnique({
      where: { id: tradeRecordId },
    });
    if (!record) return;

    const watchStock = await this.prisma.watchStock.findUnique({
      where: {
        market_exchangeCode_stockCode: {
          market: record.market,
          exchangeCode: record.exchangeCode,
          stockCode: record.stockCode,
        },
      },
    });
    if (!watchStock) return;

    const remainingQty = Math.max(0, record.quantity - executedQty);
    const isCancelledRemainder = status === OrderStatus.CANCELLED && record.status === OrderStatus.PARTIAL && executedQty > 0;
    const eventType = status === OrderStatus.CANCELLED
      ? WatchStockExecutionEventType.ORDER_CANCELLED
      : WatchStockExecutionEventType.ORDER_FILLED;
    const message = isCancelledRemainder
      ? `주문 잔량 취소 확인: ${record.side} ${executedQty}/${record.quantity}주 체결, 잔량 ${remainingQty}주 종료`
      : status === OrderStatus.CANCELLED
        ? `주문 취소 확인: ${record.side} ${record.quantity}주`
      : status === OrderStatus.PARTIAL
        ? `주문 일부 체결 확인: ${record.side} ${executedQty}/${record.quantity}주`
        : `주문 체결 확인: ${record.side} ${record.quantity}주`;

    await this.prisma.watchStockExecutionLog.create({
      data: {
        watchStockId: watchStock.id,
        tradeRecordId: record.id,
        market: record.market,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        stockName: record.stockName,
        strategyName: record.strategyName,
        eventType,
        message,
        details: {
          status,
          orderNo: record.orderNo,
          executedQty,
          executedPrice: record.executedPrice,
          remainingQty,
          cancelledRemainder: isCancelledRemainder,
        },
      },
    });
  }

  private async updateWatchStockStrategyParams(
    watchStockId: string,
    updater: (params: Record<string, any>) => Record<string, any>,
  ): Promise<void> {
    const watchStock = await this.prisma.watchStock.findUnique({ where: { id: watchStockId } });
    if (!watchStock) return;

    const currentParams = (watchStock.strategyParams as Record<string, any>) || {};
    await this.prisma.watchStock.update({
      where: { id: watchStockId },
      data: { strategyParams: updater(currentParams) },
    });
  }

  private hasActiveInfiniteBuySecondTarget(strategyParams?: Record<string, any>): boolean {
    const plan = (strategyParams as InfiniteBuyStrategyParams | undefined)?.secondaryExitPlan;
    if (!plan || !plan.firstTargetDate || plan.secondTargetQuantity <= 0) return false;

    const today = this.getTodayDate();
    if (plan.firstTargetDate >= today) return false;
    return !plan.secondTargetAttemptedDate || plan.secondTargetAttemptedDate === today;
  }

  private async updateInfiniteBuyStrategyParams(
    watchStockId: string,
    updater: (params: InfiniteBuyStrategyParams) => InfiniteBuyStrategyParams,
  ): Promise<void> {
    await this.updateWatchStockStrategyParams(
      watchStockId,
      (params) => updater(params as InfiniteBuyStrategyParams),
    );
  }

  private async markInfiniteBuySecondTargetAttempted(watchStockId: string): Promise<void> {
    const today = this.getTodayDate();
    await this.updateInfiniteBuyStrategyParams(watchStockId, (params) => {
      if (!params.secondaryExitPlan) return params;
      return {
        ...params,
        secondaryExitPlan: {
          ...params.secondaryExitPlan,
          secondTargetAttemptedDate: today,
        },
      };
    });
  }

  private async clearInfiniteBuySecondaryExitPlan(watchStockId: string): Promise<void> {
    await this.updateInfiniteBuyStrategyParams(watchStockId, (params) => {
      const { secondaryExitPlan: _secondaryExitPlan, ...rest } = params;
      return rest;
    });
  }

  private async persistInfiniteBuySecondaryExitPlan(watchStockId: string, signal: TradingSignal): Promise<void> {
    const secondTargetPrice = Number(signal.metadata?.secondaryTargetPrice);
    const secondTargetRate = Number(signal.metadata?.secondaryTargetRate);
    const secondTargetQuantity = Number(signal.metadata?.secondaryTargetQuantity);
    if (!secondTargetPrice || !secondTargetRate || !secondTargetQuantity) return;

    const today = this.getTodayDate();
    await this.updateInfiniteBuyStrategyParams(watchStockId, (params) => ({
      ...params,
      secondaryExitPlan: {
        firstTargetDate: today,
        secondTargetPrice,
        secondTargetRate,
        secondTargetQuantity,
      },
    }));
  }

  private async handleInfiniteBuySignalFill(
    watchStockId: string,
    signal: TradingSignal,
    currentPositionQty: number,
  ): Promise<void> {
    if (signal.side === 'BUY') {
      await this.clearInfiniteBuySecondaryExitPlan(watchStockId);
      return;
    }

    if (signal.metadata?.phase === 'take-profit-1') {
      const remainingQty = Math.max(0, currentPositionQty - signal.quantity);
      if (remainingQty > 0) {
        await this.persistInfiniteBuySecondaryExitPlan(watchStockId, signal);
      } else {
        await this.clearInfiniteBuySecondaryExitPlan(watchStockId);
      }
      return;
    }

    if (
      signal.metadata?.phase === 'take-profit-2'
      || this.isStopLossSignal(signal)
      || signal.quantity >= currentPositionQty
    ) {
      await this.clearInfiniteBuySecondaryExitPlan(watchStockId);
    }
  }

  private async handleMomentumBreakoutSignalFill(
    watchStockId: string,
    signal: TradingSignal,
    currentPositionQty: number,
  ): Promise<void> {
    if (signal.side === 'BUY') {
      await this.updateWatchStockStrategyParams(watchStockId, (params) => {
        const nextParams = { ...(params as MomentumBreakoutStrategyParams) };
        nextParams.entryDate = this.getTodayDate();
        delete nextParams.halfTakeProfitDone;
        return nextParams;
      });
      return;
    }

    if (signal.metadata?.phase === 'take-profit-half') {
      const remainingQty = Math.max(0, currentPositionQty - signal.quantity);
      if (remainingQty > 0) {
        await this.updateWatchStockStrategyParams(watchStockId, (params) => ({
          ...(params as MomentumBreakoutStrategyParams),
          halfTakeProfitDone: true,
        }));
      } else {
        await this.updateWatchStockStrategyParams(watchStockId, (params) => {
          const nextParams = { ...(params as MomentumBreakoutStrategyParams) };
          delete nextParams.halfTakeProfitDone;
          delete nextParams.entryDate;
          return nextParams;
        });
      }
      return;
    }

    if (
      signal.metadata?.phase === 'take-profit-full'
      || signal.metadata?.phase === 'time-stop'
      || this.isStopLossSignal(signal)
      || signal.quantity >= currentPositionQty
    ) {
      await this.updateWatchStockStrategyParams(watchStockId, (params) => {
        const nextParams = { ...(params as MomentumBreakoutStrategyParams) };
        delete nextParams.halfTakeProfitDone;
        delete nextParams.entryDate;
        return nextParams;
      });
    }
  }

  private async handleGridMeanReversionSignalFill(
    watchStockId: string,
    signal: TradingSignal,
    currentPositionQty: number,
  ): Promise<void> {
    if (signal.side === 'BUY') {
      await this.updateWatchStockStrategyParams(watchStockId, (params) => {
        const nextParams = { ...(params as GridMeanReversionStrategyParams) };
        const gridLevel = Number(signal.metadata?.gridLevel);

        nextParams.middleTakeProfitDone = false;

        if (signal.metadata?.phase === 'grid-entry' || currentPositionQty <= 0) {
          nextParams.completedGridLevels = [];
          return nextParams;
        }

        const completedGridLevels = new Set(nextParams.completedGridLevels || []);
        if (gridLevel > 0) {
          completedGridLevels.add(gridLevel);
        }
        nextParams.completedGridLevels = Array.from(completedGridLevels).sort((a, b) => a - b);
        return nextParams;
      });
      return;
    }

    if (signal.metadata?.phase === 'take-profit-middle') {
      const remainingQty = Math.max(0, currentPositionQty - signal.quantity);
      if (remainingQty > 0) {
        await this.updateWatchStockStrategyParams(watchStockId, (params) => ({
          ...(params as GridMeanReversionStrategyParams),
          middleTakeProfitDone: true,
        }));
      } else {
        await this.updateWatchStockStrategyParams(watchStockId, (params) => {
          const nextParams = { ...(params as GridMeanReversionStrategyParams) };
          delete nextParams.middleTakeProfitDone;
          delete nextParams.completedGridLevels;
          return nextParams;
        });
      }
      return;
    }

    if (
      signal.metadata?.phase === 'take-profit-full'
      || this.isStopLossSignal(signal)
      || signal.quantity >= currentPositionQty
    ) {
      await this.updateWatchStockStrategyParams(watchStockId, (params) => {
        const nextParams = { ...(params as GridMeanReversionStrategyParams) };
        delete nextParams.middleTakeProfitDone;
        delete nextParams.completedGridLevels;
        return nextParams;
      });
    }
  }

  private async handleStrategySignalFill(
    strategyName: string | undefined,
    watchStockId: string,
    signal: TradingSignal,
    currentPositionQty: number,
  ): Promise<void> {
    if (strategyName === 'infinite-buy') {
      await this.handleInfiniteBuySignalFill(watchStockId, signal, currentPositionQty);
      return;
    }

    if (strategyName === 'momentum-breakout') {
      await this.handleMomentumBreakoutSignalFill(watchStockId, signal, currentPositionQty);
      return;
    }

    if (strategyName === 'grid-mean-reversion') {
      await this.handleGridMeanReversionSignalFill(watchStockId, signal, currentPositionQty);
    }
  }
}
