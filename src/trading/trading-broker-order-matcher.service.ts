import { Injectable, Logger } from '@nestjs/common';
import { Market } from '@prisma/client';
import { BrokerPortRegistry } from '../broker/broker-port.registry';
import { BrokerOrderStatus } from '../kis/types/kis-api.types';
import { TradingBrokerContextService } from './trading-broker-context.service';
import { BrokerOrderMatchRequest } from './types/broker-order-match-request.type';
import { BrokerOrderRecoveryCandidate } from './types/broker-order-recovery-candidate.type';

const TEN_MINUTES_MS = 10 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

@Injectable()
export class TradingBrokerOrderMatcherService {
  private readonly logger = new Logger(TradingBrokerOrderMatcherService.name);

  constructor(
    private readonly brokerContextService: TradingBrokerContextService,
    private readonly registry: BrokerPortRegistry,
  ) {}

  async findSubmissionCandidates(
    request: BrokerOrderMatchRequest,
  ): Promise<BrokerOrderRecoveryCandidate[]> {
    this.assertCurrentContext(request);

    const submittedAt = request.submissionStartedAt;
    if (!(submittedAt instanceof Date) || Number.isNaN(submittedAt.getTime())) {
      throw new Error(
        `[RECOVERY ${request.tradeRecordId}] A valid submission timestamp is required`,
      );
    }

    const windowStart = new Date(submittedAt.getTime() - TEN_MINUTES_MS);
    const windowEnd = new Date(submittedAt.getTime() + TEN_MINUTES_MS);
    const startDate = this.formatKstDate(windowStart);
    const endDate = this.formatKstDate(windowEnd);

    let orders: BrokerOrderStatus[];
    try {
      orders = await this.registry
        .get(request.broker)
        .getOrderExecutions(request.market, startDate, endDate);
    } catch (error) {
      this.logger.warn(
        `[RECOVERY ${request.tradeRecordId}] Complete KIS order-history read failed: ${this.errorMessage(error)}`,
      );
      throw error;
    }

    const candidatesByIdentity = new Map<string, BrokerOrderRecoveryCandidate>();
    for (const order of orders) {
      const candidate = this.normalizeCandidate(
        order,
        request,
        windowStart,
        windowEnd,
      );
      if (!candidate) continue;

      const identity = [
        candidate.orderDate,
        candidate.exchangeCode,
        candidate.orderNo,
      ].join('|');
      if (!candidatesByIdentity.has(identity)) {
        candidatesByIdentity.set(identity, candidate);
      }
    }

    return Array.from(candidatesByIdentity.values());
  }

  private assertCurrentContext(request: BrokerOrderMatchRequest): void {
    if (!request.brokerEnvironment || !request.brokerAccountHash?.trim()) {
      throw new Error(
        `[RECOVERY ${request.tradeRecordId}] Assign broker context before KIS lookup`,
      );
    }

    const current = this.brokerContextService.getCurrentContext();
    if (
      current.environment !== request.brokerEnvironment
      || current.accountHash !== request.brokerAccountHash
    ) {
      throw new Error(
        `[RECOVERY ${request.tradeRecordId}] Stored broker context does not match current KIS context`,
      );
    }
  }

  private normalizeCandidate(
    order: BrokerOrderStatus,
    request: BrokerOrderMatchRequest,
    windowStart: Date,
    windowEnd: Date,
  ): BrokerOrderRecoveryCandidate | undefined {
    const orderNo = order.orderNo?.trim();
    const orderDate = order.orderDate?.trim();
    const orderTime = order.orderTime?.trim();
    if (!orderNo || !orderDate || !orderTime) return undefined;

    const orderTimestamp = this.parseKstTimestamp(orderDate, orderTime);
    if (
      !orderTimestamp
      || orderTimestamp.getTime() < windowStart.getTime()
      || orderTimestamp.getTime() > windowEnd.getTime()
    ) {
      return undefined;
    }

    const expectedExchange = request.market === Market.DOMESTIC
      ? 'KRX'
      : request.exchangeCode.trim().toUpperCase();
    const orderExchange = request.market === Market.DOMESTIC
      ? 'KRX'
      : order.exchangeCode?.trim().toUpperCase();
    if (!orderExchange || orderExchange !== expectedExchange) return undefined;

    if (order.stockCode?.trim().toUpperCase() !== request.stockCode.trim().toUpperCase()) {
      return undefined;
    }
    if (order.side !== request.side || order.orderQuantity !== request.quantity) {
      return undefined;
    }

    const rejectionState = order.rejectionState === 'REJECTED'
      || order.rejectionState === 'NOT_REJECTED'
      ? order.rejectionState
      : 'UNKNOWN';

    return {
      orderNo,
      stockCode: order.stockCode.trim().toUpperCase(),
      side: order.side,
      orderQuantity: order.orderQuantity,
      filledQuantity: order.filledQuantity,
      remainingQuantity: order.remainingQuantity,
      orderPrice: order.orderPrice,
      filledPrice: order.filledPrice,
      exchangeCode: orderExchange,
      orderDate,
      orderTime,
      rejectionState,
      ...(rejectionState === 'REJECTED'
        ? { rejected: true, rejectedReason: order.rejectedReason }
        : rejectionState === 'NOT_REJECTED'
          ? { rejected: false }
          : {}),
    };
  }

  private parseKstTimestamp(orderDate: string, orderTime: string): Date | undefined {
    const dateMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(orderDate);
    const timeMatch = /^(\d{2})(\d{2})(\d{2})$/.exec(orderTime);
    if (!dateMatch || !timeMatch) return undefined;

    const [, yearText, monthText, dayText] = dateMatch;
    const [, hourText, minuteText, secondText] = timeMatch;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    if (hour > 23 || minute > 59 || second > 59) return undefined;

    const timestamp = new Date(Date.UTC(
      year,
      month - 1,
      day,
      hour - 9,
      minute,
      second,
    ));
    if (
      this.formatKstDate(timestamp) !== orderDate
      || this.formatKstTime(timestamp) !== orderTime
    ) {
      return undefined;
    }
    return timestamp;
  }

  private formatKstDate(date: Date): string {
    return new Date(date.getTime() + KST_OFFSET_MS)
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '');
  }

  private formatKstTime(date: Date): string {
    return new Date(date.getTime() + KST_OFFSET_MS)
      .toISOString()
      .slice(11, 19)
      .replace(/:/g, '');
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
