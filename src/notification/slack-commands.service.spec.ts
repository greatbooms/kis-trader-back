import { Market, Side } from '@prisma/client';
import { SlackCommandsService } from './slack-commands.service';

describe('SlackCommandsService', () => {
  const mockPrisma = {
    position: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    tradeRecord: {
      findMany: jest.fn(),
    },
    watchStock: {
      findFirst: jest.fn(),
    },
  };

  const mockMarketAnalysisService = {
    getMarketCondition: jest.fn(),
  };

  const mockSlackService = {
    getApp: jest.fn(),
    formatPositionList: jest.fn(),
    formatDailySummary: jest.fn(),
    formatStockDetail: jest.fn(),
  };

  let service: SlackCommandsService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockMarketAnalysisService.getMarketCondition.mockResolvedValue({
      referenceIndexName: 'S&P500',
      referenceIndexAboveMA200: true,
    });
    service = new SlackCommandsService(
      mockPrisma as any,
      {} as any,
      {} as any,
      mockMarketAnalysisService as any,
      mockSlackService as any,
    );
  });

  it('builds a US session summary using only US positions and session trades', async () => {
    const tradeStart = new Date('2026-06-24T22:30:00+09:00');
    const tradeEnd = new Date('2026-06-25T05:00:00+09:00');

    mockPrisma.position.findMany.mockResolvedValue([
      {
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        exchangeCode: 'NASD',
        market: Market.OVERSEAS,
        quantity: 37,
        avgPrice: 78.79,
        currentPrice: 75.11,
        profitLoss: -136.01,
        profitRate: -4.66,
        totalInvested: 2915.08,
      },
    ]);
    mockPrisma.tradeRecord.findMany.mockResolvedValue([
      { side: Side.BUY, market: Market.OVERSEAS, exchangeCode: 'NASD' },
      { side: Side.SELL, market: Market.OVERSEAS, exchangeCode: 'AMEX' },
    ]);

    const summary = await service.buildDailySummary({
      summaryTitle: '미국장 매매 요약 | 2026-06-24 거래일',
      market: 'OVERSEAS',
      exchangeCodes: ['NASD', 'NYSE', 'AMEX'],
      tradeStart,
      tradeEnd,
    });

    expect(mockPrisma.position.findMany).toHaveBeenCalledWith({
      where: {
        market: Market.OVERSEAS,
        exchangeCode: { in: ['NASD', 'NYSE', 'AMEX'] },
      },
      orderBy: { updatedAt: 'desc' },
    });
    expect(mockPrisma.tradeRecord.findMany).toHaveBeenCalledWith({
      where: {
        createdAt: { gte: tradeStart, lte: tradeEnd },
        status: 'FILLED',
        market: Market.OVERSEAS,
        exchangeCode: { in: ['NASD', 'NYSE', 'AMEX'] },
      },
      select: {
        side: true,
        market: true,
        exchangeCode: true,
      },
    });
    expect(summary.summaryTitle).toBe('미국장 매매 요약 | 2026-06-24 거래일');
    expect(summary.todayBuyCount).toBe(1);
    expect(summary.todaySellCount).toBe(1);
    expect(summary.marketSummaries).toHaveLength(1);
    expect(summary.marketSummaries?.[0].label).toBe('미국');
    expect(mockMarketAnalysisService.getMarketCondition).toHaveBeenCalledWith('NASD');
  });
});
