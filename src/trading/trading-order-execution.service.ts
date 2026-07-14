import { Injectable, Logger } from '@nestjs/common';
import {
  Market,
  OrderStatus,
  OrderType,
  Prisma,
  Side,
  WatchStockExecutionEventType,
} from '@prisma/client';
import { OrderResult } from '../kis/types';
import { PrismaService } from '../prisma.service';
import { TradingBrokerContextService } from './trading-broker-context.service';
import { TradingBrokerOrderSubmissionService } from './trading-broker-order-submission.service';
import { TradingBrokerOrderRecoveryService } from './trading-broker-order-recovery.service';
import { TradingLiveSwitchService } from './trading-live-switch.service';
import { TradingOrderGuardService } from './trading-order-guard.service';
import { TradingPositionRefreshService } from './trading-position-refresh.service';
import { BrokerContext, StockStrategyContext, TradingSignal } from './types';

@Injectable()
export class TradingOrderExecutionService {
  private readonly logger = new Logger(TradingOrderExecutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderSubmission: TradingBrokerOrderSubmissionService,
    private readonly liveSwitch: TradingLiveSwitchService,
    private readonly brokerContext: TradingBrokerContextService,
    private readonly orderGuard: TradingOrderGuardService,
    private readonly positionRefresh: TradingPositionRefreshService,
    private readonly recoveryService: TradingBrokerOrderRecoveryService,
  ) {}

  async execute(
    signal: TradingSignal,
    strategyName = 'unknown',
    ctx?: StockStrategyContext,
    details?: Record<string, unknown>,
  ): Promise<boolean> {
    if (!this.liveSwitch.isEnabled()) return false;

    const context = this.brokerContext.getCurrentContext();
    let canonicalSignal = signal;
    const record = await this.orderGuard.admit(
      {
        market: signal.market,
        exchangeCode: signal.exchangeCode,
        stockCode: signal.stockCode,
        side: signal.side,
      },
      (tx, normalizedKey = {
        market: signal.market,
        exchangeCode: signal.exchangeCode,
        stockCode: signal.stockCode,
        side: signal.side,
      }) => {
        canonicalSignal = { ...signal, ...normalizedKey };
        return tx.tradeRecord.create({
          data: {
            market: normalizedKey.market as Market,
            exchangeCode: normalizedKey.exchangeCode,
            stockCode: normalizedKey.stockCode,
            stockName: normalizedKey.stockCode,
            side: normalizedKey.side as Side,
            orderType: this.getOrderType(canonicalSignal),
            quantity: canonicalSignal.quantity,
            price: new Prisma.Decimal(canonicalSignal.price || 0),
            status: OrderStatus.SUBMITTING,
            strategyName,
            reason: canonicalSignal.reason,
            submissionStartedAt: null,
            brokerEnvironment: context.environment,
            brokerAccountHash: context.accountHash,
          },
        });
      },
    );
    if (!record) return false;
    signal = canonicalSignal;

    await this.logAdmittedOrder(record.id, signal, ctx, details);
    try {
      await this.markInfiniteBuySecondTargetAttempted(signal, strategyName, ctx);
    } catch (error) {
      this.logger.warn(
        `[${signal.stockCode}] Failed to persist second-target attempted state: ${this.errorMessage(error)}`,
      );
      await this.cancelPreSubmit(record.id, '2차 익절 시도 상태 저장 실패로 주문 취소');
      return false;
    }

    try {
      await this.positionRefresh.refresh(signal.market);
    } catch (error) {
      this.logger.warn(`[${signal.stockCode}] Position refresh failed before automatic order`);
      await this.cancelPreSubmit(record.id, '포지션 동기화 실패로 주문 취소');
      return false;
    }

    if (!this.isCurrentBrokerContext(context)) {
      await this.cancelPreSubmit(record.id, 'KIS 계좌 변경으로 주문 취소');
      return false;
    }

    if (!this.liveSwitch.isEnabled()) {
      await this.cancelPreSubmit(record.id, '실거래 비활성화로 주문 취소');
      return false;
    }

    const submissionStartedAt = new Date();
    const claim = await this.prisma.tradeRecord.updateMany({
      where: {
        id: record.id,
        status: OrderStatus.SUBMITTING,
        submissionStartedAt: null,
      },
      data: { submissionStartedAt },
    });

    if (claim.count === 0) return false;

    if (!this.isCurrentBrokerContext(context)) {
      await this.prisma.tradeRecord.updateMany({
        where: {
          id: record.id,
          status: OrderStatus.SUBMITTING,
          submissionStartedAt,
        },
        data: {
          status: OrderStatus.CANCELLED,
          submissionStartedAt: null,
          brokerMessage: 'KIS 계좌 변경으로 주문 취소',
        },
      });
      return false;
    }

    if (!this.liveSwitch.isEnabled()) {
      await this.prisma.tradeRecord.updateMany({
        where: {
          id: record.id,
          status: OrderStatus.SUBMITTING,
          submissionStartedAt,
        },
        data: {
          status: OrderStatus.CANCELLED,
          submissionStartedAt: null,
          brokerMessage: '실거래 비활성화로 주문 취소',
        },
      });
      return false;
    }

    let result: OrderResult;
    try {
      result = await this.orderSubmission.submit(signal);
    } catch (error) {
      const message = this.errorMessage(error);
      this.logger.warn(`[${signal.stockCode}] Automatic order result is unknown: ${message}`);
      await this.recoveryService.markSubmissionUnknown(record.id, message);
      await this.logOrderOutcome(record.id, signal, ctx, {
        outcome: 'UNKNOWN',
        success: false,
        message,
      });
      return false;
    }

    if (result.outcome === 'ACCEPTED' && !this.hasCompleteOrderIdentity(result)) {
      const message = 'Accepted broker response missing required order identity';
      const unknownResult: OrderResult = {
        ...result,
        outcome: 'UNKNOWN',
        success: false,
        message,
      };
      await this.recoveryService.markSubmissionUnknown(record.id, message);
      await this.logOrderOutcome(record.id, signal, ctx, unknownResult);
      return false;
    }

    if (result.outcome === 'REJECTED') {
      await this.prisma.tradeRecord.updateMany({
        where: {
          id: record.id,
          status: OrderStatus.SUBMITTING,
          submissionStartedAt: { not: null },
        },
        data: {
          status: OrderStatus.FAILED,
          brokerMessage: result.message,
        },
      });
      await this.logOrderOutcome(record.id, signal, ctx, result);
      return false;
    }

    if (result.outcome !== 'ACCEPTED') {
      await this.recoveryService.markSubmissionUnknown(record.id, result.message);
      await this.logOrderOutcome(record.id, signal, ctx, result);
      return false;
    }

    const persisted = await this.persistAccepted(record.id, result, signal.stockCode);
    if (!persisted) {
      await this.recoveryService.warnAcceptedOrderPersistenceFailure({
        market: signal.market,
        stockCode: signal.stockCode,
        tradeRecordId: record.id,
        orderNo: result.orderNo || 'unknown',
      });
    }
    await this.logOrderOutcome(record.id, signal, ctx, result);
    return true;
  }

