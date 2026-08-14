import { TradingBrokerOrderMatcherService } from './trading-broker-order-matcher.service';

describe('TradingBrokerOrderMatcherService', () => {
  const brokerContext = {
    getCurrentContext: jest.fn(),
  };
  const domestic = {
    getOrderExecutions: jest.fn(),
  };
  const overseas = {
    getOrderExecutions: jest.fn(),
  };
  const port = {
    getOrderExecutions: jest.fn((market, startDate, endDate) => market === 'DOMESTIC'
      ? domestic.getOrderExecutions(startDate, endDate)
      : overseas.getOrderExecutions(startDate, endDate)),
  };
  const registry = { get: jest.fn() };

  let service: TradingBrokerOrderMatcherService;

  beforeEach(() => {
    jest.resetAllMocks();
    port.getOrderExecutions.mockImplementation((market, startDate, endDate) => market === 'DOMESTIC'
      ? domestic.getOrderExecutions(startDate, endDate)
      : overseas.getOrderExecutions(startDate, endDate));
    registry.get.mockReturnValue(port);
    brokerContext.getCurrentContext.mockReturnValue({
      environment: 'PROD',
      accountHash: 'current-hash',
      maskedAccount: '****5678-01',
    });
    service = new TradingBrokerOrderMatcherService(
      brokerContext as never,
      registry as never,
    );
  });

  const request = (overrides: Record<string, unknown> = {}) => ({
    tradeRecordId: 'trade-unknown',
    broker: 'KIS',
    market: 'OVERSEAS',
    exchangeCode: 'NASD',
    stockCode: 'TQQQ',
    side: 'SELL',
    quantity: 3,
    submissionStartedAt: new Date('2026-07-13T15:00:00.000Z'),
    brokerEnvironment: 'PROD',
    brokerAccountHash: 'current-hash',
    ...overrides,
  });

  it.each([
    ['missing account hash', { brokerEnvironment: 'PROD', brokerAccountHash: null }],
    ['missing environment', { brokerEnvironment: null, brokerAccountHash: 'current-hash' }],
  ])('blocks %s before any broker read', async (_case, contextOverride) => {
    await expect(service.findSubmissionCandidates(request(contextOverride) as never))
      .rejects.toThrow(/assign.*broker context/i);

    expect(domestic.getOrderExecutions).not.toHaveBeenCalled();
    expect(overseas.getOrderExecutions).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['invalid', new Date('invalid')],
  ])('blocks a %s submission timestamp before any broker read', async (_case, timestamp) => {
    await expect(service.findSubmissionCandidates(request({
      submissionStartedAt: timestamp,
    }) as never)).rejects.toThrow(/valid submission timestamp/i);

    expect(domestic.getOrderExecutions).not.toHaveBeenCalled();
    expect(overseas.getOrderExecutions).not.toHaveBeenCalled();
  });

  it('blocks a changed environment or account before any broker read', async () => {
    await expect(service.findSubmissionCandidates(request({
      brokerAccountHash: 'different-hash',
    }) as never)).rejects.toThrow(/does not match current KIS context/i);

    expect(brokerContext.getCurrentContext).toHaveBeenCalledTimes(1);
    expect(domestic.getOrderExecutions).not.toHaveBeenCalled();
    expect(overseas.getOrderExecutions).not.toHaveBeenCalled();
  });

  it('queries the full KST date window and returns only exact, de-duplicated domestic matches', async () => {
    domestic.getOrderExecutions.mockResolvedValue([
      {
        orderNo: ' D-1 ',
        stockCode: '005930',
        side: 'SELL',
        orderQuantity: 3,
        filledQuantity: 1,
        remainingQuantity: 2,
        exchangeCode: 'KRX',
        orderDate: '20260713',
        orderTime: '235000',
        rejectionState: 'NOT_REJECTED',
        rejected: false,
      },
      {
        orderNo: 'D-1',
        stockCode: '005930',
        side: 'SELL',
        orderQuantity: 3,
        filledQuantity: 1,
        remainingQuantity: 2,
        exchangeCode: 'KRX',
        orderDate: '20260713',
        orderTime: '235000',
        rejectionState: 'NOT_REJECTED',
      },
      {
        orderNo: 'D-2',
        stockCode: '005930',
        side: 'SELL',
        orderQuantity: 3,
        filledQuantity: 0,
        remainingQuantity: 3,
        exchangeCode: 'KRX',
        orderDate: '20260714',
        orderTime: '001000',
      },
      {
        orderNo: 'outside-window',
        stockCode: '005930',
        side: 'SELL',
        orderQuantity: 3,
        filledQuantity: 0,
        remainingQuantity: 3,
        exchangeCode: 'KRX',
        orderDate: '20260714',
        orderTime: '001001',
        rejectionState: 'UNKNOWN',
      },
      {
        orderNo: 'wrong-side',
        stockCode: '005930',
        side: 'BUY',
        orderQuantity: 3,
        filledQuantity: 0,
        remainingQuantity: 3,
        exchangeCode: 'KRX',
        orderDate: '20260714',
        orderTime: '000100',
        rejectionState: 'UNKNOWN',
      },
      {
        orderNo: 'wrong-quantity',
        stockCode: '005930',
        side: 'SELL',
        orderQuantity: 2,
        filledQuantity: 0,
        remainingQuantity: 2,
        exchangeCode: 'KRX',
        orderDate: '20260714',
        orderTime: '000100',
        rejectionState: 'UNKNOWN',
      },
      {
        orderNo: 'invalid-time',
        stockCode: '005930',
        side: 'SELL',
        orderQuantity: 3,
        filledQuantity: 0,
        remainingQuantity: 3,
        exchangeCode: 'KRX',
        orderDate: '20260714',
        orderTime: '246000',
        rejectionState: 'UNKNOWN',
      },
    ]);

    const candidates = await service.findSubmissionCandidates(request({
      market: 'DOMESTIC',
      exchangeCode: ' krx ',
      stockCode: ' 005930 ',
    }) as never);

    expect(domestic.getOrderExecutions).toHaveBeenCalledWith('20260713', '20260714');
    expect(overseas.getOrderExecutions).not.toHaveBeenCalled();
    expect(candidates).toEqual([
      expect.objectContaining({
        orderNo: 'D-1',
        exchangeCode: 'KRX',
        orderDate: '20260713',
        orderTime: '235000',
        rejectionState: 'NOT_REJECTED',
      }),
      expect.objectContaining({
        orderNo: 'D-2',
        exchangeCode: 'KRX',
        orderDate: '20260714',
        orderTime: '001000',
        rejectionState: 'UNKNOWN',
      }),
    ]);
  });

  it('uses overseas history and propagates an incomplete read without fallback data', async () => {
    overseas.getOrderExecutions.mockRejectedValue(new Error('page 2 unavailable'));

    await expect(service.findSubmissionCandidates(request() as never))
      .rejects.toThrow('page 2 unavailable');

    expect(overseas.getOrderExecutions).toHaveBeenCalledWith('20260713', '20260714');
    expect(domestic.getOrderExecutions).not.toHaveBeenCalled();
  });
});
