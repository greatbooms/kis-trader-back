import { pickRecommendationsForStorage } from './screening.service';
import { StockScore, detectEtf } from './types';
import { ScreeningCandidateCollector } from './screening-candidate-collector.service';

function createScore(rank: number, isEtf: boolean, totalScore: number): StockScore {
  return {
    stockCode: `${isEtf ? 'ETF' : 'STK'}${rank}`,
    stockName: `${isEtf ? 'ETF' : 'Stock'} ${rank}`,
    exchangeCode: 'KRX',
    market: 'DOMESTIC',
    totalScore,
    trendScore: totalScore,
    timingScore: totalScore,
    fundamentalScore: totalScore,
    riskSupplyScore: totalScore,
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

  it('reclassifies ETF-like names before applying the ETF cap', () => {
    const pseudoEtf = {
      ...createScore(1, false, 99),
      stockCode: 'BUFB',
      stockName: 'INNOVATOR LADDERED ALLOCATION BUFFER',
      exchangeCode: 'AMEX',
      market: 'OVERSEAS' as const,
    };
    const stocks = Array.from({ length: 20 }, (_, index) => createScore(index + 1, false, 98 - index));
    const etfs = Array.from({ length: 5 }, (_, index) => ({
      ...createScore(index + 1, true, 97 - index),
      exchangeCode: 'AMEX',
      market: 'OVERSEAS' as const,
    }));

    const selected = pickRecommendationsForStorage([pseudoEtf, ...stocks, ...etfs], 20, 5);

    expect(selected.filter((item) => item.isEtf)).toHaveLength(5);
    const rebucketed = selected.find((item) => item.stockCode === 'BUFB');
    expect(rebucketed?.isEtf).toBe(true);
  });
});

describe('ScreeningCandidateCollector', () => {
  it('aggregates domestic candidates from multiple ranking APIs', async () => {
    const collector = new ScreeningCandidateCollector(
      {
        getVolumeRanking: jest.fn().mockResolvedValue([
          { mksc_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_prpr: '60000', prdy_ctrt: '1.2', acml_vol: '1000000' },
        ]),
        getFluctuationRanking: jest.fn().mockResolvedValue([
          { mksc_shrn_iscd: '000660', hts_kor_isnm: 'SK하이닉스', stck_prpr: '180000', prdy_ctrt: '3.1', acml_vol: '500000' },
        ]),
        getMarketCapRanking: jest.fn().mockResolvedValue([]),
      } as any,
      {} as any,
      {
        getStocksByExchange: jest.fn().mockReturnValue([]),
      } as any,
    );

    const candidates = await collector.collectDomesticCandidates();

    expect(candidates).toHaveLength(2);
    expect(candidates.map((item) => item.stockCode)).toEqual(['005930', '000660']);
  });

  it('aggregates candidates from multiple overseas ranking APIs', async () => {
    const collector = new ScreeningCandidateCollector(
      {} as any,
      {
        searchStocks: jest.fn().mockResolvedValue([]),
        getVolumeRanking: jest.fn().mockResolvedValue([]),
        getTradeValueRanking: jest.fn().mockResolvedValue([
          { symb: '7203', name: '토요타자동차', last: '2800', rate: '1.5', tvol: '200000', valx: '35000000' },
        ]),
        getTurnoverRanking: jest.fn().mockResolvedValue([
          { symb: '6758', name: '소니그룹', last: '13000', rate: '0.8', tvol: '150000', valx: '16000000' },
        ]),
        getMarketCapRanking: jest.fn().mockResolvedValue([]),
        getUpDownRanking: jest.fn().mockResolvedValue([]),
      } as any,
      {
        getStocksByExchange: jest.fn().mockReturnValue([]),
      } as any,
    );

    const candidates = await collector.collectOverseasCandidates('TKSE');

    expect(candidates).toHaveLength(2);
    expect(candidates.map((item) => item.stockCode)).toEqual(['7203', '6758']);
  });

  it('uses stock master fallback for TKSE when KIS candidate APIs return empty', async () => {
    const collector = new ScreeningCandidateCollector(
      {} as any,
      {
        searchStocks: jest.fn().mockResolvedValue([]),
        getVolumeRanking: jest.fn().mockResolvedValue([]),
        getTradeValueRanking: jest.fn().mockResolvedValue([]),
        getTurnoverRanking: jest.fn().mockResolvedValue([]),
        getMarketCapRanking: jest.fn().mockResolvedValue([]),
        getUpDownRanking: jest.fn().mockResolvedValue([]),
      } as any,
      {
        getStocksByExchange: jest.fn().mockReturnValue([
          { stockCode: '7203', stockName: '토요타자동차', market: 'OVERSEAS', exchangeCode: 'TKSE' },
          { stockCode: '6758', stockName: '소니그룹', market: 'OVERSEAS', exchangeCode: 'TKSE' },
        ]),
      } as any,
    );

    const candidates = await collector.collectOverseasCandidates('TKSE');

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      stockCode: '7203',
      stockName: '토요타자동차',
      exchangeCode: 'TKSE',
      market: 'OVERSEAS',
    });
  });
});

describe('detectEtf', () => {
  it('recognizes US buffer and commodity funds as ETFs', () => {
    expect(detectEtf('INNOVATOR LADDERED ALLOCATION BUFFER', 'BUFB')).toBe(true);
    expect(detectEtf('UNITED STATES OIL', 'USO')).toBe(true);
  });
});
