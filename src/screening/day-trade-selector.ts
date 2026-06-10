import { DailyPrice } from '../kis/types/kis-api.types';
import {
  DayTradeCandidateScore,
  DayTradeCautionFlags,
  DayTradeIndicatorSnapshot,
  detectEtf,
} from './types';

/**
 * 데이트레이드(당일청산) 후보 선정 기준.
 * 근거: momentum-breakout 백테스트(2023-06~2026-05) — 거래세 면제 ETF + MA20 위
 * 레짐에서만 양의 기대값. 임계값 근거는 src/screening/CLAUDE.md 참조.
 * strategy-matcher의 momentum-breakout 추천 게이트와 상수를 공유한다.
 */
export const DAY_TRADE_MIN_AVG_TRADE_VALUE = 30_000_000_000; // 300억
export const DAY_TRADE_MIN_ATR_PCT = 1.2; // 왕복 비용(~0.3%) 대비 4배
const SCORE_ATR_FULL_MARK_PCT = 5; // ATR 5% 이상이면 변동성 만점
const SCORE_TRADE_VALUE_FULL_MARK = 3_000_000_000_000; // 3조 이상이면 유동성 만점
const VOLATILITY_WEIGHT = 0.6;
const LIQUIDITY_WEIGHT = 0.4;

/** 핵심 고변동성 ETF 시드 — 랭킹 API가 놓치거나 빈 응답이어도 항상 평가. 운영하며 보강 */
export const DAY_TRADE_SEED_ETFS: ReadonlyArray<{ stockCode: string; stockName: string }> = [
  { stockCode: '122630', stockName: 'KODEX 레버리지' },
  { stockCode: '252670', stockName: 'KODEX 200선물인버스2X' },
  { stockCode: '233740', stockName: 'KODEX 코스닥150레버리지' },
  { stockCode: '251340', stockName: 'KODEX 코스닥150선물인버스' },
  { stockCode: '114800', stockName: 'KODEX 인버스' },
  { stockCode: '069500', stockName: 'KODEX 200' },
  { stockCode: '229200', stockName: 'KODEX 코스닥150' },
];

/**
 * 거래세 면제 + LP 호가가 보장되는 순수 KRX ETF만 통과.
 * detectEtf는 ETN/스팩도 true이므로 별도로 거른다 — ETN은 발행사 신용 리스크,
 * 스팩은 유동성 구조가 달라 당일청산 시장가 전략에 부적합.
 */
export function isStrictKrxEtf(stockName: string, stockCode: string): boolean {
  if (!/^\d{6}$/.test(stockCode)) return false; // ETN(Q500001)/액티브펀드(0162Y0) 등 문자 포함 코드
  const upper = stockName.toUpperCase();
  if (upper.includes('ETN') || stockName.includes('스팩')) return false;
  return detectEtf(stockName, stockCode);
}

/**
 * 전일 확정 일봉 기준 지표 계산.
 * @param prices KIS getDailyPrices 결과 (최신순, index 0 = 최신)
 * @param todayStr 오늘(YYYYMMDD) — 당일 봉이 섞여 있으면 제외해 전일 확정 데이터를 보장
 * @returns 확정 봉 20개 미만이면 undefined
 */
export function computeDayTradeIndicators(
  prices: DailyPrice[],
  todayStr: string,
): DayTradeIndicatorSnapshot | undefined {
  const bars = prices.filter((p) => p.date !== todayStr && p.close > 0);
  if (bars.length < 20) return undefined;

  const prev = bars[0];
  const ma20 = bars.slice(0, 20).reduce((sum, b) => sum + b.close, 0) / 20;

  let trSum = 0;
  for (let i = 0; i < 14; i++) {
    const cur = bars[i];
    const prevClose = bars[i + 1].close;
    trSum += Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prevClose),
      Math.abs(cur.low - prevClose),
    );
  }
  const atrPct = (trSum / 14 / prev.close) * 100;

  // 거래대금 근사: 종가×거래량 (KIS 일봉 응답에 거래대금 필드가 없음)
  const avgTradeValue20d =
    bars.slice(0, 20).reduce((sum, b) => sum + b.close * b.volume, 0) / 20;

  return {
    prevDate: prev.date,
    prevClose: prev.close,
    prevRangePct: ((prev.high - prev.low) / prev.close) * 100,
    atrPct,
    ma20,
    aboveMa20: prev.close > ma20,
    avgTradeValue20d,
  };
}

function resolveExcludeReason(
  indicators: DayTradeIndicatorSnapshot,
  caution: DayTradeCautionFlags,
): string | undefined {
  if (caution.investCautionYn) return '투자유의 지정';
  if (caution.shortOverheatYn) return '단기과열 지정';
  if (caution.marketWarnCode && caution.marketWarnCode !== '00') {
    return `시장경고(${caution.marketWarnCode})`;
  }
  if (indicators.avgTradeValue20d < DAY_TRADE_MIN_AVG_TRADE_VALUE) return '평균 거래대금 미달';
  if (!indicators.aboveMa20) return 'MA20 아래 (레짐 부적합)';
  if (indicators.atrPct < DAY_TRADE_MIN_ATR_PCT) return '변동폭(ATR) 미달';
  return undefined;
}

/** 하드 필터 적용 후 통과 시 절대 점수(0~100) 계산 — 날짜 간 비교 가능하도록 코호트 비의존 */
export function buildDayTradeScore(
  stockCode: string,
  stockName: string,
  indicators: DayTradeIndicatorSnapshot,
  caution: DayTradeCautionFlags,
): DayTradeCandidateScore {
  const base = {
    stockCode,
    stockName,
    exchangeCode: 'KRX' as const,
    market: 'DOMESTIC' as const,
    rank: 0,
    indicators,
  };

  const excludeReason = resolveExcludeReason(indicators, caution);
  if (excludeReason) {
    return { ...base, score: 0, excluded: true, excludeReason };
  }

  const volNorm = Math.min(indicators.atrPct / SCORE_ATR_FULL_MARK_PCT, 1);
  const liqLogMin = Math.log10(DAY_TRADE_MIN_AVG_TRADE_VALUE);
  const liqLogMax = Math.log10(SCORE_TRADE_VALUE_FULL_MARK);
  const liqNorm = Math.min(
    Math.max((Math.log10(indicators.avgTradeValue20d) - liqLogMin) / (liqLogMax - liqLogMin), 0),
    1,
  );
  const score =
    Math.round((volNorm * VOLATILITY_WEIGHT + liqNorm * LIQUIDITY_WEIGHT) * 100 * 100) / 100;

  return { ...base, score, excluded: false };
}

/** 통과 후보 점수 내림차순 rank(1부터), 탈락(rank 0)은 뒤에 붙인다 */
export function rankDayTradeCandidates(
  scores: DayTradeCandidateScore[],
): DayTradeCandidateScore[] {
  const passing = scores
    .filter((s) => !s.excluded)
    .sort((a, b) => b.score - a.score)
    .map((s, i) => ({ ...s, rank: i + 1 }));
  const excluded = scores.filter((s) => s.excluded);
  return [...passing, ...excluded];
}
