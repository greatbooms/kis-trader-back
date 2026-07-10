import { Injectable, Logger, Optional } from '@nestjs/common';
import { ApprovalStatus, Market, OrderStatus, OrderType, Prisma, Side, WatchStockExecutionEventType } from '@prisma/client';
import { SlackService } from '../notification/slack.service';
import { PrismaService } from '../prisma.service';
import { StockStrategyContext, TradingSignal } from './types';

@Injectable()
export class TradingSellApprovalService {
  private readonly logger = new Logger(TradingSellApprovalService.name);
  private static readonly HIGH_T_SELL_APPROVAL_THRESHOLD = 20;
  private static readonly DEFAULT_SELL_APPROVAL_REMINDER_MINUTES = 30;
  private static readonly MANUAL_SELL_APPROVAL_PHASES = new Set([
    'carryover-exit',
    'eod-exit',
    'intraday-stop',
    'risk-liquidation',
    'stop-loss',
    'trailing-stop',
  ]);

  constructor(
    private prisma: PrismaService,
    @Optional() private slackService?: SlackService,
  ) {}

  shouldRequireApproval(
    signal: TradingSignal,
    strategyName?: string,
    ctx?: StockStrategyContext,
  ): boolean {
    if (signal.side !== 'SELL') return false;
    if (this.isManualSellExitSignal(signal)) return true;
    return this.isHighTInfiniteBuyTakeProfitSignal(signal, strategyName, ctx);
  }

