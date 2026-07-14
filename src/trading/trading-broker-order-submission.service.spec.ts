import { Logger } from '@nestjs/common';
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

  it.each([
    [
      'domestic BUY',
      {
        market: 'DOMESTIC' as const,
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'BUY' as const,
        quantity: 2,
        price: 70_000,
        orderDivision: '00',
        reason: 'buy',
      },
      'domesticBuy',
      ['005930', 2, 70_000, '00'],
    ],
    [
      'domestic SELL',
      {
        market: 'DOMESTIC' as const,
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'SELL' as const,
        quantity: 3,
        price: undefined,
        orderDivision: undefined,
        reason: 'sell',
      },
      'domesticSell',
      ['005930', 3, undefined, undefined],
    ],
    [
      'overseas BUY',
      {
        market: 'OVERSEAS' as const,
        exchangeCode: 'NASD',
        stockCode: 'AAPL',
        side: 'BUY' as const,
        quantity: 1,
        price: 250,
        orderDivision: '00',
        reason: 'buy',
      },
      'overseasBuy',
      ['NASD', 'AAPL', 1, 250, '00'],
    ],
    [
      'overseas SELL',
      {
        market: 'OVERSEAS' as const,
        exchangeCode: 'NYSE',
        stockCode: 'IBM',
        side: 'SELL' as const,
        quantity: 4,
        price: undefined,
        orderDivision: undefined,
        reason: 'sell',
      },
      'overseasSell',
      ['NYSE', 'IBM', 4, 0, undefined],
    ],
  ] as const)('dispatches %s through the matching KIS mutation', async (
    _label,
    signal,
    expectedCall,
    expectedArgs,
  ) => {
    const domestic = {
      orderBuy: jest.fn().mockResolvedValue(accepted),
      orderSell: jest.fn().mockResolvedValue(accepted),
    };
    const overseas = {
      orderBuy: jest.fn().mockResolvedValue(accepted),
      orderSell: jest.fn().mockResolvedValue(accepted),
    };
    const service = new TradingBrokerOrderSubmissionService(
      domestic as never,
      overseas as never,
    );

    await expect(service.submit({ ...signal })).resolves.toEqual(accepted);

    const calls = {
      domesticBuy: domestic.orderBuy,
      domesticSell: domestic.orderSell,
      overseasBuy: overseas.orderBuy,
      overseasSell: overseas.orderSell,
    };
    expect(calls[expectedCall]).toHaveBeenCalledWith(...expectedArgs);
    expect(Object.values(calls).reduce((count, mock) => count + mock.mock.calls.length, 0))
      .toBe(1);
  });

  it('warns with a stock prefix and rethrows an external submission failure', async () => {
    const error = new Error('socket timeout');
    const domestic = {
      orderBuy: jest.fn().mockRejectedValue(error),
      orderSell: jest.fn(),
    };
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new TradingBrokerOrderSubmissionService(
      domestic as never,
      {} as never,
    );

    await expect(service.submit({
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
