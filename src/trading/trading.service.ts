import { Injectable, Logger, Optional } from '@nestjs/common';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { PrismaService } from '../prisma.service';
import {
  TradingSignal,
  PerStockTradingStrategy,
  StockStrategyContext,
  InfiniteBuyStrategyParams,
} from './types';
import { BalanceItem } from '../kis/types/kis-api.types';
import { Market, Side, OrderType, OrderStatus, ApprovalStatus, Prisma, WatchStockExecutionEventType } from '@prisma/client';
import { SlackService } from '../notification/slack.service';
import { TradeAlertContext, FilterLogContext } from '../notification/types/notification.types';

@Injectable()
export class TradingService {
  private readonly logger = new Logger(TradingService.name);

  constructor(
    private kisDomestic: KisDomesticService,
    private kisOverseas: KisOverseasService,
    private prisma: PrismaService,
    @Optional() private slackService?: SlackService,
  ) {}

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

  /** 종목별 전략 실행 */
  async executePerStockStrategy(
    strategy: PerStockTradingStrategy,
    contexts: StockStrategyContext[],
  ): Promise<void> {
    const skipQuotaAccumulationIds = new Set<string>();

    for (const ctx of contexts) {
      try {
        const { signals, skipReasons } = await strategy.evaluateStock(ctx);

        if (signals.length === 0) {
          const reason = skipReasons.length > 0 ? skipReasons.join('; ') : '시그널 없음';

          await this.logWatchStockExecution(ctx, WatchStockExecutionEventType.SKIPPED, reason, {
            skipReasons,
            marketCondition: ctx.marketCondition.referenceIndexName,
            referenceIndexAboveMa200: ctx.marketCondition.referenceIndexAboveMA200,
            alreadyExecutedToday: ctx.alreadyExecutedToday,
            hasPosition: !!ctx.position,
            rsi14: ctx.stockIndicators.rsi14,
            ma200: ctx.stockIndicators.ma200,
          });

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
      await this.accumulateUnusedQuotas(strategy.name, contexts, skipQuotaAccumulationIds);
    }
  }

  /** 손절 시그널 여부 판별 */
  private isStopLossSignal(signal: TradingSignal): boolean {
    return signal.side === 'SELL' && (signal.reason?.toLowerCase().includes('stop loss') ?? false);
  }

  /** 승인된 손절 주문 실행 (SlackCommandsService에서 호출) */
  async executeApprovedStopLoss(approvalId: string): Promise<void> {
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
          status: result.success ? OrderStatus.FILLED : OrderStatus.FAILED,
          orderNo: result.orderNo,
        },
      });

      if (result.success) {
        this.logger.log(`Stop-loss executed (approved): SELL ${signal.stockCode} x ${signal.quantity}`);
        if (this.slackService?.isEnabled()) {
          const position = await this.prisma.position.findFirst({ where: { stockCode: signal.stockCode } });
          this.slackService.sendTradeAlert({
            signal,
            result,
            position: position ? {
              stockCode: position.stockCode, stockName: position.stockName,
              exchangeCode: position.exchangeCode, market: position.market,
              quantity: position.quantity, avgPrice: Number(position.avgPrice),
              currentPrice: Number(position.currentPrice), profitLoss: Number(position.profitLoss),
              profitRate: Number(position.profitRate), totalInvested: Number(position.totalInvested),
            } : undefined,
          });
        }
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
          status: result.success ? OrderStatus.FILLED : OrderStatus.FAILED,
          orderNo: result.orderNo,
        },
      });

      await this.logWatchStockExecution(
        ctx,
        result.success ? WatchStockExecutionEventType.ORDER_FILLED : WatchStockExecutionEventType.ORDER_FAILED,
        result.success
          ? `주문 체결: ${signal.side} ${signal.quantity}주`
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
        this.logger.log(`Order executed: ${signal.side} ${signal.stockCode} x ${signal.quantity}`);

        if (strategyName === 'infinite-buy' && ctx?.watchStock?.id) {
          await this.handleInfiniteBuySignalFill(ctx.watchStock.id, signal, ctx.position?.quantity || 0);
        }

        // Send Slack trade alert
        if (this.slackService?.isEnabled()) {
          const position = await this.prisma.position.findFirst({
            where: { stockCode: signal.stockCode },
          });

          const alertCtx: TradeAlertContext = {
            signal,
            result,
            position: position
              ? {
                  stockCode: position.stockCode,
                  stockName: position.stockName,
                  exchangeCode: position.exchangeCode,
                  market: position.market,
                  quantity: position.quantity,
                  avgPrice: Number(position.avgPrice),
                  currentPrice: Number(position.currentPrice),
                  profitLoss: Number(position.profitLoss),
                  profitRate: Number(position.profitRate),
                  totalInvested: Number(position.totalInvested),
                }
              : undefined,
          };

          if (ctx) {
            const perCycleQuota = (ctx.watchStock.quota && ctx.watchStock.maxCycles > 0)
              ? ctx.watchStock.quota / ctx.watchStock.maxCycles
              : 0;
            const T = ctx.position?.totalInvested && perCycleQuota > 0
              ? ctx.position.totalInvested / perCycleQuota
              : 0;
            alertCtx.strategyDetails = {
              tValue: T,
              maxCycles: ctx.watchStock.maxCycles,
              pivotPrice: signal.price || ctx.position?.avgPrice || 0,
              rsi: ctx.stockIndicators?.rsi14,
              ma200: ctx.stockIndicators?.ma200,
              originalQuota: ctx.watchStock.quota,
            };
          }

          this.slackService.sendTradeAlert(alertCtx);
        }
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

  // ── Quota 이월 (분할매수 전략) ──

  /** 매수 성공 시 누적 quota 리셋 */
  private async resetAccumulatedQuota(watchStockId: string): Promise<void> {
    try {
      const ws = await this.prisma.watchStock.findUnique({ where: { id: watchStockId } });
      if (!ws) return;
      const params = (ws.strategyParams as Record<string, any>) || {};
      const today = new Date().toISOString().slice(0, 10);
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
    skipWatchStockIds: Set<string> = new Set(),
  ): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);

    for (const ctx of contexts) {
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

      const newAccumulated = (updatedParams.accumulatedQuota || 0) + perCycleQuota;
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
        `[${ws.stockCode}] Accumulated quota: ${newAccumulated.toFixed(2)} (no buy signal today)`,
      );
    }
  }

  private getTodayDate(): string {
    return new Date().toISOString().slice(0, 10);
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
    const watchStock = await this.prisma.watchStock.findUnique({ where: { id: watchStockId } });
    if (!watchStock) return;

    const currentParams = ((watchStock.strategyParams as Record<string, any>) || {}) as InfiniteBuyStrategyParams;
    await this.prisma.watchStock.update({
      where: { id: watchStockId },
      data: { strategyParams: updater(currentParams) },
    });
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
}