  async requestApproval(
    signal: TradingSignal,
    strategyName: string | undefined,
    ctx: StockStrategyContext | undefined,
    orderType: OrderType,
  ): Promise<boolean> {
    const avgPrice = this.asFiniteNumber(ctx?.position?.avgPrice, signal.price, ctx?.price?.currentPrice, 0);
    const currentPrice = this.asFiniteNumber(ctx?.price?.currentPrice, signal.price, avgPrice, 0);
    const expectedPnlRate = avgPrice > 0 ? (currentPrice - avgPrice) / avgPrice : 0;
    const expectedPnl = (currentPrice - avgPrice) * signal.quantity;
    const lossRate = -expectedPnlRate;
    const reminderMinutes = this.getSellApprovalReminderMinutes(ctx);
    const stockName = ctx?.watchStock?.stockName || signal.stockCode;
    const effectiveStrategyName = strategyName || ctx?.watchStock?.strategyName || 'unknown';

    let existingApproval = await this.prisma.stopLossApproval.findFirst({
      where: {
        market: signal.market as Market,
        exchangeCode: signal.exchangeCode,
        stockCode: signal.stockCode,
        status: ApprovalStatus.PENDING,
      },
      orderBy: { requestedAt: 'desc' },
    });
    const hasExistingPendingApproval = !!existingApproval;

    let tradeRecordId = existingApproval?.tradeRecordId;
    if (existingApproval) {
      await this.prisma.tradeRecord.update({
        where: { id: existingApproval.tradeRecordId },
        data: {
          orderType,
          quantity: signal.quantity,
          price: new Prisma.Decimal(this.asFiniteNumber(signal.price, 0)),
          status: OrderStatus.AWAITING_APPROVAL,
          strategyName: effectiveStrategyName,
          reason: signal.reason,
        },
      });
      await this.prisma.stopLossApproval.update({
        where: { id: existingApproval.id },
        data: {
          signal: signal as unknown as Prisma.InputJsonValue,
          currentPrice: new Prisma.Decimal(currentPrice),
          avgPrice: new Prisma.Decimal(avgPrice),
          quantity: signal.quantity,
          lossRate: new Prisma.Decimal(lossRate),
          timeoutMinutes: reminderMinutes,
        },
      });
    } else {
      const record = await this.prisma.tradeRecord.create({
        data: {
          market: signal.market as Market,
          exchangeCode: signal.exchangeCode,
          stockCode: signal.stockCode,
          stockName,
          side: signal.side as Side,
          orderType,
          quantity: signal.quantity,
          price: new Prisma.Decimal(this.asFiniteNumber(signal.price, 0)),
          status: OrderStatus.AWAITING_APPROVAL,
          strategyName: effectiveStrategyName,
          reason: signal.reason,
        },
      });
      tradeRecordId = record.id;

      const approval = await this.prisma.stopLossApproval.create({
        data: {
          tradeRecordId,
          market: signal.market as Market,
          exchangeCode: signal.exchangeCode,
          stockCode: signal.stockCode,
          stockName,
          strategyName: effectiveStrategyName,
          signal: signal as unknown as Prisma.InputJsonValue,
          currentPrice: new Prisma.Decimal(currentPrice),
          avgPrice: new Prisma.Decimal(avgPrice),
          quantity: signal.quantity,
          lossRate: new Prisma.Decimal(lossRate),
          status: ApprovalStatus.PENDING,
          timeoutMinutes: reminderMinutes,
        },
      });
      existingApproval = approval;
    }

    const shouldSendSlackApproval =
      this.slackService?.isEnabled()
      && (!hasExistingPendingApproval || await this.shouldSendSellApprovalNotification(ctx, reminderMinutes));
    let slackApprovalSent = false;

    if (shouldSendSlackApproval && tradeRecordId) {
      const slackResult = await this.slackService!.sendStopLossApproval({
        approvalId: existingApproval.id,
        tradeRecordId,
        stockCode: signal.stockCode,
        stockName,
        exchangeCode: signal.exchangeCode,
        market: signal.market,
        strategyName: effectiveStrategyName,
        quantity: signal.quantity,
        currentPrice,
        avgPrice,
        lossRate,
        expectedPnl,
        expectedPnlRate,
        approvalReason: signal.reason,
        approvalType: this.resolveSellApprovalType(signal, strategyName, ctx),
        timeoutMinutes: reminderMinutes,
      });

      if (slackResult) {
        slackApprovalSent = true;
        await this.prisma.stopLossApproval.update({
          where: { id: existingApproval.id },
          data: {
            slackMessageTs: slackResult.ts,
            slackChannel: slackResult.channel,
          },
        });
      }
    }

    await this.logWatchStockExecution(
      ctx,
      WatchStockExecutionEventType.SKIPPED,
      slackApprovalSent ? '매도 승인 Slack 전송: 관리자 승인 대기' : '매도 승인 대기 유지: 주문 미제출',
      {
        side: signal.side,
        quantity: signal.quantity,
        price: signal.price,
        orderDivision: signal.orderDivision,
        orderType,
        reason: signal.reason,
        metadata: signal.metadata,
        approvalId: existingApproval.id,
        approvalType: this.resolveSellApprovalType(signal, strategyName, ctx),
        avgPrice,
        currentPrice,
        expectedPnl,
        expectedPnlRate,
        slackApprovalSent,
        reminderMinutes,
      },
      tradeRecordId,
    );

    this.logger.log(`Sell approval registered for ${signal.stockCode}; order not submitted`);
    return false;
  }

  async logApprovedOrderSubmission(
    record: {
      id: string;
      market: Market;
      exchangeCode: string;
      stockCode: string;
      stockName: string;
      strategyName?: string | null;
    },
    signal: TradingSignal,
  ): Promise<void> {
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

    await this.prisma.watchStockExecutionLog.create({
      data: {
        watchStockId: watchStock.id,
        tradeRecordId: record.id,
        market: record.market,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        stockName: record.stockName,
        strategyName: record.strategyName,
        eventType: WatchStockExecutionEventType.ORDER_SUBMITTED,
        message: `주문 제출: ${signal.side} ${signal.quantity}주`,
        details: {
          side: signal.side,
          quantity: signal.quantity,
          price: signal.price,
          orderDivision: signal.orderDivision,
          reason: signal.reason,
          metadata: signal.metadata,
          approvedSell: true,
        },
      },
    });
  }

  private isManualSellExitSignal(signal: TradingSignal): boolean {
    const phase = String(signal.metadata?.phase || '');
    if (TradingSellApprovalService.MANUAL_SELL_APPROVAL_PHASES.has(phase)) {
      return true;
    }

    const reason = signal.reason || '';
    const lowerReason = reason.toLowerCase();
    if (lowerReason.includes('stop loss')) {
      return true;
    }
    if (/손절|리스크\s*(전량)?청산|mdd\s*(전량)?청산|당일청산|이월청산|과열청산|트레일링/i.test(reason)) {
      return true;
    }

    return !this.isTakeProfitReason(reason);
  }

