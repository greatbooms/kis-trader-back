import { Logger } from '@nestjs/common';
import { TradingOrderFailureNotificationService } from './trading-order-failure-notification.service';
import { Broker } from '@prisma/client';

describe('TradingOrderFailureNotificationService', () => {
  const failedRecord = {
    broker: Broker.TOSS,
    market: 'OVERSEAS',
    exchangeCode: 'NASD',
    stockCode: 'TQQQ',
    stockName: 'PROSHARES QQQ 3X',
    side: 'BUY',
    quantity: 2,
    orderType: 'LIMIT',
    price: 74.43,
    strategyName: 'infinite-buy',
    reason: 'Buy1: T=29.3',
    status: 'FAILED',
    brokerMessage: 'EGW00201 - 초당 거래건수를 초과하였습니다.',
    orderNo: null,
    updatedAt: new Date('2026-08-07T06:30:00.879Z'),
    stopLossApprovals: [],
  };

  const createHarness = () => {
    const prisma = {
      tradeRecord: {
        findUnique: jest.fn().mockResolvedValue(failedRecord),
      },
    };
    const slackService = {
      isEnabled: jest.fn().mockReturnValue(true),
      sendOrderFailureAlert: jest.fn().mockResolvedValue(undefined),
    };
    const service = new TradingOrderFailureNotificationService(
      prisma as never,
      slackService as never,
    );

    return { service, prisma, slackService };
  };

  it('alerts Slack from an authoritative automatic failed row', async () => {
    const { service, prisma, slackService } = createHarness();

    await service.notify('trade-tqqq', 'SUBMISSION');

    expect(prisma.tradeRecord.findUnique).toHaveBeenCalledWith({
      where: { id: 'trade-tqqq' },
      select: expect.objectContaining({
        status: true,
        strategyName: true,
        stopLossApprovals: { select: { id: true }, take: 1 },
      }),
    });
    expect(slackService.sendOrderFailureAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        stockCode: 'TQQQ',
        broker: Broker.TOSS,
        stage: 'SUBMISSION',
        brokerMessage: expect.stringContaining('EGW00201'),
        orderNo: undefined,
      }),
    );
  });

  it.each([
    ['PENDING', 'infinite-buy', []],
    ['FAILED', null, []],
    ['FAILED', 'manual', []],
    ['FAILED', 'infinite-buy', [{ id: 'approval-1' }]],
  ])('skips ineligible failure rows', async (status, strategyName, stopLossApprovals) => {
    const { service, prisma, slackService } = createHarness();
    prisma.tradeRecord.findUnique.mockResolvedValue({
      ...failedRecord,
      status,
      strategyName,
      stopLossApprovals,
    });

    await service.notify('trade-tqqq', 'SUBMISSION');

    expect(slackService.sendOrderFailureAlert).not.toHaveBeenCalled();
  });

  it('does not read the DB when Slack is disabled', async () => {
    const { service, prisma, slackService } = createHarness();
    slackService.isEnabled.mockReturnValue(false);

    await service.notify('trade-tqqq', 'SUBMISSION');

    expect(prisma.tradeRecord.findUnique).not.toHaveBeenCalled();
  });

  it('absorbs Slack failures', async () => {
    const { service, slackService } = createHarness();
    slackService.sendOrderFailureAlert.mockRejectedValueOnce(new Error('slack down'));

    await expect(service.notify('trade-tqqq', 'SUBMISSION')).resolves.toBeUndefined();
  });

  it('absorbs database failures with a searchable warning', async () => {
    const { service, prisma, slackService } = createHarness();
    prisma.tradeRecord.findUnique.mockRejectedValueOnce(new Error('database down'));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(service.notify('trade-tqqq', 'RECONCILIATION')).resolves.toBeUndefined();

    expect(slackService.sendOrderFailureAlert).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      '[TRADE trade-tqqq] Failed to send order failure alert: database down',
    );
    warn.mockRestore();
  });
});
