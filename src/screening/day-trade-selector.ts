import { DailyPrice } from '../kis/types/kis-api.types';
import {
  DayTradeBacktestSnapshot,
  DayTradeCandidateScore,
  DayTradeCautionFlags,
  DayTradeDirection,
  DayTradeIndicatorSnapshot,
  DayTradeRegimeLabel,
  DayTradeUnderlyingProxy,
  DayTradeUnderlyingRegimeSnapshot,
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
const REGIME_ADX_THRESHOLD = 25;
const BACKTEST_MIN_TRADES = 5;
const BACKTEST_MIN_AVG_RETURN_PCT = 0;
const BACKTEST_MIN_TOTAL_RETURN_PCT = 0;
const BACKTEST_K_VALUE = 0.5;
const BACKTEST_STOP_LOSS_RATE = 0.02;
const BACKTEST_SLIPPAGE_RATE = 0.002;
const BACKTEST_BUY_FEE_RATE = 0.00015;
const BACKTEST_SELL_FEE_RATE = 0.00015;
const BACKTEST_SELL_TAX_RATE = 0;

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

const UNDERLYING_PROXY_BY_CODE: Record<string, DayTradeUnderlyingProxy> = {
  // KOSPI200 계열
  '069500': { stockCode: '069500', stockName: 'KODEX 200' },
  '122630': { stockCode: '069500', stockName: 'KODEX 200' },
  '114800': { stockCode: '069500', stockName: 'KODEX 200' },
  '252670': { stockCode: '069500', stockName: 'KODEX 200' },
  // KOSDAQ150 계열
  '229200': { stockCode: '229200', stockName: 'KODEX 코스닥150' },
  '233740': { stockCode: '229200', stockName: 'KODEX 코스닥150' },
  '251340': { stockCode: '229200', stockName: 'KODEX 코스닥150' },
};

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

export function detectDayTradeDirection(stockName: string): DayTradeDirection {
  const upper = stockName.toUpperCase();
  return stockName.includes('인버스') || upper.includes('INVERSE') || upper.includes('BEAR')
    ? 'INVERSE'
    : 'LONG';
}

export function resolveUnderlyingProxy(stockName: string, stockCode: string): DayTradeUnderlyingProxy | undefined {
  const mapped = UNDERLYING_PROXY_BY_CODE[stockCode];
  if (mapped) return mapped;

  // 랭킹에서 새로 들어온 일반/섹터 ETF는 자기 자신을 추세 프록시로 사용한다.
  // 반대로 매핑되지 않은 인버스는 기초지수 방향을 알 수 없으므로 fail-closed 한다.
  if (detectDayTradeDirection(stockName) === 'INVERSE') return undefined;
  return { stockCode, stockName };
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

function calculateAdx(highs: number[], lows: number[], closes: number[], period = 14): number | undefined {
  if (highs.length < period * 2 || lows.length < period * 2 || closes.length < period * 2) return undefined;

  const trs: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    ));
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  let atrSum = trs.slice(0, period).reduce((sum, value) => sum + value, 0);
  let plusDMSum = plusDMs.slice(0, period).reduce((sum, value) => sum + value, 0);
  let minusDMSum = minusDMs.slice(0, period).reduce((sum, value) => sum + value, 0);

  const dxValues: number[] = [];
  for (let i = period; i < trs.length; i++) {
    atrSum = atrSum - atrSum / period + trs[i];
    plusDMSum = plusDMSum - plusDMSum / period + plusDMs[i];
    minusDMSum = minusDMSum - minusDMSum / period + minusDMs[i];
    const plusDI = atrSum > 0 ? (plusDMSum / atrSum) * 100 : 0;
    const minusDI = atrSum > 0 ? (minusDMSum / atrSum) * 100 : 0;
    const diSum = plusDI + minusDI;
    dxValues.push(diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0);
  }

  if (dxValues.length === 0) return undefined;
  if (dxValues.length < period) return dxValues[dxValues.length - 1];

  let adx = dxValues.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let i = period; i < dxValues.length; i++) {
    adx = (adx * (period - 1) + dxValues[i]) / period;
  }
  return adx;
}

