/**
 * Pure indicator calculator for backtesting.
 *
 * Input convention: OHLCV series with index 0 = oldest, index N-1 = newest (chronological).
 * Most functions take an `asOfIndex` param to compute indicators "as of" that day.
 *
 * Matches calculation methodology of src/trading/market-analysis.service.ts but
 * works with chronological order (safer for backtests — no reverse array ops).
 */

export interface OHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount?: number; // 거래대금 (국내만)
}

export interface ComputedIndicators {
  ma20?: number;
  ma60?: number;
  ma200?: number;
  rsi14?: number;
  atr14?: number;
  atrPercent?: number;
  adx14?: number;
  bollingerUpper?: number;
  bollingerMiddle?: number;
  bollingerLower?: number;
  volatility30d?: number;
  avgVolume20?: number;
}

/** Simple moving average of last `period` closes ending at `asOfIndex` (inclusive). */
export function sma(values: number[], asOfIndex: number, period: number): number | undefined {
  if (asOfIndex < period - 1) return undefined;
  let sum = 0;
  for (let i = asOfIndex - period + 1; i <= asOfIndex; i++) sum += values[i];
  return sum / period;
}

/**
 * Wilder's smoothed RSI as of `asOfIndex`.
 * Requires at least `period + 1` data points.
 */
export function rsi(values: number[], asOfIndex: number, period = 14): number | undefined {
  if (asOfIndex < period) return undefined;

  // Initial averages using the first `period` changes before `asOfIndex`
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += -diff;
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder smoothing for the rest
  for (let i = period + 1; i <= asOfIndex; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Bollinger Bands (period=20, multiplier=2). Uses population stdev to match market-analysis.service.ts. */
export function bollinger(
  values: number[],
  asOfIndex: number,
  period = 20,
  multiplier = 2,
): { upper: number; middle: number; lower: number } | undefined {
  const middle = sma(values, asOfIndex, period);
  if (middle === undefined) return undefined;
  let variance = 0;
  for (let i = asOfIndex - period + 1; i <= asOfIndex; i++) {
    variance += (values[i] - middle) ** 2;
  }
  variance /= period;
  const stdDev = Math.sqrt(variance);
  return { upper: middle + multiplier * stdDev, middle, lower: middle - multiplier * stdDev };
}

/**
 * ADX + ATR (Wilder, period=14) as of `asOfIndex`.
 * Requires at least 2*period bars for stable values.
 */
export function adxAtr(
  highs: number[],
  lows: number[],
  closes: number[],
  asOfIndex: number,
  period = 14,
): { adx?: number; atr?: number } {
  const n = asOfIndex + 1;
  if (n < period * 2) return {};

  const trs: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];
  for (let i = 1; i <= asOfIndex; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    trs.push(tr);
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  if (trs.length < period) return {};

  let atrSum = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let plusDMSum = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let minusDMSum = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);

  const dxValues: number[] = [];
  const plusDI0 = atrSum > 0 ? (plusDMSum / atrSum) * 100 : 0;
  const minusDI0 = atrSum > 0 ? (minusDMSum / atrSum) * 100 : 0;
  dxValues.push(plusDI0 + minusDI0 > 0 ? (Math.abs(plusDI0 - minusDI0) / (plusDI0 + minusDI0)) * 100 : 0);

  for (let i = period; i < trs.length; i++) {
    atrSum = atrSum - atrSum / period + trs[i];
    plusDMSum = plusDMSum - plusDMSum / period + plusDMs[i];
    minusDMSum = minusDMSum - minusDMSum / period + minusDMs[i];
    const plusDI = atrSum > 0 ? (plusDMSum / atrSum) * 100 : 0;
    const minusDI = atrSum > 0 ? (minusDMSum / atrSum) * 100 : 0;
    const diSum = plusDI + minusDI;
    dxValues.push(diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0);
  }

  const atr = atrSum / period;

  if (dxValues.length < period) {
    return { adx: dxValues[dxValues.length - 1], atr };
  }
  let adx = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxValues.length; i++) {
    adx = (adx * (period - 1) + dxValues[i]) / period;
  }
  return { adx, atr };
}

/** Annualized volatility (%) over last `period` days of log-ish returns. */
export function annualizedVolatility(values: number[], asOfIndex: number, period = 30): number | undefined {
  if (asOfIndex < period) return undefined;
  const returns: number[] = [];
  for (let i = asOfIndex - period + 1; i <= asOfIndex; i++) {
    if (values[i - 1] > 0) returns.push(values[i] / values[i - 1] - 1);
  }
  if (returns.length === 0) return undefined;
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

/** Convenience: compute all indicators at once for a given asOfIndex. */
export function computeIndicators(bars: OHLCV[], asOfIndex: number): ComputedIndicators {
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const volumes = bars.map((b) => b.volume);

  const ma20 = sma(closes, asOfIndex, 20);
  const ma60 = sma(closes, asOfIndex, 60);
  const ma200 = sma(closes, asOfIndex, 200);
  const rsi14 = rsi(closes, asOfIndex, 14);
  const bb = bollinger(closes, asOfIndex, 20, 2);
  const { adx, atr } = adxAtr(highs, lows, closes, asOfIndex, 14);
  const curPrice = closes[asOfIndex];
  const atrPercent = atr !== undefined && curPrice > 0 ? (atr / curPrice) * 100 : undefined;
  const volatility30d = annualizedVolatility(closes, asOfIndex, 30);
  const avgVolume20 = sma(volumes, asOfIndex, 20);

  return {
    ma20,
    ma60,
    ma200,
    rsi14,
    atr14: atr,
    atrPercent,
    adx14: adx,
    bollingerUpper: bb?.upper,
    bollingerMiddle: bb?.middle,
    bollingerLower: bb?.lower,
    volatility30d,
    avgVolume20,
  };
}
