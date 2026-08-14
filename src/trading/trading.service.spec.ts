import { Test, TestingModule } from '@nestjs/testing';
import { Broker } from '@prisma/client';
import { TradingService } from './trading.service';
import { TradingSellApprovalService } from './trading-sell-approval.service';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { PrismaService } from '../prisma.service';
import { SlackService } from '../notification/slack.service';
import { ConfigService } from '@nestjs/config';
import { MarketAnalysisService } from './market-analysis.service';
import { TradingOrderExecutionService } from './trading-order-execution.service';
import { TradingBrokerContextService } from './trading-broker-context.service';
import { TradingBrokerOrderSubmissionService } from './trading-broker-order-submission.service';
import { TradingOrderGuardService } from './trading-order-guard.service';

describe('TradingService', () => {
  let service: TradingService;

  const mockKisDomestic = {
    getPrice: jest.fn(),
    getBalance: jest.fn(),
    orderBuy: jest.fn(),
    orderSell: jest.fn(),
    getOrderExecutions: jest.fn(),
  };

  const mockKisOverseas = {
    getPrice: jest.fn(),
    getBalance: jest.fn(),
    orderBuy: jest.fn(),
    orderSell: jest.fn(),
    getOrderExecutions: jest.fn(),
  };

  const mockPrisma = {
    $transaction: jest.fn(),
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
    stopLossApproval: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const mockSlackService = {
    isEnabled: jest.fn().mockReturnValue(true),
    sendFilterLog: jest.fn(),
    sendInsufficientFundsAlert: jest.fn(),
    sendStopLossApproval: jest.fn(),
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

  const mockOrderExecutionService = {
    execute: jest.fn().mockResolvedValue(true),
  };

  const mockBrokerContext = {
    getCurrentContext: jest.fn().mockReturnValue({
      broker: Broker.KIS,
      environment: 'PAPER',
      accountHash: 'account-hash',
      maskedAccount: '****1234-01',
    }),
  };

  const mockOrderGuard = {
    admit: jest.fn(),
  };

  beforeEach(async () => {
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
    mockPrisma.stopLossApproval.findMany.mockResolvedValue([]);
    mockPrisma.stopLossApproval.updateMany.mockResolvedValue({ count: 1 });
    mockOrderGuard.admit.mockImplementation(async (_key, createWithTx) => createWithTx(mockPrisma));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradingService,
        TradingSellApprovalService,
        { provide: KisDomesticService, useValue: mockKisDomestic },
        { provide: KisOverseasService, useValue: mockKisOverseas },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MarketAnalysisService, useValue: mockMarketAnalysis },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: TradingOrderExecutionService, useValue: mockOrderExecutionService },
        { provide: TradingBrokerContextService, useValue: mockBrokerContext },
        { provide: TradingOrderGuardService, useValue: mockOrderGuard },
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
    it('does not reach a broker port when the context broker is missing', async () => {
      const port = { submitOrder: jest.fn().mockResolvedValue({}) };
      const registry = { get: jest.fn().mockReturnValue(port) };
      const gateway = new TradingBrokerOrderSubmissionService(registry as never);
      mockOrderExecutionService.execute.mockImplementationOnce(async (signal) => {
        await gateway.submit(signal);
        return true;
      });
      const strategy = {
        name: 'test-strategy',
        evaluateStock: jest.fn().mockResolvedValue({
          signals: [{
            market: 'DOMESTIC',
            exchangeCode: 'KRX',
            stockCode: '005930',
            side: 'BUY',
            quantity: 1,
            price: 70_000,
            reason: 'test buy',
          }],
          skipReasons: [],
        }),
      };
      const context = {
        watchStock: {
          id: 'ws-missing-broker',
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          stockName: '삼성전자',
          cycle: 0,
          maxCycles: 1,
          stopLossRate: 0.1,
          maxPortfolioRate: 1,
        },
        price: { currentPrice: 70_000 },
        alreadyExecutedToday: false,
        marketCondition: {},
        stockIndicators: {},
        buyableAmount: 70_000,
        totalPortfolioValue: 70_000,
      } as any;

      await service.executePerStockStrategy(strategy as any, [context]);

      expect(registry.get).not.toHaveBeenCalled();
      expect(port.submitOrder).not.toHaveBeenCalled();
    });

    it('routes every generated signal with the WatchStock broker as truth', async () => {
      const strategy = {
        name: 'test-strategy',
        evaluateStock: jest.fn().mockResolvedValue({
          signals: [{
            broker: Broker.KIS,
            market: 'OVERSEAS',
            exchangeCode: 'NASD',
            stockCode: 'TQQQ',
            side: 'BUY',
            quantity: 1,
            price: 50,
            reason: 'test buy',
          }],
          skipReasons: [],
        }),
      };
      const context = {
        watchStock: {
          id: 'ws-toss',
          broker: Broker.TOSS,
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          cycle: 0,
          maxCycles: 1,
          stopLossRate: 0.1,
          maxPortfolioRate: 1,
        },
        price: { currentPrice: 50 },
        alreadyExecutedToday: false,
        marketCondition: {},
        stockIndicators: {},
        buyableAmount: 50,
        totalPortfolioValue: 50,
      } as any;

      await service.executePerStockStrategy(strategy as any, [context]);

      expect(mockOrderExecutionService.execute).toHaveBeenCalledWith(
        expect.objectContaining({ broker: Broker.TOSS, stockCode: 'TQQQ' }),
        'test-strategy',
        context,
        undefined,
      );
    });

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
            broker: Broker.KIS,
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
            broker: Broker.KIS,
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
            broker: Broker.KIS,
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
            broker: Broker.KIS,
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
          message: '자전거래/수수료 방지: 매수·매도 가격 간격이 부족하여 해당 매수 스킵',
          details: expect.objectContaining({
            skipReason: 'INSUFFICIENT_SAME_CYCLE_PROFIT_GAP',
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

    it('should skip BUY submission when same-cycle SELL does not clear the configured cost buffer', async () => {
      const buySignal = {
        market: 'OVERSEAS',
        exchangeCode: 'AMEX',
        stockCode: 'SOXL',
        side: 'BUY',
        quantity: 1,
        price: 294.28,
        reason: 'Buy1',
        orderDivision: '00',
      };
      const sellSignal = {
        market: 'OVERSEAS',
        exchangeCode: 'AMEX',
        stockCode: 'SOXL',
        side: 'SELL',
        quantity: 1,
        price: 294.27,
        reason: 'Take profit 1',
        orderDivision: '00',
        metadata: {
          sameCycleMinProfitRate: 0.006,
        },
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
            broker: Broker.KIS,
            market: 'OVERSEAS',
            exchangeCode: 'AMEX',
            stockCode: 'SOXL',
            stockName: 'SOXL',
            strategyName: 'infinite-buy',
            quota: 10000,
            cycle: 1.9,
            maxCycles: 40,
            stopLossRate: 0.5,
            maxPortfolioRate: 1,
            strategyParams: {},
          },
          position: {
            stockCode: 'SOXL',
            quantity: 2,
            avgPrice: 253.89,
            currentPrice: 294.27,
            totalInvested: 507.78,
          },
          price: { currentPrice: 294.28 } as any,
          alreadyExecutedToday: false,
          marketCondition: {} as any,
          stockIndicators: {} as any,
          buyableAmount: 6500.88,
          totalPortfolioValue: 0,
        },
      ]);

      expect(executeSignalSpy).toHaveBeenCalledTimes(1);
      expect(executeSignalSpy).toHaveBeenCalledWith(
        expect.objectContaining({ side: 'SELL', quantity: 1, price: 294.27 }),
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
          details: expect.objectContaining({
            skipReason: 'INSUFFICIENT_SAME_CYCLE_PROFIT_GAP',
            minProfitRate: 0.006,
            blockedSignals: [expect.objectContaining({ side: 'BUY', price: 294.28 })],
            executableSignals: [expect.objectContaining({ side: 'SELL', price: 294.27 })],
          }),
        }),
      });
    });

    it('submits BUY and SELL when their prices differ enough in the same cycle', async () => {
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
        metadata: {
          sameCycleMinProfitRate: 0.006,
        },
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
            broker: Broker.KIS,
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
            skipReason: 'INSUFFICIENT_SAME_CYCLE_PROFIT_GAP',
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
            broker: Broker.KIS,
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
            broker: Broker.KIS,
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
    it('keeps approval classification in TradingService and delegates ordinary execution unchanged', async () => {
      const executionService = {
        execute: jest.fn().mockResolvedValue(true),
      };
      (service as any).orderExecutionService = executionService;
      mockPrisma.tradeRecord.create.mockResolvedValue({ id: 'legacy-path' });
      mockPrisma.tradeRecord.update.mockResolvedValue({});
      mockKisDomestic.orderBuy.mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        orderNo: 'legacy-order',
        brokerOrderDate: '20260713',
        orderTime: '101112',
        message: '접수',
      });
      const signal = {
        market: 'DOMESTIC' as const,
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'BUY' as const,
        quantity: 1,
        price: 70_000,
        reason: 'ordinary buy',
      };
      const details = { adjustedQuota: 70_000 };

      await expect(
        (service as any).executeSignal(signal, 'daily-dca', undefined, details),
      ).resolves.toBe(true);

      expect(executionService.execute).toHaveBeenCalledWith(
        signal,
        'daily-dca',
        undefined,
        details,
      );
      expect(mockKisDomestic.orderBuy).not.toHaveBeenCalled();
    });

    it('passes buyable diagnostics to the automatic execution service', async () => {
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
            broker: Broker.KIS,
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

      expect(mockOrderExecutionService.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          market: 'OVERSEAS',
          stockCode: 'TQQQ',
          side: 'BUY',
        }),
        'infinite-buy',
        expect.objectContaining({
          buyableAmount: 109.2,
          buyableMeta: expect.objectContaining({
            source: 'KIS_OVERSEAS_INQUIRE_PSAMOUNT',
            maxQuantity: 1,
          }),
        }),
        expect.objectContaining({
          preCashCappedQuota: 212.5,
          adjustedQuota: 109.2,
          buy1Qty: 1,
          buy2Qty: 0,
        }),
      );
    });
  });

  describe('manual SELL approvals', () => {
    const baseContext = {
      watchStock: {
        id: 'ws-approval',
        broker: Broker.KIS,
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
      price: { currentPrice: 220 } as any,
      position: {
        stockCode: 'TQQQ',
        quantity: 10,
        avgPrice: 200,
        currentPrice: 220,
        totalInvested: 2000,
      },
      alreadyExecutedToday: false,
      marketCondition: {} as any,
      stockIndicators: {} as any,
      buyableAmount: 0,
      totalPortfolioValue: 0,
    };

    beforeEach(() => {
      mockPrisma.tradeRecord.create.mockResolvedValue({ id: 'trade-approval' });
      mockPrisma.tradeRecord.update.mockResolvedValue({});
      mockPrisma.stopLossApproval.findFirst.mockResolvedValue(null);
      mockPrisma.stopLossApproval.create.mockResolvedValue({ id: 'approval-1' });
      mockPrisma.stopLossApproval.update.mockResolvedValue({});
      mockSlackService.sendStopLossApproval.mockImplementation(async () => ({
        ts: String(Date.now() / 1000),
        channel: '#test',
      }));
      mockKisDomestic.orderSell.mockResolvedValue({ success: true, orderNo: 'D-1', message: 'SELL order placed' });
      mockKisOverseas.orderSell.mockResolvedValue({ success: true, orderNo: 'O-1', message: 'SELL order placed' });
    });

    it('requires approval for Korean stop-loss liquidation signals instead of submitting a sell order', async () => {
      const result = await (service as any).executeSignal(
        {
          broker: Broker.KIS,
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          side: 'SELL',
          quantity: 3,
          price: undefined,
          reason: '손절청산: -2.1% <= -2.0%',
          metadata: { phase: 'intraday-stop' },
        },
        'momentum-breakout',
        {
          ...baseContext,
          watchStock: {
            ...baseContext.watchStock,
            market: 'DOMESTIC',
            exchangeCode: 'KRX',
            stockCode: '005930',
            stockName: '삼성전자',
            strategyName: 'momentum-breakout',
          },
          price: { currentPrice: 68000 } as any,
          position: {
            stockCode: '005930',
            quantity: 3,
            avgPrice: 70000,
            currentPrice: 68000,
            totalInvested: 210000,
          },
        },
      );

      expect(result).toBe(false);
      expect(mockKisDomestic.orderSell).not.toHaveBeenCalled();
      expect(mockPrisma.stopLossApproval.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          stockCode: '005930',
          quantity: 3,
          status: 'PENDING',
          expiresAt: expect.any(Date),
          signal: expect.objectContaining({
            reason: '손절청산: -2.1% <= -2.0%',
            metadata: expect.objectContaining({ phase: 'intraday-stop' }),
          }),
        }),
      });
      const createdApproval = mockPrisma.stopLossApproval.create.mock.calls[0][0].data;
      expect(createdApproval.expiresAt.getTime() - createdApproval.requestedAt.getTime()).toBe(
        2 * 60 * 1000,
      );
      expect(mockSlackService.sendStopLossApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalId: 'approval-1',
          stockCode: '005930',
          approvalReason: '손절청산: -2.1% <= -2.0%',
          expectedPnl: -6000,
          expectedPnlRate: expect.closeTo(-0.028571, 6),
        }),
      );
    });

    it('requires approval for infinite-buy take-profit signals when T is 20 or higher', async () => {
      const result = await (service as any).executeSignal(
        {
          broker: Broker.KIS,
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          side: 'SELL',
          quantity: 4,
          price: 220,
          reason: 'Take profit 1: T=20.5, target +8.0%',
          orderDivision: '00',
          metadata: { phase: 'take-profit-1', tValue: 20.5 },
        },
        'infinite-buy',
        baseContext,
      );

      expect(result).toBe(false);
      expect(mockKisOverseas.orderSell).not.toHaveBeenCalled();
      expect(mockSlackService.sendStopLossApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          stockCode: 'TQQQ',
          approvalReason: 'Take profit 1: T=20.5, target +8.0%',
          expectedPnl: 80,
          expectedPnlRate: 0.1,
        }),
      );
    });

    it('keeps trend-following trend-exit sell signals automatic', async () => {
      const signal = {
        market: 'OVERSEAS' as const,
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'SELL' as const,
        quantity: 10,
        price: 190,
        reason: '추세소멸: ADX=18.5 < 20',
      };
      const context = {
        ...baseContext,
        watchStock: {
          ...baseContext.watchStock,
          strategyName: 'trend-following',
        },
        price: { currentPrice: 190 } as any,
        position: {
          stockCode: 'TQQQ',
          quantity: 10,
          avgPrice: 200,
          currentPrice: 190,
          totalInvested: 2000,
        },
      };

      const result = await (service as any).executeSignal(
        signal,
        'trend-following',
        context,
      );

      expect(result).toBe(true);
      expect(mockOrderExecutionService.execute).toHaveBeenCalledWith(
        signal,
        'trend-following',
        context,
        undefined,
      );
      expect(mockKisOverseas.orderSell).not.toHaveBeenCalled();
      expect(mockPrisma.tradeRecord.create).not.toHaveBeenCalled();
      expect(mockSlackService.sendStopLossApproval).not.toHaveBeenCalled();
    });

    it('keeps ordinary infinite-buy take-profit under T20 automatic', async () => {
      const result = await (service as any).executeSignal(
        {
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          side: 'SELL',
          quantity: 4,
          price: 220,
          reason: 'Take profit 1: T=19.9, target +8.0%',
          orderDivision: '00',
          metadata: { phase: 'take-profit-1', tValue: 19.9 },
        },
        'infinite-buy',
        baseContext,
      );

      expect(result).toBe(true);
      expect(mockOrderExecutionService.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          market: 'OVERSEAS',
          stockCode: 'TQQQ',
          side: 'SELL',
          quantity: 4,
          price: 220,
        }),
        'infinite-buy',
        baseContext,
        undefined,
      );
      expect(mockKisOverseas.orderSell).not.toHaveBeenCalled();
      expect(mockSlackService.sendStopLossApproval).not.toHaveBeenCalled();
    });
  });

  describe('executeApprovedStopLoss', () => {
    it('fails closed and directs callers to the actor-aware workflow without side effects', async () => {
      const signal = {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'SELL',
        quantity: 4,
        price: 220,
        reason: 'Take profit 1: T=20.5, target +8.0%',
        orderDivision: '00',
        metadata: { phase: 'take-profit-1', tValue: 20.5 },
      };
      mockPrisma.stopLossApproval.findUnique.mockResolvedValue({
        id: 'approval-1',
        status: 'APPROVED',
        tradeRecordId: 'trade-approval',
        signal,
        tradeRecord: {
          id: 'trade-approval',
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          strategyName: 'infinite-buy',
        },
      });
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-approval',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        strategyName: 'infinite-buy',
      });
      mockKisOverseas.getBalance.mockResolvedValue([]);
      mockPrisma.position.findFirst.mockResolvedValue({
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        quantity: 4,
        avgPrice: 200,
        currentPrice: 220,
        totalInvested: 800,
      });
      mockPrisma.tradeRecord.update.mockResolvedValue({});
      mockKisOverseas.orderSell.mockResolvedValue({
        success: true,
        orderNo: 'O-1',
        message: 'SELL order placed',
      });

      const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation();
      let thrown: unknown;
      try {
        await service.executeApprovedStopLoss('approval-1');
      } catch (error) {
        thrown = error;
      }

      expect({
        thrownMessage: thrown instanceof Error ? thrown.message : undefined,
        warning: warnSpy.mock.calls[0]?.[0],
        approvalReads: mockPrisma.stopLossApproval.findUnique.mock.calls.length,
        approvalMutations: mockPrisma.stopLossApproval.update.mock.calls.length
          + mockPrisma.stopLossApproval.updateMany.mock.calls.length,
        tradeMutations: mockPrisma.tradeRecord.update.mock.calls.length
          + mockPrisma.tradeRecord.updateMany.mock.calls.length,
        positionRefreshes: mockKisDomestic.getBalance.mock.calls.length
          + mockKisOverseas.getBalance.mock.calls.length
          + mockPrisma.position.findFirst.mock.calls.length,
        kisOrders: mockKisDomestic.orderSell.mock.calls.length
          + mockKisOverseas.orderSell.mock.calls.length,
        slackCalls: Object.values(mockSlackService)
          .reduce((count, mock) => count + mock.mock.calls.length, 0),
      }).toEqual({
        thrownMessage: expect.stringContaining('TradingSellApprovalWorkflowService'),
        warning: expect.stringContaining('[APPROVAL approval-1]'),
        approvalReads: 0,
        approvalMutations: 0,
        tradeMutations: 0,
        positionRefreshes: 0,
        kisOrders: 0,
        slackCalls: 0,
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

    it('uses only the watch stock broker position for the same-day second target quantity', async () => {
      const executeSignalSpy = jest.spyOn(service as any, 'executeSignal').mockResolvedValue(true);
      const persistPlanSpy = jest
        .spyOn(service as any, 'persistInfiniteBuySecondaryExitPlan')
        .mockResolvedValue(undefined);
      jest.spyOn(service as any, 'getMinutesUntilMarketClose').mockReturnValue(180);

      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-1',
        broker: Broker.KIS,
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
      mockPrisma.position.findFirst.mockImplementation(({ where }) => (
        where.broker === Broker.KIS
          ? Promise.resolve({
            broker: Broker.KIS,
            stockCode: 'TQQQ',
            quantity: 2,
            avgPrice: 52.1,
            currentPrice: 58.4,
            totalInvested: 104.2,
          })
          : Promise.resolve({
            broker: Broker.TOSS,
            stockCode: 'TQQQ',
            quantity: 99,
            avgPrice: 52.1,
            currentPrice: 58.4,
            totalInvested: 5157.9,
          })
      ));
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
            tValue: 20.5,
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
            tValue: 20.5,
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
      expect(mockPrisma.position.findFirst).toHaveBeenCalledWith({
        where: {
          broker: Broker.KIS,
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
        },
      });
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

  describe('infinite-buy-v4 상태 영속화 (persistInfiniteBuyV4State)', () => {
    function buildV4Ctx(v4: Record<string, any>): any {
      return {
        watchStock: {
          id: 'ws-v4',
          broker: Broker.KIS,
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          strategyName: 'infinite-buy-v4',
          quota: 20000,
          cycle: 0,
          maxCycles: 40,
          stopLossRate: 0.5,
          maxPortfolioRate: 1,
          strategyParams: { v4 },
        },
        price: { currentPrice: 50 },
        alreadyExecutedToday: false,
        marketCondition: {},
        stockIndicators: {},
        buyableAmount: 15000,
        totalPortfolioValue: 20000,
      };
    }

    it('mode/recentCloses를 strategyParams.v4에 저장하고 turn/cashRemaining/cycleSeq는 보존한다', async () => {
      const strategy = {
        name: 'infinite-buy-v4',
        evaluateStock: jest.fn().mockResolvedValue({
          signals: [],
          skipReasons: ['오늘 이미 실행됨'],
          details: {
            v4StateUpdate: { mode: 'NORMAL', recentCloses: [{ date: '2026-07-27', close: 51 }] },
          },
        }),
      };
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-v4',
        strategyParams: { v4: { mode: 'NORMAL', turn: 10, cashRemaining: 15000, cycleSeq: 0 } },
      });

      await service.executePerStockStrategy(
        strategy as any,
        [buildV4Ctx({ mode: 'NORMAL', turn: 10, cashRemaining: 15000, cycleSeq: 0 })],
      );

      expect(mockPrisma.watchStock.update).toHaveBeenCalledWith({
        where: { id: 'ws-v4' },
        data: {
          strategyParams: {
            v4: {
              mode: 'NORMAL',
              turn: 10,
              cashRemaining: 15000,
              cycleSeq: 0,
              recentCloses: [{ date: '2026-07-27', close: 51 }],
            },
          },
        },
      });
    });

    it('NORMAL→REVERSE 전환 시 로그를 1회 남긴다', async () => {
      const strategy = {
        name: 'infinite-buy-v4',
        evaluateStock: jest.fn().mockResolvedValue({
          signals: [],
          skipReasons: ['오늘 이미 실행됨'],
          details: { v4StateUpdate: { mode: 'REVERSE', recentCloses: [] } },
        }),
      };
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-v4',
        strategyParams: { v4: { mode: 'NORMAL', turn: 39.5, cashRemaining: 100, cycleSeq: 0 } },
      });

      await service.executePerStockStrategy(
        strategy as any,
        [buildV4Ctx({ mode: 'NORMAL', turn: 39.5, cashRemaining: 100, cycleSeq: 0 })],
      );

      expect(mockPrisma.watchStockExecutionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: 'SIGNAL_CREATED',
            message: expect.stringContaining('REVERSE 모드 진입'),
            details: { phase: 'v4-reverse-enter' },
          }),
        }),
      );
    });

    it('이미 REVERSE 모드면 진입 알림을 다시 남기지 않는다', async () => {
      const strategy = {
        name: 'infinite-buy-v4',
        evaluateStock: jest.fn().mockResolvedValue({
          signals: [],
          skipReasons: ['오늘 이미 실행됨'],
          details: { v4StateUpdate: { mode: 'REVERSE', recentCloses: [] } },
        }),
      };
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-v4',
        strategyParams: { v4: { mode: 'REVERSE', turn: 39.5, cashRemaining: 100, cycleSeq: 0 } },
      });

      await service.executePerStockStrategy(
        strategy as any,
        [buildV4Ctx({ mode: 'REVERSE', turn: 39.5, cashRemaining: 100, cycleSeq: 0 })],
      );

      expect(mockPrisma.watchStockExecutionLog.create).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ message: expect.stringContaining('REVERSE 모드 진입') }),
        }),
      );
    });
  });

  describe('infinite-buy-v4 체결 후처리 (handleInfiniteBuyV4SignalFill)', () => {
    function mockWatchStockV4(v4: Record<string, any>, overrides: Record<string, any> = {}) {
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-v4',
        stockCode: 'TQQQ',
        quota: 20000,
        maxCycles: 40,
        strategyParams: { v4 },
        ...overrides,
      });
    }

    it('NORMAL BUY 체결: 실제 체결가(executedPrice) 기준으로 cashRemaining 차감 + T 증가', async () => {
      mockWatchStockV4({ mode: 'NORMAL', turn: 10, cashRemaining: 15000, cycleSeq: 0 });

      await service.handleStrategySignalFill(
        'infinite-buy-v4',
        'ws-v4',
        {
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          side: 'BUY',
          quantity: 10,
          price: 50,
          reason: 'V4 v4-avg-buy: 10주 @ 50',
          orderDivision: '34',
          metadata: { phase: 'v4-avg-buy', v4AttemptAmount: 250 },
        },
        100, // previousHoldingQty
        undefined,
        49.8, // executedPrice — 제출가(50)와 다른 실제 체결가
      );

      const updated = mockPrisma.watchStock.update.mock.calls[0][0].data.strategyParams.v4;
      expect(updated.cashRemaining).toBeCloseTo(15000 - 49.8 * 10, 2); // 498 체결금액 기준
      expect(updated.turn).toBeCloseTo(10 + (49.8 * 10) / 250, 6);
      expect(updated.lastKnownHoldQty).toBe(110);
      expect(updated.cycleSeq).toBe(0);
    });

    it('전반전 두 leg 전량 체결 시 합계 ΔT=+1 (분모는 당일 총액 — leg별 분모면 +2가 되는 회귀 고정)', async () => {
      // 평단 leg 5주@50=250 + 별지점 leg 5주@50=250, 당일 BUY 총액 500.
      const dayTotal = 500;
      const legMeta = (phase: string) => ({
        phase,
        v4AttemptAmount: 250,
        v4DayBuyAttemptTotal: dayTotal,
      });
      const legSignal = (phase: string) => ({
        market: 'OVERSEAS' as const,
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'BUY' as const,
        quantity: 5,
        price: 50,
        reason: `V4 ${phase}: 5주 @ 50`,
        orderDivision: '34',
        metadata: legMeta(phase),
      });

      mockWatchStockV4({ mode: 'NORMAL', turn: 10, cashRemaining: 15000, cycleSeq: 0 });
      await service.handleStrategySignalFill('infinite-buy-v4', 'ws-v4', legSignal('v4-avg-buy'), 100, undefined, 50);
      const afterFirst = mockPrisma.watchStock.update.mock.calls[0][0].data.strategyParams.v4;
      expect(afterFirst.turn).toBeCloseTo(10.5, 6); // 250/500 = +0.5

      // 두 번째 leg는 첫 체결이 반영된 상태에서 이어진다.
      mockWatchStockV4({ ...afterFirst });
      await service.handleStrategySignalFill('infinite-buy-v4', 'ws-v4', legSignal('v4-star-buy'), 105, undefined, 50);
      const afterSecond = mockPrisma.watchStock.update.mock.calls[1][0].data.strategyParams.v4;
      expect(afterSecond.turn).toBeCloseTo(11, 6); // 합계 정확히 +1
      expect(afterSecond.cashRemaining).toBeCloseTo(15000 - 500, 2);
    });

    it('BUY 체결가 없으면 제출가(signal.price)로 대체한다', async () => {
      mockWatchStockV4({ mode: 'NORMAL', turn: 0, cashRemaining: 20000, cycleSeq: 0 });

      await service.handleStrategySignalFill(
        'infinite-buy-v4',
        'ws-v4',
        {
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          side: 'BUY',
          quantity: 8,
          price: 56,
          reason: 'V4 v4-first-buy: 8주 @ 56',
          orderDivision: '34',
          metadata: { phase: 'v4-first-buy', v4AttemptAmount: 448 },
        },
        0,
      );

      const updated = mockPrisma.watchStock.update.mock.calls[0][0].data.strategyParams.v4;
      expect(updated.cashRemaining).toBeCloseTo(20000 - 56 * 8, 2);
    });

    it('REVERSE BUY 체결: applyBuyFillToT의 reverse 식(N 포함)을 사용한다', async () => {
      mockWatchStockV4({ mode: 'REVERSE', turn: 37.525, cashRemaining: 400, cycleSeq: 0 });

      await service.handleStrategySignalFill(
        'infinite-buy-v4',
        'ws-v4',
        {
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          side: 'BUY',
          quantity: 2,
          price: 45.99,
          reason: 'V4 v4-reverse-buy: 2주 @ 45.99',
          orderDivision: '34',
          metadata: { phase: 'v4-reverse-buy', v4AttemptAmount: 100 },
        },
        190,
        undefined,
        45.99,
      );

      const updated = mockPrisma.watchStock.update.mock.calls[0][0].data.strategyParams.v4;
      const fillAmount = 45.99 * 2;
      const expectedT = 37.525 + (40 - 37.525) * 0.25 * (fillAmount / 100);
      expect(updated.turn).toBeCloseTo(expectedT, 6);
      expect(updated.cashRemaining).toBeCloseTo(400 - fillAmount, 2);
      expect(updated.lastKnownHoldQty).toBe(192);
    });

    it('SELL 부분 체결(쿼터매도): metadata.v4PrevHolding 기준으로 T를 축소하고 cashRemaining을 늘린다', async () => {
      mockWatchStockV4({ mode: 'NORMAL', turn: 10, cashRemaining: 15000, cycleSeq: 0 });

      await service.handleStrategySignalFill(
        'infinite-buy-v4',
        'ws-v4',
        {
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          side: 'SELL',
          quantity: 25,
          price: 53.75,
          reason: 'V4 v4-quarter-sell: 25주 @ 53.75',
          orderDivision: '34',
          metadata: { phase: 'v4-quarter-sell', v4PrevHolding: 100 },
        },
        100, // previousHoldingQty (reconciliation 관점의 fill 직전 보유수량)
        undefined,
        53.75,
      );

      const updated = mockPrisma.watchStock.update.mock.calls[0][0].data.strategyParams.v4;
      expect(updated.turn).toBeCloseTo(10 * (1 - 25 / 100), 6); // 7.5
      expect(updated.cashRemaining).toBeCloseTo(15000 + 53.75 * 25, 2);
      expect(updated.lastKnownHoldQty).toBe(75);
      expect(updated.cycleSeq).toBe(0); // 사이클 종료 아님 (보유 잔존)
    });

    it('SELL 체결 후 보유수량 0: 사이클 종료 — T=0, cycleSeq+=1, compoundMode=true면 수익 재투입', async () => {
      mockWatchStockV4({ mode: 'NORMAL', turn: 2.5, cashRemaining: 16343.75, cycleSeq: 0, compoundMode: true });

      await service.handleStrategySignalFill(
        'infinite-buy-v4',
        'ws-v4',
        {
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          side: 'SELL',
          quantity: 75,
          price: 57.5,
          reason: 'V4 v4-final-sell: 75주 @ 57.5',
          orderDivision: '00',
          metadata: { phase: 'v4-final-sell', v4PrevHolding: 75 },
        },
        75,
        undefined,
        57.5,
      );

      const updated = mockPrisma.watchStock.update.mock.calls[0][0].data.strategyParams.v4;
      expect(updated.turn).toBe(0);
      expect(updated.cycleSeq).toBe(1);
      expect(updated.cashRemaining).toBeCloseTo(16343.75 + 57.5 * 75, 2); // 복리 — 수익 그대로 재투입
      expect(updated.lastKnownHoldQty).toBe(0);
    });

    it('SELL 체결 후 보유수량 0 + compoundMode=false: 원금 초과분은 제외하고 재설정', async () => {
      mockWatchStockV4({ mode: 'NORMAL', turn: 2.5, cashRemaining: 16343.75, cycleSeq: 0, compoundMode: false });

      await service.handleStrategySignalFill(
        'infinite-buy-v4',
        'ws-v4',
        {
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          side: 'SELL',
          quantity: 75,
          price: 57.5,
          reason: 'V4 v4-final-sell: 75주 @ 57.5',
          orderDivision: '00',
          metadata: { phase: 'v4-final-sell', v4PrevHolding: 75 },
        },
        75,
        undefined,
        57.5,
      );

      const updated = mockPrisma.watchStock.update.mock.calls[0][0].data.strategyParams.v4;
      expect(updated.turn).toBe(0);
      expect(updated.cycleSeq).toBe(1);
      expect(updated.cashRemaining).toBe(20000); // quota(원금) 상한으로 클램프 — 단리
    });

    it(
      '같은 pass 쿼터+최종매도 동시 체결: reconciliation의 스냅샷 역산 prevHolding이 틀려도 '
      + 'v4.lastKnownHoldQty 체이닝으로 쿼터매도에서 조기 사이클 종료가 없고 최종매도에서 정확히 1회 종료된다',
      async () => {
        // 실제 순서: 보유 100 → 쿼터매도 25체결(보유 75) → 최종매도 75체결(보유 0).
        // reconciliation은 pass 종료 후 스냅샷(0)을 역산해 qtyBeforeFill을 구하므로
        // 쿼터 레코드에 25(오답, 정답은 100), 최종 레코드에 75(우연히 정답)를 넘긴다.
        mockWatchStockV4({ mode: 'NORMAL', turn: 10, cashRemaining: 15000, cycleSeq: 0, lastKnownHoldQty: 100 });

        await service.handleStrategySignalFill(
          'infinite-buy-v4',
          'ws-v4',
          {
            market: 'OVERSEAS',
            exchangeCode: 'NASD',
            stockCode: 'TQQQ',
            side: 'SELL',
            quantity: 25,
            price: 53.75,
            reason: 'V4 v4-quarter-sell: 25주 @ 53.75',
            orderDivision: '34',
            metadata: { phase: 'v4-quarter-sell', v4PrevHolding: 100 },
          },
          25, // reconciliation의 (틀린) qtyBeforeFill — 체이닝이 없으면 25-25=0으로 오판
          undefined,
          53.75,
        );

        const afterQuarter = mockPrisma.watchStock.update.mock.calls[0][0].data.strategyParams.v4;
        expect(afterQuarter.lastKnownHoldQty).toBe(75); // 체이닝된 100 - 25
        expect(afterQuarter.turn).toBeCloseTo(10 * (1 - 25 / 100), 6); // 7.5 — 조기 T=0 리셋 없음
        expect(afterQuarter.cycleSeq).toBe(0); // 조기 사이클 종료 없음

        mockWatchStockV4({ ...afterQuarter });
        await service.handleStrategySignalFill(
          'infinite-buy-v4',
          'ws-v4',
          {
            market: 'OVERSEAS',
            exchangeCode: 'NASD',
            stockCode: 'TQQQ',
            side: 'SELL',
            quantity: 75,
            price: 57.5,
            reason: 'V4 v4-final-sell: 75주 @ 57.5',
            orderDivision: '00',
            metadata: { phase: 'v4-final-sell', v4PrevHolding: 75 },
          },
          75, // reconciliation의 qtyBeforeFill (이 경우는 우연히 정답)
          undefined,
          57.5,
        );

        const afterFinal = mockPrisma.watchStock.update.mock.calls[1][0].data.strategyParams.v4;
        expect(afterFinal.turn).toBe(0);
        expect(afterFinal.cycleSeq).toBe(1); // 딱 1회만 종료 (이중 증가 없음)
        expect(afterFinal.lastKnownHoldQty).toBe(0);
      },
    );

    it('v4.lastKnownHoldQty가 없으면(최초 체결) reconciliation이 전달한 previousHoldingQty로 fallback한다', async () => {
      mockWatchStockV4({ mode: 'NORMAL', turn: 5, cashRemaining: 10000, cycleSeq: 0 }); // lastKnownHoldQty 미설정

      await service.handleStrategySignalFill(
        'infinite-buy-v4',
        'ws-v4',
        {
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          side: 'SELL',
          quantity: 50,
          price: 55,
          reason: 'V4 v4-final-sell: 50주 @ 55',
          orderDivision: '00',
          metadata: { phase: 'v4-final-sell', v4PrevHolding: 50 },
        },
        50, // lastKnownHoldQty 부재 — 이 reconciliation 전달값이 그대로 사용돼야 함
        undefined,
        55,
      );

      const updated = mockPrisma.watchStock.update.mock.calls[0][0].data.strategyParams.v4;
      expect(updated.lastKnownHoldQty).toBe(0); // 50 - 50 = 0
      expect(updated.cycleSeq).toBe(1);
    });
  });

  describe('infinite-buy-v4 제출 순서: SELL을 BUY보다 먼저 제출', () => {
    it('같은 평가에서 BUY/SELL 신호가 함께 나오면 SELL을 먼저 executeSignal에 넘긴다', async () => {
      const strategy = {
        name: 'infinite-buy-v4',
        evaluateStock: jest.fn().mockResolvedValue({
          signals: [
            {
              market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'TQQQ',
              side: 'BUY', quantity: 5, price: 50, reason: 'V4 v4-avg-buy', orderDivision: '34',
              metadata: { phase: 'v4-avg-buy', v4AttemptAmount: 250 },
            },
            {
              market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'TQQQ',
              side: 'BUY', quantity: 5, price: 53.74, reason: 'V4 v4-star-buy', orderDivision: '34',
              metadata: { phase: 'v4-star-buy', v4AttemptAmount: 250 },
            },
            {
              market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'TQQQ',
              side: 'SELL', quantity: 25, price: 53.75, reason: 'V4 v4-quarter-sell', orderDivision: '34',
              metadata: { phase: 'v4-quarter-sell', v4PrevHolding: 100 },
            },
            {
              market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'TQQQ',
              side: 'SELL', quantity: 75, price: 57.5, reason: 'V4 v4-final-sell', orderDivision: '00',
              metadata: { phase: 'v4-final-sell', v4PrevHolding: 100 },
            },
          ],
          skipReasons: [],
          details: { v4StateUpdate: { mode: 'NORMAL', recentCloses: [] } },
        }),
      };
      const executeSignalSpy = jest.spyOn(service as any, 'executeSignal').mockResolvedValue(true);
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-v4',
        strategyParams: { v4: { mode: 'NORMAL', turn: 10, cashRemaining: 15000, cycleSeq: 0 } },
      });

      await service.executePerStockStrategy(strategy as any, [{
        watchStock: {
          id: 'ws-v4',
          broker: Broker.KIS,
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          strategyName: 'infinite-buy-v4',
          quota: 20000,
          cycle: 0,
          maxCycles: 40,
          stopLossRate: 0.5,
          maxPortfolioRate: 1,
          strategyParams: { v4: { mode: 'NORMAL', turn: 10, cashRemaining: 15000, cycleSeq: 0 } },
        },
        price: { currentPrice: 55 },
        position: { stockCode: 'TQQQ', quantity: 100, avgPrice: 50, currentPrice: 55, totalInvested: 5000 },
        alreadyExecutedToday: false,
        marketCondition: {},
        stockIndicators: {},
        buyableAmount: 15000,
        totalPortfolioValue: 20000,
      }] as any);

      const submittedSides = executeSignalSpy.mock.calls.map((call) => (call[0] as any).side);
      expect(submittedSides).toEqual(['SELL', 'SELL', 'BUY', 'BUY']);
    });
  });

  describe('관망(silent wait) skip', () => {
    function buildWaitContext() {
      return {
        watchStock: {
          id: 'ws-1',
          broker: Broker.KIS,
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

  describe('시그널과 skipReasons가 함께 발생하는 경우 (once-daily 매수 스킵 로깅)', () => {
    function buildInfiniteBuyContext(overrides: Record<string, any> = {}) {
      return {
        watchStock: {
          id: 'ws-1',
          broker: Broker.KIS,
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          strategyName: 'infinite-buy',
          quota: 10000,
          cycle: 12.42,
          maxCycles: 40,
          stopLossRate: 0.3,
          maxPortfolioRate: 1,
          strategyParams: {},
        },
        position: {
          stockCode: 'TQQQ',
          quantity: 4,
          avgPrice: 50,
          currentPrice: 60,
          totalInvested: 200,
        },
        price: { currentPrice: 60 } as any,
        alreadyExecutedToday: false,
        marketCondition: {} as any,
        stockIndicators: {} as any,
        buyableAmount: 250,
        totalPortfolioValue: 0,
        ...overrides,
      };
    }

    it('SELL 시그널과 BUY 이월 스킵이 함께 발생하면 SIGNAL_CREATED와 별도로 SKIPPED 로그를 남긴다', async () => {
      const sellSignal = {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'SELL',
        quantity: 2,
        price: 60,
        reason: 'Take profit 1',
        orderDivision: '00',
      };
      const strategy = {
        name: 'infinite-buy',
        evaluateStock: jest.fn().mockResolvedValue({
          signals: [sellSignal],
          skipReasons: ['매수 수량 부족: 조정 할당금 250 < 기준가 300 (1주 매수 가능 기준가 250 이하)'],
          details: {},
        }),
      };
      jest.spyOn(service as any, 'executeSignal').mockResolvedValue(true);

      await service.executePerStockStrategy(strategy as any, [buildInfiniteBuyContext() as any]);

      expect(mockPrisma.watchStockExecutionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ eventType: 'SIGNAL_CREATED' }),
      });
      expect(mockPrisma.watchStockExecutionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'SKIPPED',
          message: expect.stringContaining('매수 스킵:'),
        }),
      });
      const skippedCall = mockPrisma.watchStockExecutionLog.create.mock.calls.find(
        ([arg]: any) => arg.data.eventType === 'SKIPPED',
      );
      expect(skippedCall[0].data.message).toContain('오늘 이월');
    });

    it('skipReasons가 없으면 SKIPPED 로그를 남기지 않는다', async () => {
      const buySignal = {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'BUY',
        quantity: 1,
        price: 60,
        reason: 'Buy1',
        orderDivision: '00',
      };
      const strategy = {
        name: 'infinite-buy',
        evaluateStock: jest.fn().mockResolvedValue({
          signals: [buySignal],
          skipReasons: [],
          details: {},
        }),
      };
      jest.spyOn(service as any, 'executeSignal').mockResolvedValue(true);

      await service.executePerStockStrategy(strategy as any, [buildInfiniteBuyContext() as any]);

      const skippedCall = mockPrisma.watchStockExecutionLog.create.mock.calls.find(
        ([arg]: any) => arg.data.eventType === 'SKIPPED',
      );
      expect(skippedCall).toBeUndefined();
    });

    it('관망 사유는 시그널이 있어도 SKIPPED로 로깅하지 않는다 (silent wait 규칙 유지)', async () => {
      const buySignal = {
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'BUY',
        quantity: 1,
        price: 71000,
        reason: '변동성돌파',
        orderDivision: '01',
      };
      const strategy = {
        name: 'momentum-breakout',
        evaluateStock: jest.fn().mockResolvedValue({
          signals: [buySignal],
          skipReasons: ['관망: 미체결 매도 주문 처리 대기'],
          details: {},
        }),
      };
      jest.spyOn(service as any, 'executeSignal').mockResolvedValue(true);

      await service.executePerStockStrategy(strategy as any, [
        {
          watchStock: {
            id: 'ws-2',
            broker: Broker.KIS,
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
          price: { currentPrice: 71000 } as any,
          alreadyExecutedToday: false,
          marketCondition: {} as any,
          stockIndicators: {} as any,
          buyableAmount: 1000000,
          totalPortfolioValue: 0,
        } as any,
      ]);

      expect(mockPrisma.watchStockExecutionLog.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.watchStockExecutionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ eventType: 'SIGNAL_CREATED' }),
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

    it('BUY 체결 시 filledAt(주문 시각) 날짜로 entryDate 기록 — reconciliation 지연 무관', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-1',
        stockCode: '005930',
        strategyParams: {},
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
        new Date('2026-06-09T14:50:00+09:00'), // 어제 장중 주문 — reconciliation이 자정을 넘겨도
      );

      const updated = mockPrisma.watchStock.update.mock.calls[0][0].data.strategyParams;
      expect(updated.entryDate).toBe('2026-06-09');
    });

    it('BUY 체결 시 metadata.entryDayHigh를 기록 (트레일링 "진입 후 고가" 기준)', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-1',
        stockCode: '005930',
        strategyParams: {},
      });

      await service.handleStrategySignalFill(
        'momentum-breakout',
        'ws-1',
        {
          ...baseSignal,
          side: 'BUY',
          reason: '변동성돌파: 돌파가 71000',
          metadata: { phase: 'vb-entry', breakoutPrice: 71000, entryDayHigh: 71600 },
        },
        13,
      );

      const updated = mockPrisma.watchStock.update.mock.calls[0][0].data.strategyParams;
      expect(updated.entryDayHigh).toBe(71600);
    });

    it.each([
      'carryover-exit',
      'intraday-stop',
      'trailing-stop',
      'take-profit',
      'eod-exit',
      'risk-liquidation',
    ])('SELL(%s) 체결 시 entryDate/entryDayHigh 제거', async (phase) => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-1',
        stockCode: '005930',
        strategyParams: { entryDate: '2026-06-10', entryDayHigh: 71600, kValue: 0.6 },
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
      expect(updated.entryDayHigh).toBeUndefined();
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
