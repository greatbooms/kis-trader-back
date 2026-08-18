import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Broker, OrderStatus } from '@prisma/client';
import { BrokerPortRegistry } from '../broker/broker-port.registry';
import { PrismaService } from '../prisma.service';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { TradeRecordManualOrderService } from './trade-record-manual-order.service';
import { TradeRecordResolver } from './trade-record.resolver';
import { TradingBrokerContextService } from '../trading/trading-broker-context.service';
import { TradingBrokerOrderRecoveryService } from '../trading/trading-broker-order-recovery.service';
import { TradingLiveSwitchService } from '../trading/trading-live-switch.service';
import { TradingOrderGuardService } from '../trading/trading-order-guard.service';
import { TradingPositionRefreshService } from '../trading/trading-position-refresh.service';
import { ManualSellInput } from './dto';

describe('TradeRecordManualOrderService', () => {
  let service: TradeRecordManualOrderService;
  const mockPositionFindFirst = jest.fn();
  const mockPositionFindMany = jest.fn((args) => Promise.resolve(
    mockPositionFindFirst(args),
  ).then((position) => position ? [{ broker: Broker.KIS, ...position }] : []));

  const mockPrisma = {
    tradeRecord: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    position: {
      findFirst: mockPositionFindFirst,
      findMany: mockPositionFindMany,
    },
  };

  const mockKisDomestic = {
    getPrice: jest.fn(),
    orderSell: jest.fn(),
    cancelOrder: jest.fn(),
    getUnfilledOrders: jest.fn(),
    getOrderExecutions: jest.fn(),
  };

  const mockKisOverseas = {
    getPrice: jest.fn(),
    orderSell: jest.fn(),
    cancelOrder: jest.fn(),
    getUnfilledOrders: jest.fn(),
    getOrderExecutions: jest.fn(),
  };
  const mockPort = {
    submitOrder: jest.fn((signal) => signal.market === 'DOMESTIC'
      ? mockKisDomestic.orderSell(
        signal.stockCode,
        signal.quantity,
        signal.price,
        signal.orderDivision,
      )
      : mockKisOverseas.orderSell(
        signal.exchangeCode,
        signal.stockCode,
        signal.quantity,
        signal.price,
        signal.orderDivision,
      )),
    getOrderExecutions: jest.fn((market, startDate, endDate) => market === 'DOMESTIC'
      ? mockKisDomestic.getOrderExecutions(startDate, endDate)
      : mockKisOverseas.getOrderExecutions(startDate, endDate)),
    getUnfilledOrders: jest.fn((market) => market === 'DOMESTIC'
      ? mockKisDomestic.getUnfilledOrders()
      : mockKisOverseas.getUnfilledOrders()),
    cancelOrder: jest.fn((request) => request.market === 'DOMESTIC'
      ? mockKisDomestic.cancelOrder(request.orderNo, request.stockCode, request.qty)
      : mockKisOverseas.cancelOrder(
        request.exchangeCode,
        request.orderNo,
        request.stockCode,
        request.qty,
        request.price,
      )),
  };
  const mockRegistry = {
    get: jest.fn().mockReturnValue(mockPort),
    isActive: jest.fn().mockReturnValue(true),
    requireActive: jest.fn().mockReturnValue(mockPort),
  };

  const mockLiveSwitch = {
    isEnabled: jest.fn().mockReturnValue(true),
  };

  const mockBrokerContext = {
    getCurrentContext: jest.fn((broker) => ({
      broker,
      environment: broker === Broker.TOSS ? 'PROD' : 'PAPER',
      accountHash: 'account-hash',
      maskedAccount: '****1234-01',
    })),
    matchesCurrentContext: jest.fn(
      (_broker, environment, accountHash) => (
        (environment === 'PAPER' || environment === 'PROD')
        && accountHash === 'account-hash'
      ),
    ),
  };

  const mockOrderGuard = {
    admit: jest.fn(),
  };

  const mockPositionRefresh = {
    refresh: jest.fn(),
  };

  const mockRecovery = {
    markSubmissionUnknown: jest.fn(),
    warnAcceptedOrderPersistenceFailure: jest.fn(),
    claimCancellation: jest.fn(),
    markCancellationAccepted: jest.fn(),
    markCancellationRejected: jest.fn(),
    markCancellationUnknown: jest.fn(),
    releaseCancellationClaim: jest.fn(),
  };

  const createService = async (tradingEnabled = true) => {
    mockLiveSwitch.isEnabled.mockReset().mockReturnValue(tradingEnabled);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeRecordManualOrderService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: KisDomesticService, useValue: mockKisDomestic },
        { provide: KisOverseasService, useValue: mockKisOverseas },
        { provide: BrokerPortRegistry, useValue: mockRegistry },
        { provide: TradingLiveSwitchService, useValue: mockLiveSwitch },
        { provide: TradingBrokerContextService, useValue: mockBrokerContext },
        { provide: TradingOrderGuardService, useValue: mockOrderGuard },
        { provide: TradingPositionRefreshService, useValue: mockPositionRefresh },
        { provide: TradingBrokerOrderRecoveryService, useValue: mockRecovery },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(tradingEnabled) },
        },
      ],
    }).compile();

    return module.get(TradeRecordManualOrderService);
  };

  beforeEach(async () => {
    service = await createService();
    mockRegistry.isActive.mockReset().mockReturnValue(true);
    mockRegistry.requireActive.mockReset().mockReturnValue(mockPort);
    mockPort.submitOrder.mockImplementation((signal) => signal.market === 'DOMESTIC'
      ? mockKisDomestic.orderSell(
        signal.stockCode,
        signal.quantity,
        signal.price,
        signal.orderDivision,
      )
      : mockKisOverseas.orderSell(
        signal.exchangeCode,
        signal.stockCode,
        signal.quantity,
        signal.price,
        signal.orderDivision,
      ));
    mockPositionFindMany.mockImplementation((args) => Promise.resolve(
      mockPositionFindFirst(args),
    ).then((position) => position ? [{ broker: Broker.KIS, ...position }] : []));
    mockRecovery.claimCancellation.mockResolvedValue(true);
    mockOrderGuard.admit.mockImplementation(async (_key, createWithTx) => createWithTx({
      tradeRecord: { create: mockPrisma.tradeRecord.create },
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('manualSell', () => {
    it('fails closed before context, guard, or broker access when no position matches', async () => {
      mockPositionFindMany.mockResolvedValue([]);

      await expect(service.manualSell({
        broker: Broker.KIS,
        market: 'DOMESTIC',
        exchangeCode: '',
        stockCode: '005930',
      })).rejects.toThrow('보유 포지션을 찾을 수 없습니다.');

      expect(mockBrokerContext.getCurrentContext).not.toHaveBeenCalled();
      expect(mockOrderGuard.admit).not.toHaveBeenCalled();
      expect(mockRegistry.get).not.toHaveBeenCalled();
      expect(mockKisDomestic.getPrice).not.toHaveBeenCalled();
    });

    it('rejects a legacy missing-broker request before resolving a KIS position', async () => {
      mockPositionFindMany.mockResolvedValue([
        { broker: Broker.KIS, quantity: 2, exchangeCode: 'KRX', stockName: '삼성전자' },
      ]);

      await expect(service.manualSell({
        market: 'DOMESTIC',
        exchangeCode: '',
        stockCode: '005930',
      } as ManualSellInput)).rejects.toThrow('브로커를 지정해주세요.');

      expect(mockPositionFindMany).not.toHaveBeenCalled();
      expect(mockBrokerContext.getCurrentContext).not.toHaveBeenCalled();
      expect(mockOrderGuard.admit).not.toHaveBeenCalled();
      expect(mockRegistry.get).not.toHaveBeenCalled();
      expect(mockKisDomestic.getPrice).not.toHaveBeenCalled();
    });

    it('filters by an explicit broker before submitting a sell', async () => {
      mockPositionFindMany.mockResolvedValue([
        { broker: Broker.TOSS, quantity: 3, exchangeCode: 'KRX', stockName: '삼성전자' },
      ]);
      mockKisDomestic.getPrice.mockResolvedValue({ currentPrice: 70_000 });
      mockPrisma.tradeRecord.create.mockResolvedValue({ id: 'explicit-toss-sell' });
      mockPositionRefresh.refresh.mockResolvedValue([{
        stockCode: '005930',
        stockName: '삼성전자',
        exchangeCode: 'KRX',
        quantity: 3,
      }]);
      mockPrisma.tradeRecord.updateMany.mockResolvedValue({ count: 1 });
      mockPort.submitOrder.mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        orderNo: 'toss-sell',
        brokerOrderDate: '20260713',
        orderTime: '101112',
        message: '접수',
      });

      await expect(service.manualSell({
        broker: Broker.TOSS,
        market: 'DOMESTIC',
        exchangeCode: '',
        stockCode: '005930',
        quantity: 2,
      })).resolves.toEqual({
        success: true,
        orderNo: 'toss-sell',
        message: '2주 매도 주문 접수',
      });

      expect(mockPositionFindMany).toHaveBeenCalledWith({
        where: {
          broker: Broker.TOSS,
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
        },
      });
      expect(mockRegistry.requireActive).toHaveBeenCalledWith(Broker.TOSS);
    });

    it('never infers TOSS for a legacy missing-broker request', async () => {
      mockPositionFindMany.mockResolvedValue([{
        broker: Broker.TOSS,
        quantity: 3,
        exchangeCode: 'KRX',
        stockName: '삼성전자',
      }]);
      await expect(service.manualSell({
        market: 'DOMESTIC',
        exchangeCode: '',
        stockCode: '005930',
        quantity: 2,
      } as ManualSellInput)).rejects.toThrow('브로커를 지정해주세요.');

      expect(mockPositionFindMany).not.toHaveBeenCalled();
      expect(mockKisDomestic.getPrice).not.toHaveBeenCalled();
      expect(mockOrderGuard.admit).not.toHaveBeenCalled();
      expect(mockRegistry.requireActive).not.toHaveBeenCalled();
      expect(mockPort.submitOrder).not.toHaveBeenCalled();
    });

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects an invalid explicit quantity (%s) before DB or KIS access',
      async (quantity) => {
        await expect(service.manualSell({
          broker: Broker.KIS,
          market: 'DOMESTIC',
          exchangeCode: '',
          stockCode: '005930',
          quantity,
        })).resolves.toEqual({
          success: false,
          message: '매도 수량은 1 이상의 정수여야 합니다.',
        });

        expect(mockPrisma.position.findFirst).not.toHaveBeenCalled();
        expect(mockKisDomestic.getPrice).not.toHaveBeenCalled();
        expect(mockKisDomestic.orderSell).not.toHaveBeenCalled();
      },
    );

    it('admits a broker-bound SUBMITTING intent through the shared order guard', async () => {
      const tx = {
        tradeRecord: {
          create: jest.fn().mockResolvedValue({ id: 'manual-guarded' }),
        },
      };
      mockPrisma.position.findFirst.mockResolvedValue({
        broker: Broker.KIS,
        quantity: 5,
        exchangeCode: 'KRX',
        stockName: '삼성전자',
      });
      mockKisDomestic.getPrice.mockResolvedValue({ currentPrice: 70_123 });
      mockPrisma.tradeRecord.create.mockResolvedValue({ id: 'legacy-direct' });
      mockKisDomestic.orderSell.mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        orderNo: 'broker-1',
        brokerOrderDate: '20260713',
        orderTime: '101112',
        message: '접수',
      });
      mockOrderGuard.admit.mockImplementationOnce(async (_key, createWithTx) => createWithTx(tx));
      mockPositionRefresh.refresh.mockResolvedValue([
        {
          stockCode: '005930',
          stockName: '삼성전자',
          quantity: 5,
          avgPrice: 65_000,
          currentPrice: 70_123,
          profitLoss: 0,
          profitRate: 0,
        },
      ]);
      mockPrisma.tradeRecord.updateMany.mockResolvedValue({ count: 1 });

      await service.manualSell({
        broker: Broker.KIS,
        market: 'DOMESTIC',
        exchangeCode: '',
        stockCode: '005930',
        quantity: 2,
      });

      expect(mockOrderGuard.admit).toHaveBeenCalledWith(
        {
          broker: Broker.KIS,
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          side: 'SELL',
        },
        expect.any(Function),
      );
      expect(tx.tradeRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          broker: Broker.KIS,
          status: OrderStatus.SUBMITTING,
          submissionStartedAt: null,
          brokerEnvironment: 'PAPER',
          brokerAccountHash: 'account-hash',
        }),
      });
      expect(mockPrisma.tradeRecord.create).not.toHaveBeenCalled();
    });

    it("uses the guard's canonical key for manual-order creation and broker submission", async () => {
      const tx = {
        tradeRecord: {
          create: jest.fn().mockResolvedValue({ id: 'manual-canonical' }),
        },
      };
      const canonicalKey = {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'SELL',
      };
      mockPrisma.position.findFirst.mockResolvedValue({
        quantity: 2,
        exchangeCode: 'NASD',
        stockName: 'ProShares UltraPro QQQ',
      });
      mockKisOverseas.getPrice.mockResolvedValue({ currentPrice: 56.73 });
      mockOrderGuard.admit.mockImplementationOnce(
        async (_key, createWithTx) => createWithTx(tx, canonicalKey),
      );
      mockPositionRefresh.refresh.mockResolvedValue([{
        stockCode: 'TQQQ',
        stockName: 'ProShares UltraPro QQQ',
        exchangeCode: 'NASD',
        quantity: 2,
        avgPrice: 50,
        currentPrice: 56.73,
        profitLoss: 0,
        profitRate: 0,
      }]);
      mockPrisma.tradeRecord.updateMany.mockResolvedValue({ count: 1 });
      mockKisOverseas.orderSell.mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        orderNo: 'canonical-order',
        brokerOrderDate: '20260713',
        orderTime: '101112',
        message: '접수',
      });

      await expect(service.manualSell({
        broker: Broker.KIS,
        market: 'OVERSEAS',
        exchangeCode: 'nasd',
        stockCode: 'tqqq',
        quantity: 2,
      })).resolves.toEqual({
        success: true,
        orderNo: 'canonical-order',
        message: '2주 매도 주문 접수',
      });

      expect(tx.tradeRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining(canonicalKey),
      });
      expect(mockKisOverseas.getPrice).toHaveBeenCalledWith('NASD', 'TQQQ');
      expect(mockKisOverseas.orderSell).toHaveBeenCalledWith(
        'NASD',
        'TQQQ',
        2,
        56.73,
        '00',
      );
    });

    it.each([
      ['returns false', () => false],
      ['throws', () => {
        throw new Error('context unavailable');
      }],
    ])('fails closed before the submission claim when broker-context validation %s after refresh', async (
      _label,
      validateContext,
    ) => {
      mockPrisma.position.findFirst.mockResolvedValue({
        quantity: 2,
        exchangeCode: 'KRX',
        stockName: '삼성전자',
      });
      mockKisDomestic.getPrice.mockResolvedValue({ currentPrice: 70_000 });
      mockPrisma.tradeRecord.create.mockResolvedValue({ id: 'manual-context-pre-claim' });
      mockPositionRefresh.refresh.mockResolvedValue([{
        stockCode: '005930',
        stockName: '삼성전자',
        exchangeCode: 'KRX',
        quantity: 2,
        avgPrice: 65_000,
        currentPrice: 70_000,
        profitLoss: 0,
        profitRate: 0,
      }]);
      mockBrokerContext.matchesCurrentContext.mockImplementationOnce(validateContext);
      mockPrisma.tradeRecord.updateMany.mockResolvedValue({ count: 1 });
      mockKisDomestic.orderSell.mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        orderNo: 'must-not-submit',
        brokerOrderDate: '20260714',
        orderTime: '101112',
        message: '접수',
      });

      await expect(service.manualSell({
        broker: Broker.KIS,
        market: 'DOMESTIC',
        exchangeCode: '',
        stockCode: '005930',
        quantity: 2,
      })).resolves.toEqual({
        success: false,
        message: 'KIS 계좌 정보를 확인할 수 없어 수동 매도를 중단했습니다.',
      });

      expect(mockPrisma.tradeRecord.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'manual-context-pre-claim',
          status: OrderStatus.SUBMITTING,
          submissionStartedAt: null,
        },
        data: {
          status: OrderStatus.CANCELLED,
          brokerMessage: '브로커 컨텍스트 검증 실패로 수동 매도 취소',
        },
      });
      expect(mockPrisma.tradeRecord.updateMany).toHaveBeenCalledTimes(1);
      expect(mockKisDomestic.orderSell).not.toHaveBeenCalled();
    });

    it.each([
      ['returns false', () => false],
      ['throws', () => {
        throw new Error('context unavailable');
      }],
    ])('cancels only its claimed submission when broker-context validation %s before POST', async (
      _label,
      validateContext,
    ) => {
      mockPrisma.position.findFirst.mockResolvedValue({
        quantity: 2,
        exchangeCode: 'KRX',
        stockName: '삼성전자',
      });
      mockKisDomestic.getPrice.mockResolvedValue({ currentPrice: 70_000 });
      mockPrisma.tradeRecord.create.mockResolvedValue({ id: 'manual-context-post-claim' });
      mockPositionRefresh.refresh.mockResolvedValue([{
        stockCode: '005930',
        stockName: '삼성전자',
        exchangeCode: 'KRX',
        quantity: 2,
        avgPrice: 65_000,
        currentPrice: 70_000,
        profitLoss: 0,
        profitRate: 0,
      }]);
      mockBrokerContext.matchesCurrentContext
        .mockReturnValueOnce(true)
        .mockImplementationOnce(validateContext);
      mockPrisma.tradeRecord.updateMany.mockResolvedValue({ count: 1 });
      mockKisDomestic.orderSell.mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        orderNo: 'must-not-submit',
        brokerOrderDate: '20260714',
        orderTime: '101112',
        message: '접수',
      });

      await expect(service.manualSell({
        broker: Broker.KIS,
        market: 'DOMESTIC',
        exchangeCode: '',
        stockCode: '005930',
        quantity: 2,
      })).resolves.toEqual({
        success: false,
        message: 'KIS 계좌 정보를 확인할 수 없어 수동 매도를 중단했습니다.',
      });

      expect(mockPrisma.tradeRecord.updateMany).toHaveBeenCalledTimes(2);
      const claim = mockPrisma.tradeRecord.updateMany.mock.calls[0][0];
      const cancellation = mockPrisma.tradeRecord.updateMany.mock.calls[1][0];
      expect(claim.data.submissionStartedAt).toBeInstanceOf(Date);
      expect(cancellation).toEqual({
        where: {
          id: 'manual-context-post-claim',
          status: OrderStatus.SUBMITTING,
          submissionStartedAt: claim.data.submissionStartedAt,
        },
        data: {
          status: OrderStatus.CANCELLED,
          submissionStartedAt: null,
          brokerMessage: '브로커 컨텍스트 검증 실패로 수동 매도 취소',
        },
      });
      expect(mockKisDomestic.orderSell).not.toHaveBeenCalled();
    });

    it('cancels only its claimed submission when live trading is disabled before POST', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({
        quantity: 2,
        exchangeCode: 'KRX',
        stockName: '삼성전자',
      });
      mockKisDomestic.getPrice.mockResolvedValue({ currentPrice: 70_000 });
      mockPrisma.tradeRecord.create.mockResolvedValue({ id: 'manual-live-switch-post-claim' });
      mockPositionRefresh.refresh.mockResolvedValue([{
        stockCode: '005930',
        stockName: '삼성전자',
        exchangeCode: 'KRX',
        quantity: 2,
        avgPrice: 65_000,
        currentPrice: 70_000,
        profitLoss: 0,
        profitRate: 0,
      }]);
      mockLiveSwitch.isEnabled
        .mockReset()
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);
      mockPrisma.tradeRecord.updateMany.mockResolvedValue({ count: 1 });
      mockKisDomestic.orderSell.mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        orderNo: 'must-not-submit',
        brokerOrderDate: '20260714',
        orderTime: '101112',
        message: '접수',
      });

      await expect(service.manualSell({
        broker: Broker.KIS,
        market: 'DOMESTIC',
        exchangeCode: '',
        stockCode: '005930',
        quantity: 2,
      })).resolves.toEqual({
        success: false,
        message: '현재 환경에서는 실거래가 비활성화되어 수동 매도를 실행할 수 없습니다.',
      });

      expect(mockPrisma.tradeRecord.updateMany).toHaveBeenCalledTimes(2);
      const claim = mockPrisma.tradeRecord.updateMany.mock.calls[0][0];
      expect(mockPrisma.tradeRecord.updateMany.mock.calls[1][0]).toEqual({
        where: {
          id: 'manual-live-switch-post-claim',
          status: OrderStatus.SUBMITTING,
          submissionStartedAt: claim.data.submissionStartedAt,
        },
        data: {
          status: OrderStatus.CANCELLED,
          submissionStartedAt: null,
          brokerMessage: '실거래 비활성화로 수동 매도 취소',
        },
      });
      expect(mockKisDomestic.orderSell).not.toHaveBeenCalled();
    });

    it('cancels only its claimed manual submission when its broker becomes inactive before POST', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({
        quantity: 2,
        exchangeCode: 'KRX',
        stockName: '삼성전자',
      });
      mockKisDomestic.getPrice.mockResolvedValue({ currentPrice: 70_000 });
      mockPrisma.tradeRecord.create.mockResolvedValue({ id: 'manual-broker-disabled' });
      mockPositionRefresh.refresh.mockResolvedValue([{
        stockCode: '005930',
        stockName: '삼성전자',
        exchangeCode: 'KRX',
        quantity: 2,
        avgPrice: 65_000,
        currentPrice: 70_000,
        profitLoss: 0,
        profitRate: 0,
      }]);
      mockRegistry.isActive
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);
      mockPrisma.tradeRecord.updateMany.mockResolvedValue({ count: 1 });
      mockKisDomestic.orderSell.mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        orderNo: 'must-not-submit',
        brokerOrderDate: '20260714',
        orderTime: '101112',
        message: '접수',
      });

      await expect(service.manualSell({
        broker: Broker.KIS,
        market: 'DOMESTIC',
        exchangeCode: '',
        stockCode: '005930',
        quantity: 2,
      })).resolves.toEqual({
        success: false,
        message: 'KIS 브로커가 비활성화되어 수동 매도를 실행할 수 없습니다.',
      });

      expect(mockPrisma.tradeRecord.updateMany).toHaveBeenCalledTimes(2);
      const claim = mockPrisma.tradeRecord.updateMany.mock.calls[0][0];
      expect(mockPrisma.tradeRecord.updateMany.mock.calls[1][0]).toEqual({
        where: {
          id: 'manual-broker-disabled',
          status: OrderStatus.SUBMITTING,
          submissionStartedAt: claim.data.submissionStartedAt,
        },
        data: {
          status: OrderStatus.CANCELLED,
          submissionStartedAt: null,
          brokerMessage: '브로커 비활성화로 수동 매도 취소',
        },
      });
      expect(mockRegistry.requireActive).not.toHaveBeenCalled();
      expect(mockKisDomestic.orderSell).not.toHaveBeenCalled();
      expect(mockRecovery.markSubmissionUnknown).not.toHaveBeenCalled();
    });

    it('refreshes holdings, clamps quantity, wins the CAS, and persists an accepted manual order', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({
        broker: Broker.KIS,
        quantity: 5,
        exchangeCode: 'KRX',
        stockName: '삼성전자',
      });
      mockKisDomestic.getPrice.mockResolvedValue({ currentPrice: 70_123 });
      mockPrisma.tradeRecord.create.mockResolvedValue({ id: 'manual-clamped' });
      mockPositionRefresh.refresh.mockResolvedValue([
        {
          stockCode: '005930',
          stockName: '삼성전자',
          quantity: 2,
          avgPrice: 65_000,
          currentPrice: 70_123,
          profitLoss: 0,
          profitRate: 0,
        },
      ]);
      mockPrisma.tradeRecord.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 1 });
      mockKisDomestic.orderSell.mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        orderNo: 'manual-broker-1',
        brokerOrderDate: '20260713',
        orderTime: '101112',
        message: '접수',
      });

      await expect(
        service.manualSell({
          broker: Broker.KIS,
          market: 'DOMESTIC',
          exchangeCode: '',
          stockCode: '005930',
          quantity: 5,
        }),
      ).resolves.toEqual({
        success: true,
        orderNo: 'manual-broker-1',
        message: '2주 매도 주문 접수',
      });

      expect(mockPositionRefresh.refresh).toHaveBeenCalledWith(Broker.KIS, 'DOMESTIC');
      expect(mockPrisma.tradeRecord.updateMany).toHaveBeenNthCalledWith(1, {
        where: {
          id: 'manual-clamped',
          status: OrderStatus.SUBMITTING,
          submissionStartedAt: null,
        },
        data: {
          quantity: 2,
          submissionStartedAt: expect.any(Date),
        },
      });
      expect(mockKisDomestic.orderSell).toHaveBeenCalledTimes(1);
      expect(mockKisDomestic.orderSell).toHaveBeenCalledWith('005930', 2, 70_123, '00');
      expect(mockPrisma.tradeRecord.updateMany).toHaveBeenNthCalledWith(2, {
        where: {
          id: 'manual-clamped',
          status: OrderStatus.SUBMITTING,
          submissionStartedAt: { not: null },
        },
        data: {
          status: OrderStatus.PENDING,
          orderNo: 'manual-broker-1',
          brokerOrderDate: '20260713',
          brokerOrderTime: '101112',
          brokerMessage: '접수',
        },
      });
    });

    it('submits an explicit KIS manual sell without broker inference', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({
        quantity: 5,
        exchangeCode: 'KRX',
        stockName: '삼성전자',
      });
      mockKisDomestic.getPrice.mockResolvedValue({ currentPrice: 70123.4 });
      mockPrisma.tradeRecord.create.mockResolvedValue({ id: 'trade-1' });
      mockKisDomestic.orderSell.mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        orderNo: '12345',
        brokerOrderDate: '20260713',
        orderTime: '101112',
        message: '접수',
      });
      mockPositionRefresh.refresh.mockResolvedValue([
        {
          stockCode: '005930',
          stockName: '삼성전자',
          quantity: 5,
          avgPrice: 65_000,
          currentPrice: 70_123,
          profitLoss: 0,
          profitRate: 0,
        },
      ]);
      mockPrisma.tradeRecord.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.manualSell({
        broker: Broker.KIS,
        market: 'DOMESTIC',
        stockCode: '005930',
        quantity: 2,
        exchangeCode: '',
      });

      expect(mockPrisma.position.findFirst).toHaveBeenCalledWith({
        where: {
          broker: Broker.KIS,
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
        },
      });
      expect(mockPrisma.tradeRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          stockName: '삼성전자',
          quantity: 2,
          price: expect.anything(),
          status: OrderStatus.SUBMITTING,
          submissionStartedAt: null,
          brokerEnvironment: 'PAPER',
          brokerAccountHash: 'account-hash',
        }),
      });
      expect(mockKisDomestic.orderSell).toHaveBeenCalledWith('005930', 2, 70123, '00');
      expect(result).toEqual({ success: true, orderNo: '12345', message: '2주 매도 주문 접수' });
    });

    it('uses only the requested overseas venue to authorize and size a cross-listed manual sell', async () => {
      mockPrisma.position.findFirst.mockImplementation(({ where }) => (
        where.exchangeCode === 'NASD'
          ? Promise.resolve({
            quantity: 5,
            exchangeCode: 'NASD',
            stockName: 'Cross Listed',
          })
          : Promise.resolve({
            quantity: 100,
            exchangeCode: 'NYSE',
            stockName: 'Wrong Venue Holding',
          })
      ));
      mockKisOverseas.getPrice.mockResolvedValue({ currentPrice: 25 });
      mockPrisma.tradeRecord.create.mockResolvedValue({ id: 'manual-cross-listed' });
      mockPositionRefresh.refresh.mockResolvedValue([
        {
          stockCode: 'DUAL',
          exchangeCode: 'NYSE',
          stockName: 'Wrong Venue Holding',
          quantity: 100,
        },
        {
          stockCode: 'DUAL',
          exchangeCode: 'NASD',
          stockName: 'Cross Listed',
          quantity: 2,
        },
      ]);
      mockPrisma.tradeRecord.updateMany.mockResolvedValue({ count: 1 });
      mockKisOverseas.orderSell.mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        orderNo: 'cross-listed-order',
        brokerOrderDate: '20260713',
        orderTime: '101112',
        message: '접수',
      });

      await expect(service.manualSell({
        broker: Broker.KIS,
        market: 'OVERSEAS',
        exchangeCode: 'nasd',
        stockCode: 'DUAL',
        quantity: 5,
      })).resolves.toEqual({
        success: true,
        orderNo: 'cross-listed-order',
        message: '2주 매도 주문 접수',
      });

      expect(mockPrisma.position.findFirst).toHaveBeenCalledWith({
        where: {
          broker: Broker.KIS,
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'DUAL',
        },
      });
      expect(mockKisOverseas.getPrice).toHaveBeenCalledWith('NASD', 'DUAL');
      expect(mockKisOverseas.orderSell).toHaveBeenCalledWith(
        'NASD',
        'DUAL',
        2,
        25,
        '00',
      );
    });

    it('persists an explicit broker rejection as failed', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({
        quantity: 1,
        exchangeCode: 'NASD',
        stockName: 'TQQQ',
      });
      mockKisOverseas.getPrice.mockResolvedValue({ currentPrice: 56.739 });
      mockPrisma.tradeRecord.create.mockResolvedValue({ id: 'trade-2' });
      mockKisOverseas.orderSell.mockResolvedValue({
        outcome: 'REJECTED',
        success: false,
        message: 'broker rejected',
      });
      mockPositionRefresh.refresh.mockResolvedValue([
        {
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          quantity: 1,
          avgPrice: 50,
          currentPrice: 56.739,
          profitLoss: 0,
          profitRate: 0,
          exchangeCode: 'NASD',
        },
      ]);
      mockPrisma.tradeRecord.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.manualSell({
        broker: Broker.KIS,
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
      });

      expect(mockKisOverseas.orderSell).toHaveBeenCalledWith('NASD', 'TQQQ', 1, 56.74, '00');
      expect(mockPrisma.tradeRecord.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: 'trade-2',
          status: OrderStatus.SUBMITTING,
          submissionStartedAt: { not: null },
        },
        data: {
          status: OrderStatus.FAILED,
          brokerMessage: 'broker rejected',
        },
      });
      expect(result).toEqual({ success: false, message: 'broker rejected' });
    });

    it.each([
      ['blank orderNo', { orderNo: '   ', brokerOrderDate: '20260713', orderTime: '101112' }],
      ['blank brokerOrderDate', { orderNo: 'manual-identity', brokerOrderDate: '', orderTime: '101112' }],
      ['missing orderTime', { orderNo: 'manual-identity', brokerOrderDate: '20260713', orderTime: undefined }],
    ])('maps nominal manual ACCEPTED with %s to UNKNOWN', async (_label, identity) => {
      mockPrisma.position.findFirst.mockResolvedValue({
        quantity: 1,
        exchangeCode: 'KRX',
        stockName: '삼성전자',
      });
      mockKisDomestic.getPrice.mockResolvedValue({ currentPrice: 70_000 });
      mockPrisma.tradeRecord.create.mockResolvedValue({ id: 'manual-invalid-accepted' });
      mockPositionRefresh.refresh.mockResolvedValue([
        {
          stockCode: '005930',
          stockName: '삼성전자',
          quantity: 1,
        },
      ]);
      mockPrisma.tradeRecord.updateMany.mockResolvedValue({ count: 1 });
      mockKisDomestic.orderSell.mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        ...identity,
        message: 'nominal success',
      });
      mockRecovery.markSubmissionUnknown.mockResolvedValue(true);

      await expect(service.manualSell({
        broker: Broker.KIS,
        market: 'DOMESTIC',
        exchangeCode: '',
        stockCode: '005930',
        quantity: 1,
      })).resolves.toEqual({
        success: false,
        message: 'Accepted broker response missing required order identity',
      });

      expect(mockKisDomestic.orderSell).toHaveBeenCalledTimes(1);
      expect(mockPrisma.tradeRecord.updateMany).toHaveBeenCalledTimes(1);
      expect(mockRecovery.markSubmissionUnknown).toHaveBeenCalledWith(
        'manual-invalid-accepted',
        'Accepted broker response missing required order identity',
      );
    });

    it('retries only accepted manual-order persistence twice without a second KIS sell', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({
        quantity: 1,
        exchangeCode: 'KRX',
        stockName: '삼성전자',
      });
      mockKisDomestic.getPrice.mockResolvedValue({ currentPrice: 70_000 });
      mockPrisma.tradeRecord.create.mockResolvedValue({ id: 'manual-db-failure' });
      mockPositionRefresh.refresh.mockResolvedValue([
        {
          stockCode: '005930',
          stockName: '삼성전자',
          quantity: 1,
          avgPrice: 65_000,
          currentPrice: 70_000,
          profitLoss: 0,
          profitRate: 0,
        },
      ]);
      mockPrisma.tradeRecord.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockRejectedValueOnce(new Error('db 1'))
        .mockRejectedValueOnce(new Error('db 2'))
        .mockRejectedValueOnce(new Error('db 3'));
      mockKisDomestic.orderSell.mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        orderNo: 'manual-known-order',
        brokerOrderDate: '20260713',
        orderTime: '101112',
        message: '접수',
      });

      await expect(
        service.manualSell({
          broker: Broker.KIS,
          market: 'DOMESTIC',
          exchangeCode: '',
          stockCode: '005930',
          quantity: 1,
        }),
      ).resolves.toEqual({
        success: false,
        orderNo: 'manual-known-order',
        message: '브로커 주문은 접수되었으나 로컬 저장에 실패했습니다. KIS 주문 내역 확인이 필요합니다.',
      });

      expect(mockKisDomestic.orderSell).toHaveBeenCalledTimes(1);
      expect(mockPrisma.tradeRecord.updateMany).toHaveBeenCalledTimes(4);
      expect(mockRecovery.warnAcceptedOrderPersistenceFailure).toHaveBeenCalledWith({
        broker: Broker.KIS,
        market: 'DOMESTIC',
        stockCode: '005930',
        tradeRecordId: 'manual-db-failure',
        orderNo: 'manual-known-order',
      });
    });

    it('blocks the mutation when live trading is disabled', async () => {
      service = await createService(false);

      const result = await service.manualSell({ broker: Broker.KIS, market: 'DOMESTIC', exchangeCode: '', stockCode: '005930' });

      expect(result).toEqual({
        success: false,
        message: '현재 환경에서는 실거래가 비활성화되어 수동 매도를 실행할 수 없습니다.',
      });
      expect(mockPrisma.position.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('cancelTradeOrder', () => {
    it('fails closed before claim or KIS access when the stored broker context mismatches', async () => {
      mockPrisma.tradeRecord.findUnique.mockResolvedValue({
        broker: Broker.KIS,
        id: 'trade-wrong-account',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'SELL',
        quantity: 2,
        executedQty: 0,
        price: '70000',
        status: 'PENDING',
        orderNo: 'wrong-account-order',
        brokerOrderDate: '20260713',
        brokerEnvironment: 'PROD',
        brokerAccountHash: 'another-account-hash',
      });
      mockKisDomestic.cancelOrder.mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        message: '취소 접수',
      });

      await expect(
        service.cancelTradeOrder({ tradeRecordId: 'trade-wrong-account' }),
      ).resolves.toEqual({
        success: false,
        message: '저장된 브로커 주문 정보가 현재 KIS 계좌와 일치하지 않아 취소할 수 없습니다.',
      });

      expect(mockBrokerContext.matchesCurrentContext).toHaveBeenCalledWith(
        Broker.KIS,
        'PROD',
        'another-account-hash',
      );
      expect(mockRecovery.claimCancellation).not.toHaveBeenCalled();
      expect(mockKisDomestic.getOrderExecutions).not.toHaveBeenCalled();
      expect(mockKisDomestic.getUnfilledOrders).not.toHaveBeenCalled();
      expect(mockKisDomestic.cancelOrder).not.toHaveBeenCalled();
    });

    it.each([Broker.KIS, Broker.TOSS])(
      'fails closed before a manual cancellation claim when %s is inactive',
      async (broker) => {
        mockPrisma.tradeRecord.findUnique.mockResolvedValue({
          broker,
          id: `trade-disabled-${broker}`,
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          side: 'SELL',
          quantity: 2,
          executedQty: 0,
          price: '70000',
          status: 'PENDING',
          orderNo: `${broker}-order`,
          brokerOrderDate: '20260713',
          brokerEnvironment: broker === Broker.TOSS ? 'PROD' : 'PAPER',
          brokerAccountHash: 'account-hash',
        });
        mockRegistry.isActive.mockReturnValue(false);

        await expect(
          service.cancelTradeOrder({ tradeRecordId: `trade-disabled-${broker}` }),
        ).resolves.toEqual({
          success: false,
          message: `${broker} 브로커가 비활성화되어 주문 취소를 실행할 수 없습니다.`,
        });

        expect(mockRecovery.claimCancellation).not.toHaveBeenCalled();
        expect(mockRegistry.requireActive).not.toHaveBeenCalled();
        expect(mockPort.cancelOrder).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['missing broker environment', { brokerEnvironment: null }],
      ['blank broker account hash', { brokerAccountHash: '   ' }],
      ['missing broker date', { brokerOrderDate: null }],
      ['invalid broker date', { brokerOrderDate: '20260230' }],
      ['blank order number', { orderNo: '   ' }],
    ])('fails closed before claim or KIS access for an incomplete identity: %s', async (
      _label,
      identityOverride,
    ) => {
      mockPrisma.tradeRecord.findUnique.mockResolvedValue({
        broker: Broker.KIS,
        id: 'trade-incomplete-identity',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'SELL',
        quantity: 2,
        executedQty: 0,
        price: '70000',
        status: 'PENDING',
        orderNo: 'incomplete-order',
        brokerOrderDate: '20260713',
        brokerEnvironment: 'PAPER',
        brokerAccountHash: 'account-hash',
        ...identityOverride,
      });
      mockKisDomestic.cancelOrder.mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        message: '취소 접수',
      });

      await expect(
        service.cancelTradeOrder({ tradeRecordId: 'trade-incomplete-identity' }),
      ).resolves.toEqual({
        success: false,
        message: '브로커 주문 식별 정보가 완전하지 않아 취소할 수 없습니다.',
      });

      expect(mockRecovery.claimCancellation).not.toHaveBeenCalled();
      expect(mockKisDomestic.getOrderExecutions).not.toHaveBeenCalled();
      expect(mockKisDomestic.getUnfilledOrders).not.toHaveBeenCalled();
      expect(mockKisDomestic.cancelOrder).not.toHaveBeenCalled();
    });

    it('releases the claim when the reloaded broker order identity changed', async () => {
      const initialRecord = {
        broker: Broker.KIS,
        id: 'trade-identity-race',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'SELL',
        quantity: 2,
        executedQty: 0,
        price: '70000',
        status: 'PENDING',
        cancellationStatus: null,
        orderNo: 'original-order',
        brokerOrderDate: '20260713',
        brokerEnvironment: 'PAPER',
        brokerAccountHash: 'account-hash',
      };
      mockPrisma.tradeRecord.findUnique
        .mockResolvedValueOnce(initialRecord)
        .mockResolvedValueOnce({
          ...initialRecord,
          cancellationStatus: 'SUBMITTING',
          orderNo: 'changed-order',
        });
      mockRecovery.releaseCancellationClaim.mockResolvedValue(true);
      mockKisDomestic.cancelOrder.mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        message: '취소 접수',
      });

      await expect(
        service.cancelTradeOrder({ tradeRecordId: initialRecord.id }),
      ).resolves.toEqual({
        success: false,
        message: '취소 대상 주문 정보가 변경되어 취소를 중단했습니다.',
      });

      expect(mockPrisma.tradeRecord.findUnique).toHaveBeenCalledTimes(2);
      expect(mockRecovery.releaseCancellationClaim).toHaveBeenCalledWith(
        initialRecord.id,
        Broker.KIS,
        '취소 대상 주문 정보 변경',
      );
      expect(mockKisDomestic.getOrderExecutions).not.toHaveBeenCalled();
      expect(mockKisDomestic.getUnfilledOrders).not.toHaveBeenCalled();
      expect(mockKisDomestic.cancelOrder).not.toHaveBeenCalled();
    });

    it('constrains and rechecks the broker when reloading a won cancellation claim', async () => {
      const initialRecord = {
        broker: Broker.KIS,
        id: 'trade-broker-race',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'SELL',
        quantity: 2,
        executedQty: 0,
        price: '70000',
        status: 'PENDING',
        cancellationStatus: null,
        orderNo: 'broker-race-order',
        brokerOrderDate: '20260713',
        brokerEnvironment: 'PAPER',
        brokerAccountHash: 'account-hash',
      };
      mockPrisma.tradeRecord.findUnique
        .mockResolvedValueOnce(initialRecord)
        .mockResolvedValueOnce({
          ...initialRecord,
          broker: Broker.TOSS,
          cancellationStatus: 'SUBMITTING',
        });
      mockRecovery.releaseCancellationClaim.mockResolvedValue(true);

      await expect(
        service.cancelTradeOrder({ tradeRecordId: initialRecord.id }),
      ).resolves.toEqual({
        success: false,
        message: '취소 대상 주문 정보가 변경되어 취소를 중단했습니다.',
      });

      expect(mockPrisma.tradeRecord.findUnique).toHaveBeenNthCalledWith(2, {
        where: { id: initialRecord.id, broker: Broker.KIS },
      });
      expect(mockRecovery.releaseCancellationClaim).toHaveBeenCalledWith(
        initialRecord.id,
        Broker.KIS,
        '취소 대상 주문 정보 변경',
      );
      expect(mockRegistry.get).not.toHaveBeenCalled();
    });

    it('releases the claim when complete broker reads do not prove the exact open order', async () => {
      const record = {
        broker: Broker.KIS,
        id: 'trade-broker-mismatch',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'SELL',
        quantity: 2,
        executedQty: 0,
        price: '70000',
        status: 'PENDING',
        cancellationStatus: null,
        orderNo: 'broker-mismatch-order',
        brokerOrderDate: '20260713',
        brokerEnvironment: 'PAPER',
        brokerAccountHash: 'account-hash',
      };
      mockPrisma.tradeRecord.findUnique
        .mockResolvedValueOnce(record)
        .mockResolvedValueOnce({
          ...record,
          cancellationStatus: 'SUBMITTING',
        });
      mockKisDomestic.getOrderExecutions.mockResolvedValue([{
        orderNo: record.orderNo,
        orderDate: record.brokerOrderDate,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        side: record.side,
        orderQuantity: 3,
        filledQuantity: 0,
        remainingQuantity: 3,
        rejectionState: 'NOT_REJECTED',
      }]);
      mockKisDomestic.getUnfilledOrders.mockResolvedValue([{
        orderNo: record.orderNo,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        side: record.side,
        quantity: 2,
        price: 70_000,
      }]);
      mockRecovery.releaseCancellationClaim.mockResolvedValue(true);
      mockKisDomestic.cancelOrder.mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        message: '취소 접수',
      });

      await expect(
        service.cancelTradeOrder({ tradeRecordId: record.id }),
      ).resolves.toEqual({
        success: false,
        message: '현재 KIS 계좌에서 취소 대상 주문을 정확히 확인할 수 없어 취소를 중단했습니다.',
      });

      expect(mockKisDomestic.getOrderExecutions).toHaveBeenCalledWith(
        record.brokerOrderDate,
        record.brokerOrderDate,
      );
      expect(mockKisDomestic.getUnfilledOrders).toHaveBeenCalledTimes(1);
      expect(mockRecovery.releaseCancellationClaim).toHaveBeenCalledWith(
        record.id,
        Broker.KIS,
        'KIS 주문 상태 검증 실패',
      );
      expect(mockKisDomestic.cancelOrder).not.toHaveBeenCalled();
    });

    it('does not treat a conflicting domestic exchange as the exact broker order', async () => {
      const record = {
        broker: Broker.KIS,
        id: 'trade-broker-exchange-mismatch',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'SELL',
        quantity: 2,
        executedQty: 0,
        price: '70000',
        status: 'PENDING',
        cancellationStatus: null,
        orderNo: 'broker-exchange-mismatch-order',
        brokerOrderDate: '20260713',
        brokerEnvironment: 'PAPER',
        brokerAccountHash: 'account-hash',
      };
      mockPrisma.tradeRecord.findUnique
        .mockResolvedValueOnce(record)
        .mockResolvedValueOnce({
          ...record,
          cancellationStatus: 'SUBMITTING',
        });
      mockKisDomestic.getOrderExecutions.mockResolvedValue([{
        orderNo: record.orderNo,
        orderDate: record.brokerOrderDate,
        exchangeCode: 'NYSE',
        stockCode: record.stockCode,
        side: record.side,
        orderQuantity: record.quantity,
        filledQuantity: 0,
        remainingQuantity: 2,
        rejectionState: 'NOT_REJECTED',
      }]);
      mockKisDomestic.getUnfilledOrders.mockResolvedValue([{
        orderNo: record.orderNo,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        side: record.side,
        quantity: 2,
        price: 70_000,
      }]);
      mockRecovery.releaseCancellationClaim.mockResolvedValue(true);
      mockKisDomestic.cancelOrder.mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        message: '취소 접수',
      });

      await expect(
        service.cancelTradeOrder({ tradeRecordId: record.id }),
      ).resolves.toEqual({
        success: false,
        message: '현재 KIS 계좌에서 취소 대상 주문을 정확히 확인할 수 없어 취소를 중단했습니다.',
      });

      expect(mockRecovery.releaseCancellationClaim).toHaveBeenCalledWith(
        record.id,
        Broker.KIS,
        'KIS 주문 상태 검증 실패',
      );
      expect(mockKisDomestic.cancelOrder).not.toHaveBeenCalled();
    });

    it('releases the claim when a broker row has malformed order identity', async () => {
      const record = {
        broker: Broker.KIS,
        id: 'trade-malformed-broker-row',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'SELL',
        quantity: 2,
        executedQty: 0,
        price: '70000',
        status: 'PENDING',
        cancellationStatus: null,
        orderNo: 'malformed-row-order',
        brokerOrderDate: '20260713',
        brokerEnvironment: 'PAPER',
        brokerAccountHash: 'account-hash',
      };
      mockPrisma.tradeRecord.findUnique
        .mockResolvedValueOnce(record)
        .mockResolvedValueOnce({
          ...record,
          cancellationStatus: 'SUBMITTING',
        });
      mockKisDomestic.getOrderExecutions.mockResolvedValue([{
        orderNo: null,
        orderDate: record.brokerOrderDate,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        side: record.side,
        orderQuantity: record.quantity,
        filledQuantity: 0,
        remainingQuantity: 2,
        rejectionState: 'NOT_REJECTED',
      }]);
      mockKisDomestic.getUnfilledOrders.mockResolvedValue([{
        orderNo: record.orderNo,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        side: record.side,
        quantity: 2,
        price: 70_000,
      }]);
      mockRecovery.releaseCancellationClaim.mockResolvedValue(true);

      await expect(
        service.cancelTradeOrder({ tradeRecordId: record.id }),
      ).resolves.toEqual({
        success: false,
        message: '현재 KIS 계좌에서 취소 대상 주문을 정확히 확인할 수 없어 취소를 중단했습니다.',
      });

      expect(mockRecovery.releaseCancellationClaim).toHaveBeenCalledWith(
        record.id,
        Broker.KIS,
        'KIS 주문 상태 검증 실패',
      );
      expect(mockKisDomestic.cancelOrder).not.toHaveBeenCalled();
    });

    it('releases the claim when complete broker reads contain no target order', async () => {
      const record = {
        broker: Broker.KIS,
        id: 'trade-broker-none',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'SELL',
        quantity: 2,
        executedQty: 0,
        price: '70000',
        status: 'PENDING',
        cancellationStatus: null,
        orderNo: 'broker-none-order',
        brokerOrderDate: '20260713',
        brokerEnvironment: 'PAPER',
        brokerAccountHash: 'account-hash',
      };
      mockPrisma.tradeRecord.findUnique
        .mockResolvedValueOnce(record)
        .mockResolvedValueOnce({
          ...record,
          cancellationStatus: 'SUBMITTING',
        });
      mockKisDomestic.getOrderExecutions.mockResolvedValue([]);
      mockKisDomestic.getUnfilledOrders.mockResolvedValue([]);
      mockRecovery.releaseCancellationClaim.mockResolvedValue(true);

      await expect(
        service.cancelTradeOrder({ tradeRecordId: record.id }),
      ).resolves.toEqual({
        success: false,
        message: '현재 KIS 계좌에서 취소 대상 주문을 정확히 확인할 수 없어 취소를 중단했습니다.',
      });

      expect(mockKisDomestic.getOrderExecutions).toHaveBeenCalledWith(
        record.brokerOrderDate,
        record.brokerOrderDate,
      );
      expect(mockKisDomestic.getUnfilledOrders).toHaveBeenCalledTimes(1);
      expect(mockRecovery.releaseCancellationClaim).toHaveBeenCalledWith(
        record.id,
        Broker.KIS,
        'KIS 주문 상태 검증 실패',
      );
      expect(mockKisDomestic.cancelOrder).not.toHaveBeenCalled();
    });

    it('releases the claim when a complete broker read fails', async () => {
      const record = {
        broker: Broker.KIS,
        id: 'trade-broker-read-failed',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'SELL',
        quantity: 2,
        executedQty: 0,
        price: '70000',
        status: 'PENDING',
        cancellationStatus: null,
        orderNo: 'broker-read-failed-order',
        brokerOrderDate: '20260713',
        brokerEnvironment: 'PAPER',
        brokerAccountHash: 'account-hash',
      };
      mockPrisma.tradeRecord.findUnique
        .mockResolvedValueOnce(record)
        .mockResolvedValueOnce({
          ...record,
          cancellationStatus: 'SUBMITTING',
        });
      mockKisDomestic.getOrderExecutions.mockResolvedValue([{
        orderNo: record.orderNo,
        orderDate: record.brokerOrderDate,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        side: record.side,
        orderQuantity: record.quantity,
        filledQuantity: 0,
        remainingQuantity: 2,
        rejectionState: 'NOT_REJECTED',
      }]);
      mockKisDomestic.getUnfilledOrders.mockRejectedValue(
        new Error('incomplete KIS pagination'),
      );
      mockRecovery.releaseCancellationClaim.mockResolvedValue(true);

      await expect(
        service.cancelTradeOrder({ tradeRecordId: record.id }),
      ).resolves.toEqual({
        success: false,
        message: 'KIS 주문 상태 조회에 실패하여 취소를 중단했습니다.',
      });

      expect(mockKisDomestic.getOrderExecutions).toHaveBeenCalledTimes(1);
      expect(mockKisDomestic.getUnfilledOrders).toHaveBeenCalledTimes(1);
      expect(mockRecovery.releaseCancellationClaim).toHaveBeenCalledWith(
        record.id,
        Broker.KIS,
        'KIS 주문 상태 조회 실패',
      );
      expect(mockKisDomestic.cancelOrder).not.toHaveBeenCalled();
    });

    it('releases the claim when the broker context changes after complete reads', async () => {
      const record = {
        broker: Broker.KIS,
        id: 'trade-context-drift',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'SELL',
        quantity: 2,
        executedQty: 0,
        price: '70000',
        status: 'PENDING',
        cancellationStatus: null,
        orderNo: 'context-drift-order',
        brokerOrderDate: '20260713',
        brokerEnvironment: 'PAPER',
        brokerAccountHash: 'account-hash',
      };
      mockPrisma.tradeRecord.findUnique
        .mockResolvedValueOnce(record)
        .mockResolvedValueOnce({
          ...record,
          cancellationStatus: 'SUBMITTING',
        });
      mockBrokerContext.matchesCurrentContext
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);
      mockKisDomestic.getOrderExecutions.mockResolvedValue([{
        orderNo: record.orderNo,
        orderDate: record.brokerOrderDate,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        side: record.side,
        orderQuantity: record.quantity,
        filledQuantity: 0,
        remainingQuantity: 2,
        rejectionState: 'NOT_REJECTED',
      }]);
      mockKisDomestic.getUnfilledOrders.mockResolvedValue([{
        orderNo: record.orderNo,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        side: record.side,
        quantity: 2,
        price: 70_000,
      }]);
      mockRecovery.releaseCancellationClaim.mockResolvedValue(true);
      mockKisDomestic.cancelOrder.mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        message: '취소 접수',
      });

      await expect(
        service.cancelTradeOrder({ tradeRecordId: record.id }),
      ).resolves.toEqual({
        success: false,
        message: 'KIS 계좌 정보가 변경되어 취소를 중단했습니다.',
      });

      expect(mockKisDomestic.getOrderExecutions).toHaveBeenCalledTimes(1);
      expect(mockKisDomestic.getUnfilledOrders).toHaveBeenCalledTimes(1);
      expect(mockBrokerContext.matchesCurrentContext).toHaveBeenCalledTimes(2);
      expect(mockRecovery.releaseCancellationClaim).toHaveBeenCalledWith(
        record.id,
        Broker.KIS,
        '브로커 컨텍스트 변경으로 주문 취소 중단',
      );
      expect(mockKisDomestic.cancelOrder).not.toHaveBeenCalled();
    });

    it('releases the claim when broker-context validation throws after complete reads', async () => {
      const record = {
        broker: Broker.KIS,
        id: 'trade-context-validation-error',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'SELL',
        quantity: 2,
        executedQty: 0,
        price: '70000',
        status: 'PENDING',
        cancellationStatus: null,
        orderNo: 'context-validation-error-order',
        brokerOrderDate: '20260713',
        brokerEnvironment: 'PAPER',
        brokerAccountHash: 'account-hash',
      };
      mockPrisma.tradeRecord.findUnique
        .mockResolvedValueOnce(record)
        .mockResolvedValueOnce({
          ...record,
          cancellationStatus: 'SUBMITTING',
        });
      mockBrokerContext.matchesCurrentContext
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => {
          throw new Error('context unavailable');
        });
      mockKisDomestic.getOrderExecutions.mockResolvedValue([{
        orderNo: record.orderNo,
        orderDate: record.brokerOrderDate,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        side: record.side,
        orderQuantity: record.quantity,
        filledQuantity: 0,
        remainingQuantity: 2,
        rejectionState: 'NOT_REJECTED',
      }]);
      mockKisDomestic.getUnfilledOrders.mockResolvedValue([{
        orderNo: record.orderNo,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        side: record.side,
        quantity: 2,
        price: 70_000,
      }]);
      mockRecovery.releaseCancellationClaim.mockResolvedValue(true);

      await expect(
        service.cancelTradeOrder({ tradeRecordId: record.id }),
      ).resolves.toEqual({
        success: false,
        message: 'KIS 계좌 정보가 변경되어 취소를 중단했습니다.',
      });

      expect(mockRecovery.releaseCancellationClaim).toHaveBeenCalledWith(
        record.id,
        Broker.KIS,
        '브로커 컨텍스트 변경으로 주문 취소 중단',
      );
      expect(mockKisDomestic.cancelOrder).not.toHaveBeenCalled();
    });

    it('does not POST when another caller already owns or blocks the cancellation claim', async () => {
      mockPrisma.tradeRecord.findUnique.mockResolvedValue({
        broker: Broker.KIS,
        id: 'trade-claimed',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'SELL',
        quantity: 2,
        executedQty: 0,
        price: '70000',
        status: 'PENDING',
        cancellationStatus: null,
        orderNo: 'claimed-order',
        brokerOrderDate: '20260713',
        brokerEnvironment: 'PAPER',
        brokerAccountHash: 'account-hash',
      });
      mockRecovery.claimCancellation.mockResolvedValue(false);

      await expect(
        service.cancelTradeOrder({ tradeRecordId: 'trade-claimed' }),
      ).resolves.toEqual({
        success: false,
        message: '주문 취소가 이미 처리 중이거나 결과 확인이 필요합니다.',
      });

      expect(mockKisDomestic.cancelOrder).not.toHaveBeenCalled();
      expect(mockKisOverseas.cancelOrder).not.toHaveBeenCalled();
    });

    it('releases a won cancellation claim when the live switch closes before POST', async () => {
      const record = {
        broker: Broker.KIS,
        id: 'trade-switch-off',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'SELL',
        quantity: 2,
        executedQty: 0,
        price: '70000',
        status: 'PENDING',
        cancellationStatus: null,
        orderNo: 'switch-order',
        brokerOrderDate: '20260713',
        brokerEnvironment: 'PAPER',
        brokerAccountHash: 'account-hash',
      };
      mockPrisma.tradeRecord.findUnique
        .mockResolvedValueOnce(record)
        .mockResolvedValueOnce({
          ...record,
          cancellationStatus: 'SUBMITTING',
        });
      mockLiveSwitch.isEnabled
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);
      mockKisDomestic.getOrderExecutions.mockResolvedValue([{
        orderNo: record.orderNo,
        orderDate: record.brokerOrderDate,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        side: record.side,
        orderQuantity: record.quantity,
        filledQuantity: 0,
        remainingQuantity: 2,
        rejectionState: 'NOT_REJECTED',
      }]);
      mockKisDomestic.getUnfilledOrders.mockResolvedValue([{
        orderNo: record.orderNo,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        side: record.side,
        quantity: 2,
        price: 70_000,
      }]);
      mockRecovery.releaseCancellationClaim.mockResolvedValue(true);
      mockKisDomestic.cancelOrder.mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        message: '취소 접수',
      });

      await expect(
        service.cancelTradeOrder({ tradeRecordId: 'trade-switch-off' }),
      ).resolves.toEqual({
        success: false,
        message: '현재 환경에서는 실거래가 비활성화되어 주문 취소를 실행할 수 없습니다.',
      });

      expect(mockRecovery.releaseCancellationClaim).toHaveBeenCalledWith(
        'trade-switch-off',
        Broker.KIS,
        '실거래 비활성화로 주문 취소 중단',
      );
      expect(mockKisDomestic.getOrderExecutions).toHaveBeenCalledTimes(1);
      expect(mockKisDomestic.getUnfilledOrders).toHaveBeenCalledTimes(1);
      expect(mockLiveSwitch.isEnabled).toHaveBeenCalledTimes(3);
      expect(mockKisDomestic.cancelOrder).not.toHaveBeenCalled();
    });

    it('persists an accepted cancellation without terminalizing the original order', async () => {
      const record = {
        broker: Broker.KIS,
        id: 'trade-3',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'SELL',
        quantity: 2,
        executedQty: 0,
        price: '56.73',
        status: 'PENDING',
        cancellationStatus: null,
        orderNo: '12345',
        brokerOrderDate: '20260713',
        brokerEnvironment: 'PAPER',
        brokerAccountHash: 'account-hash',
        reason: 'Take profit order',
      };
      mockPrisma.tradeRecord.findUnique
        .mockResolvedValueOnce(record)
        .mockResolvedValueOnce({
          ...record,
          cancellationStatus: 'SUBMITTING',
        });
      mockKisOverseas.getOrderExecutions.mockResolvedValue([{
        orderNo: record.orderNo,
        orderDate: record.brokerOrderDate,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        side: record.side,
        orderQuantity: record.quantity,
        filledQuantity: 0,
        remainingQuantity: 2,
        rejectionState: 'NOT_REJECTED',
      }]);
      mockKisOverseas.getUnfilledOrders.mockResolvedValue([{
        orderNo: record.orderNo,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        side: record.side,
        quantity: 2,
        price: 56.73,
      }]);
      mockKisOverseas.cancelOrder.mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        message: '취소 접수',
      });
      mockRecovery.markCancellationAccepted.mockResolvedValue(true);

      const result = await service.cancelTradeOrder({ tradeRecordId: 'trade-3' });

      expect(mockKisOverseas.getOrderExecutions).toHaveBeenCalledWith(
        record.brokerOrderDate,
        record.brokerOrderDate,
      );
      expect(mockKisOverseas.getUnfilledOrders).toHaveBeenCalledTimes(1);
      expect(mockKisOverseas.cancelOrder).toHaveBeenCalledWith('NASD', '12345', 'TQQQ', 2, 56.73);
      expect(mockKisOverseas.cancelOrder).toHaveBeenCalledTimes(1);
      expect(mockRecovery.markCancellationAccepted).toHaveBeenCalledWith(
        'trade-3',
        Broker.KIS,
        '취소 접수',
      );
      expect(mockPrisma.tradeRecord.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        orderNo: '12345',
        message: 'TQQQ 주문 취소 요청을 접수했습니다.',
      });
    });

    it('returns the broker failure while the order remains open', async () => {
      const record = {
        broker: Broker.KIS,
        id: 'trade-4',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'SELL',
        quantity: 2,
        executedQty: 0,
        price: '70000',
        status: 'PENDING',
        cancellationStatus: null,
        orderNo: '99999',
        brokerOrderDate: '20260713',
        brokerEnvironment: 'PAPER',
        brokerAccountHash: 'account-hash',
        reason: null,
        createdAt: new Date('2026-04-15T00:00:00.000Z'),
      };
      mockPrisma.tradeRecord.findUnique
        .mockResolvedValueOnce(record)
        .mockResolvedValueOnce({
          ...record,
          cancellationStatus: 'SUBMITTING',
        });
      mockKisDomestic.cancelOrder.mockResolvedValue({
        outcome: 'REJECTED',
        success: false,
        message: 'broker rejected',
      });
      mockRecovery.markCancellationRejected.mockResolvedValue(true);
      mockKisDomestic.getOrderExecutions.mockResolvedValue([{
        orderNo: record.orderNo,
        orderDate: record.brokerOrderDate,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        side: record.side,
        orderQuantity: record.quantity,
        filledQuantity: 0,
        remainingQuantity: 2,
        rejectionState: 'NOT_REJECTED',
      }]);
      mockKisDomestic.getUnfilledOrders.mockResolvedValue([{
        orderNo: record.orderNo,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        side: record.side,
        quantity: 2,
        price: 70_000,
      }]);

      const result = await service.cancelTradeOrder({ tradeRecordId: 'trade-4' });

      expect(result).toEqual({ success: false, message: 'broker rejected' });
      expect(mockRecovery.markCancellationRejected).toHaveBeenCalledWith(
        'trade-4',
        Broker.KIS,
        'broker rejected',
      );
      expect(mockKisDomestic.getOrderExecutions).toHaveBeenCalledWith(
        record.brokerOrderDate,
        record.brokerOrderDate,
      );
      expect(mockKisDomestic.getUnfilledOrders).toHaveBeenCalledTimes(1);
      expect(mockPrisma.tradeRecord.update).not.toHaveBeenCalled();
    });

    it('persists an UNKNOWN cancellation after verified reads without mutating the original order', async () => {
      const record = {
        broker: Broker.KIS,
        id: 'trade-cancel-unknown',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'SELL',
        quantity: 2,
        executedQty: 0,
        price: '70000',
        status: 'PENDING',
        cancellationStatus: null,
        orderNo: 'unknown-order',
        brokerOrderDate: '20260713',
        brokerEnvironment: 'PAPER',
        brokerAccountHash: 'account-hash',
      };
      mockPrisma.tradeRecord.findUnique
        .mockResolvedValueOnce(record)
        .mockResolvedValueOnce({
          ...record,
          cancellationStatus: 'SUBMITTING',
        });
      mockKisDomestic.getOrderExecutions.mockResolvedValue([{
        orderNo: record.orderNo,
        orderDate: record.brokerOrderDate,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        side: record.side,
        orderQuantity: record.quantity,
        filledQuantity: 0,
        remainingQuantity: 2,
        rejectionState: 'NOT_REJECTED',
      }]);
      mockKisDomestic.getUnfilledOrders.mockResolvedValue([{
        orderNo: record.orderNo,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        side: record.side,
        quantity: 2,
        price: 70_000,
      }]);
      mockKisDomestic.cancelOrder.mockResolvedValue({
        outcome: 'UNKNOWN',
        success: false,
        message: 'network timeout',
      });
      mockRecovery.markCancellationUnknown.mockResolvedValue(true);

      await expect(
        service.cancelTradeOrder({ tradeRecordId: 'trade-cancel-unknown' }),
      ).resolves.toEqual({ success: false, message: 'network timeout' });

      expect(mockKisDomestic.cancelOrder).toHaveBeenCalledTimes(1);
      expect(mockRecovery.markCancellationUnknown).toHaveBeenCalledWith(
        'trade-cancel-unknown',
        Broker.KIS,
        'network timeout',
      );
      expect(mockKisDomestic.getOrderExecutions).toHaveBeenCalledWith(
        record.brokerOrderDate,
        record.brokerOrderDate,
      );
      expect(mockKisDomestic.getUnfilledOrders).toHaveBeenCalledTimes(1);
      expect(mockPrisma.tradeRecord.update).not.toHaveBeenCalled();
    });

    it('treats a thrown cancellation transport failure as UNKNOWN without another POST', async () => {
      const record = {
        broker: Broker.KIS,
        id: 'trade-cancel-throw',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'SELL',
        quantity: 2,
        executedQty: 0,
        price: '70000',
        status: 'PENDING',
        cancellationStatus: null,
        orderNo: 'throw-order',
        brokerOrderDate: '20260713',
        brokerEnvironment: 'PAPER',
        brokerAccountHash: 'account-hash',
      };
      mockPrisma.tradeRecord.findUnique
        .mockResolvedValueOnce(record)
        .mockResolvedValueOnce({
          ...record,
          cancellationStatus: 'SUBMITTING',
        });
      mockKisDomestic.getOrderExecutions.mockResolvedValue([{
        orderNo: record.orderNo,
        orderDate: record.brokerOrderDate,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        side: record.side,
        orderQuantity: record.quantity,
        filledQuantity: 0,
        remainingQuantity: 2,
        rejectionState: 'NOT_REJECTED',
      }]);
      mockKisDomestic.getUnfilledOrders.mockResolvedValue([{
        orderNo: record.orderNo,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        side: record.side,
        quantity: 2,
        price: 70_000,
      }]);
      mockKisDomestic.cancelOrder.mockRejectedValue(new Error('socket closed'));
      mockRecovery.markCancellationUnknown.mockResolvedValue(true);

      await expect(
        service.cancelTradeOrder({ tradeRecordId: 'trade-cancel-throw' }),
      ).resolves.toEqual({ success: false, message: 'socket closed' });

      expect(mockKisDomestic.cancelOrder).toHaveBeenCalledTimes(1);
      expect(mockRecovery.markCancellationUnknown).toHaveBeenCalledWith(
        'trade-cancel-throw',
        Broker.KIS,
        'socket closed',
      );
      expect(mockPrisma.tradeRecord.update).not.toHaveBeenCalled();
    });

    it('blocks the mutation when live trading is disabled', async () => {
      service = await createService(false);

      const result = await service.cancelTradeOrder({ tradeRecordId: 'trade-6' });

      expect(result).toEqual({
        success: false,
        message: '현재 환경에서는 실거래가 비활성화되어 주문 취소를 실행할 수 없습니다.',
      });
      expect(mockPrisma.tradeRecord.findUnique).not.toHaveBeenCalled();
    });
  });
});

describe('TradeRecordResolver manual order mutations', () => {
  it('delegates both mutations to TradeRecordManualOrderService unchanged', async () => {
    const tradeRecordService = {} as never;
    const manualOrderService = {
      manualSell: jest.fn().mockResolvedValue({ success: true, orderNo: 'sell-1' }),
      cancelTradeOrder: jest.fn().mockResolvedValue({ success: true, orderNo: 'cancel-1' }),
    };
    const resolver = new TradeRecordResolver(tradeRecordService, manualOrderService as never);
    const sellInput = { broker: Broker.KIS, market: 'DOMESTIC', exchangeCode: '', stockCode: '005930', quantity: 1 } as const;
    const cancelInput = { tradeRecordId: 'trade-1' };

    await expect(resolver.manualSell(sellInput)).resolves.toEqual({ success: true, orderNo: 'sell-1' });
    await expect(resolver.cancelTradeOrder(cancelInput)).resolves.toEqual({ success: true, orderNo: 'cancel-1' });
    expect(manualOrderService.manualSell).toHaveBeenCalledWith(sellInput);
    expect(manualOrderService.cancelTradeOrder).toHaveBeenCalledWith(cancelInput);
  });
});
