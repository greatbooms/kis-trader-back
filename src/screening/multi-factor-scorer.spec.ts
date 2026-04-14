import { scoreTechnical } from './multi-factor-scorer';
import { ScreeningCandidate, StockIndicatorDetail } from './types';

describe('multi-factor technical scoring', () => {
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

  it('should give higher score when individual technical indicators are broadly bullish', () => {
    const bullishIndicators: StockIndicatorDetail = {
      technicalRatings: {
        timeframe: '1D',
        oscillators: [
          { key: 'macd12269', label: 'MACD', value: 0.6, action: 'BUY' },
          { key: 'rsi14', label: 'RSI', value: 55, action: 'BUY' },
          { key: 'williamsR14', label: 'Williams %R', value: -85, action: 'BUY' },
        ],
        movingAverages: [
          { key: 'ema200', label: 'EMA 200', value: 48, action: 'BUY' },
          { key: 'ema50', label: 'EMA 50', value: 50, action: 'BUY' },
          { key: 'ichimoku', label: 'Ichimoku', value: 45, action: 'BUY' },
        ],
        oscillatorSummary: { score: 0.4, recommendation: 'BUY', buyCount: 3, neutralCount: 0, sellCount: 0 },
        movingAverageSummary: { score: 0.8, recommendation: 'STRONG_BUY', buyCount: 3, neutralCount: 0, sellCount: 0 },
        overallSummary: { score: 0.6, recommendation: 'STRONG_BUY', buyCount: 6, neutralCount: 0, sellCount: 0 },
      },
      rsi14: 55,
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
          { key: 'macd12269', label: 'MACD', value: 0.1, action: 'NEUTRAL' },
          { key: 'rsi14', label: 'RSI', value: 68, action: 'NEUTRAL' },
          { key: 'williamsR14', label: 'Williams %R', value: -5, action: 'SELL' },
        ],
        movingAverages: [
          { key: 'ema200', label: 'EMA 200', value: 48, action: 'BUY' },
          { key: 'ema50', label: 'EMA 50', value: 53, action: 'SELL' },
          { key: 'ichimoku', label: 'Ichimoku', value: 52, action: 'NEUTRAL' },
        ],
        oscillatorSummary: { score: -0.1, recommendation: 'NEUTRAL', buyCount: 0, neutralCount: 2, sellCount: 1 },
        movingAverageSummary: { score: 0, recommendation: 'NEUTRAL', buyCount: 1, neutralCount: 1, sellCount: 1 },
        overallSummary: { score: -0.05, recommendation: 'NEUTRAL', buyCount: 1, neutralCount: 3, sellCount: 2 },
      },
      rsi14: 68,
      ma20: 51,
      ma60: 50.5,
      macd: { line: 0.1, signal: 0.12, histogram: -0.02 },
      bollingerBands: { upper: 56, middle: 52, lower: 48, percentB: 0.92 },
      adx14: 16,
    };

    const bullish = scoreTechnical(bullishIndicators, candidate, 20);
    const mixed = scoreTechnical(mixedIndicators, candidate, 20);

    expect(bullish.score).toBeGreaterThan(mixed.score);
    expect(bullish.reasons.join(' ')).toContain('기술지표 매수 우위');
  });
});