  private getOrderType(signal: TradingSignal): OrderType {
    if (signal.orderDivision === '34') return OrderType.LOC;
    if (signal.price) return OrderType.LIMIT;
    return OrderType.MARKET;
  }

  private async logAdmittedOrder(
    tradeRecordId: string,
    signal: TradingSignal,
    ctx?: StockStrategyContext,
    details?: Record<string, unknown>,
  ): Promise<void> {
    if (!ctx?.watchStock?.id) return;

    try {
      const preCashCappedQuota = Number(details?.preCashCappedQuota || 0);
      const adjustedQuota = Number(details?.adjustedQuota || 0);
      const cashCapApplied = preCashCappedQuota > 0
        && adjustedQuota > 0
        && adjustedQuota < preCashCappedQuota;

      await this.prisma.watchStockExecutionLog.create({
        data: {
          watchStockId: ctx.watchStock.id,
          tradeRecordId,
          market: ctx.watchStock.market as Market,
          exchangeCode: ctx.watchStock.exchangeCode,
          stockCode: ctx.watchStock.stockCode,
          stockName: ctx.watchStock.stockName,
          strategyName: ctx.watchStock.strategyName,
          eventType: WatchStockExecutionEventType.ORDER_SUBMITTED,
          message: `주문 제출: ${signal.side} ${signal.quantity}주`,
          details: {
            side: signal.side,
            quantity: signal.quantity,
            price: signal.price,
            orderDivision: signal.orderDivision,
            reason: signal.reason,
            orderType: this.getOrderType(signal),
            metadata: signal.metadata,
            buyableAmount: ctx.buyableAmount,
            buyableAmountSource: ctx.buyableMeta?.source,
            buyableAmountMaxQuantity: ctx.buyableMeta?.maxQuantity,
            buyableAmountPriceUsed: ctx.buyableMeta?.priceUsed,
            ...details,
            cashCapApplied,
            cashCapDelta: cashCapApplied ? preCashCappedQuota - adjustedQuota : 0,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.warn(
        `[${signal.stockCode}] Failed to write admitted-order mirror: ${this.errorMessage(error)}`,
      );
    }
  }

  private async markInfiniteBuySecondTargetAttempted(
    signal: TradingSignal,
    strategyName: string,
    ctx?: StockStrategyContext,
  ): Promise<void> {
    if (
      strategyName !== 'infinite-buy'
      || signal.metadata?.phase !== 'take-profit-2'
      || !ctx?.watchStock?.id
    ) {
      return;
    }

    const watchStock = await this.prisma.watchStock.findUnique({
      where: { id: ctx.watchStock.id },
    });
    if (!watchStock) return;

    const strategyParams = (watchStock.strategyParams as Record<string, unknown>) || {};
    const secondaryExitPlan = strategyParams.secondaryExitPlan as Record<string, unknown> | undefined;
    if (!secondaryExitPlan) return;

    await this.prisma.watchStock.update({
      where: { id: ctx.watchStock.id },
      data: {
        strategyParams: {
          ...strategyParams,
          secondaryExitPlan: {
            ...secondaryExitPlan,
            secondTargetAttemptedDate: this.getTodayKstDate(),
          },
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async logOrderOutcome(
    tradeRecordId: string,
    signal: TradingSignal,
    ctx: StockStrategyContext | undefined,
    result: OrderResult,
  ): Promise<void> {
    if (!ctx?.watchStock?.id) return;

    const eventType = result.outcome === 'ACCEPTED'
      ? WatchStockExecutionEventType.ORDER_SUBMITTED
      : result.outcome === 'REJECTED'
        ? WatchStockExecutionEventType.ORDER_FAILED
        : WatchStockExecutionEventType.ORDER_SUBMISSION_UNKNOWN;
    const label = result.outcome === 'ACCEPTED'
      ? '주문 접수'
      : result.outcome === 'REJECTED'
        ? '주문 실패'
        : '주문 제출 결과 불명';

    try {
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
          message: `${label}: ${signal.side} ${signal.quantity}주`,
          details: {
            outcome: result.outcome,
            brokerMessage: result.message,
            orderNo: result.orderNo,
            brokerOrderDate: result.brokerOrderDate,
            orderTime: result.orderTime,
          } as Prisma.InputJsonValue,
        },
      });
    } catch {
      this.logger.warn(`[${signal.stockCode}] Failed to write broker order outcome audit`);
    }
  }

  private getTodayKstDate(): string {
    return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  private async persistAccepted(
    tradeRecordId: string,
    result: OrderResult,
    stockCode: string,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const persisted = await this.prisma.tradeRecord.updateMany({
          where: {
            id: tradeRecordId,
            status: OrderStatus.SUBMITTING,
            submissionStartedAt: { not: null },
          },
          data: {
            status: OrderStatus.PENDING,
            orderNo: result.orderNo,
            brokerOrderDate: result.brokerOrderDate,
            brokerOrderTime: result.orderTime,
            brokerMessage: result.message,
          },
        });
        return persisted.count > 0;
      } catch (error) {
        this.logger.warn(
          `[${stockCode}] Accepted order DB persistence failed (${attempt}/3, order ${result.orderNo || 'unknown'}): ${this.errorMessage(error)}`,
        );
      }
    }

    return false;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private hasCompleteOrderIdentity(result: OrderResult): boolean {
    return [result.orderNo, result.brokerOrderDate, result.orderTime]
      .every((value) => typeof value === 'string' && value.trim().length > 0);
  }

  private async cancelPreSubmit(recordId: string, brokerMessage: string): Promise<void> {
    await this.prisma.tradeRecord.updateMany({
      where: {
        id: recordId,
        status: OrderStatus.SUBMITTING,
        submissionStartedAt: null,
      },
      data: {
        status: OrderStatus.CANCELLED,
        brokerMessage,
      },
    });
  }

  private isCurrentBrokerContext(expected: BrokerContext): boolean {
    try {
      const current = this.brokerContext.getCurrentContext();
      return current.environment === expected.environment
        && current.accountHash === expected.accountHash;
    } catch (error) {
      this.logger.warn(
        `Failed to verify broker context before order submission: ${this.errorMessage(error)}`,
      );
      return false;
    }
  }
}
