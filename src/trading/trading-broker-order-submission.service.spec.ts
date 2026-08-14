import { Logger } from '@nestjs/common';
import { Broker } from '@prisma/client';
import { TradingBrokerOrderSubmissionService } from './trading-broker-order-submission.service';

describe('TradingBrokerOrderSubmissionService', () => {
  const accepted = {
    outcome: 'ACCEPTED' as const,
    success: true,
    orderNo: 'O-100',
    brokerOrderDate: '20260714',
    orderTime: '101112',
    message: 'accepted',
  };

  it('routes the complete signal through its broker port', async () => {
    const signal = {
      broker: Broker.KIS,
      market: 'OVERSEAS' as const,
      exchangeCode: 'NASD',
      stockCode: 'AAPL',
      side: 'BUY' as const,
      quantity: 1,
      price: 250,
      orderDivision: '00',
      reason: 'buy',
    };
    const port = { submitOrder: jest.fn().mockResolvedValue(accepted) };
    const registry = { get: jest.fn().mockReturnValue(port) };
    const service = new TradingBrokerOrderSubmissionService(registry as never);

    await expect(service.submit(signal)).resolves.toEqual(accepted);

    expect(registry.get).toHaveBeenCalledWith(Broker.KIS);
    expect(port.submitOrder).toHaveBeenCalledWith(signal);
  });

  it('fails closed before registry lookup when signal broker is missing', async () => {
    const registry = { get: jest.fn() };
    const service = new TradingBrokerOrderSubmissionService(registry as never);

    await expect(service.submit({
      market: 'DOMESTIC',
      exchangeCode: 'KRX',
      stockCode: '005930',
      side: 'BUY',
      quantity: 1,
      price: 70_000,
      reason: 'buy',
    })).rejects.toThrow('[005930] Broker is required for order submission');

    expect(registry.get).not.toHaveBeenCalled();
  });

  it('warns with a stock prefix and rethrows an external submission failure', async () => {
    const error = new Error('socket timeout');
    const port = { submitOrder: jest.fn().mockRejectedValue(error) };
    const registry = { get: jest.fn().mockReturnValue(port) };
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new TradingBrokerOrderSubmissionService(registry as never);

    await expect(service.submit({
      broker: Broker.KIS,
      market: 'DOMESTIC',
      exchangeCode: 'KRX',
      stockCode: '005930',
      side: 'BUY',
      quantity: 1,
      price: 70_000,
      reason: 'buy',
    })).rejects.toBe(error);

    expect(warn).toHaveBeenCalledWith('[005930] Broker order submission failed: socket timeout');
    warn.mockRestore();
  });
});
