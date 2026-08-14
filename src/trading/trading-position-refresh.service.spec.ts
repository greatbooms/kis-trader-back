import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BrokerPortRegistry } from '../broker/broker-port.registry';
import { BalanceItem } from '../kis/types/kis-api.types';
import { TradingPositionRefreshService } from './trading-position-refresh.service';
import { TradingPositionSyncService } from './trading-position-sync.service';
import { Broker } from '@prisma/client';

describe('TradingPositionRefreshService', () => {
  let service: TradingPositionRefreshService;

  const port = { getBalance: jest.fn() };
  const registry = { get: jest.fn().mockReturnValue(port) };
  const positionSync = { syncPositions: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradingPositionRefreshService,
        { provide: BrokerPortRegistry, useValue: registry },
        { provide: TradingPositionSyncService, useValue: positionSync },
      ],
    }).compile();

    service = module.get(TradingPositionRefreshService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('synchronizes and returns the unchanged domestic snapshot', async () => {
    const snapshot: BalanceItem[] = [
      {
        stockCode: '005930',
        stockName: 'Samsung',
        quantity: 1,
        avgPrice: 70000,
        currentPrice: 71000,
        profitLoss: 1000,
        profitRate: 1.43,
      },
    ];
    port.getBalance.mockResolvedValue(snapshot);
    positionSync.syncPositions.mockResolvedValue(undefined);

    const result = await service.refresh(Broker.TOSS, 'DOMESTIC');

    expect(registry.get).toHaveBeenCalledWith(Broker.TOSS);
    expect(port.getBalance).toHaveBeenCalledWith('DOMESTIC');
    expect(positionSync.syncPositions).toHaveBeenCalledWith(Broker.TOSS, 'DOMESTIC', snapshot);
    expect(result).toBe(snapshot);
  });

  it('treats an empty overseas snapshot as a successful no-holdings result', async () => {
    const snapshot: BalanceItem[] = [];
    port.getBalance.mockResolvedValue(snapshot);
    positionSync.syncPositions.mockResolvedValue(undefined);

    const result = await service.refresh(Broker.KIS, 'OVERSEAS');

    expect(port.getBalance).toHaveBeenCalledWith('OVERSEAS');
    expect(positionSync.syncPositions).toHaveBeenCalledWith(Broker.KIS, 'OVERSEAS', snapshot);
    expect(result).toBe(snapshot);
  });

  it('warns, rethrows, and does not synchronize when KIS balance lookup fails', async () => {
    const failure = new Error('balance unavailable');
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    port.getBalance.mockRejectedValue(failure);

    await expect(service.refresh(Broker.TOSS, 'DOMESTIC')).rejects.toBe(failure);

    expect(warn).toHaveBeenCalledWith(
      '[TOSS DOMESTIC] Failed to refresh positions: balance unavailable',
    );
    expect(positionSync.syncPositions).not.toHaveBeenCalled();
  });
});
