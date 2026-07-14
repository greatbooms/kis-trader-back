import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { BalanceItem } from '../kis/types/kis-api.types';
import { TradingPositionRefreshService } from './trading-position-refresh.service';
import { TradingPositionSyncService } from './trading-position-sync.service';

describe('TradingPositionRefreshService', () => {
  let service: TradingPositionRefreshService;

  const kisDomestic = { getBalance: jest.fn() };
  const kisOverseas = { getBalance: jest.fn() };
  const positionSync = { syncPositions: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradingPositionRefreshService,
        { provide: KisDomesticService, useValue: kisDomestic },
        { provide: KisOverseasService, useValue: kisOverseas },
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
    kisDomestic.getBalance.mockResolvedValue(snapshot);
    positionSync.syncPositions.mockResolvedValue(undefined);

    const result = await service.refresh('DOMESTIC');

    expect(kisDomestic.getBalance).toHaveBeenCalledTimes(1);
    expect(kisOverseas.getBalance).not.toHaveBeenCalled();
    expect(positionSync.syncPositions).toHaveBeenCalledWith('DOMESTIC', snapshot);
    expect(result).toBe(snapshot);
  });

  it('treats an empty overseas snapshot as a successful no-holdings result', async () => {
    const snapshot: BalanceItem[] = [];
    kisOverseas.getBalance.mockResolvedValue(snapshot);
    positionSync.syncPositions.mockResolvedValue(undefined);

    const result = await service.refresh('OVERSEAS');

    expect(kisOverseas.getBalance).toHaveBeenCalledTimes(1);
    expect(kisDomestic.getBalance).not.toHaveBeenCalled();
    expect(positionSync.syncPositions).toHaveBeenCalledWith('OVERSEAS', snapshot);
    expect(result).toBe(snapshot);
  });

  it('warns, rethrows, and does not synchronize when KIS balance lookup fails', async () => {
    const failure = new Error('balance unavailable');
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    kisDomestic.getBalance.mockRejectedValue(failure);

    await expect(service.refresh('DOMESTIC')).rejects.toBe(failure);

    expect(warn).toHaveBeenCalledWith(
      'Failed to refresh DOMESTIC positions: balance unavailable',
    );
    expect(positionSync.syncPositions).not.toHaveBeenCalled();
  });
});
