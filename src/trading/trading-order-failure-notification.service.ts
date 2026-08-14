import { Injectable, Logger, Optional } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { SlackService } from '../notification/slack.service';
import { OrderFailureAlertContext } from '../notification/types/order-failure-alert-context.type';
import { PrismaService } from '../prisma.service';

@Injectable()
export class TradingOrderFailureNotificationService {
  private readonly logger = new Logger(TradingOrderFailureNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly slackService?: SlackService,
  ) {}

  async notify(
    tradeRecordId: string,
    stage: OrderFailureAlertContext['stage'],
  ): Promise<void> {
    let tag = `[TRADE ${tradeRecordId}]`;
    try {
      if (!this.slackService?.isEnabled()) return;

      const record = await this.prisma.tradeRecord.findUnique({
        where: { id: tradeRecordId },
        select: {
          broker: true,
          market: true,
          exchangeCode: true,
          stockCode: true,
          stockName: true,
          side: true,
          quantity: true,
          orderType: true,
          price: true,
          strategyName: true,
          reason: true,
          status: true,
          brokerMessage: true,
          orderNo: true,
          updatedAt: true,
          stopLossApprovals: { select: { id: true }, take: 1 },
        },
      });

      if (
        !record
        || record.status !== OrderStatus.FAILED
        || !record.strategyName
        || record.strategyName === 'manual'
        || record.stopLossApprovals.length > 0
      ) return;
      tag = `[${record.broker} ${record.stockCode}] [TRADE ${tradeRecordId}]`;

      await this.slackService.sendOrderFailureAlert({
        broker: record.broker,
        market: record.market,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        stockName: record.stockName,
        side: record.side,
        quantity: record.quantity,
        orderType: record.orderType,
        price: Number(record.price),
        strategyName: record.strategyName,
        reason: record.reason ?? undefined,
        stage,
        brokerMessage: record.brokerMessage ?? undefined,
        orderNo: record.orderNo ?? undefined,
        occurredAt: record.updatedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `${tag} Failed to send order failure alert: ${message}`,
      );
    }
  }
}