function computeRegimeFromBars(
  bars: DailyPrice[],
  direction: DayTradeDirection,
  proxy: DayTradeUnderlyingProxy,
): DayTradeUnderlyingRegimeSnapshot {
  if (bars.length < 60) {
    return {
      direction,
      proxyStockCode: proxy.stockCode,
      proxyStockName: proxy.stockName,
      regime: 'UNKNOWN',
      aligned: false,
      reason: '기초지수 프록시 일봉 부족',
    };
  }

  const prev = bars[0];
  const ma20 = bars.slice(0, 20).reduce((sum, bar) => sum + bar.close, 0) / 20;
  const ma60 = bars.slice(0, 60).reduce((sum, bar) => sum + bar.close, 0) / 60;
  const chronological = [...bars].reverse();
  const adx14 = calculateAdx(
    chronological.map((bar) => bar.high),
    chronological.map((bar) => bar.low),
    chronological.map((bar) => bar.close),
    14,
  );

  let regime: DayTradeRegimeLabel = 'SIDEWAYS';
  if ((adx14 ?? 0) >= REGIME_ADX_THRESHOLD && ma20 > ma60 && prev.close > ma20) {
    regime = 'TRENDING_UP';
  } else if ((adx14 ?? 0) >= REGIME_ADX_THRESHOLD && ma20 < ma60 && prev.close < ma20) {
    regime = 'TRENDING_DOWN';
  }

  const aligned = direction === 'INVERSE'
    ? regime === 'TRENDING_DOWN'
    : regime === 'TRENDING_UP';
  const expected = direction === 'INVERSE' ? '하락' : '상승';
  const actual = regime === 'TRENDING_UP'
    ? '상승'
    : regime === 'TRENDING_DOWN'
      ? '하락'
      : '횡보';

  return {
    direction,
    proxyStockCode: proxy.stockCode,
    proxyStockName: proxy.stockName,
    regime,
    aligned,
    prevDate: prev.date,
    prevClose: prev.close,
    ma20,
    ma60,
    adx14,
    reason: aligned
      ? `기초지수 ${actual} 레짐`
      : `방향 불일치: ${direction === 'INVERSE' ? '인버스' : '롱'} ETF는 ${expected} 레짐 필요, 현재 ${actual}`,
  };
}

export function computeUnderlyingRegime(
  prices: DailyPrice[],
  todayStr: string,
  direction: DayTradeDirection,
  proxy: DayTradeUnderlyingProxy,
): DayTradeUnderlyingRegimeSnapshot {
  const bars = prices.filter((p) => p.date !== todayStr && p.close > 0);
  return computeRegimeFromBars(bars, direction, proxy);
}

function buildProxyIndexByDate(proxyBars: DailyPrice[] | undefined): Map<string, number> {
  const map = new Map<string, number>();
  if (!proxyBars) return map;
  proxyBars.forEach((bar, index) => map.set(bar.date, index));
  return map;
}

