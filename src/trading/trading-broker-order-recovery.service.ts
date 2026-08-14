import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  BrokerOrderAction,
  BrokerOrderActionChannel,
  CancellationAttemptStatus,
  OrderStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SlackService } from '../notification/slack.service';
import { BrokerOrderPersistenceWarning } from '../notification/types/broker-order-persistence-warning.type';
import { BrokerOrderRecoveryItem } from './types/broker-order-recovery-item.type';
import { BrokerActionContext } from './types/broker-action-context.type';
import { BrokerOrderRecoveryRecord } from './types/broker-order-recovery-record.type';
import { TradingBrokerContextService } from './trading-broker-context.service';
import { TradingBrokerOrderMatcherService } from './trading-broker-order-matcher.service';
import { BrokerOrderCandidateInspection } from './types/broker-order-candidate-inspection.type';
import { BrokerContext } from './types/broker-context.type';
import { TradingBrokerOrderResolutionService } from './trading-broker-order-resolution.service';
import { BrokerOrderCandidateIdentityInput } from './types/broker-order-candidate-identity-input.type';
import { MatchExistingBrokerOrderInput } from './types/match-existing-broker-order-input.type';
import { TradingBrokerCancellationRecoveryService } from './trading-broker-cancellation-recovery.service';
import { BrokerContextPreview } from './types/broker-context-preview.type';
import { TradingBrokerRecoverySlackAlertService } from './trading-broker-recovery-slack-alert.service';
import { BrokerOrderStartupRecoverySummary } from './types/broker-order-startup-recovery-summary.type';

