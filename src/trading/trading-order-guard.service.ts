import { Injectable, Logger } from '@nestjs/common';
import { Broker, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { OrderAdmissionKey } from './types/order-admission-key.type';

const UNRESOLVED_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.AWAITING_APPROVAL,
  OrderStatus.SUBMITTING,
  OrderStatus.SUBMISSION_UNKNOWN,
  OrderStatus.PENDING,
];

@Injectable()
export class TradingOrderGuardService {
  private readonly logger = new Logger(TradingOrderGuardService.name);

  constructor(private readonly prisma: PrismaService) {}

  async admit<T>(
    key: OrderAdmissionKey,
    createWithTx: (
      tx: Prisma.TransactionClient,
      normalizedKey: OrderAdmissionKey,
    ) => Promise<T>,
  ): Promise<T | null> {
    const normalizedKey = this.normalizeKey(key);
    const canonicalKey = this.buildCanonicalKey(normalizedKey);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${canonicalKey}, 0))::text
      `;

      const unresolved = await tx.tradeRecord.findFirst({
        where: {
          ...normalizedKey,
          OR: [
            { status: { in: UNRESOLVED_ORDER_STATUSES } },
            {
              status: OrderStatus.PARTIAL,
              orderNo: { not: null },
            },
          ],
        },
      });
      if (unresolved) return null;

      return createWithTx(tx, normalizedKey);
    });
  }

  private normalizeKey(key: OrderAdmissionKey): OrderAdmissionKey {
    if (
      !key ||
      (key.broker !== Broker.KIS && key.broker !== Broker.TOSS) ||
      (key.market !== 'DOMESTIC' && key.market !== 'OVERSEAS') ||
      (key.side !== 'BUY' && key.side !== 'SELL')
    ) {
      return this.invalidKey();
    }

    const configuredExchange = this.normalizeComponent(key.exchangeCode);
    const stockCode = this.normalizeComponent(key.stockCode);
    return {
      broker: key.broker,
      market: key.market,
      exchangeCode: key.market === 'DOMESTIC' ? 'KRX' : configuredExchange,
      stockCode,
      side: key.side,
    };
  }

  private normalizeComponent(value: unknown): string {
    if (typeof value !== 'string') return this.invalidKey();

    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(normalized)) {
      return this.invalidKey();
    }
    return normalized;
  }

  private buildCanonicalKey(key: OrderAdmissionKey): string {
    return [key.broker, key.market, key.exchangeCode, key.stockCode, key.side]
      .map((component) => `${component.length}:${component}`)
      .join('|');
  }

  private invalidKey(): never {
    this.logger.warn('Rejected invalid order admission key');
    throw new Error('Invalid order admission key');
  }
}
