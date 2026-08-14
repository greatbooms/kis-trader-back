import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApprovalStatus,
  Broker,
  Market,
  OrderStatus,
  Prisma,
  TradeRecord,
  WatchStockExecutionEventType,
} from '@prisma/client';
import { OrderResult } from '../kis/types';
import { PrismaService } from '../prisma.service';
import { TradingBrokerContextService } from './trading-broker-context.service';
import { TradingBrokerOrderRecoveryService } from './trading-broker-order-recovery.service';
import { TradingBrokerOrderSubmissionService } from './trading-broker-order-submission.service';
import { TradingLiveSwitchService } from './trading-live-switch.service';
import { TradingPositionRefreshService } from './trading-position-refresh.service';
import { TradingSellApprovalNotificationService } from './trading-sell-approval-notification.service';
import { SellApprovalWorkflowResult } from './types/sell-approval-workflow-result.type';
import { TradingSignal } from './types/trading-signal.type';

const PAIR_CLAIM_ROLLBACK = Symbol('PAIR_CLAIM_ROLLBACK');

@Injectable()
export class TradingSellApprovalWorkflowService {
  private readonly logger = new Logger(TradingSellApprovalWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderSubmission: TradingBrokerOrderSubmissionService,
    private readonly liveSwitch: TradingLiveSwitchService,
    private readonly positionRefresh: TradingPositionRefreshService,
    private readonly recoveryService: TradingBrokerOrderRecoveryService,
    private readonly brokerContext: TradingBrokerContextService,
    private readonly configService: ConfigService,
    private readonly notification: TradingSellApprovalNotificationService,
  ) {}

  async approve(approvalId: string, slackUserId: string): Promise<SellApprovalWorkflowResult> {
    const actor = this.authorizedActor(slackUserId);
    if (!actor) {
      return { approvalId, claimed: false, submitted: false, reason: 'UNAUTHORIZED' };
    }
    const result = await this.decide(approvalId, actor, 'APPROVE');

    if (!result.claimed) {
      if (result.reason === 'EXPIRED') {
        await this.notification.updateDecision(approvalId, 'EXPIRED');
      }
      return result;
    }
    const executionResult = await this.executeClaimedApproval(approvalId, result);
    await this.notification.updateApprovedOutcome(approvalId, executionResult);
    return executionResult;
  }

  async reject(approvalId: string, slackUserId: string): Promise<SellApprovalWorkflowResult> {
    const actor = this.authorizedActor(slackUserId);
    if (!actor) {
      return { approvalId, claimed: false, submitted: false, reason: 'UNAUTHORIZED' };
    }

    const result = await this.decide(approvalId, actor, 'REJECT');

    if (result.approvalStatus === ApprovalStatus.REJECTED) {
      await this.notification.updateDecision(approvalId, 'REJECTED');
    } else if (result.reason === 'EXPIRED') {
      await this.notification.updateDecision(approvalId, 'EXPIRED');
    }
    return result;
  }

