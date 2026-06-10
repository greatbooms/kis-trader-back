import { DailyPrice } from '../kis/types/kis-api.types';
import {
  buildDayTradeScore,
  computeDayTradeIndicators,
  isStrictKrxEtf,
  rankDayTradeCandidates,
} from './day-trade-selector';
import { DayTradeCandidateScore, DayTradeIndicatorSnapshot } from './types';

const TODAY = '20260611';

/** 최신순(index 0 = 최신) 봉 생성. overrides[i]는 i번째(최신부터) 봉을 덮어쓴다 */
function makeBars(
  count: number,
  overrides: Record<number, Partial<DailyPrice>> = {},
): DailyPrice[] {
  return Array.from({ length: count }, (_, i) => ({
    date: String(20260610 - i), // 단순 감소 날짜 (TODAY와 겹치지 않음)
    close: 100,
    open: 100,
    high: 102,
    low: 98,
    volume: 600_000_000,
    ...overrides[i],
  }));
}

function makeSnapshot(overrides: Partial<DayTradeIndicatorSnapshot> = {}): DayTradeIndicatorSnapshot {
  return {
    prevDate: '20260610',
    prevClose: 100,
    prevRangePct: 4,
    atrPct: 2.5,
    ma20: 99,
    aboveMa20: true,
    avgTradeValue20d: 300_000_000_000, // 3000억
    ...overrides,
  };
}

describe('isStrictKrxEtf', () => {
  it('국내 레버리지/인버스 ETF를 통과시킨다', () => {
    expect(isStrictKrxEtf('KODEX 레버리지', '122630')).toBe(true);
    expect(isStrictKrxEtf('TIGER 200선물인버스2X', '252710')).toBe(true);
  });

  it('일반 주식을 거른다', () => {
    expect(isStrictKrxEtf('삼성전자', '005930')).toBe(false);
  });

  it('ETN을 코드/이름 양쪽에서 거른다', () => {
    expect(isStrictKrxEtf('신한 레버리지 WTI원유 선물 ETN', '500031')).toBe(false); // 이름에 ETN
    expect(isStrictKrxEtf('미래에셋 레버리지 ETN(H)', 'Q500001')).toBe(false); // 문자 포함 코드
  });

  it('스팩을 거른다', () => {
    expect(isStrictKrxEtf('삼성스팩8호', '448740')).toBe(false);
  });
});

describe('computeDayTradeIndicators', () => {
  it('확정 봉 20개 미만이면 undefined를 반환한다', () => {
    expect(computeDayTradeIndicators(makeBars(19), TODAY)).toBeUndefined();
  });

  it('동일 봉 20개에서 MA20/ATR/변동폭을 계산한다', () => {
    const result = computeDayTradeIndicators(makeBars(25), TODAY)!;
    expect(result.prevDate).toBe('20260610');
    expect(result.prevClose).toBe(100);
    expect(result.ma20).toBe(100);
    expect(result.aboveMa20).toBe(false); // 100 > 100은 false
    expect(result.prevRangePct).toBeCloseTo(4, 6); // (102-98)/100
    expect(result.atrPct).toBeCloseTo(4, 6); // TR 전부 4
    expect(result.avgTradeValue20d).toBeCloseTo(60_000_000_000, 0); // 100 × 6억주
  });

  it('최신 봉이 상승하면 aboveMa20이 true가 된다', () => {
    const bars = makeBars(25, { 0: { close: 110, high: 112, low: 108 } });
    const result = computeDayTradeIndicators(bars, TODAY)!;
    expect(result.ma20).toBeCloseTo((110 + 19 * 100) / 20, 6);
    expect(result.aboveMa20).toBe(true);
    // TR0 = max(112-108, |112-100|, |108-100|) = 12, 나머지 13개 = 4
    expect(result.atrPct).toBeCloseTo(((12 + 13 * 4) / 14 / 110) * 100, 6);
  });

  it('당일 봉이 섞여 있으면 제외하고 계산한다 (전일 확정 보장)', () => {
    const withToday = [
      { date: TODAY, close: 999, open: 999, high: 999, low: 999, volume: 1 },
      ...makeBars(25),
    ];
    expect(computeDayTradeIndicators(withToday, TODAY)).toEqual(
      computeDayTradeIndicators(makeBars(25), TODAY),
    );
  });
});

describe('buildDayTradeScore', () => {
  it('모든 하드 필터를 통과하면 점수를 계산한다', () => {
    // atrPct 2.5 → 변동성 (2.5/5)×60 = 30, 거래대금 3000억 → log 중간점 ×40 = 20
    const result = buildDayTradeScore('122630', 'KODEX 레버리지', makeSnapshot(), {});
    expect(result.excluded).toBe(false);
    expect(result.score).toBeCloseTo(50, 1);
  });

  it('투자유의 지정이면 제외한다', () => {
    const result = buildDayTradeScore('122630', 'KODEX 레버리지', makeSnapshot(), {
      investCautionYn: true,
    });
    expect(result.excluded).toBe(true);
    expect(result.excludeReason).toBe('투자유의 지정');
  });

  it('단기과열 지정이면 제외한다', () => {
    const result = buildDayTradeScore('122630', 'KODEX 레버리지', makeSnapshot(), {
      shortOverheatYn: true,
    });
    expect(result.excluded).toBe(true);
    expect(result.excludeReason).toBe('단기과열 지정');
  });

  it('시장경고 코드가 00이 아니면 제외한다', () => {
    const result = buildDayTradeScore('122630', 'KODEX 레버리지', makeSnapshot(), {
      marketWarnCode: '01',
    });
    expect(result.excluded).toBe(true);
  });

  it('평균 거래대금 300억 미만이면 제외한다', () => {
    const result = buildDayTradeScore(
      '122630', 'KODEX 레버리지',
      makeSnapshot({ avgTradeValue20d: 29_999_999_999 }), {},
    );
    expect(result.excludeReason).toBe('평균 거래대금 미달');
  });

  it('MA20 아래면 제외한다', () => {
    const result = buildDayTradeScore(
      '122630', 'KODEX 레버리지', makeSnapshot({ aboveMa20: false }), {},
    );
    expect(result.excludeReason).toBe('MA20 아래 (레짐 부적합)');
  });

  it('ATR 1.2% 미만이면 제외한다', () => {
    const result = buildDayTradeScore(
      '122630', 'KODEX 레버리지', makeSnapshot({ atrPct: 1.19 }), {},
    );
    expect(result.excludeReason).toBe('변동폭(ATR) 미달');
  });
});

describe('rankDayTradeCandidates', () => {
  function score(code: string, value: number, excluded = false): DayTradeCandidateScore {
    return {
      stockCode: code,
      stockName: code,
      exchangeCode: 'KRX',
      market: 'DOMESTIC',
      score: value,
      rank: 0,
      excluded,
      indicators: makeSnapshot(),
    };
  }

  it('통과 후보를 점수 내림차순으로 rank 부여하고 탈락은 rank 0으로 뒤에 둔다', () => {
    const ranked = rankDayTradeCandidates([
      score('A', 30),
      score('B', 70),
      score('C', 0, true),
      score('D', 50),
    ]);
    expect(ranked.map((r) => r.stockCode)).toEqual(['B', 'D', 'A', 'C']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 0]);
  });
});