const RECOVERY_ITEM_SELECT = {
  id: true,
  broker: true,
  market: true,
  exchangeCode: true,
  stockCode: true,
  stockName: true,
  side: true,
  orderType: true,
  quantity: true,
  price: true,
  orderNo: true,
  status: true,
  submissionStartedAt: true,
  brokerOrderDate: true,
  brokerOrderTime: true,
  brokerEnvironment: true,
  brokerAccountHash: true,
  submissionResolvedAt: true,
  submissionResolvedBy: true,
  submissionResolution: true,
  cancellationStatus: true,
  cancellationStartedAt: true,
  cancellationResolvedAt: true,
  cancellationResolvedBy: true,
  cancellationMessage: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class TradingBrokerOrderRecoveryService {
  private readonly logger = new Logger(TradingBrokerOrderRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly brokerContextService: TradingBrokerContextService,
    private readonly brokerOrderMatcher: TradingBrokerOrderMatcherService,
    private readonly brokerOrderResolution: TradingBrokerOrderResolutionService,
    private readonly brokerCancellationRecovery: TradingBrokerCancellationRecoveryService,
    private readonly recoverySlackAlert: TradingBrokerRecoverySlackAlertService,
    @Optional() private readonly slackService?: SlackService,
  ) {}

  async listRecoveryItems(): Promise<BrokerOrderRecoveryItem[]> {
    const records = await this.prisma.tradeRecord.findMany({
      where: {
        OR: [
          { status: OrderStatus.SUBMISSION_UNKNOWN },
          { cancellationStatus: CancellationAttemptStatus.UNKNOWN },
        ],
      },
      orderBy: [
        { updatedAt: 'desc' },
        { id: 'desc' },
      ],
      select: RECOVERY_ITEM_SELECT,
    });

    return records.map((record) => this.toRecoveryItem(record));
  }

  getCurrentContextPreview(): BrokerContextPreview {
    const current = this.brokerContextService.getCurrentContext();
    return {
      environment: current.environment,
      maskedAccount: current.maskedAccount,
      contextToken: this.brokerContextService.createContextBindingToken(current),
    };
  }

  async assignCurrentContext(
    tradeRecordId: string,
    expectedContextToken: string,
    context: BrokerActionContext,
  ): Promise<BrokerOrderRecoveryItem> {
    const actor = context.actor?.trim();
    if (!actor) {
      throw new Error(`[RECOVERY ${tradeRecordId}] Recovery actor is required`);
    }
    const currentContext = this.brokerContextService.getCurrentContext();
    if (!this.brokerContextService.matchesContextBindingToken(
      currentContext,
      expectedContextToken,
    )) {
      throw new Error(
        `[RECOVERY ${tradeRecordId}] Broker preview context changed before assignment`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.tradeRecord.updateMany({
        where: {
          id: tradeRecordId,
          brokerEnvironment: null,
          brokerAccountHash: null,
          OR: [
            { status: OrderStatus.SUBMISSION_UNKNOWN },
            { cancellationStatus: CancellationAttemptStatus.UNKNOWN },
          ],
        },
        data: {
          brokerEnvironment: currentContext.environment,
          brokerAccountHash: currentContext.accountHash,
        },
      });
      if (claimed.count !== 1) {
        throw new Error(
          `[RECOVERY ${tradeRecordId}] Broker context assignment failed because state changed`,
        );
      }

      const record = await tx.tradeRecord.findUnique({
        where: { id: tradeRecordId },
        select: RECOVERY_ITEM_SELECT,
      });
      if (!record) {
        throw new Error(`[RECOVERY ${tradeRecordId}] Trade record disappeared after context assignment`);
      }

      await tx.brokerOrderActionAuditLog.create({
        data: {
          tradeRecordId,
          channel: context.channel,
          action: BrokerOrderAction.LEGACY_CONTEXT_ASSIGNED,
          actor,
          beforeStatus: record.status,
          afterStatus: record.status,
          details: {
            environment: currentContext.environment,
            maskedAccount: currentContext.maskedAccount,
          },
        },
      });

      return this.toRecoveryItem(record, currentContext);
    });
  }

  async inspectCandidates(
    tradeRecordId: string,
    context: BrokerActionContext,
  ): Promise<BrokerOrderCandidateInspection> {
    const actor = context.actor?.trim();
    if (!actor) {
      throw new Error(`[RECOVERY ${tradeRecordId}] Recovery actor is required`);
    }

    const record = await this.prisma.tradeRecord.findFirst({
      where: {
        id: tradeRecordId,
        status: OrderStatus.SUBMISSION_UNKNOWN,
      },
      select: RECOVERY_ITEM_SELECT,
    });
    if (!record) {
      throw new Error(
        `[RECOVERY ${tradeRecordId}] Trade record is not an unresolved submission`,
      );
    }

    const matchRequest = {
      tradeRecordId,
      broker: record.broker,
      market: record.market,
      exchangeCode: record.exchangeCode,
      stockCode: record.stockCode,
      side: record.side,
      quantity: record.quantity,
      submissionStartedAt: record.submissionStartedAt,
      brokerEnvironment: record.brokerEnvironment,
      brokerAccountHash: record.brokerAccountHash,
    };
    const matchedCandidates = await this.brokerOrderMatcher
      .findSubmissionCandidates(matchRequest);
    const currentContext = this.brokerContextService.getCurrentContext();
    if (
      record.brokerEnvironment !== currentContext.environment
      || record.brokerAccountHash !== currentContext.accountHash
    ) {
      throw new Error(
        `[RECOVERY ${tradeRecordId}] Broker context changed during candidate inspection`,
      );
    }
    const candidates = await this.brokerOrderResolution
      .annotateCandidateCollisions(matchRequest, matchedCandidates);
    const inspectedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      const stillUnknown = await tx.tradeRecord.findFirst({
        where: {
          id: tradeRecordId,
          status: OrderStatus.SUBMISSION_UNKNOWN,
          brokerEnvironment: record.brokerEnvironment,
          brokerAccountHash: record.brokerAccountHash,
        },
        select: { id: true, status: true },
      });
      if (!stillUnknown) {
        throw new Error(
          `[RECOVERY ${tradeRecordId}] Candidate inspection state changed before audit`,
        );
      }

      await tx.brokerOrderActionAuditLog.create({
        data: {
          tradeRecordId,
          channel: context.channel,
          action: BrokerOrderAction.CANDIDATES_INSPECTED,
          actor,
          beforeStatus: stillUnknown.status,
          afterStatus: stillUnknown.status,
          details: {
            candidateCount: candidates.length,
            candidates: candidates.map((candidate) => ({
              brokerOrderDate: candidate.orderDate,
              exchangeCode: candidate.exchangeCode,
              orderNo: candidate.orderNo,
              rejectionState: candidate.rejectionState,
              ...(candidate.existingTradeRecordId
                ? {
                    existingTradeRecordId: candidate.existingTradeRecordId,
                    collisionType: candidate.collisionType,
                  }
                : {}),
            })),
          },
        },
      });
    });

    return {
      recoveryItem: this.toRecoveryItem(record, currentContext),
      candidates,
      inspectedAt,
    };
  }

  async linkCandidate(
    input: BrokerOrderCandidateIdentityInput,
    context: BrokerActionContext,
  ): Promise<BrokerOrderRecoveryItem> {
    const record = await this.brokerOrderResolution.linkCandidate(input, context);
    return this.toRecoveryItem(record, this.currentContextForDisplay());
  }

  async confirmNotSubmitted(
    tradeRecordId: string,
    context: BrokerActionContext,
  ): Promise<BrokerOrderRecoveryItem> {
    const record = await this.brokerOrderResolution.confirmNotSubmitted(
      tradeRecordId,
      context,
    );
    return this.toRecoveryItem(record, this.currentContextForDisplay());
  }

  async confirmMatchesExisting(
    input: MatchExistingBrokerOrderInput,
    context: BrokerActionContext,
  ): Promise<BrokerOrderRecoveryItem> {
    const record = await this.brokerOrderResolution.confirmMatchesExisting(
      input,
      context,
    );
    return this.toRecoveryItem(record, this.currentContextForDisplay());
  }

  async inspectCancellation(
    tradeRecordId: string,
    context: BrokerActionContext,
  ): Promise<BrokerOrderRecoveryItem> {
    const record = await this.brokerCancellationRecovery.inspectCancellation(
      tradeRecordId,
      context,
    );
    return this.toRecoveryItem(record, this.currentContextForDisplay());
  }

  async confirmCancellationNotAccepted(
    tradeRecordId: string,
    context: BrokerActionContext,
  ): Promise<BrokerOrderRecoveryItem> {
    const record = await this.brokerCancellationRecovery
      .confirmCancellationNotAccepted(tradeRecordId, context);
    return this.toRecoveryItem(record, this.currentContextForDisplay());
  }

  private toRecoveryItem(
    record: BrokerOrderRecoveryRecord,
    currentContext: BrokerContext | null = null,
  ): BrokerOrderRecoveryItem {
    const brokerContextAssigned = record.brokerEnvironment !== null
      && record.brokerAccountHash !== null;
    return {
      tradeRecordId: record.id,
      lifecycle: record.cancellationStatus !== null
        ? 'CANCELLATION'
        : 'SUBMISSION',
      market: record.market,
      exchangeCode: record.exchangeCode,
      stockCode: record.stockCode,
      stockName: record.stockName,
      side: record.side,
      orderType: record.orderType,
      quantity: record.quantity,
      price: Number(record.price),
      orderNo: record.orderNo,
      status: record.status,
      submissionStartedAt: record.submissionStartedAt,
      brokerOrderDate: record.brokerOrderDate,
      brokerOrderTime: record.brokerOrderTime,
      submissionResolvedAt: record.submissionResolvedAt,
      submissionResolvedBy: record.submissionResolvedBy,
      submissionResolution: record.submissionResolution,
      cancellationStatus: record.cancellationStatus,
      cancellationStartedAt: record.cancellationStartedAt,
      cancellationResolvedAt: record.cancellationResolvedAt,
      cancellationResolvedBy: record.cancellationResolvedBy,
      cancellationMessage: record.cancellationMessage,
      brokerContextAssigned,
      currentBrokerEnvironment: currentContext?.environment ?? null,
      maskedCurrentAccount: currentContext?.maskedAccount ?? null,
      brokerContextMatchesCurrent: brokerContextAssigned && currentContext
        ? record.brokerEnvironment === currentContext.environment
          && record.brokerAccountHash === currentContext.accountHash
        : null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private currentContextForDisplay(): BrokerContext | null {
    try {
      return this.brokerContextService.getCurrentContext();
    } catch (error) {
      this.logger.debug(
        `[RECOVERY LIST] Current broker context unavailable: ${this.errorMessage(error)}`,
      );
      return null;
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async warnAcceptedOrderPersistenceFailure(
    warning: BrokerOrderPersistenceWarning,
  ): Promise<void> {
    if (!this.slackService) return;
    try {
      await this.slackService.sendBrokerOrderPersistenceWarning(warning);
    } catch {
      this.logger.warn(
        `[${warning.stockCode}] Failed to deliver accepted-order persistence warning`,
      );
    }
  }

  async claimCancellation(tradeRecordId: string): Promise<boolean> {
    const claimed = await this.prisma.tradeRecord.updateMany({
      where: {
        id: tradeRecordId,
        status: { in: [OrderStatus.PENDING, OrderStatus.PARTIAL] },
        orderNo: { not: null },
        OR: [
          { cancellationStatus: null },
          {
            cancellationStatus: {
              in: [
                CancellationAttemptStatus.REJECTED,
                CancellationAttemptStatus.RESOLVED,
              ],
            },
          },
        ],
      },
      data: {
        cancellationStatus: CancellationAttemptStatus.SUBMITTING,
        cancellationStartedAt: new Date(),
        cancellationResolvedAt: null,
        cancellationResolvedBy: null,
        cancellationMessage: null,
      },
    });
    return claimed.count > 0;
  }

  async releaseCancellationClaim(tradeRecordId: string, message: string): Promise<boolean> {
    const released = await this.prisma.tradeRecord.updateMany({
      where: {
        id: tradeRecordId,
        cancellationStatus: CancellationAttemptStatus.SUBMITTING,
      },
      data: {
        cancellationStatus: CancellationAttemptStatus.REJECTED,
        cancellationResolvedAt: new Date(),
        cancellationResolvedBy: 'system',
        cancellationMessage: this.sanitizeMessage(message),
      },
    });
    return released.count > 0;
  }

  async markCancellationAccepted(tradeRecordId: string, message: string): Promise<boolean> {
    const persisted = await this.prisma.tradeRecord.updateMany({
      where: {
        id: tradeRecordId,
        cancellationStatus: CancellationAttemptStatus.SUBMITTING,
      },
      data: {
        cancellationStatus: CancellationAttemptStatus.ACCEPTED,
        cancellationMessage: this.sanitizeMessage(message),
      },
    });
    return persisted.count > 0;
  }

  async markCancellationRejected(tradeRecordId: string, message: string): Promise<boolean> {
    const persisted = await this.prisma.tradeRecord.updateMany({
      where: {
        id: tradeRecordId,
        cancellationStatus: CancellationAttemptStatus.SUBMITTING,
      },
      data: {
        cancellationStatus: CancellationAttemptStatus.REJECTED,
        cancellationResolvedAt: new Date(),
        cancellationResolvedBy: 'system',
        cancellationMessage: this.sanitizeMessage(message),
      },
    });
    return persisted.count > 0;
  }

  async markCancellationUnknown(
    tradeRecordId: string,
    message: string,
    notifySlack = true,
  ): Promise<boolean> {
    const cancellationMessage = this.sanitizeMessage(message);

    const changed = await this.prisma.$transaction(async (tx) => {
      const persisted = await tx.tradeRecord.updateMany({
        where: {
          id: tradeRecordId,
          cancellationStatus: CancellationAttemptStatus.SUBMITTING,
        },
        data: {
          cancellationStatus: CancellationAttemptStatus.UNKNOWN,
          cancellationMessage,
        },
      });
      if (persisted.count === 0) return false;

      await tx.brokerOrderActionAuditLog.create({
        data: {
          tradeRecordId,
          channel: BrokerOrderActionChannel.SYSTEM,
          action: BrokerOrderAction.CANCELLATION_UNKNOWN,
          actor: 'system',
          details: { message: cancellationMessage },
        },
      });
      return true;
    });
    if (changed && notifySlack) {
      await this.recoverySlackAlert.notifyUnknown(tradeRecordId);
    }
    return changed;
  }

  async takeOverCancellationAttempts(): Promise<number> {
    const staleAttempts = await this.prisma.tradeRecord.findMany({
      where: { cancellationStatus: CancellationAttemptStatus.SUBMITTING },
      select: { id: true },
    });

    let takenOver = 0;
    for (const attempt of staleAttempts) {
      const changed = await this.markCancellationUnknown(
        attempt.id,
        'Cold-start takeover of unfinished cancellation',
        false,
      );
      if (changed) takenOver += 1;
    }
    return takenOver;
  }

  async takeOverSubmissionAttempts(): Promise<{ unknown: number; cancelled: number }> {
    const staleAttempts = await this.prisma.tradeRecord.findMany({
      where: { status: OrderStatus.SUBMITTING },
      select: { id: true, submissionStartedAt: true },
    });

    let unknown = 0;
    let cancelled = 0;
    for (const attempt of staleAttempts) {
      if (attempt.submissionStartedAt) {
        const changed = await this.markSubmissionUnknown(
          attempt.id,
          'Cold-start takeover of attempted order submission',
          false,
        );
        if (changed) unknown += 1;
        continue;
      }

      const changed = await this.prisma.$transaction(async (tx) => {
        const message = 'Cold-start cancelled before broker submission';
        const persisted = await tx.tradeRecord.updateMany({
          where: {
            id: attempt.id,
            status: OrderStatus.SUBMITTING,
            submissionStartedAt: null,
          },
          data: {
            status: OrderStatus.CANCELLED,
            brokerMessage: message,
          },
        });
        if (persisted.count === 0) return false;

        await tx.brokerOrderActionAuditLog.create({
          data: {
            tradeRecordId: attempt.id,
            channel: BrokerOrderActionChannel.SYSTEM,
            action: BrokerOrderAction.CONFIRMED_NOT_SUBMITTED,
            actor: 'system',
            beforeStatus: OrderStatus.SUBMITTING,
            afterStatus: OrderStatus.CANCELLED,
            details: { message },
          },
        });
        return true;
      });
      if (changed) cancelled += 1;
    }
    return { unknown, cancelled };
  }

  async takeOverStartupState(): Promise<BrokerOrderStartupRecoverySummary> {
    const submissions = await this.takeOverSubmissionAttempts();
    const cancellationUnknown = await this.takeOverCancellationAttempts();
    const unresolvedCount = await this.prisma.tradeRecord.count({
      where: {
        OR: [
          { status: OrderStatus.SUBMISSION_UNKNOWN },
          { cancellationStatus: CancellationAttemptStatus.UNKNOWN },
        ],
      },
    });
    await this.recoverySlackAlert.notifyStartupSummary(unresolvedCount);
    return {
      submissionUnknown: submissions.unknown,
      submissionCancelled: submissions.cancelled,
      cancellationUnknown,
      unresolvedCount,
    };
  }

  async markSubmissionUnknown(
    tradeRecordId: string,
    message: string,
    notifySlack = true,
  ): Promise<boolean> {
    const brokerMessage = this.sanitizeMessage(message);

    const changed = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.tradeRecord.updateMany({
        where: {
          id: tradeRecordId,
          status: OrderStatus.SUBMITTING,
          submissionStartedAt: { not: null },
        },
        data: {
          status: OrderStatus.SUBMISSION_UNKNOWN,
          brokerMessage,
        },
      });
      if (claimed.count === 0) return false;

      await tx.brokerOrderActionAuditLog.create({
        data: {
          tradeRecordId,
          channel: BrokerOrderActionChannel.SYSTEM,
          action: BrokerOrderAction.UNKNOWN_DETECTED,
          actor: 'system',
          beforeStatus: OrderStatus.SUBMITTING,
          afterStatus: OrderStatus.SUBMISSION_UNKNOWN,
          details: { message: brokerMessage },
        },
      });
      return true;
    });
    if (changed && notifySlack) {
      await this.recoverySlackAlert.notifyUnknown(tradeRecordId);
    }
    return changed;
  }

  private sanitizeMessage(message: string): string {
    const normalized = typeof message === 'string' ? message.trim() : '';
    return (normalized || 'KIS mutation outcome unknown').slice(0, 500);
  }
}