export function runDayTradeBacktest(
  prices: DailyPrice[],
  todayStr: string,
  options: {
    direction?: DayTradeDirection;
    proxy?: DayTradeUnderlyingProxy;
    proxyPrices?: DailyPrice[];
  } = {},
): DayTradeBacktestSnapshot {
  const bars = prices
    .filter((p) => p.date !== todayStr && p.close > 0)
    .slice()
    .reverse();
  if (bars.length < 40) {
    return {
      passed: false,
      tradeCount: 0,
      winRatePct: 0,
      totalReturnPct: 0,
      averageTradeReturnPct: 0,
      maxDrawdownPct: 0,
      reason: '백테스트 일봉 부족',
    };
  }

  const proxyBars = options.proxyPrices
    ?.filter((p) => p.date !== todayStr && p.close > 0)
    .slice()
    .reverse();
  const proxyIndexByDate = buildProxyIndexByDate(proxyBars);
  const returns: number[] = [];
  const positiveReturns: number[] = [];
  const negativeReturns: number[] = [];
  let firstTradeDate: string | undefined;
  let lastTradeDate: string | undefined;
  let equity = 1;
  let peak = 1;
  let maxDrawdownPct = 0;

  for (let i = 20; i < bars.length; i++) {
    const today = bars[i];
    const history = bars.slice(0, i).reverse();
    const indicators = computeDayTradeIndicators(history, today.date);
    if (!indicators) continue;
    if (indicators.avgTradeValue20d < DAY_TRADE_MIN_AVG_TRADE_VALUE) continue;
    if (!indicators.aboveMa20) continue;
    if (indicators.atrPct < DAY_TRADE_MIN_ATR_PCT) continue;

    if (options.direction && options.proxy && proxyBars) {
      const prevDate = bars[i - 1]?.date;
      const proxyIndex = prevDate ? proxyIndexByDate.get(prevDate) : undefined;
      if (proxyIndex === undefined) continue;
      const proxyHistory = proxyBars.slice(0, proxyIndex + 1).reverse();
      const regime = computeRegimeFromBars(proxyHistory, options.direction, options.proxy);
      if (!regime.aligned) continue;
    }

    const prev = bars[i - 1];
    const breakoutPrice = today.open + (prev.high - prev.low) * BACKTEST_K_VALUE;
    const entryPrice = breakoutPrice * (1 + BACKTEST_SLIPPAGE_RATE);
    if (today.high < entryPrice) continue;

    const stopPrice = entryPrice * (1 - BACKTEST_STOP_LOSS_RATE);
    const exitRawPrice = today.low <= stopPrice ? stopPrice : today.close;
    const exitPrice = exitRawPrice * (1 - BACKTEST_SLIPPAGE_RATE);
    const cost = entryPrice * (1 + BACKTEST_BUY_FEE_RATE);
    const proceeds = exitPrice * (1 - BACKTEST_SELL_FEE_RATE - BACKTEST_SELL_TAX_RATE);
    const tradeReturnPct = ((proceeds - cost) / cost) * 100;

    firstTradeDate ??= today.date;
    lastTradeDate = today.date;
    returns.push(tradeReturnPct);
    if (tradeReturnPct > 0) positiveReturns.push(tradeReturnPct);
    if (tradeReturnPct < 0) negativeReturns.push(tradeReturnPct);
    equity *= 1 + tradeReturnPct / 100;
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.min(maxDrawdownPct, ((equity - peak) / peak) * 100);
  }

  const tradeCount = returns.length;
  const totalReturnPct = (equity - 1) * 100;
  const averageTradeReturnPct = tradeCount > 0
    ? returns.reduce((sum, value) => sum + value, 0) / tradeCount
    : 0;
  const winRatePct = tradeCount > 0
    ? (positiveReturns.length / tradeCount) * 100
    : 0;
  const positiveSum = positiveReturns.reduce((sum, value) => sum + value, 0);
  const negativeSum = Math.abs(negativeReturns.reduce((sum, value) => sum + value, 0));
  const profitFactor = negativeSum > 0
    ? positiveSum / negativeSum
    : undefined;

  const passed = tradeCount >= BACKTEST_MIN_TRADES
    && averageTradeReturnPct > BACKTEST_MIN_AVG_RETURN_PCT
    && totalReturnPct > BACKTEST_MIN_TOTAL_RETURN_PCT;
  const reason = passed
    ? `최근 백테스트 통과: ${tradeCount}회, 평균 ${averageTradeReturnPct.toFixed(2)}%`
    : tradeCount < BACKTEST_MIN_TRADES
      ? `거래 수 부족: ${tradeCount}/${BACKTEST_MIN_TRADES}`
      : `기대값 미달: 평균 ${averageTradeReturnPct.toFixed(2)}%, 누적 ${totalReturnPct.toFixed(1)}%`;

  const result: DayTradeBacktestSnapshot = {
    passed,
    tradeCount,
    winRatePct: Math.round(winRatePct * 10) / 10,
    totalReturnPct: Math.round(totalReturnPct * 10) / 10,
    averageTradeReturnPct: Math.round(averageTradeReturnPct * 100) / 100,
    maxDrawdownPct: Math.round(maxDrawdownPct * 10) / 10,
    reason,
  };
  if (firstTradeDate) result.fromDate = firstTradeDate;
  if (lastTradeDate) result.toDate = lastTradeDate;
  if (profitFactor !== undefined && Number.isFinite(profitFactor)) {
    result.profitFactor = Math.round(profitFactor * 100) / 100;
  }
  return result;
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
  if (indicators.underlyingRegime && !indicators.underlyingRegime.aligned) {
    return `기초지수 레짐 불일치 (${indicators.underlyingRegime.reason})`;
  }
  if (indicators.backtest && !indicators.backtest.passed) {
    return `백테스트 미통과 (${indicators.backtest.reason})`;
  }
  return undefined;
}

/** 하드 필터 적용 후 통과 시 절대 점수(0~100) 계산 — 날짜 간 비교 가능하도록 코호트 비의존 */
export function buildDayTradeScore(
  stockCode: string,
  stockName: string,
  indicators: DayTradeIndicatorSnapshot,
  caution: DayTradeCautionFlags,
  validation: {
    underlyingRegime?: DayTradeUnderlyingRegimeSnapshot;
    backtest?: DayTradeBacktestSnapshot;
  } = {},
): DayTradeCandidateScore {
  const enrichedIndicators = {
    ...indicators,
    ...validation,
  };
  const base = {
    stockCode,
    stockName,
    exchangeCode: 'KRX' as const,
    market: 'DOMESTIC' as const,
    rank: 0,
    indicators: enrichedIndicators,
  };

  const excludeReason = resolveExcludeReason(enrichedIndicators, caution);
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