  private isStopLossSignal(signal: TradingSignal): boolean {
    return signal.side === 'SELL' && (signal.reason?.toLowerCase().includes('stop loss') ?? false);
  }

  private isHighTInfiniteBuyTakeProfitSignal(
    signal: TradingSignal,
    strategyName?: string,
    ctx?: StockStrategyContext,
  ): boolean {
    const effectiveStrategyName = strategyName || ctx?.watchStock?.strategyName;
    if (effectiveStrategyName !== 'infinite-buy') return false;

    const phase = String(signal.metadata?.phase || '');
    const isTakeProfit = phase.startsWith('take-profit') || this.isTakeProfitReason(signal.reason);
    if (!isTakeProfit) return false;

    const tValue = this.readSignalTValue(signal, ctx);
    return tValue !== undefined && tValue >= TradingSellApprovalService.HIGH_T_SELL_APPROVAL_THRESHOLD;
  }

  private readSignalTValue(signal: TradingSignal, ctx?: StockStrategyContext): number | undefined {
    const metadata = signal.metadata || {};
    const candidates = [
      metadata.tValue,
      metadata.T,
      metadata.t,
      metadata.postFillTValue,
    ];

    for (const candidate of candidates) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    const reasonMatch = signal.reason?.match(/\bT\s*=\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (reasonMatch) {
      const parsed = Number(reasonMatch[1]);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    const quota = Number(ctx?.watchStock?.quota || 0);
    const maxCycles = Number(ctx?.watchStock?.maxCycles || 0);
    const totalInvested = Number(ctx?.position?.totalInvested || 0);
    const perCycleQuota = quota > 0 && maxCycles > 0 ? quota / maxCycles : 0;
    if (perCycleQuota > 0 && totalInvested > 0) {
      return totalInvested / perCycleQuota;
    }

    return undefined;
  }

  private isTakeProfitReason(reason?: string): boolean {
    const value = reason || '';
    return value.includes('익절') || value.toLowerCase().includes('take profit');
  }

  private resolveSellApprovalType(
    signal: TradingSignal,
    strategyName?: string,
    ctx?: StockStrategyContext,
  ): 'STOP_LOSS' | 'LIQUIDATION' | 'HIGH_T_TAKE_PROFIT' {
    if (this.isHighTInfiniteBuyTakeProfitSignal(signal, strategyName, ctx)) {
      return 'HIGH_T_TAKE_PROFIT';
    }

    const reason = signal.reason || '';
    if (this.isStopLossSignal(signal) || reason.includes('손절')) {
      return 'STOP_LOSS';
    }

    return 'LIQUIDATION';
  }

  private asFiniteNumber(...values: unknown[]): number {
    for (const value of values) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return 0;
  }

  private getSellApprovalReminderMinutes(ctx?: StockStrategyContext): number {
    const params = ctx?.watchStock?.strategyParams || {};
    const configured = Number(
      params.sellApprovalReminderMinutes
      ?? params.stopLossApprovalReminderMinutes
      ?? params.stopLossApproval?.reminderMinutes,
    );
    return Number.isFinite(configured) && configured > 0
      ? configured
      : TradingSellApprovalService.DEFAULT_SELL_APPROVAL_REMINDER_MINUTES;
  }

  private async shouldSendSellApprovalNotification(
    ctx: StockStrategyContext | undefined,
    reminderMinutes: number,
  ): Promise<boolean> {
    if (!ctx?.watchStock?.id) return true;

    const since = new Date(Date.now() - reminderMinutes * 60 * 1000);
    const recentNotification = await this.prisma.watchStockExecutionLog.findFirst({
      where: {
        watchStockId: ctx.watchStock.id,
        eventType: WatchStockExecutionEventType.SKIPPED,
        message: { contains: '매도 승인 Slack 전송' },
        createdAt: { gte: since },
      },
    });

    return !recentNotification;
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
}
