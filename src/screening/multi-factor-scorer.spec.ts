import { scoreTiming, scoreTrend } from './multi-factor-scorer';
import { ScreeningCandidate, StockIndicatorDetail } from './types';

describe('multi-factor axis scoring', () => {
  const candidate: ScreeningCandidate = {
    stockCode: 'TQQQ',
    stockName: 'ProShares UltraPro QQQ',
    exchangeCode: 'NASD',
    market: 'OVERSEAS',
    currentPrice: 52.5,
    changeRate: 1.5,
    volume: 1000000,
    marketCap: 100000,
  };

  it('should give a higher trend score when trend structure is broadly bullish', () => {
    const bullishIndicators: StockIndicatorDetail = {
      technicalRatings: {
        timeframe: '1D',
        oscillators: [
          { key: 'macd12269', label: 'MACD', value: 0.6, action: 'BUY' },
          { key: 'adx14', label: 'ADX', value: 27, action: 'BUY' },
        ],
        movingAverages: [
          { key: 'ema200', label: 'EMA 200', value: 48, action: 'BUY' },
          { key: 'ema50', label: 'EMA 50', value: 50, action: 'BUY' },
          { key: 'ichimoku', label: 'Ichimoku', value: 45, action: 'BUY' },
        ],
        oscillatorSummary: { score: 0.3, recommendation: 'BUY', buyCount: 2, neutralCount: 0, sellCount: 0 },
        movingAverageSummary: { score: 0.8, recommendation: 'STRONG_BUY', buyCount: 3, neutralCount: 0, sellCount: 0 },
        overallSummary: { score: 0.6, recommendation: 'STRONG_BUY', buyCount: 5, neutralCount: 0, sellCount: 0 },
      },
      priceAboveMa200: true,
      ma20: 50,
      ma60: 48,
      macd: { line: 0.6, signal: 0.4, histogram: 0.2 },
      bollingerBands: { upper: 56, middle: 52, lower: 48, percentB: 0.6 },
      adx14: 27,
    };

    const mixedIndicators: StockIndicatorDetail = {
      technicalRatings: {
        timeframe: '1D',
        oscillators: [
          { key: 'macd12269', label: 'MACD', value: 0.1, action: 'SELL' },
          { key: 'adx14', label: 'ADX', value: 16, action: 'NEUTRAL' },
        ],
        movingAverages: [
          { key: 'ema200', label: 'EMA 200', value: 60, action: 'SELL' },
          { key: 'ema50', label: 'EMA 50', value: 53, action: 'SELL' },
          { key: 'ichimoku', label: 'Ichimoku', value: 52, action: 'NEUTRAL' },
        ],
        oscillatorSummary: { score: -0.1, recommendation: 'NEUTRAL', buyCount: 0, neutralCount: 1, sellCount: 1 },
        movingAverageSummary: { score: -0.5, recommendation: 'SELL', buyCount: 0, neutralCount: 1, sellCount: 2 },
        overallSummary: { score: -0.35, recommendation: 'SELL', buyCount: 0, neutralCount: 2, sellCount: 3 },
      },
      priceAboveMa200: false,
      ma20: 51,
      ma60: 52,
      macd: { line: 0.1, signal: 0.12, histogram: -0.02 },
      bollingerBands: { upper: 56, middle: 52, lower: 48, percentB: 0.25 },
      adx14: 16,
    };

    const bullish = scoreTrend(bullishIndicators, candidate, 30);
    const mixed = scoreTrend(mixedIndicators, candidate, 30);

    expect(bullish.score).toBeGreaterThan(mixed.score);
    expect(bullish.reasons.join(' ')).toContain('추세 매수 우위');
  });

  it('should give a higher timing score when oscillators support a cleaner entry', () => {
    const bullishIndicators: StockIndicatorDetail = {
      technicalRatings: {
        timeframe: '1D',
        oscillators: [
          { key: 'rsi14', label: 'RSI', value: 42, action: 'BUY' },
          { key: 'stochasticK', label: 'Stochastic', value: 28, action: 'BUY' },
          { key: 'williamsR14', label: 'Williams %R', value: -82, action: 'BUY' },
        ],
        movingAverages: [],
        oscillatorSummary: { score: 0.5, recommendation: 'BUY', buyCount: 3, neutralCount: 0, sellCount: 0 },
        movingAverageSummary: { score: 0, recommendation: 'NEUTRAL', buyCount: 0, neutralCount: 0, sellCount: 0 },
        overallSummary: { score: 0.5, recommendation: 'BUY', buyCount: 3, neutralCount: 0, sellCount: 0 },
      },
      rsi14: 42,
      ma20: 50,
      ma60: 48,
      bollingerBands: { upper: 56, middle: 52, lower: 48, percentB: 0.45 },
    };

    const overheatedIndicators: StockIndicatorDetail = {
      technicalRatings: {
        timeframe: '1D',
        oscillators: [
          { key: 'rsi14', label: 'RSI', value: 78, action: 'SELL' },
          { key: 'stochasticK', label: 'Stochastic', value: 91, action: 'SELL' },
          { key: 'williamsR14', label: 'Williams %R', value: -4, action: 'SELL' },
        ],
        movingAverages: [],
        oscillatorSummary: { score: -0.7, recommendation: 'STRONG_SELL', buyCount: 0, neutralCount: 0, sellCount: 3 },
        movingAverageSummary: { score: 0, recommendation: 'NEUTRAL', buyCount: 0, neutralCount: 0, sellCount: 0 },
        overallSummary: { score: -0.7, recommendation: 'STRONG_SELL', buyCount: 0, neutralCount: 0, sellCount: 3 },
      },
      rsi14: 78,
      ma20: 50,
      ma60: 49,
      bollingerBands: { upper: 56, middle: 52, lower: 48, percentB: 0.96 },
    };

    const bullish = scoreTiming(bullishIndicators, candidate, 20);
    const overheated = scoreTiming(overheatedIndicators, { ...candidate, changeRate: 9.2 }, 20);

    expect(bullish.score).toBeGreaterThan(overheated.score);
    expect(bullish.reasons.join(' ')).toContain('타이밍 매수 우위');
  });
});
