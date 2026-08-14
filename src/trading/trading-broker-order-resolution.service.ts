import { Injectable, Logger } from '@nestjs/common';
import {
  BrokerOrderAction,
  OrderStatus,
  SubmissionResolution,
  WatchStockExecutionEventType,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { TradingBrokerContextService } from './trading-broker-context.service';
import { TradingBrokerOrderMatcherService } from './trading-broker-order-matcher.service';
import { BrokerActionContext } from './types/broker-action-context.type';
import { BrokerOrderCandidateIdentityInput } from './types/broker-order-candidate-identity-input.type';
import { BrokerOrderMatchRequest } from './types/broker-order-match-request.type';
import { BrokerOrderRecoveryCandidate } from './types/broker-order-recovery-candidate.type';
import { BrokerOrderRecoveryRecord } from './types/broker-order-recovery-record.type';
import { MatchExistingBrokerOrderInput } from './types/match-existing-broker-order-input.type';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class TradingBrokerOrderResolutionService {
  private readonly logger = new Logger(TradingBrokerOrderResolutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matcher: TradingBrokerOrderMatcherService,
    private readonly brokerContextService: TradingBrokerContextService,
  ) {}

  async annotateCandidateCollisions(
    request: BrokerOrderMatchRequest,
    candidates: BrokerOrderRecoveryCandidate[],
  ): Promise<BrokerOrderRecoveryCandidate[]> {
    if (candidates.length === 0) return [];
    if (!request.brokerEnvironment || !request.brokerAccountHash) {
      throw new Error(
        `[RECOVERY ${request.tradeRecordId}] Broker context is required for collision checks`,
      );
    }

    const identities = candidates.map((candidate) => ({
      brokerOrderDate: candidate.orderDate,
      exchangeCode: candidate.exchangeCode.trim().toUpperCase(),
      orderNo: candidate.orderNo.trim(),
    }));
    const exactRows = await this.prisma.tradeRecord.findMany({
      where: {
        id: { not: request.tradeRecordId },
        brokerEnvironment: request.brokerEnvironment,
        brokerAccountHash: request.brokerAccountHash,
        market: request.market,
        OR: identities,
      },
      select: {
        id: true,
        brokerOrderDate: true,
        exchangeCode: true,
        orderNo: true,
        createdAt: true,
      },
    });

    const candidateDays = candidates
      .map((candidate) => this.parseKstCalendarDay(candidate.orderDate))
      .filter((day): day is number => day !== undefined);
    const minDay = Math.min(...candidateDays) - DAY_MS;
    const maxDay = Math.max(...candidateDays) + (2 * DAY_MS);
    const legacyRows = await this.prisma.tradeRecord.findMany({
      where: {
        id: { not: request.tradeRecordId },
        market: request.market,
        createdAt: {
          gte: new Date(minDay - KST_OFFSET_MS),
          lt: new Date(maxDay - KST_OFFSET_MS),
        },
        AND: [
          {
            OR: [
              { brokerEnvironment: null },
              { brokerAccountHash: null },
              { brokerOrderDate: null },
            ],
          },
          {
            OR: identities.map(({ exchangeCode, orderNo }) => ({
              exchangeCode,
              orderNo,
            })),
          },
        ],
      },
      select: {
        id: true,
        brokerOrderDate: true,
        exchangeCode: true,
        orderNo: true,
        createdAt: true,
      },
    });

    return candidates.map((candidate) => {
      const exchangeCode = candidate.exchangeCode.trim().toUpperCase();
      const orderNo = candidate.orderNo.trim();
      const exact = exactRows.find((row) => (
        row.brokerOrderDate === candidate.orderDate
        && row.exchangeCode.trim().toUpperCase() === exchangeCode
        && row.orderNo?.trim() === orderNo
      ));
      if (exact) {
        return {
          ...candidate,
          existingTradeRecordId: exact.id,
          collisionType: 'EXACT',
        };
      }

      const candidateDay = this.parseKstCalendarDay(candidate.orderDate);
      const legacy = candidateDay === undefined
        ? undefined
        : legacyRows.find((row) => (
          row.exchangeCode.trim().toUpperCase() === exchangeCode
          && row.orderNo?.trim() === orderNo
          && Math.abs(this.kstCalendarDay(row.createdAt) - candidateDay) <= DAY_MS
        ));
      return legacy
        ? {
            ...candidate,
            existingTradeRecordId: legacy.id,
            collisionType: 'LEGACY',
          }
        : candidate;
    });
  }

  async linkCandidate(
    input: BrokerOrderCandidateIdentityInput,
    context: BrokerActionContext,
  ): Promise<BrokerOrderRecoveryRecord> {
    const identity = this.normalizeIdentity(input);
    const actor = this.requireActor(identity.tradeRecordId, context.actor);
    const record = await this.prisma.tradeRecord.findFirst({
      where: {
        id: identity.tradeRecordId,
        status: OrderStatus.SUBMISSION_UNKNOWN,
      },
    });
    if (!record) {
      throw new Error(
        `[RECOVERY ${identity.tradeRecordId}] Trade record is not an unresolved submission`,
      );
    }

    const matchRequest = this.toMatchRequest(record);
    const candidates = await this.matcher.findSubmissionCandidates(matchRequest);
    const currentContext = this.brokerContextService.getCurrentContext();
    if (
      record.brokerEnvironment !== currentContext.environment
      || record.brokerAccountHash !== currentContext.accountHash
    ) {
      throw new Error(
        `[RECOVERY ${identity.tradeRecordId}] Broker context changed during candidate link`,
      );
    }

    const annotated = await this.annotateCandidateCollisions(matchRequest, candidates);
    const selected = annotated.find((candidate) => (
      candidate.orderDate === identity.brokerOrderDate
      && candidate.exchangeCode.trim().toUpperCase() === identity.exchangeCode
      && candidate.orderNo.trim() === identity.orderNo
    ));
    if (!selected) {
      throw new Error(
        `[RECOVERY ${identity.tradeRecordId}] Selected broker order is no longer present in complete KIS history`,
      );
    }
    if (selected.existingTradeRecordId) {
      throw new Error(
        `[RECOVERY ${identity.tradeRecordId}] Broker order collides with existing TradeRecord ${selected.existingTradeRecordId}`,
      );
    }

    const resolvedAt = new Date();
    let resolvedRecord: BrokerOrderRecoveryRecord;
    try {
      resolvedRecord = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.tradeRecord.updateMany({
          where: {
            id: identity.tradeRecordId,
            status: OrderStatus.SUBMISSION_UNKNOWN,
            brokerEnvironment: record.brokerEnvironment,
            brokerAccountHash: record.brokerAccountHash,
          },
          data: {
            status: OrderStatus.PENDING,
            orderNo: selected.orderNo,
            brokerOrderDate: selected.orderDate,
            brokerOrderTime: selected.orderTime,
            submissionResolvedAt: resolvedAt,
            submissionResolvedBy: actor,
            submissionResolution: SubmissionResolution.LINKED_BROKER_ORDER,
            brokerMessage: 'Broker order linked by operator recovery',
          },
        });
        if (claimed.count !== 1) {
          throw new Error(
            `[RECOVERY ${identity.tradeRecordId}] Submission recovery state changed before link`,
          );
        }

        await tx.brokerOrderActionAuditLog.create({
          data: {
            tradeRecordId: identity.tradeRecordId,
            channel: context.channel,
            action: BrokerOrderAction.BROKER_ORDER_LINKED,
            actor,
            brokerOrderDate: selected.orderDate,
            exchangeCode: selected.exchangeCode,
            orderNo: selected.orderNo,
            beforeStatus: OrderStatus.SUBMISSION_UNKNOWN,
            afterStatus: OrderStatus.PENDING,
            details: {
              orderQuantity: selected.orderQuantity,
              filledQuantity: selected.filledQuantity,
              remainingQuantity: selected.remainingQuantity,
              rejectionState: selected.rejectionState,
            },
          },
        });

        const updated = await tx.tradeRecord.findUnique({
          where: { id: identity.tradeRecordId },
        });
        if (!updated) {
          throw new Error(
            `[RECOVERY ${identity.tradeRecordId}] Linked TradeRecord disappeared`,
          );
        }
        return updated;
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new Error(
          `[RECOVERY ${identity.tradeRecordId}] Broker order is already linked to another TradeRecord`,
        );
      }
      throw error;
    }

    await this.mirrorResolutionBestEffort(
      record,
      BrokerOrderAction.BROKER_ORDER_LINKED,
      selected,
    );
    return resolvedRecord;
  }

  async confirmNotSubmitted(
    tradeRecordId: string,
    context: BrokerActionContext,
  ): Promise<BrokerOrderRecoveryRecord> {
    const normalizedId = this.normalizeTradeRecordId(tradeRecordId);
    const actor = this.requireActor(normalizedId, context.actor);
    const record = await this.loadUnknownSubmission(normalizedId);
    const candidates = await this.matcher.findSubmissionCandidates(
      this.toMatchRequest(record),
    );
    this.assertCurrentContextUnchanged(record, 'not-submitted confirmation');
    if (candidates.length > 0) {
      throw new Error(
        `[RECOVERY ${normalizedId}] Matching broker order exists; candidate review is required`,
      );
    }

    return this.resolveSubmissionAsFailed(
      record,
      context,
      actor,
      SubmissionResolution.CONFIRMED_NOT_SUBMITTED,
    );
  }

  async confirmMatchesExisting(
    input: MatchExistingBrokerOrderInput,
    context: BrokerActionContext,
  ): Promise<BrokerOrderRecoveryRecord> {
    const identity = this.normalizeExistingMatchInput(input);
    const actor = this.requireActor(identity.tradeRecordId, context.actor);
    const record = await this.loadUnknownSubmission(identity.tradeRecordId);
    const matchRequest = this.toMatchRequest(record);
    const candidates = await this.matcher.findSubmissionCandidates(matchRequest);
    this.assertCurrentContextUnchanged(record, 'existing-record confirmation');
    const annotated = await this.annotateCandidateCollisions(matchRequest, candidates);
    const selected = annotated.find((candidate) => (
      candidate.orderDate === identity.brokerOrderDate
      && candidate.exchangeCode.trim().toUpperCase() === identity.exchangeCode
      && candidate.orderNo.trim() === identity.orderNo
    ));
    if (!selected) {
      throw new Error(
        `[RECOVERY ${identity.tradeRecordId}] Selected broker order is no longer present in complete KIS history`,
      );
    }
    if (
      selected.existingTradeRecordId !== identity.existingTradeRecordId
      || !selected.collisionType
    ) {
      throw new Error(
        `[RECOVERY ${identity.tradeRecordId}] Selected broker order does not match existing TradeRecord ${identity.existingTradeRecordId}`,
      );
    }

    return this.resolveSubmissionAsFailed(
      record,
      context,
      actor,
      SubmissionResolution.MATCHED_EXISTING_TRADE_RECORD,
      selected,
      identity.existingTradeRecordId,
    );
  }

  private toMatchRequest(record: BrokerOrderRecoveryRecord): BrokerOrderMatchRequest {
    return {
      tradeRecordId: record.id,
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
  }

  private normalizeIdentity(
    input: BrokerOrderCandidateIdentityInput,
  ): BrokerOrderCandidateIdentityInput {
    const tradeRecordId = input.tradeRecordId?.trim();
    const brokerOrderDate = input.brokerOrderDate?.trim();
    const exchangeCode = input.exchangeCode?.trim().toUpperCase();
    const orderNo = input.orderNo?.trim();
    if (!tradeRecordId || !/^\d{8}$/.test(brokerOrderDate) || !exchangeCode || !orderNo) {
      throw new Error('[RECOVERY] Invalid broker order identity');
    }
    return { tradeRecordId, brokerOrderDate, exchangeCode, orderNo };
  }

  private normalizeExistingMatchInput(
    input: MatchExistingBrokerOrderInput,
  ): MatchExistingBrokerOrderInput {
    const identity = this.normalizeIdentity(input);
    const existingTradeRecordId = input.existingTradeRecordId?.trim();
    if (!existingTradeRecordId || existingTradeRecordId === identity.tradeRecordId) {
      throw new Error('[RECOVERY] Invalid existing TradeRecord identity');
    }
    return { ...identity, existingTradeRecordId };
  }

  private normalizeTradeRecordId(tradeRecordId: string): string {
    const normalized = tradeRecordId?.trim();
    if (!normalized) {
      throw new Error('[RECOVERY] TradeRecord identity is required');
    }
    return normalized;
  }

  private async loadUnknownSubmission(
    tradeRecordId: string,
  ): Promise<BrokerOrderRecoveryRecord> {
    const record = await this.prisma.tradeRecord.findFirst({
      where: {
        id: tradeRecordId,
        status: OrderStatus.SUBMISSION_UNKNOWN,
      },
    });
    if (!record) {
      throw new Error(
        `[RECOVERY ${tradeRecordId}] Trade record is not an unresolved submission`,
      );
    }
    return record;
  }

  private assertCurrentContextUnchanged(
    record: BrokerOrderRecoveryRecord,
    operation: string,
  ): void {
    const currentContext = this.brokerContextService.getCurrentContext();
    if (
      record.brokerEnvironment !== currentContext.environment
      || record.brokerAccountHash !== currentContext.accountHash
    ) {
      throw new Error(
        `[RECOVERY ${record.id}] Broker context changed during ${operation}`,
      );
    }
  }

  private requireActor(tradeRecordId: string, actor: string): string {
    const normalized = actor?.trim();
    if (!normalized) {
      throw new Error(`[RECOVERY ${tradeRecordId}] Recovery actor is required`);
    }
    return normalized;
  }

  private async resolveSubmissionAsFailed(
    record: BrokerOrderRecoveryRecord,
    context: BrokerActionContext,
    actor: string,
    resolution: SubmissionResolution,
    candidate?: BrokerOrderRecoveryCandidate,
    existingTradeRecordId?: string,
  ): Promise<BrokerOrderRecoveryRecord> {
    const isNotSubmitted = resolution === SubmissionResolution.CONFIRMED_NOT_SUBMITTED;
    const action = isNotSubmitted
      ? BrokerOrderAction.CONFIRMED_NOT_SUBMITTED
      : BrokerOrderAction.MATCHED_EXISTING_TRADE_RECORD;
    const brokerMessage = isNotSubmitted
      ? 'Operator confirmed no matching broker order'
      : 'Operator confirmed broker order belongs to an existing TradeRecord';
    const resolvedAt = new Date();
    const resolved = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.tradeRecord.updateMany({
        where: {
          id: record.id,
          status: OrderStatus.SUBMISSION_UNKNOWN,
          brokerEnvironment: record.brokerEnvironment,
          brokerAccountHash: record.brokerAccountHash,
        },
        data: {
          status: OrderStatus.FAILED,
          submissionResolvedAt: resolvedAt,
          submissionResolvedBy: actor,
          submissionResolution: resolution,
          brokerMessage,
        },
      });
      if (claimed.count !== 1) {
        throw new Error(
          `[RECOVERY ${record.id}] Submission recovery state changed before confirmation`,
        );
      }

      await tx.brokerOrderActionAuditLog.create({
        data: {
          tradeRecordId: record.id,
          channel: context.channel,
          action,
          actor,
          ...(candidate
            ? {
                brokerOrderDate: candidate.orderDate,
                exchangeCode: candidate.exchangeCode.trim().toUpperCase(),
                orderNo: candidate.orderNo.trim(),
              }
            : {}),
          beforeStatus: OrderStatus.SUBMISSION_UNKNOWN,
          afterStatus: OrderStatus.FAILED,
          details: isNotSubmitted
            ? { candidateCount: 0 }
            : {
                existingTradeRecordId: existingTradeRecordId as string,
                collisionType: candidate?.collisionType as string,
              },
        },
      });

      const updated = await tx.tradeRecord.findUnique({ where: { id: record.id } });
      if (!updated) {
        throw new Error(`[RECOVERY ${record.id}] Resolved TradeRecord disappeared`);
      }
      return updated;
    });

    await this.mirrorResolutionBestEffort(
      record,
      action,
      candidate,
      existingTradeRecordId,
    );
    return resolved;
  }

  private async mirrorResolutionBestEffort(
    record: BrokerOrderRecoveryRecord,
    action: BrokerOrderAction,
    candidate?: BrokerOrderRecoveryCandidate,
    existingTradeRecordId?: string,
  ): Promise<void> {
    try {
      const watchStock = await this.prisma.watchStock.findFirst({
        where: {
          market: record.market,
          exchangeCode: record.exchangeCode,
          stockCode: record.stockCode,
        },
        select: { id: true, strategyName: true },
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
          strategyName: watchStock.strategyName ?? record.strategyName,
          eventType: WatchStockExecutionEventType.ORDER_RECONCILIATION,
          message: action === BrokerOrderAction.BROKER_ORDER_LINKED
            ? '불명 주문을 KIS 주문 기록에 연결'
            : action === BrokerOrderAction.CONFIRMED_NOT_SUBMITTED
              ? 'KIS 주문 이력 재조회 후 미주문으로 확정'
              : 'KIS 주문을 기존 거래 기록과 동일한 주문으로 확정',
          details: candidate
            ? {
                action,
                brokerOrderDate: candidate.orderDate,
                exchangeCode: candidate.exchangeCode.trim().toUpperCase(),
                orderNo: candidate.orderNo.trim(),
                ...(existingTradeRecordId ? { existingTradeRecordId } : {}),
              }
            : { action },
        },
      });
    } catch (error) {
      this.logger.warn(
        `[RECOVERY ${record.id}] WatchStock recovery mirror failed: ${this.errorMessage(error)}`,
      );
    }
  }

  private parseKstCalendarDay(value: string): number | undefined {
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    if (!match) return undefined;
    const day = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const normalized = new Date(day).toISOString().slice(0, 10).replace(/-/g, '');
    return normalized === value ? day : undefined;
  }

  private kstCalendarDay(value: Date): number {
    const date = new Date(value.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
    return Date.parse(`${date}T00:00:00.000Z`);
  }

  private isUniqueConflict(error: unknown): boolean {
    return typeof error === 'object'
      && error !== null
      && 'code' in error
      && (error as { code?: unknown }).code === 'P2002';
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