  private async decide(
    approvalId: string,
    actor: string,
    action: 'APPROVE' | 'REJECT',
  ): Promise<SellApprovalWorkflowResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const approval = await tx.stopLossApproval.findUnique({
          where: { id: approvalId },
          include: { tradeRecord: true },
        });
        if (!approval) {
          return { approvalId, claimed: false, submitted: false, reason: 'NOT_FOUND' };
        }
        if (
          approval.status !== ApprovalStatus.PENDING
          || approval.tradeRecord.status !== OrderStatus.AWAITING_APPROVAL
        ) {
          return {
            approvalId,
            approvalStatus: approval.status,
            tradeRecordId: approval.tradeRecordId,
            tradeStatus: approval.tradeRecord.status,
            claimed: false,
            submitted: false,
            reason: 'ALREADY_HANDLED',
          };
        }
        if (approval.expiresAt <= now) {
          const expired = await tx.stopLossApproval.updateMany({
            where: {
              id: approvalId,
              status: ApprovalStatus.PENDING,
              expiresAt: { lte: now },
            },
            data: { status: ApprovalStatus.EXPIRED },
          });
          if (expired.count !== 1) throw PAIR_CLAIM_ROLLBACK;
          const cancelled = await tx.tradeRecord.updateMany({
            where: { id: approval.tradeRecordId, status: OrderStatus.AWAITING_APPROVAL },
            data: { status: OrderStatus.CANCELLED },
          });
          if (cancelled.count !== 1) throw PAIR_CLAIM_ROLLBACK;
          return {
            approvalId,
            approvalStatus: ApprovalStatus.EXPIRED,
            tradeRecordId: approval.tradeRecordId,
            tradeStatus: OrderStatus.CANCELLED,
            claimed: false,
            submitted: false,
            reason: 'EXPIRED',
          };
        }
        if (
          !approval.notifiedAt
          || !approval.slackMessageTs?.trim()
          || !approval.slackChannel?.trim()
        ) {
          return {
            approvalId,
            approvalStatus: approval.status,
            tradeRecordId: approval.tradeRecordId,
            tradeStatus: approval.tradeRecord.status,
            claimed: false,
            submitted: false,
            reason: 'DELIVERY_NOT_READY',
          };
        }
        if (
          action === 'APPROVE'
          && !this.matchesCurrentBrokerContext(
            approval.tradeRecord.brokerEnvironment,
            approval.tradeRecord.brokerAccountHash,
            approval.stockCode,
          )
        ) {
          return {
            approvalId,
            approvalStatus: approval.status,
            tradeRecordId: approval.tradeRecordId,
            tradeStatus: approval.tradeRecord.status,
            claimed: false,
            submitted: false,
            reason: 'BROKER_CONTEXT_MISMATCH',
          };
        }
        if (action === 'APPROVE' && !this.liveSwitch.isEnabled()) {
          return {
            approvalId,
            approvalStatus: approval.status,
            tradeRecordId: approval.tradeRecordId,
            tradeStatus: approval.tradeRecord.status,
            claimed: false,
            submitted: false,
            reason: 'TRADING_DISABLED',
          };
        }

