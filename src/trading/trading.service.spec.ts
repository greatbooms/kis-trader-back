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

    it('should skip BUY submission and carry quota when BUY and SELL signals share the same price', async () => {
      const buySignal = {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'BUY',
        quantity: 1,
        price: 70.6,
        reason: 'Buy1',
        orderDivision: '00',
      };
      const sellSignal = {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'SELL',
        quantity: 4,
        price: 70.6,
        reason: 'Take profit 1',
        orderDivision: '00',
      };
      const strategy = {
        name: 'infinite-buy',
        evaluateStock: jest.fn().mockResolvedValue({
          signals: [buySignal, sellSignal],
          skipReasons: [],
          details: {},
        }),
      };
      const executeSignalSpy = jest.spyOn(service as any, 'executeSignal').mockResolvedValue(true);
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-1',
        stockCode: 'TQQQ',
        quota: 10000,
        maxCycles: 40,
        strategyParams: {},
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
            cycle: 1.6,
            maxCycles: 40,
            stopLossRate: 0.3,
            maxPortfolioRate: 1,
            strategyParams: {},
          },
          position: {
            stockCode: 'TQQQ',
            quantity: 8,
            avgPrice: 60,
            currentPrice: 70.6,
            totalInvested: 480,
          },
          price: { currentPrice: 70.6 } as any,
          alreadyExecutedToday: false,
          marketCondition: {} as any,
          stockIndicators: {} as any,
          buyableAmount: 4884.92,
          totalPortfolioValue: 0,
        },
      ]);

      expect(executeSignalSpy).toHaveBeenCalledTimes(1);
      expect(executeSignalSpy).toHaveBeenCalledWith(
        expect.objectContaining({ side: 'SELL', quantity: 4 }),
        'infinite-buy',
        expect.any(Object),
        expect.any(Object),
      );
      expect(executeSignalSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ side: 'BUY' }),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
      expect(mockPrisma.watchStockExecutionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'SKIPPED',
          message: '자전거래 방지: 매수가가 매도가와 동일하여 해당 매수 스킵',
          details: expect.objectContaining({
            skipReason: 'SAME_PRICE_OPPOSITE_ORDER_PREVENTION',
            selfTradePrevention: true,
            actionTaken: 'SELL_SUBMITTED_BUY_SKIPPED',
            carryQueued: true,
            strategyName: 'infinite-buy',
            stockCode: 'TQQQ',
            exchangeCode: 'NASD',
            currentPrice: 70.6,
            buyableAmount: 4884.92,
            positionQuantity: 8,
            positionAvgPrice: 60,
            blockedSignals: [expect.objectContaining({ side: 'BUY', quantity: 1 })],
            executableSignals: [expect.objectContaining({ side: 'SELL', quantity: 4 })],
            diagnostics: expect.objectContaining({
              buyableAmount: 4884.92,
            }),
          }),
        }),
      });
      expect(mockPrisma.watchStock.update).toHaveBeenCalledWith({
        where: { id: 'ws-1' },
        data: {
          strategyParams: expect.objectContaining({
            accumulatedQuota: 250,
          }),
        },
      });
    });

    it('submits BUY and SELL when their prices differ in the same cycle', async () => {
      const buy1 = {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'BUY',
        quantity: 2,
        price: 76.03,
        reason: 'Buy1',
        orderDivision: '00',
      };
      const buy2 = {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'BUY',
        quantity: 1,
        price: 73.18,
        reason: 'Buy2',
        orderDivision: '00',
      };
      const sell = {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'SELL',
        quantity: 1,
        price: 76.89,
        reason: 'Take profit 1',
        orderDivision: '00',
      };
      const strategy = {
        name: 'infinite-buy',
        evaluateStock: jest.fn().mockResolvedValue({
          signals: [buy1, buy2, sell],
          skipReasons: [],
          details: {},
        }),
      };
      const executeSignalSpy = jest.spyOn(service as any, 'executeSignal').mockResolvedValue(true);
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-1',
        stockCode: 'TQQQ',
        quota: 10000,
        maxCycles: 40,
        strategyParams: {},
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
            cycle: 1.2,
            maxCycles: 40,
            stopLossRate: 0.3,
            maxPortfolioRate: 1,
            strategyParams: {},
          },
          position: {
            stockCode: 'TQQQ',
            quantity: 2,
            avgPrice: 65.72,
            currentPrice: 76.03,
            totalInvested: 131.44,
          },
          price: { currentPrice: 76.03 } as any,
          alreadyExecutedToday: false,
          marketCondition: {} as any,
          stockIndicators: {} as any,
          buyableAmount: 4867.14,
          totalPortfolioValue: 0,
        },
      ]);

      expect(executeSignalSpy).toHaveBeenCalledTimes(3);
      expect(executeSignalSpy).toHaveBeenCalledWith(
        expect.objectContaining({ side: 'BUY', price: 76.03 }),
        'infinite-buy',
        expect.any(Object),
        expect.any(Object),
      );
      expect(executeSignalSpy).toHaveBeenCalledWith(
        expect.objectContaining({ side: 'BUY', price: 73.18 }),
        'infinite-buy',
        expect.any(Object),
        expect.any(Object),
      );
      expect(executeSignalSpy).toHaveBeenCalledWith(
        expect.objectContaining({ side: 'SELL', price: 76.89 }),
        'infinite-buy',
        expect.any(Object),
        expect.any(Object),
      );
      expect(mockPrisma.watchStockExecutionLog.create).not.toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'SKIPPED',
          details: expect.objectContaining({
            skipReason: 'SAME_PRICE_OPPOSITE_ORDER_PREVENTION',
          }),
        }),
      });
    });

    it('accumulates quota when all BUY signal submissions fail (orders rejected)', async () => {
      // Given: 전략이 BUY 시그널을 생성했지만 executeSignal 이 모두 실패한 시나리오
      // Expected: accumulatedQuota 가 perCycleQuota (10000/40 = 250) 만큼 증가
      const strategy = {
        name: 'infinite-buy',
        evaluateStock: jest.fn().mockResolvedValue({
          signals: [
            {
              market: 'OVERSEAS',
              exchangeCode: 'NASD',
              stockCode: 'TQQQ',
              side: 'BUY',
              quantity: 2,
              price: 56.87,
              reason: 'Buy2',
              orderDivision: '00',
            },
          ],
          skipReasons: [],
          details: {},
        }),
      };
      // executeSignal false = 주문 제출 실패
      jest.spyOn(service as any, 'executeSignal').mockResolvedValue(false);
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-tqqq',
        stockCode: 'TQQQ',
        quota: 10000,
        maxCycles: 40,
        strategyParams: {},
      });

      await service.executePerStockStrategy(strategy as any, [
        {
          watchStock: {
            id: 'ws-tqqq',
            market: 'OVERSEAS',
            exchangeCode: 'NASD',
            stockCode: 'TQQQ',
            stockName: 'TQQQ',
            strategyName: 'infinite-buy',
            quota: 10000,
            cycle: 1.3,
            maxCycles: 40,
            stopLossRate: 0.3,
            maxPortfolioRate: 1,
            strategyParams: {},
          },
          position: {
            stockCode: 'TQQQ',
            quantity: 6,
            avgPrice: 55.36,
            currentPrice: 58.08,
            totalInvested: 332.16,
          },
          price: { currentPrice: 58.08 } as any,
          alreadyExecutedToday: false,
          marketCondition: {} as any,
          stockIndicators: {} as any,
          buyableAmount: 1000,
          totalPortfolioValue: 0,
        },
      ]);

      // resetAccumulatedQuota 는 호출되지 않아야 함
      const resetCall = (mockPrisma.watchStock.update as jest.Mock).mock.calls.find(
        (args) => args[0]?.data?.strategyParams?.accumulatedQuota === 0,
      );
      expect(resetCall).toBeUndefined();

      // 대신 accumulateUnusedQuotas 경로로 누적되어야 함
      // perCycleQuota = 10000 / 40 = 250, remainingQuota = 10000 - 332.16 = 9667.84
      // newAccumulated = min(0 + 250, 9667.84) = 250
      expect(mockPrisma.watchStock.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ws-tqqq' },
          data: expect.objectContaining({
            strategyParams: expect.objectContaining({
              accumulatedQuota: 250,
            }),
          }),
        }),
      );
    });

    it('accumulates quota when only sell signals exist and buy quantity was insufficient', async () => {
      const strategy = {
        name: 'infinite-buy',
        evaluateStock: jest.fn().mockResolvedValue({
          signals: [
            {
              market: 'OVERSEAS',
              exchangeCode: 'AMEX',
              stockCode: 'SOXL',
              side: 'SELL',
              quantity: 1,
              price: 161.91,
              reason: 'Take profit',
              orderDivision: '00',
            },
          ],
          skipReasons: ['매수 수량 부족: 조정 할당금 85 < 기준가 153.81'],
          details: {
            adjustedQuota: 85,
            minimumExecutablePrice: 153.81,
          },
        }),
      };
      jest.spyOn(service as any, 'executeSignal').mockResolvedValue(true);
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-soxl',
        stockCode: 'SOXL',
        quota: 10000,
        maxCycles: 40,
        strategyParams: {},
      });

      await service.executePerStockStrategy(strategy as any, [
        {
          watchStock: {
            id: 'ws-soxl',
            market: 'OVERSEAS',
            exchangeCode: 'AMEX',
            stockCode: 'SOXL',
            stockName: 'SOXL',
            strategyName: 'infinite-buy',
            quota: 10000,
            cycle: 0.5,
            maxCycles: 40,
            stopLossRate: 0.3,
            maxPortfolioRate: 1,
            strategyParams: {},
          },
          position: {
            stockCode: 'SOXL',
            quantity: 1,
            avgPrice: 127.63,
            currentPrice: 161.91,
            totalInvested: 127.63,
          },
          price: { currentPrice: 161.91 } as any,
          alreadyExecutedToday: false,
          marketCondition: {} as any,
          stockIndicators: {} as any,
          buyableAmount: 4516,
          totalPortfolioValue: 0,
        },
      ]);

      expect(mockPrisma.watchStock.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ws-soxl' },
          data: expect.objectContaining({
            strategyParams: expect.objectContaining({
              accumulatedQuota: 250,
            }),
          }),
        }),
      );
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
    it('should not clear pending second target plan when a buy fill is reconciled later', async () => {
      const clearPlanSpy = jest.spyOn(service as any, 'clearInfiniteBuySecondaryExitPlan');
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-1',
        strategyParams: {
          secondaryExitPlan: {
            firstTargetDate: '2026-05-06',
            secondTargetPrice: 70.6,
            secondTargetRate: 0.2,
            secondTargetQuantity: 7,
          },
        },
      });

      await (service as any).handleInfiniteBuySignalFill(
        'ws-1',
        {
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          side: 'BUY',
          quantity: 1,
          price: 70.6,
          reason: 'Buy1',
          orderDivision: '00',
        },
        7,
      );

      expect(clearPlanSpy).not.toHaveBeenCalled();
    });

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
        quantity: 7,
        avgPrice: 52.1,
        currentPrice: 58.4,
        totalInvested: 364.7,
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

      expect(persistPlanSpy).toHaveBeenCalledWith(
        'ws-1',
        expect.objectContaining({
          metadata: expect.objectContaining({
            secondaryTargetQuantity: 7,
          }),
        }),
      );
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
        quantity: 7,
        avgPrice: 52.1,
        currentPrice: 58.4,
        totalInvested: 364.7,
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
            secondaryTargetQuantity: 6,
          },
        },
        3,
      );

      expect(executeSignalSpy).not.toHaveBeenCalled();
      expect(persistPlanSpy).toHaveBeenCalledWith(
        'ws-1',
        expect.objectContaining({
          metadata: expect.objectContaining({
            secondaryTargetQuantity: 7,
          }),
        }),
      );
    });
  });

  describe('관망(silent wait) skip', () => {
    function buildWaitContext() {
      return {
        watchStock: {
          id: 'ws-1',
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          stockName: '삼성전자',
          strategyName: 'momentum-breakout',
          quota: 1000000,
          cycle: 0,
          maxCycles: 40,
          stopLossRate: 0.3,
          maxPortfolioRate: 0.15,
          strategyParams: {},
        },
        price: { currentPrice: 70000 } as any,
        alreadyExecutedToday: false,
        marketCondition: {} as any,
        stockIndicators: {} as any,
        buyableAmount: 1000000,
        totalPortfolioValue: 0,
      };
    }

    it('관망 prefix 스킵은 실행 로그/Slack 없이 조용히 넘어간다 (매분 반복 스팸 방지)', async () => {
      const strategy = {
        name: 'momentum-breakout',
        evaluateStock: jest.fn().mockResolvedValue({
          signals: [],
          skipReasons: ['관망: 돌파 대기 (현재가 70000 < 돌파가 71000)'],
        }),
      };

      await service.executePerStockStrategy(strategy as any, [buildWaitContext() as any]);

      expect(mockPrisma.watchStockExecutionLog.create).not.toHaveBeenCalled();
      expect(mockSlackService.sendFilterLog).not.toHaveBeenCalled();
    });

    it('관망이 아닌 스킵 사유는 기존대로 실행 로그를 남긴다', async () => {
      const strategy = {
        name: 'momentum-breakout',
        evaluateStock: jest.fn().mockResolvedValue({
          signals: [],
          skipReasons: ['유효하지 않은 현재가'],
        }),
      };

      await service.executePerStockStrategy(strategy as any, [buildWaitContext() as any]);

      expect(mockPrisma.watchStockExecutionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'SKIPPED',
          message: '유효하지 않은 현재가',
        }),
      });
    });
  });

  describe('momentum-breakout 체결 후처리 (handleStrategySignalFill)', () => {
    const baseSignal = {
      market: 'DOMESTIC' as const,
      exchangeCode: 'KRX',
      stockCode: '005930',
      side: 'SELL' as const,
      quantity: 13,
      reason: '당일청산: 15:10 장 마감 전 전량 정리',
    };

    it('BUY 체결 시 entryDate(KST) 기록 + legacy halfTakeProfitDone 제거', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-1',
        stockCode: '005930',
        strategyParams: { halfTakeProfitDone: true, kValue: 0.6 },
      });

      await service.handleStrategySignalFill(
        'momentum-breakout',
        'ws-1',
        {
          ...baseSignal,
          side: 'BUY',
          reason: '변동성돌파: 돌파가 71000',
          metadata: { phase: 'vb-entry', breakoutPrice: 71000 },
        },
        13,
      );

      expect(mockPrisma.watchStock.update).toHaveBeenCalledTimes(1);
      const updated = mockPrisma.watchStock.update.mock.calls[0][0].data.strategyParams;
      expect(updated.entryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(updated.kValue).toBe(0.6); // 기존 튜닝 파라미터 보존
      expect(updated.halfTakeProfitDone).toBeUndefined();
    });

    it.each([
      'carryover-exit',
      'intraday-stop',
      'trailing-stop',
      'take-profit',
      'eod-exit',
      'risk-liquidation',
    ])('SELL(%s) 체결 시 entryDate 제거', async (phase) => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-1',
        stockCode: '005930',
        strategyParams: { entryDate: '2026-06-10', kValue: 0.6 },
      });

      await service.handleStrategySignalFill(
        'momentum-breakout',
        'ws-1',
        { ...baseSignal, metadata: { phase } },
        13,
      );

      expect(mockPrisma.watchStock.update).toHaveBeenCalledTimes(1);
      const updated = mockPrisma.watchStock.update.mock.calls[0][0].data.strategyParams;
      expect(updated.entryDate).toBeUndefined();
      expect(updated.kValue).toBe(0.6);
    });

    it('전량 매도(phase 없음)도 entryDate 제거 (수량 기준 fallback)', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-1',
        stockCode: '005930',
        strategyParams: { entryDate: '2026-06-10' },
      });

      await service.handleStrategySignalFill(
        'momentum-breakout',
        'ws-1',
        { ...baseSignal, metadata: undefined },
        13, // signal.quantity(13) >= currentPositionQty(13)
      );

      expect(mockPrisma.watchStock.update).toHaveBeenCalledTimes(1);
      const updated = mockPrisma.watchStock.update.mock.calls[0][0].data.strategyParams;
      expect(updated.entryDate).toBeUndefined();
    });
  });

});
