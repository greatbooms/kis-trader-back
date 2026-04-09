import { pickRecommendationsForStorage } from './screening.service';
import { StockScore } from './types';
import { ScreeningService } from './screening.service';

function createScore(rank: number, isEtf: boolean, totalScore: number): StockScore {
  return {
    stockCode: `${isEtf ? 'ETF' : 'STK'}${rank}`,
    stockName: `${isEtf ? 'ETF' : 'Stock'} ${rank}`,
    exchangeCode: 'KRX',
    market: 'DOMESTIC',
    totalScore,
    technicalScore: totalScore,
    fundamentalScore: totalScore,
    momentumScore: totalScore,
    reasons: [],
    indicators: {},
    suggestedStrategies: [],
    currentPrice: 1000,
    changeRate: 0,
    volume: 1000,
    marketCap: 1000000,
    isEtf,
  };
}

describe('pickRecommendationsForStorage', () => {
  it('caps total recommendations at 20 and ETF count at 5', () => {
    const stocks = Array.from({ length: 30 }, (_, index) => createScore(index + 1, false, 100 - index));
    const etfs = Array.from({ length: 10 }, (_, index) => createScore(index + 1, true, 95 - index));

    const selected = pickRecommendationsForStorage([...stocks, ...etfs]);

    expect(selected).toHaveLength(20);
    expect(selected.filter((item) => item.isEtf)).toHaveLength(5);
    expect(selected.filter((item) => !item.isEtf)).toHaveLength(15);
  });

  it('fills remaining slots with stocks when ETF candidates are fewer than the cap', () => {
    const stocks = Array.from({ length: 30 }, (_, index) => createScore(index + 1, false, 100 - index));
    const etfs = Array.from({ length: 3 }, (_, index) => createScore(index + 1, true, 90 - index));

    const selected = pickRecommendationsForStorage([...stocks, ...etfs]);

    expect(selected).toHaveLength(20);
    expect(selected.filter((item) => item.isEtf)).toHaveLength(3);
    expect(selected.filter((item) => !item.isEtf)).toHaveLength(17);
  });

  it('returns the selected items sorted by total score for unified ranking', () => {
    const scores = [
      createScore(1, false, 90),
      createScore(2, false, 88),
      createScore(1, true, 95),
      createScore(3, false, 84),
    ];

    const selected = pickRecommendationsForStorage(scores, 4, 2);

    expect(selected.map((item) => item.totalScore)).toEqual([95, 90, 88, 84]);
  });
});

describe('ScreeningService overseas candidate fallback', () => {
  it('uses stock master fallback for TKSE when KIS candidate APIs return empty', async () => {
    const service = new ScreeningService(
      {} as any,
      {} as any,
      {
        searchStocks: jest.fn().mockResolvedValue([]),
        getVolumeRanking: jest.fn().mockResolvedValue([]),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        getStocksByExchange: jest.fn().mockReturnValue([
          { stockCode: '7203', stockName: '토요타자동차', market: 'OVERSEAS', exchangeCode: 'TKSE' },
          { stockCode: '6758', stockName: '소니그룹', market: 'OVERSEAS', exchangeCode: 'TKSE' },
        ]),
      } as any,
    );

    const candidates = await (service as any).collectOverseasCandidates('TKSE');

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      stockCode: '7203',
      stockName: '토요타자동차',
      exchangeCode: 'TKSE',
      market: 'OVERSEAS',
    });
  });
});