        const isApproval = action === 'APPROVE';
        const approvalStatus = isApproval ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;
        const tradeStatus = isApproval ? OrderStatus.SUBMITTING : OrderStatus.CANCELLED;
        const approvalClaim = await tx.stopLossApproval.updateMany({
          where: {
            id: approvalId,
            status: ApprovalStatus.PENDING,
            expiresAt: { gt: now },
          },
          data: { status: approvalStatus, respondedAt: now, respondedBy: actor },
        });
        if (approvalClaim.count !== 1) throw PAIR_CLAIM_ROLLBACK;
        const tradeClaim = await tx.tradeRecord.updateMany({
          where: { id: approval.tradeRecordId, status: OrderStatus.AWAITING_APPROVAL },
          data: { status: tradeStatus },
        });
        if (tradeClaim.count !== 1) throw PAIR_CLAIM_ROLLBACK;
        return {
          approvalId,
          approvalStatus,
          tradeRecordId: approval.tradeRecordId,
          tradeStatus,
          claimed: true,
          submitted: false,
        };
      });
    } catch (error) {
      if (error !== PAIR_CLAIM_ROLLBACK) throw error;
      return this.readPersistedOutcome(approvalId);
    }
  }

  private authorizedActor(slackUserId: string): string | null {
    const actor = typeof slackUserId === 'string' ? slackUserId.trim() : '';
    const configured = this.configService.get<unknown>('slack.approverUserIds');
    if (!actor || !Array.isArray(configured)) return null;
    const authorized = configured.some(
      (value) => typeof value === 'string' && value.trim() === actor,
    );
    return authorized ? actor : null;
  }

  private async executeClaimedApproval(
    approvalId: string,
    claimedResult: SellApprovalWorkflowResult,
  ): Promise<SellApprovalWorkflowResult> {
    const approval = await this.prisma.stopLossApproval.findUnique({
      where: { id: approvalId },
      include: { tradeRecord: true },
    });
    if (
      !approval
      || approval.status !== ApprovalStatus.APPROVED
      || approval.tradeRecord.status !== OrderStatus.SUBMITTING
    ) {
      return this.readPersistedOutcome(approvalId);
    }

    if (!this.matchesCurrentBrokerContext(
      approval.tradeRecord.brokerEnvironment,
      approval.tradeRecord.brokerAccountHash,
      approval.stockCode,
    )) {
      return this.cancelForBrokerContextMismatch(
        claimedResult,
        approval.tradeRecordId,
        approval.stockCode,
      );
    }

    let holdings;
    try {
      holdings = await this.positionRefresh.refresh(approval.market);
    } catch (error) {
      const message = `Position refresh failed: ${this.errorMessage(error)}`;
      this.logger.warn(`[${approval.stockCode}] ${message}`);
      const cancelled = await this.cancelPreSubmit(approval.tradeRecordId, message);
      if (!cancelled) {
        return this.resolveStateChangedResult(
          claimedResult,
          approval.tradeRecordId,
          approval.stockCode,
          false,
        );
      }
      return {
        ...claimedResult,
        tradeStatus: OrderStatus.CANCELLED,
        reason: 'REFRESH_FAILED',
      };
    }

    const holding = holdings.find((item) => this.matchesHolding(
      approval.market,
      approval.exchangeCode,
      approval.stockCode,
      item.exchangeCode,
      item.stockCode,
    ));
    const heldQuantity = Math.floor(Number(holding?.quantity || 0));
    if (heldQuantity <= 0) {
      this.logger.warn(`[${approval.stockCode}] Approved sell cancelled: no matching holding`);
      const cancelled = await this.cancelPreSubmit(
        approval.tradeRecordId,
        'No matching broker holding',
      );
      if (!cancelled) {
        return this.resolveStateChangedResult(
          claimedResult,
          approval.tradeRecordId,
          approval.stockCode,
          false,
        );
      }
      return {
        ...claimedResult,
        tradeStatus: OrderStatus.CANCELLED,
        reason: 'NO_HOLDING',
      };
    }

    if (!this.liveSwitch.isEnabled()) {
      this.logger.warn(`[${approval.stockCode}] Approved sell cancelled: live trading disabled`);
      const cancelled = await this.cancelPreSubmit(
        approval.tradeRecordId,
        'Live trading disabled before submission',
      );
      if (!cancelled) {
        return this.resolveStateChangedResult(
          claimedResult,
          approval.tradeRecordId,
          approval.stockCode,
          false,
        );
      }
      return {
        ...claimedResult,
        tradeStatus: OrderStatus.CANCELLED,
        reason: 'TRADING_DISABLED',
      };
    }

    const quantity = Math.min(approval.tradeRecord.quantity, heldQuantity);
    const signal = {
      ...(approval.signal as unknown as TradingSignal),
      quantity,
    };
    let signalPersistence: { count: number };
    try {
      signalPersistence = await this.prisma.stopLossApproval.updateMany({
        where: {
          id: approval.id,
          tradeRecordId: approval.tradeRecordId,
          status: ApprovalStatus.APPROVED,
        },
        data: { signal: signal as unknown as Prisma.InputJsonValue },
      });
    } catch (error) {
      this.logger.warn(
        `[${approval.stockCode}] Failed to persist clamped approval signal: ${this.errorMessage(error)}`,
      );
      return this.cancelForSignalPersistenceFailure(
        claimedResult,
        approval.tradeRecordId,
        approval.stockCode,
      );
    }
    if (signalPersistence.count !== 1) {
      this.logger.warn(
        `[${approval.stockCode}] Clamped approval signal persistence CAS missed`,
      );
      return this.cancelForSignalPersistenceFailure(
        claimedResult,
        approval.tradeRecordId,
        approval.stockCode,
      );
    }

    if (!this.matchesCurrentBrokerContext(
      approval.tradeRecord.brokerEnvironment,
      approval.tradeRecord.brokerAccountHash,
      approval.stockCode,
    )) {
      return this.cancelForBrokerContextMismatch(
        claimedResult,
        approval.tradeRecordId,
        approval.stockCode,
      );
    }

    const submissionStartedAt = new Date();
    const submissionClaim = await this.prisma.tradeRecord.updateMany({
      where: {
        id: approval.tradeRecordId,
        status: OrderStatus.SUBMITTING,
        submissionStartedAt: null,
      },
      data: { quantity, submissionStartedAt },
    });
    if (submissionClaim.count !== 1) {
      return {
        ...claimedResult,
        claimed: false,
        reason: 'SUBMISSION_CLAIM_LOST',
      };
    }

    if (!this.matchesCurrentBrokerContext(
      approval.tradeRecord.brokerEnvironment,
      approval.tradeRecord.brokerAccountHash,
      approval.stockCode,
    )) {
      return this.cancelClaimedBeforePost(
        claimedResult,
        approval.tradeRecordId,
        approval.stockCode,
        submissionStartedAt,
        'Broker context changed after submission claim',
        'BROKER_CONTEXT_MISMATCH',
      );
    }
    if (!this.liveSwitch.isEnabled()) {
      return this.cancelClaimedBeforePost(
        claimedResult,
        approval.tradeRecordId,
        approval.stockCode,
        submissionStartedAt,
        'Live trading disabled after submission claim',
        'TRADING_DISABLED',
      );
    }

    await this.logApprovedOrderSubmission(approval.tradeRecord, signal, quantity);
    if (!this.liveSwitch.isEnabled()) {
      return this.cancelClaimedBeforePost(
        claimedResult,
        approval.tradeRecordId,
        approval.stockCode,
        submissionStartedAt,
        'Live trading disabled after submission claim',
        'TRADING_DISABLED',
      );
    }
    if (!this.matchesCurrentBrokerContext(
      approval.tradeRecord.brokerEnvironment,
      approval.tradeRecord.brokerAccountHash,
      approval.stockCode,
    )) {
      return this.cancelClaimedBeforePost(
        claimedResult,
        approval.tradeRecordId,
        approval.stockCode,
        submissionStartedAt,
        'Broker context changed after submission claim',
        'BROKER_CONTEXT_MISMATCH',
      );
    }

    let orderResult: OrderResult;
    try {
      orderResult = await this.orderSubmission.submit({
        ...signal,
        broker: approval.tradeRecord.broker,
        market: approval.market,
        exchangeCode: approval.exchangeCode,
        stockCode: approval.stockCode,
        side: 'SELL',
        quantity,
        price: Number(approval.tradeRecord.price),
      });
    } catch (error) {
      const message = this.errorMessage(error);
      this.logger.warn(`[${approval.stockCode}] Approved sell submission outcome unknown: ${message}`);
      const markedUnknown = await this.recoveryService.markSubmissionUnknown(
        approval.tradeRecordId,
        message,
      );
      if (!markedUnknown) {
        return this.resolveStateChangedResult(
          claimedResult,
          approval.tradeRecordId,
          approval.stockCode,
          true,
        );
      }
      return {
        ...claimedResult,
        tradeStatus: OrderStatus.SUBMISSION_UNKNOWN,
        submitted: true,
        reason: 'BROKER_UNKNOWN',
      };
    }

    if (orderResult.outcome === 'ACCEPTED' && this.hasCompleteOrderIdentity(orderResult)) {
      const persisted = await this.persistAccepted(
        approval.tradeRecordId,
        approval.market,
        approval.stockCode,
        orderResult,
      );
      return {
        ...claimedResult,
        tradeStatus: persisted ? OrderStatus.PENDING : OrderStatus.SUBMITTING,
        submitted: true,
        reason: persisted ? undefined : 'ACCEPTED_PERSISTENCE_PENDING',
      };
    }

    if (orderResult.outcome === 'REJECTED') {
      const rejected = await this.prisma.tradeRecord.updateMany({
        where: {
          id: approval.tradeRecordId,
          status: OrderStatus.SUBMITTING,
          submissionStartedAt: { not: null },
        },
        data: { status: OrderStatus.FAILED, brokerMessage: orderResult.message },
      });
      if (rejected.count !== 1) {
        return this.resolveStateChangedResult(
          claimedResult,
          approval.tradeRecordId,
          approval.stockCode,
          true,
        );
      }
      return {
        ...claimedResult,
        tradeStatus: OrderStatus.FAILED,
        submitted: true,
        reason: 'BROKER_REJECTED',
      };
    }

    const message = orderResult.outcome === 'ACCEPTED'
      ? 'Accepted broker response missing required order identity'
      : orderResult.message;
    const markedUnknown = await this.recoveryService.markSubmissionUnknown(
      approval.tradeRecordId,
      message,
    );
    if (!markedUnknown) {
      return this.resolveStateChangedResult(
        claimedResult,
        approval.tradeRecordId,
        approval.stockCode,
        true,
      );
    }
    return {
      ...claimedResult,
      tradeStatus: OrderStatus.SUBMISSION_UNKNOWN,
      submitted: true,
      reason: 'BROKER_UNKNOWN',
    };
  }

  private async resolveStateChangedResult(
    current: SellApprovalWorkflowResult,
    tradeRecordId: string,
    stockCode: string,
    submitted: boolean,
  ): Promise<SellApprovalWorkflowResult> {
    const persisted = await this.prisma.tradeRecord.findUnique({
      where: { id: tradeRecordId },
      select: { status: true },
    });
    const tradeStatus = persisted?.status ?? current.tradeStatus;
    this.logger.warn(
      `[${stockCode}] Trade state changed before workflow persistence: ${tradeStatus || 'UNKNOWN'}`,
    );
    return {
      ...current,
      tradeStatus,
      submitted,
      reason: 'STATE_CHANGED',
    };
  }

  private async persistAccepted(
    tradeRecordId: string,
    market: Market,
    stockCode: string,
    result: OrderResult,
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
        if (persisted.count === 1) return true;
        this.logger.warn(
          `[${stockCode}] Accepted order DB persistence CAS missed (${attempt}/3)`,
        );
      } catch (error) {
        this.logger.warn(
          `[${stockCode}] Accepted order DB persistence failed (${attempt}/3): ${this.errorMessage(error)}`,
        );
      }
    }
    await this.recoveryService.warnAcceptedOrderPersistenceFailure({
      market,
      stockCode,
      tradeRecordId,
      orderNo: result.orderNo || 'unknown',
    });
    return false;
  }

  private async cancelPreSubmit(tradeRecordId: string, brokerMessage: string): Promise<boolean> {
    const cancelled = await this.prisma.tradeRecord.updateMany({
      where: {
        id: tradeRecordId,
        status: OrderStatus.SUBMITTING,
        submissionStartedAt: null,
      },
      data: { status: OrderStatus.CANCELLED, brokerMessage },
    });
    return cancelled.count === 1;
  }

  private async cancelForSignalPersistenceFailure(
    current: SellApprovalWorkflowResult,
    tradeRecordId: string,
    stockCode: string,
  ): Promise<SellApprovalWorkflowResult> {
    const cancelled = await this.cancelPreSubmit(
      tradeRecordId,
      '승인 주문 수량 저장 실패로 주문 취소',
    );
    if (!cancelled) {
      return this.resolveStateChangedResult(current, tradeRecordId, stockCode, false);
    }
    return {
      ...current,
      tradeStatus: OrderStatus.CANCELLED,
      submitted: false,
      reason: 'STATE_CHANGED',
    };
  }

  private async cancelForBrokerContextMismatch(
    current: SellApprovalWorkflowResult,
    tradeRecordId: string,
    stockCode: string,
  ): Promise<SellApprovalWorkflowResult> {
    this.logger.warn(`[${stockCode}] Approved sell cancelled: broker context mismatch`);
    const cancelled = await this.cancelPreSubmit(
      tradeRecordId,
      'Broker context changed before submission',
    );
    if (!cancelled) {
      return this.resolveStateChangedResult(current, tradeRecordId, stockCode, false);
    }
    return {
      ...current,
      tradeStatus: OrderStatus.CANCELLED,
      submitted: false,
      reason: 'BROKER_CONTEXT_MISMATCH',
    };
  }

  private async cancelClaimedBeforePost(
    current: SellApprovalWorkflowResult,
    tradeRecordId: string,
    stockCode: string,
    submissionStartedAt: Date,
    brokerMessage: string,
    reason: 'BROKER_CONTEXT_MISMATCH' | 'TRADING_DISABLED',
  ): Promise<SellApprovalWorkflowResult> {
    this.logger.warn(`[${stockCode}] Approved sell cancelled: ${brokerMessage}`);
    const cancelled = await this.prisma.tradeRecord.updateMany({
      where: {
        id: tradeRecordId,
        status: OrderStatus.SUBMITTING,
        submissionStartedAt,
      },
      data: {
        status: OrderStatus.CANCELLED,
        submissionStartedAt: null,
        brokerMessage,
      },
    });
    if (cancelled.count !== 1) {
      return this.resolveStateChangedResult(current, tradeRecordId, stockCode, false);
    }
    return {
      ...current,
      tradeStatus: OrderStatus.CANCELLED,
      submitted: false,
      reason,
    };
  }

  private matchesCurrentBrokerContext(
    environment: Parameters<TradingBrokerContextService['matchesCurrentContext']>[0],
    accountHash: Parameters<TradingBrokerContextService['matchesCurrentContext']>[1],
    stockCode: string,
  ): boolean {
    try {
      return this.brokerContext.matchesCurrentContext(environment, accountHash);
    } catch {
      this.logger.warn(`[${stockCode}] Broker context validation failed`);
      return false;
    }
  }

  private matchesHolding(
    market: Market,
    exchangeCode: string,
    stockCode: string,
    holdingExchangeCode: string | undefined,
    holdingStockCode: string,
  ): boolean {
    const expectedExchange = market === Market.DOMESTIC
      ? 'KRX'
      : exchangeCode.trim().toUpperCase();
    const actualExchange = market === Market.DOMESTIC
      ? 'KRX'
      : (holdingExchangeCode || '').trim().toUpperCase();
    return expectedExchange === actualExchange
      && stockCode.trim().toUpperCase() === holdingStockCode.trim().toUpperCase();
  }

  private hasCompleteOrderIdentity(result: OrderResult): boolean {
    return [result.orderNo, result.brokerOrderDate, result.orderTime]
      .every((value) => typeof value === 'string' && value.trim().length > 0);
  }

  private async logApprovedOrderSubmission(
    record: TradeRecord,
    signal: TradingSignal,
    quantity: number,
  ): Promise<void> {
    try {
      const watchStock = await this.prisma.watchStock.findUnique({
        where: {
          broker_market_exchangeCode_stockCode: {
            broker: Broker.KIS,
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
          message: `주문 제출: ${signal.side} ${quantity}주`,
          details: {
            side: signal.side,
            quantity,
            price: signal.price,
            orderDivision: signal.orderDivision,
            reason: signal.reason,
            metadata: signal.metadata,
            approvedSell: true,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.warn(
        `[${record.stockCode}] Approved submission mirror failed: ${this.errorMessage(error)}`,
      );
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async readPersistedOutcome(approvalId: string): Promise<SellApprovalWorkflowResult> {
    const approval = await this.prisma.stopLossApproval.findUnique({
      where: { id: approvalId },
      include: { tradeRecord: true },
    });
    if (!approval) {
      return { approvalId, claimed: false, submitted: false, reason: 'NOT_FOUND' };
    }
    return {
      approvalId,
      approvalStatus: approval.status,
      tradeRecordId: approval.tradeRecordId,
      tradeStatus: approval.tradeRecord.status,
      claimed: false,
      submitted: false,
      reason: 'ALREADY_HANDLED',
    };
  }
}
