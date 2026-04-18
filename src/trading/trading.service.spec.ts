import { Test, TestingModule } from '@nestjs/testing';
import { TradingService } from './trading.service';
import { TradingPositionSyncService } from './trading-position-sync.service';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { PrismaService } from '../prisma.service';
import { SlackService } from '../notification/slack.service';
import { ConfigService } from '@nestjs/config';
import { MarketAnalysisService } from './market-analysis.service';

describe('TradingService', () => {
  let service: TradingService;

  const mockKisDomestic = {
    getPrice: jest.fn(),
    orderBuy: jest.fn(),
    orderSell: jest.fn(),
    getOrderExecutions: jest.fn(),
  };

  const mockKisOverseas = {
    getPrice: jest.fn(),
    orderBuy: jest.fn(),
    orderSell: jest.fn(),
    getOrderExecutions: jest.fn(),
  };

  const mockPrisma = {
    tradeRecord: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    position: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    watchStock: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    watchStockExecutionLog: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const mockSlackService = {
    isEnabled: jest.fn().mockReturnValue(true),
    sendFilterLog: jest.fn(),
    sendInsufficientFundsAlert: jest.fn(),
    sendStopLossAlert: jest.fn(),
    sendTradeAlert: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'trading.enabled') return true;
      return undefined;
    }),
  };

  const mockMarketAnalysis = {
    getStockIndicators: jest.fn(),
    getIntradayVwap: jest.fn(),
  };

  const mockPositionSyncService = {
    syncPositions: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradingService,
        { provide: KisDomesticService, useValue: mockKisDomestic },
        { provide: KisOverseasService, useValue: mockKisOverseas },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MarketAnalysisService, useValue: mockMarketAnalysis },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: TradingPositionSyncService, useValue: mockPositionSyncService },
        { provide: SlackService, useValue: mockSlackService },
      ],
    }).compile();

    service = module.get<TradingService>(TradingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockSlackService.isEnabled.mockReturnValue(true);
  });

  describe('executePerStockStrategy', () => {
    it('should send one insufficient funds alert when actual buyable cash is lower than planned quota', async () => {
      const strategy = {
        name: 'infinite-buy',
        evaluateStock: jest.fn().mockResolvedValue({
          signals: [],
          skipReasons: ['매수 수량 부족: 조정 할당금 100 < 현재가 200'],
          details: {
            preCashCappedQuota: 500,
            adjustedQuota: 100,
            minimumExecutablePrice: 100,
          },
        }),
      };
      mockPrisma.watchStockExecutionLog.findFirst.mockResolvedValueOnce(null);

      await service.executePerStockStrategy(strategy as any, [
        {
          watchStock: {
            id: 'ws-1',
            market: 'OVERSEAS',
            exchangeCode: 'NASD',
            stockCode: 'TQQQ',
            stockName: 'TQQQ',
            strategyName: 'infinite-buy',
            quota: 10000,
            cycle: 0,
            maxCycles: 40,
            stopLossRate: 0.3,
            maxPortfolioRate: 1,
            strategyParams: {},
          },
          price: { currentPrice: 200 } as any,
          alreadyExecutedToday: false,
          marketCondition: {} as any,
          stockIndicators: {} as any,
          buyableAmount: 100,
          totalPortfolioValue: 0,
        },
      ]);

      expect(mockSlackService.sendInsufficientFundsAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          stockCode: 'TQQQ',
          buyableAmount: 100,
          plannedAmount: 500,
          adjustedQuota: 100,
          currentPrice: 200,
        }),
      );
    });

    it('should include buyable diagnostics in signal created logs', async () => {
      const strategy = {
        name: 'infinite-buy',
        evaluateStock: jest.fn().mockResolvedValue({
          signals: [
            {
              market: 'OVERSEAS',
              exchangeCode: 'NASD',
              stockCode: 'TQQQ',
              side: 'BUY',
              quantity: 1,
              price: 54.6,
              reason: 'Buy1',
              orderDivision: '00',
            },
          ],
          skipReasons: [],
          details: {
            preCashCappedQuota: 212.5,
            adjustedQuota: 109.2,
            quotaAdjustments: [{ label: 'RSI 72.0 ≥ 70', multiplier: 0.6 }],
            buy1Qty: 1,
            buy2Qty: 0,
            buy1Price: 54.6,
            buy2Price: 54.05,
            dipRate: 0.01,
            buy2OnlyMode: true,
          },
        }),
      };
      jest.spyOn(service as any, 'executeSignal').mockResolvedValue(true);

      await service.executePerStockStrategy(strategy as any, [
        {
          watchStock: {
            id: 'ws-1',
            market: 'OVERSEAS',
            exchangeCode: 'NASD',
            stockCode: 'TQQQ',
            stockName: 'TQQQ',
            strategyName: 'infinite-buy',
            quota: 10000,
            cycle: 0,
            maxCycles: 40,
            stopLossRate: 0.3,
            maxPortfolioRate: 1,
            strategyParams: {},
          },
          price: { currentPrice: 54.6 } as any,
          alreadyExecutedToday: false,
          marketCondition: {} as any,
          stockIndicators: {} as any,
          buyableAmount: 109.2,
          buyableMeta: {
            source: 'KIS_OVERSEAS_INQUIRE_PSAMOUNT',
            maxQuantity: 1,
            priceUsed: 54.6,
          },
          totalPortfolioValue: 0,
        },
      ]);

      expect(mockPrisma.watchStockExecutionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'SIGNAL_CREATED',
          details: expect.objectContaining({
            buyableAmount: 109.2,
            buyableAmountSource: 'KIS_OVERSEAS_INQUIRE_PSAMOUNT',
            buyableAmountMaxQuantity: 1,
            preCashCappedQuota: 212.5,
            adjustedQuota: 109.2,
            cashCapApplied: true,
            diagnosticReasons: expect.arrayContaining(['전략 가감산 적용', 'KIS 주문가능금액 상한 적용']),
            buy1Qty: 1,
            buy2Qty: 0,
          }),
        }),
      });
    });

    it('should clear accumulated quota when terminal quota exhaustion is reached without a buy', async () => {
      const strategy = {
        name: 'infinite-buy',
        evaluateStock: jest.fn().mockResolvedValue({
          signals: [
            {
              market: 'OVERSEAS',
              exchangeCode: 'NASD',
              stockCode: 'TQQQ',
              side: 'SELL',
              quantity: 1,
              price: 70,
              reason: 'Take profit',
              orderDivision: '00',
            },
          ],
          skipReasons: ['최대 사이클 도달: 잔여 투자한도 50 < 기준가 54.45'],
          details: {
            remainingQuota: 50,
            minimumExecutablePrice: 54.45,
          },
        }),
      };
      jest.spyOn(service as any, 'executeSignal').mockResolvedValue(true);
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-1',
        stockCode: 'TQQQ',
        strategyParams: {
          accumulatedQuota: 200,
          lastAccumulatedDate: '2026-04-15',
        },
      });

      await service.executePerStockStrategy(strategy as any, [
        {
          watchStock: {
            id: 'ws-1',
            market: 'OVERSEAS',
            exchangeCode: 'NASD',
            stockCode: 'TQQQ',
            stockName: 'TQQQ',
            strategyName: 'infinite-buy',
            quota: 10000,
            cycle: 39.8,
            maxCycles: 40,
            stopLossRate: 0.3,
            maxPortfolioRate: 1,
            strategyParams: {
              accumulatedQuota: 200,
            },
          },
          position: {
            stockCode: 'TQQQ',
            quantity: 3,
            avgPrice: 50,
            currentPrice: 55,
            totalInvested: 9950,
          },
          price: { currentPrice: 55 } as any,
          alreadyExecutedToday: false,
          marketCondition: {} as any,
          stockIndicators: {} as any,
          buyableAmount: 1000,
          totalPortfolioValue: 0,
        },
      ]);

      expect(mockPrisma.watchStock.update).toHaveBeenCalledWith({
        where: { id: 'ws-1' },
        data: {
          strategyParams: {
            lastAccumulatedDate: '2026-04-15',
          },
        },
      });
    });
  });

  describe('executeSignal diagnostics logging', () => {
    it('should include buyable diagnostics in order submitted logs', async () => {
      jest.spyOn(service as any, 'refreshMarketPositionsBeforeOrder').mockResolvedValue(undefined);
      mockPrisma.tradeRecord.create.mockResolvedValue({ id: 'trade-1' });
      mockPrisma.tradeRecord.update.mockResolvedValue({});
      mockKisOverseas.orderBuy.mockResolvedValue({
        success: true,
        orderNo: '1001',
        message: 'BUY order placed',
      });

      await (service as any).executeSignal(
        {
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          side: 'BUY',
          quantity: 1,
          price: 54.6,
          reason: 'Buy1',
          orderDivision: '00',
        },
        'infinite-buy',
        {
          watchStock: {
            id: 'ws-1',
            market: 'OVERSEAS',
            exchangeCode: 'NASD',
            stockCode: 'TQQQ',
            stockName: 'TQQQ',
            strategyName: 'infinite-buy',
            quota: 10000,
            cycle: 0,
            maxCycles: 40,
            stopLossRate: 0.3,
            maxPortfolioRate: 1,
            strategyParams: {},
          },
          price: { currentPrice: 54.6 } as any,
          alreadyExecutedToday: false,
          marketCondition: {} as any,
          stockIndicators: {} as any,
          buyableAmount: 109.2,
          buyableMeta: {
            source: 'KIS_OVERSEAS_INQUIRE_PSAMOUNT',
            maxQuantity: 1,
            priceUsed: 54.6,
          },
          totalPortfolioValue: 0,
        },
        {
          preCashCappedQuota: 212.5,
          adjustedQuota: 109.2,
          quotaAdjustments: [{ label: 'RSI 72.0 ≥ 70', multiplier: 0.6 }],
          buy1Qty: 1,
          buy2Qty: 0,
        },
      );

      expect(mockPrisma.watchStockExecutionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'ORDER_SUBMITTED',
          message: '주문 제출: BUY 1주',
          details: expect.objectContaining({
            buyableAmount: 109.2,
            buyableAmountSource: 'KIS_OVERSEAS_INQUIRE_PSAMOUNT',
            buyableAmountMaxQuantity: 1,
            preCashCappedQuota: 212.5,
            adjustedQuota: 109.2,
            cashCapApplied: true,
          }),
        }),
      });
    });
  });

  describe('infinite-buy hybrid second target', () => {
    it('should submit same-day second target after first take-profit fill when trend stays strong', async () => {
      const executeSignalSpy = jest.spyOn(service as any, 'executeSignal').mockResolvedValue(true);
      const persistPlanSpy = jest
        .spyOn(service as any, 'persistInfiniteBuySecondaryExitPlan')
        .mockResolvedValue(undefined);
      jest.spyOn(service as any, 'getMinutesUntilMarketClose').mockReturnValue(180);

      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-1',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        strategyName: 'infinite-buy',
        quota: 10000,
        cycle: 1,
        maxCycles: 40,
        stopLossRate: 0.3,
        maxPortfolioRate: 1,
        strategyParams: {},
      });
      mockPrisma.position.findFirst.mockResolvedValue({
        stockCode: 'TQQQ',
        quantity: 2,
        avgPrice: 52.1,
        currentPrice: 58.4,
        totalInvested: 104.2,
      });
      mockKisOverseas.getPrice.mockResolvedValue({
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        currentPrice: 58.4,
        openPrice: 57.8,
        highPrice: 58.6,
        lowPrice: 57.2,
        volume: 1000000,
      });
      mockMarketAnalysis.getStockIndicators.mockResolvedValue({
        currentAboveMA200: true,
        todayOpen: 57.8,
        ma20: 56.9,
        adx14: 28,
        rsi14: 63,
        volumeRatio: 1.1,
        atrPercent: 1.2,
        macdHistogram: 0.8,
        macdPrevHistogram: 0.7,
      });
      mockMarketAnalysis.getIntradayVwap.mockResolvedValue(58.0);

      await (service as any).handleInfiniteBuySignalFill(
        'ws-1',
        {
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          side: 'SELL',
          quantity: 1,
          price: 58.42,
          reason: 'Take profit 1',
          orderDivision: '00',
          metadata: {
            phase: 'take-profit-1',
            sameDaySecondaryEligible: true,
            secondaryTargetPrice: 59.88,
            secondaryTargetRate: 0.19,
            secondaryTargetQuantity: 2,
          },
        },
        3,
      );

      expect(executeSignalSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          side: 'SELL',
          quantity: 2,
          price: 59.88,
          metadata: expect.objectContaining({
            phase: 'take-profit-2',
            sameDayTriggered: true,
          }),
        }),
        'infinite-buy',
        expect.objectContaining({
          watchStock: expect.objectContaining({
            stockCode: 'TQQQ',
          }),
          position: expect.objectContaining({
            quantity: 2,
          }),
          alreadyExecutedToday: true,
        }),
      );
      expect(persistPlanSpy).not.toHaveBeenCalled();
    });

    it('should fall back to next-day second target plan when same-day submission fails', async () => {
      jest.spyOn(service as any, 'executeSignal').mockResolvedValue(false);
      const persistPlanSpy = jest
        .spyOn(service as any, 'persistInfiniteBuySecondaryExitPlan')
        .mockResolvedValue(undefined);
      jest.spyOn(service as any, 'getMinutesUntilMarketClose').mockReturnValue(180);

      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-1',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        strategyName: 'infinite-buy',
        quota: 10000,
        cycle: 1,
        maxCycles: 40,
        stopLossRate: 0.3,
        maxPortfolioRate: 1,
        strategyParams: {},
      });
      mockPrisma.position.findFirst.mockResolvedValue({
        stockCode: 'TQQQ',
        quantity: 2,
        avgPrice: 52.1,
        currentPrice: 58.4,
        totalInvested: 104.2,
      });
      mockKisOverseas.getPrice.mockResolvedValue({
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        currentPrice: 58.4,
        openPrice: 57.8,
        highPrice: 58.6,
        lowPrice: 57.2,
        volume: 1000000,
      });
      mockMarketAnalysis.getStockIndicators.mockResolvedValue({
        currentAboveMA200: true,
        todayOpen: 57.8,
        ma20: 56.9,
        adx14: 28,
        rsi14: 63,
        volumeRatio: 1.1,
        atrPercent: 1.2,
        macdHistogram: 0.8,
        macdPrevHistogram: 0.7,
      });
      mockMarketAnalysis.getIntradayVwap.mockResolvedValue(58.0);

      const signal = {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'SELL',
        quantity: 1,
        price: 58.42,
        reason: 'Take profit 1',
        orderDivision: '00',
        metadata: {
          phase: 'take-profit-1',
          sameDaySecondaryEligible: true,
          secondaryTargetPrice: 59.88,
          secondaryTargetRate: 0.19,
          secondaryTargetQuantity: 2,
        },
      };

      await (service as any).handleInfiniteBuySignalFill('ws-1', signal, 3);

      expect(persistPlanSpy).toHaveBeenCalledWith('ws-1', signal);
    });

    it('should keep next-day second target when latest trend re-check is weak', async () => {
      const executeSignalSpy = jest.spyOn(service as any, 'executeSignal').mockResolvedValue(true);
      const persistPlanSpy = jest
        .spyOn(service as any, 'persistInfiniteBuySecondaryExitPlan')
        .mockResolvedValue(undefined);

      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-1',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        strategyName: 'infinite-buy',
        quota: 10000,
        cycle: 1,
        maxCycles: 40,
        stopLossRate: 0.3,
        maxPortfolioRate: 1,
        strategyParams: {},
      });
      mockPrisma.position.findFirst.mockResolvedValue({
        stockCode: 'TQQQ',
        quantity: 2,
        avgPrice: 52.1,
        currentPrice: 58.4,
        totalInvested: 104.2,
      });
      mockKisOverseas.getPrice.mockResolvedValue({
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        currentPrice: 57.4,
        openPrice: 57.8,
        highPrice: 58.6,
        lowPrice: 57.1,
        volume: 1000000,
      });
      mockMarketAnalysis.getStockIndicators.mockResolvedValue({
        currentAboveMA200: true,
        todayOpen: 57.8,
        ma20: 57.9,
        adx14: 18,
        rsi14: 51,
        volumeRatio: 0.7,
        atrPercent: 1.2,
        macdHistogram: 0.3,
        macdPrevHistogram: 0.7,
      });
      mockMarketAnalysis.getIntradayVwap.mockResolvedValue(57.5);

      await (service as any).handleInfiniteBuySignalFill(
        'ws-1',
        {
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          side: 'SELL',
          quantity: 1,
          price: 58.42,
          reason: 'Take profit 1',
          orderDivision: '00',
          metadata: {
            phase: 'take-profit-1',
            secondaryTargetPrice: 59.88,
            secondaryTargetRate: 0.19,
            secondaryTargetQuantity: 2,
          },
        },
        3,
      );

      expect(executeSignalSpy).not.toHaveBeenCalled();
      expect(persistPlanSpy).toHaveBeenCalled();
    });
  });

});
