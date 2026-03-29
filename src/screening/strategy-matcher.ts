import { ScreeningCandidate, StockIndicatorDetail, SuggestedStrategy } from './types';

function buildStrategyMatchScore(base: number, ...components: number[]): number {
  return Math.round(Math.min(100, base + components.reduce((sum, value) => sum + value, 0)));
}

function scaleMatchScore(
  value: number | undefined,
  threshold: number,
  ideal: number,
  maxScore: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  if (threshold === ideal) return maxScore;
  const ratio = (value - threshold) / (ideal - threshold);
  return Math.max(0, Math.min(maxScore, Math.round(ratio * maxScore)));
}

export function suggestStrategies(
  indicators: StockIndicatorDetail,
  candidate: ScreeningCandidate,
  isOverseas: boolean,
): SuggestedStrategy[] {
  const strategies: SuggestedStrategy[] = [];
  const volumeSurgeRate = indicators.volumeIncreaseRate ?? indicators.volumeSurgeRate;

  if ((indicators.per ?? 999) <= 12 && (indicators.roe ?? 0) >= 10) {
    strategies.push({
      name: 'value-factor',
      displayName: '밸류 팩터',
      matchScore: buildStrategyMatchScore(
        35,
        scaleMatchScore(indicators.per, 10, 6, 30),
        scaleMatchScore(indicators.roe, 12, 20, 25),
        scaleMatchScore(indicators.debtRatio, 150, 30, 10),
      ),
      reason: `PER ${indicators.per?.toFixed(1)}, ROE ${indicators.roe?.toFixed(1)}%`,
    });
  }

  if ((indicators.ma20 ?? 0) > (indicators.ma60 ?? Number.MAX_SAFE_INTEGER) && (indicators.adx14 ?? 0) >= 20) {
    const maSpread = indicators.ma60
      ? ((indicators.ma20! - indicators.ma60) / indicators.ma60) * 100
      : undefined;
    const priceLead = indicators.ma20
      ? ((candidate.currentPrice - indicators.ma20) / indicators.ma20) * 100
      : undefined;
    strategies.push({
      name: 'trend-following',
      displayName: '추세 추종',
      matchScore: buildStrategyMatchScore(
        40,
        scaleMatchScore(indicators.adx14, 22, 35, 30),
        scaleMatchScore(maSpread, 1, 6, 20),
        scaleMatchScore(priceLead, 0, 8, 10),
        indicators.macd?.histogram && indicators.macd.histogram > 0 ? 10 : 0,
      ),
      reason: `MA20 상향, ADX ${indicators.adx14?.toFixed(1)}`,
    });
  }

  if (candidate.changeRate >= 1 && (volumeSurgeRate ?? 0) >= 50) {
    strategies.push({
      name: 'momentum-breakout',
      displayName: '모멘텀 돌파',
      matchScore: buildStrategyMatchScore(
        35,
        scaleMatchScore(candidate.changeRate, 2, 5, 25),
        scaleMatchScore(volumeSurgeRate, 80, 200, 25),
        indicators.priceAboveMa200 ? 10 : 0,
      ),
      reason: `등락률 +${candidate.changeRate.toFixed(1)}%, 거래량 급증`,
    });
  }

  if ((indicators.rsi14 ?? 100) < 35 && candidate.changeRate < 0) {
    const supportDistance = indicators.supportLevels?.[0]
      ? Math.abs(((candidate.currentPrice - indicators.supportLevels[0]) / indicators.supportLevels[0]) * 100)
      : undefined;
    strategies.push({
      name: 'grid-mean-reversion',
      displayName: '그리드 평균회귀',
      matchScore: buildStrategyMatchScore(
        35,
        scaleMatchScore(indicators.rsi14, 32, 15, 30),
        scaleMatchScore(candidate.changeRate, -2, -5, 20),
        scaleMatchScore(supportDistance, 5, 0, 10),
      ),
      reason: `RSI ${indicators.rsi14?.toFixed(1)}, 눌림목 구간`,
    });
  }

  if ((indicators.rsi14 ?? 100) < 25) {
    strategies.push({
      name: 'conservative',
      displayName: '보수적 매매',
      matchScore: buildStrategyMatchScore(
        40,
        scaleMatchScore(indicators.rsi14, 22, 12, 35),
        scaleMatchScore(indicators.volatility30d, 35, 18, 15),
        (indicators.currentRatio ?? 0) >= 100 ? 10 : 0,
      ),
      reason: `RSI ${indicators.rsi14?.toFixed(1)} 극단적 과매도`,
    });
  }

  if (!isOverseas && (indicators.priceAboveMa200 ?? false)) {
    const distanceAboveMa200 = indicators.ma200
      ? ((candidate.currentPrice - indicators.ma200) / indicators.ma200) * 100
      : undefined;
    strategies.push({
      name: 'infinite-buy',
      displayName: '무한매수법',
      matchScore: buildStrategyMatchScore(
        45,
        scaleMatchScore(distanceAboveMa200, 2, 10, 20),
        scaleMatchScore(indicators.rsi14, 35, 50, 15),
        candidate.changeRate >= 0 ? 10 : 0,
      ),
      reason: '장기 상승 추세 유지',
    });
  }

  if (!isOverseas && (indicators.dividendYield ?? 0) >= 3 && (indicators.consecutiveDividendYears ?? 0) >= 5) {
    strategies.push({
      name: 'dividend-stability',
      displayName: '배당 안정화',
      matchScore: buildStrategyMatchScore(
        40,
        scaleMatchScore(indicators.dividendYield, 3.5, 5.5, 25),
        scaleMatchScore(indicators.consecutiveDividendYears, 7, 12, 25),
        scaleMatchScore(indicators.payoutRatio, 100, 40, 10),
      ),
      reason: `배당 ${indicators.dividendYield?.toFixed(1)}%, 연속 ${indicators.consecutiveDividendYears}년`,
    });
  }

  if (!isOverseas && (indicators.marginOfSafety ?? 0) >= 15) {
    strategies.push({
      name: 'dcf-value',
      displayName: 'DCF 밸류',
      matchScore: buildStrategyMatchScore(
        45,
        scaleMatchScore(indicators.marginOfSafety, 18, 30, 35),
        scaleMatchScore(indicators.targetPriceUpside, 5, 25, 10),
      ),
      reason: `안전마진 ${indicators.marginOfSafety?.toFixed(1)}%`,
    });
  }

  if (!isOverseas && (indicators.shortSaleRatio ?? 0) > 5 && (indicators.volumeSurgeRate ?? 0) > 30) {
    strategies.push({
      name: 'short-squeeze-response',
      displayName: '숏스퀴즈 대응',
      matchScore: buildStrategyMatchScore(
        35,
        scaleMatchScore(indicators.shortSaleRatio, 6, 12, 20),
        scaleMatchScore(indicators.volumeSurgeRate, 50, 150, 25),
        scaleMatchScore(candidate.changeRate, 1, 5, 10),
      ),
      reason: `공매도 ${indicators.shortSaleRatio?.toFixed(1)}%, 거래량 급증`,
    });
  }

  if ((indicators.revenueGrowthRate ?? 0) >= 10 && (indicators.operatingProfitGrowthRate ?? 0) >= 10
    && (indicators.netMargin ?? 0) >= 10 && (indicators.per ?? 999) < 25 && (indicators.per ?? 0) > 0) {
    strategies.push({
      name: 'quality-growth',
      displayName: '퀄리티 성장',
      matchScore: buildStrategyMatchScore(
        40,
        scaleMatchScore(indicators.revenueGrowthRate, 10, 20, 20),
        scaleMatchScore(indicators.operatingProfitGrowthRate, 10, 20, 15),
        scaleMatchScore(indicators.netMargin, 10, 20, 15),
        scaleMatchScore(indicators.per, 25, 10, 10),
      ),
      reason: `매출성장 ${indicators.revenueGrowthRate?.toFixed(1)}%, 순이익률 ${indicators.netMargin?.toFixed(1)}%`,
    });
  }

  strategies.sort((a, b) => b.matchScore - a.matchScore);
  return strategies.slice(0, 4);
}
