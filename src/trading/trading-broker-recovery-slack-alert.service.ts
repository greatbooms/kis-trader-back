import { Injectable, Logger } from '@nestjs/common';
import {
  CancellationAttemptStatus,
  OrderStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { TradingSlackRecoveryPresentationService } from './trading-slack-recovery-presentation.service';

const UNKNOWN_ALERT_SELECT = {
  id: true,
  market: true,
  exchangeCode: true,
  stockCode: true,
  stockName: true,
  side: true,
  quantity: true,
  price: true,
  status: true,
  submissionStartedAt: true,
  cancellationStatus: true,
  cancellationStartedAt: true,
  brokerEnvironment: true,
  brokerAccountHash: true,
} as const;

@Injectable()
export class TradingBrokerRecoverySlackAlertService {
  private readonly logger = new Logger(
    TradingBrokerRecoverySlackAlertService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly presentation: TradingSlackRecoveryPresentationService,
  ) {}

  async notifyUnknown(tradeRecordId: string): Promise<void> {
    const id = tradeRecordId?.trim();
    if (!id) return;

    try {
      const record = await this.prisma.tradeRecord.findFirst({
        where: {
          id,
          OR: [
            { status: OrderStatus.SUBMISSION_UNKNOWN },
            { cancellationStatus: CancellationAttemptStatus.UNKNOWN },
          ],
        },
        select: UNKNOWN_ALERT_SELECT,
      });
      if (!record) return;

      const cancellationUnknown = record.cancellationStatus
        === CancellationAttemptStatus.UNKNOWN;
      await this.presentation.sendUnknownAlert({
        tradeRecordId: record.id,
        lifecycle: cancellationUnknown ? 'CANCELLATION' : 'SUBMISSION',
        market: record.market,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        stockName: record.stockName,
        side: record.side,
        quantity: record.quantity,
        price: Number(record.price),
        startedAt: cancellationUnknown
          ? record.cancellationStartedAt
          : record.submissionStartedAt,
        brokerContextAssigned: record.brokerEnvironment !== null
          && record.brokerAccountHash !== null,
      });
    } catch (error) {
      this.logger.warn(
        `[RECOVERY ${id}] Slack unknown-order alert failed: ${this.errorMessage(error)}`,
      );
    }
  }

  async notifyStartupSummary(unresolvedCount: number): Promise<void> {
    if (!Number.isSafeInteger(unresolvedCount) || unresolvedCount <= 0) return;
    try {
      await this.presentation.sendStartupSummary(unresolvedCount);
    } catch (error) {
      this.logger.warn(
        `Slack startup recovery summary failed: ${this.errorMessage(error)}`,
      );
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
