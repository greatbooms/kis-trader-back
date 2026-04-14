import { ScreeningCandidate, StockIndicatorDetail, FactorComponent } from './types';
import { TechnicalIndicatorSnapshot, TechnicalRatingsSnapshot } from '../trading/types';

const MIN_MARKET_CAP_BY_EXCHANGE: Record<string, number> = {
  NASD: 150000,
  NYSE: 150000,
  AMEX: 50000,
  TKSE: 20000000,
  SEHK: 1200000,
  SHAA: 1100000,
  SZAA: 1100000,
  HASE: 4000000000,
  VNSE: 4000000000,
};

const TECHNICAL_ACTION_MULTIPLIER: Record<string, number> = {
  BUY: 1,
  NEUTRAL: 0.45,
  SELL: 0,
};

const TECHNICAL_INDICATOR_WEIGHT: Record<string, number> = {
  rsi14: 1.2,
  stochasticK: 1.1,
  cci20: 1.1,
  adx14: 1.2,
  ao: 0.9,
  momentum10: 1.0,
  macd12269: 1.3,
  stochRsiFast: 1.0,
  williamsR14: 1.0,
  bullBearPower13: 0.9,
  uo71428: 1.0,
  sma10: 0.8,
  ema10: 0.8,
  sma20: 0.9,
  ema20: 0.9,
  sma30: 1.0,
  ema30: 1.0,
  sma50: 1.1,
  ema50: 1.1,
  sma100: 1.2,
  ema100: 1.2,
  sma200: 1.4,
  ema200: 1.4,
  hma9: 0.9,
  vwma20: 0.9,
  ichimoku: 1.2,
};

const TREND_TECHNICAL_KEYS = new Set([
  'sma10', 'ema10',
  'sma20', 'ema20',
  'sma30', 'ema30',
  'sma50', 'ema50',
  'sma100', 'ema100',
  'sma200', 'ema200',
  'hma9',
  'vwma20',
  'ichimoku',
  'adx14',
  'macd12269',
]);

const TIMING_TECHNICAL_KEYS = new Set([
  'rsi14',
  'stochasticK',
  'cci20',
  'ao',
  'momentum10',
  'stochRsiFast',
  'williamsR14',
  'bullBearPower13',
  'uo71428',
]);

function capScore(score: number, max: number): number {
  return Math.round(Math.max(0, Math.min(score, max)) * 10) / 10;
}

function emptyFactor(max: number): FactorComponent {
  return { score: 0, max, reasons: [], hasData: false };
}

function combineFactors(
  max: number,
  factors: FactorComponent[],
  reasonLimit = 8,
): FactorComponent {
  const availableWeight = factors.reduce((sum, factor) => sum + (factor.hasData ? factor.max : 0), 0);
  if (availableWeight <= 0) {
    return emptyFactor(max);
  }

  const rawScore = factors.reduce((sum, factor) => sum + factor.score, 0);
  const reasons = dedupeReasons(factors.flatMap((factor) => factor.reasons)).slice(0, reasonLimit);

  return {
    score: capScore((rawScore / availableWeight) * max, max),
    max,
    reasons,
    hasData: true,
  };
}

function dedupeReasons(reasons: string[]) {
  return [...new Set(reasons.filter(Boolean))];
}

function collectTechnicalSignals(
  technicalRatings: TechnicalRatingsSnapshot,
  keys: Set<string>,
): TechnicalIndicatorSnapshot[] {
  return [
    ...technicalRatings.oscillators,
    ...technicalRatings.movingAverages,
  ].filter((indicator) => keys.has(indicator.key));
}

function scoreTechnicalSignals(
  signals: TechnicalIndicatorSnapshot[],
  max: number,
  buyPrefix: string,
  sellPrefix: string,
): { score: number; reasons: string[] } {
  if (signals.length === 0) {
    return { score: 0, reasons: [] };
  }

  const totalWeight = signals.reduce((sum, indicator) => sum + (TECHNICAL_INDICATOR_WEIGHT[indicator.key] ?? 1), 0);
  if (totalWeight <= 0) {
    return { score: 0, reasons: [] };
  }

  const weightedScore = signals.reduce((sum, indicator) => {
    const weight = TECHNICAL_INDICATOR_WEIGHT[indicator.key] ?? 1;
    const actionWeight = TECHNICAL_ACTION_MULTIPLIER[indicator.action] ?? 0.45;
    return sum + (weight * actionWeight);
  }, 0);

  const buySignals = topTechnicalSignals(signals, 'BUY').slice(0, 3);
  const sellSignals = topTechnicalSignals(signals, 'SELL').slice(0, 2);
  const reasons: string[] = [];

  if (buySignals.length > 0) {
    reasons.push(`${buyPrefix}: ${buySignals.map((signal) => signal.label).join(', ')}`);
  }
  if (sellSignals.length > 0) {
    reasons.push(`${sellPrefix}: ${sellSignals.map((signal) => signal.label).join(', ')}`);
  }

  return {
    score: (weightedScore / totalWeight) * max,
    reasons,
  };
}

function topTechnicalSignals(indicators: TechnicalIndicatorSnapshot[], action: 'BUY' | 'SELL') {
  return indicators
    .filter((indicator) => indicator.action === action)
    .sort((left, right) => (TECHNICAL_INDICATOR_WEIGHT[right.key] ?? 1) - (TECHNICAL_INDICATOR_WEIGHT[left.key] ?? 1));
}

export function buildDomesticScore(candidate: ScreeningCandidate, indicators: StockIndicatorDetail) {
  const trend = scoreTrend(indicators, candidate, 30);
  const timing = scoreTiming(indicators, candidate, 20);
  const valuation = scoreValuation(indicators, 15);
  const growth = scoreGrowth(indicators, 10);
  const profitability = scoreProfitability(indicators, 10);
  const dividend = scoreDividend(indicators, 5);
  const consensus = scoreConsensus(indicators, 10);
  const fundamental = combineFactors(30, [valuation, growth, profitability, dividend, consensus]);
  const risk = scoreRisk(indicators, 10);
  const supplyDemand = scoreSupplyDemand(indicators, 10);
  const riskSupply = combineFactors(20, [risk, supplyDemand]);

  return composeScore(candidate, indicators, {
    trend,
    timing,
    fundamental,
    riskSupply,
    valuation,
    growth,
    profitability,
    dividend,
    consensus,
    risk,
    supplyDemand,
  });
}

export function buildOverseasScore(candidate: ScreeningCandidate, indicators: StockIndicatorDetail) {
  const trend = scoreTrend(indicators, candidate, 30);
  const timing = scoreTiming(indicators, candidate, 20);
  const valuation = scoreValuation(indicators, 10);
  const growth = scoreGrowth(indicators, 15);
  const profitability = scoreProfitability(indicators, 15);
  const dividend = scoreDividend(indicators, 5);
  const consensus = scoreConsensus(indicators, 5);
  const fundamental = combineFactors(30, [valuation, growth, profitability, dividend, consensus]);
  const risk = scoreRisk(indicators, 10);
  const supplyDemand = scoreOverseasSupply(indicators, candidate, 10);
  const riskSupply = combineFactors(20, [risk, supplyDemand]);

  return composeScore(candidate, indicators, {
    trend,
    timing,
    fundamental,
    riskSupply,
    valuation,
    growth,
    profitability,
    dividend,
    consensus,
    risk,
    supplyDemand,
  });
}

export function buildEtfScore(candidate: ScreeningCandidate, indicators: StockIndicatorDetail, isOverseas: boolean) {
  const trend = scoreTrend(indicators, candidate, 35, true);
  const timing = scoreTiming(indicators, candidate, 25, true);
  const valuation = scoreValuation(indicators, 5);
  const growth = scoreGrowth(indicators, 2);
  const profitability = scoreProfitability(indicators, 2);
  const dividend = scoreDividend(indicators, 1);
  const consensus = scoreConsensus(indicators, 2);
  const fundamental = combineFactors(10, [valuation, growth, profitability, dividend, consensus], 5);
  const risk = scoreRisk(indicators, 15);
  const supplyDemand = isOverseas
    ? scoreOverseasSupply(indicators, candidate, 15)
    : scoreSupplyDemand(indicators, 15);
  const riskSupply = combineFactors(30, [risk, supplyDemand]);

  return composeScore(candidate, indicators, {
    trend,
    timing,
    fundamental,
    riskSupply,
    valuation,
    growth,
    profitability,
    dividend,
    consensus,
    risk,
    supplyDemand,
  });
}

export function composeScore(
  candidate: ScreeningCandidate,
  indicators: StockIndicatorDetail,
  factors: {
    trend: FactorComponent;
    timing: FactorComponent;
    fundamental: FactorComponent;
    riskSupply: FactorComponent;
    valuation: FactorComponent;
    growth: FactorComponent;
    profitability: FactorComponent;
    dividend: FactorComponent;
    consensus: FactorComponent;
    risk: FactorComponent;
    supplyDemand: FactorComponent;
  },
) {
  const axes = [factors.trend, factors.timing, factors.fundamental, factors.riskSupply];
  const totalWeight = axes.reduce((sum, factor) => sum + factor.max, 0);
  const availableWeight = axes.reduce((sum, factor) => sum + (factor.hasData ? factor.max : 0), 0);
  const rawScore = axes.reduce((sum, factor) => sum + factor.score, 0);
  const totalScore = availableWeight > 0 ? Math.round((rawScore / availableWeight) * 1000) / 10 : 0;
  const dataAvailability = totalWeight > 0 ? Math.round((availableWeight / totalWeight) * 100) : 0;

  const factorScores = {
    trend: factors.trend.score,
    timing: factors.timing.score,
    fundamental: factors.fundamental.score,
    riskSupply: factors.riskSupply.score,
    valuation: factors.valuation.score,
    growth: factors.growth.score,
    profitability: factors.profitability.score,
    dividend: factors.dividend.score,
    consensus: factors.consensus.score,
    risk: factors.risk.score,
    supplyDemand: factors.supplyDemand.score,
  };

  const reasons = dedupeReasons([
    ...factors.trend.reasons,
    ...factors.timing.reasons,
    ...factors.fundamental.reasons,
    ...factors.riskSupply.reasons,
  ]).slice(0, 12);

  if (candidate.market === 'DOMESTIC' && indicators.targetPriceUpside !== undefined && indicators.targetPriceUpside > 20) {
    reasons.unshift(`목표가 괴리율 +${indicators.targetPriceUpside.toFixed(1)}%`);
  }

  return {
    totalScore,
    trendScore: factors.trend.score,
    timingScore: factors.timing.score,
    fundamentalScore: factors.fundamental.score,
    riskSupplyScore: factors.riskSupply.score,
    factorScores,
    dataAvailability,
    reasons,
  };
}

export function scoreTrend(
  indicators: StockIndicatorDetail,
  candidate: ScreeningCandidate,
  max: number,
  isEtf = false,
): FactorComponent {
  let score = 0;
  const reasons: string[] = [];
  let hasData = false;

  const technicalRatings = indicators.technicalRatings;
  if (technicalRatings) {
    hasData = true;
    const trendSignals = collectTechnicalSignals(technicalRatings, TREND_TECHNICAL_KEYS);
    const detailed = scoreTechnicalSignals(trendSignals, max * 0.45, '추세 매수 우위', '추세 주의');
    score += detailed.score;
    reasons.push(...detailed.reasons);

    const movingAverageScore = technicalRatings.movingAverageSummary.score;
    if (movingAverageScore > 0.5) {
      score += max * 0.15;
      reasons.push('이동평균 구조 강한 상승');
    } else if (movingAverageScore > 0.1) {
      score += max * 0.1;
      reasons.push('이동평균 구조 상승 우위');
    }
  }

  if (indicators.priceAboveMa200) {
    hasData = true;
    score += max * 0.1;
    reasons.push('주가가 MA200 상단');
  }

  if (indicators.ma20 && indicators.ma60) {
    hasData = true;
    if (candidate.currentPrice > indicators.ma20 && indicators.ma20 > indicators.ma60) {
      score += max * 0.1;
      reasons.push('MA20 > MA60 상승 구조');
    } else if (indicators.goldenCrossNear) {
      score += max * 0.06;
      reasons.push('골든크로스 근접');
    }
  }

  if (indicators.macd) {
    hasData = true;
    if (indicators.macd.histogram > 0) {
      score += max * 0.07;
      reasons.push('MACD 상승 추세');
    }
  }

  if (indicators.adx14 !== undefined) {
    hasData = true;
    if (indicators.adx14 >= 25) {
      score += max * 0.07;
      reasons.push(`ADX ${indicators.adx14.toFixed(1)} 추세 강도 양호`);
    } else if (indicators.adx14 >= 18) {
      score += max * 0.03;
    }
  }

  if (indicators.bollingerBands) {
    hasData = true;
    if (indicators.bollingerBands.percentB >= 0.45 && indicators.bollingerBands.percentB <= 0.85) {
      score += max * 0.05;
      reasons.push('볼린저 중상단 추세 유지');
    }
  }

  if (indicators.chartPattern) {
    hasData = true;
    score += max * (isEtf ? 0.04 : 0.06);
    reasons.push(`패턴 ${indicators.chartPattern}`);
  }

  return { score: capScore(score, max), max, reasons: dedupeReasons(reasons), hasData };
}

export function scoreTiming(
  indicators: StockIndicatorDetail,
  candidate: ScreeningCandidate,
  max: number,
  isEtf = false,
): FactorComponent {
  let score = 0;
  const reasons: string[] = [];
  let hasData = false;

  const technicalRatings = indicators.technicalRatings;
  if (technicalRatings) {
    hasData = true;
    const timingSignals = collectTechnicalSignals(technicalRatings, TIMING_TECHNICAL_KEYS);
    const detailed = scoreTechnicalSignals(timingSignals, max * 0.5, '타이밍 매수 우위', '타이밍 주의');
    score += detailed.score;
    reasons.push(...detailed.reasons);

    const oscillatorScore = technicalRatings.oscillatorSummary.score;
    if (oscillatorScore > 0.5) {
      score += max * 0.12;
      reasons.push('오실레이터 강한 매수 구간');
    } else if (oscillatorScore > 0.1) {
      score += max * 0.08;
      reasons.push('오실레이터 매수 우위');
    }
  }

  if (indicators.rsi14 !== undefined) {
    hasData = true;
    if (indicators.rsi14 >= 35 && indicators.rsi14 <= 60) {
      score += max * 0.1;
      reasons.push(`RSI ${indicators.rsi14.toFixed(1)} 진입 우호`);
    } else if (indicators.rsi14 >= 25 && indicators.rsi14 < 35) {
      score += max * 0.12;
      reasons.push(`RSI ${indicators.rsi14.toFixed(1)} 반등 구간`);
    }
  }

  if (candidate.changeRate >= -2 && candidate.changeRate <= 4) {
    hasData = true;
    score += max * 0.08;
    reasons.push(candidate.changeRate < 0 ? '과열 없는 눌림 구간' : '과열 전 상승 구간');
  } else if (candidate.changeRate > 4 && candidate.changeRate <= 8) {
    hasData = true;
    score += max * (isEtf ? 0.07 : 0.05);
    reasons.push(`단기 돌파 +${candidate.changeRate.toFixed(1)}%`);
  }

  if (indicators.ma20 && indicators.ma60) {
    hasData = true;
    const pullbackGap = Math.abs((candidate.currentPrice - indicators.ma20) / Math.max(indicators.ma20, 1));
    if (pullbackGap <= 0.03 && indicators.ma20 >= indicators.ma60) {
      score += max * 0.08;
      reasons.push('추세 속 눌림/재가속 구간');
    }
  }

  if (indicators.bollingerBands) {
    hasData = true;
    if (indicators.bollingerBands.percentB >= 0.25 && indicators.bollingerBands.percentB <= 0.7) {
      score += max * 0.05;
      reasons.push('볼린저 기준 진입 부담 낮음');
    }
  }

  return { score: capScore(score, max), max, reasons: dedupeReasons(reasons), hasData };
}

export function scoreValuation(indicators: StockIndicatorDetail, max: number): FactorComponent {
  let score = 0;
  const reasons: string[] = [];
  let hasData = false;

  if (indicators.per !== undefined && indicators.per > 0) {
    hasData = true;
    if (indicators.per <= 10) {
      score += max * 0.25;
      reasons.push(`PER ${indicators.per.toFixed(1)} 저평가`);
    } else if (indicators.per <= 18) {
      score += max * 0.15;
    }
  }
  if (indicators.pbr !== undefined && indicators.pbr > 0) {
    hasData = true;
    if (indicators.pbr <= 1.0) {
      score += max * 0.2;
      reasons.push(`PBR ${indicators.pbr.toFixed(2)} 저평가`);
    } else if (indicators.pbr <= 2.0) {
      score += max * 0.1;
    }
  }
  if (indicators.evEbitda !== undefined && indicators.evEbitda > 0) {
    hasData = true;
    if (indicators.evEbitda <= 8) {
      score += max * 0.2;
      reasons.push(`EV/EBITDA ${indicators.evEbitda.toFixed(1)} 매력적`);
    } else if (indicators.evEbitda <= 12) {
      score += max * 0.1;
    }
  }
  if (indicators.marginOfSafety !== undefined) {
    hasData = true;
    if (indicators.marginOfSafety >= 20) {
      score += max * 0.35;
      reasons.push(`안전마진 ${indicators.marginOfSafety.toFixed(1)}%`);
    } else if (indicators.marginOfSafety >= 10) {
      score += max * 0.2;
    }
  }

  return { score: capScore(score, max), max, reasons, hasData };
}

export function scoreGrowth(indicators: StockIndicatorDetail, max: number): FactorComponent {
  let score = 0;
  const reasons: string[] = [];
  let hasData = false;

  if (indicators.revenueGrowthRate !== undefined) {
    hasData = true;
    if (indicators.revenueGrowthRate >= 10) {
      score += max * 0.3;
      reasons.push(`매출 성장률 ${indicators.revenueGrowthRate.toFixed(1)}%`);
    } else if (indicators.revenueGrowthRate >= 5) {
      score += max * 0.15;
    }
  }
  if (indicators.operatingProfitGrowthRate !== undefined) {
    hasData = true;
    if (indicators.operatingProfitGrowthRate >= 10) {
      score += max * 0.3;
      reasons.push(`영업이익 성장률 ${indicators.operatingProfitGrowthRate.toFixed(1)}%`);
    } else if (indicators.operatingProfitGrowthRate >= 5) {
      score += max * 0.15;
    }
  }
  if (indicators.epsGrowthRate !== undefined) {
    hasData = true;
    if (indicators.epsGrowthRate >= 10) {
      score += max * 0.2;
      reasons.push(`EPS 성장률 ${indicators.epsGrowthRate.toFixed(1)}%`);
    } else if (indicators.epsGrowthRate >= 5) {
      score += max * 0.1;
    }
  }
  if (indicators.equityGrowthRate !== undefined) {
    hasData = true;
    if (indicators.equityGrowthRate >= 10) {
      score += max * 0.2;
      reasons.push(`자기자본 성장률 ${indicators.equityGrowthRate.toFixed(1)}%`);
    } else if (indicators.equityGrowthRate >= 5) {
      score += max * 0.1;
    }
  }
  if (indicators.secPeriodicReportAgeDays !== undefined) {
    hasData = true;
    if (indicators.secPeriodicReportAgeDays <= 120) {
      score += max * 0.1;
      reasons.push('최근 10-Q/10-K 반영');
    }
  }
  if ((indicators.recentPeriodicDisclosureCount30d ?? 0) > 0) {
    hasData = true;
    score += max * 0.08;
    reasons.push('최근 정기공시 반영');
  }

  return { score: capScore(score, max), max, reasons, hasData };
}

export function scoreProfitability(indicators: StockIndicatorDetail, max: number): FactorComponent {
  let score = 0;
  const reasons: string[] = [];
  let hasData = false;

  if (indicators.operatingMargin !== undefined) {
    hasData = true;
    if (indicators.operatingMargin >= 15) {
      score += max * 0.25;
      reasons.push(`영업이익률 ${indicators.operatingMargin.toFixed(1)}%`);
    } else if (indicators.operatingMargin >= 8) {
      score += max * 0.15;
    }
  }
  if (indicators.netMargin !== undefined) {
    hasData = true;
    if (indicators.netMargin >= 10) {
      score += max * 0.25;
      reasons.push(`순이익률 ${indicators.netMargin.toFixed(1)}%`);
    } else if (indicators.netMargin >= 5) {
      score += max * 0.12;
    }
  }
  if (indicators.roe !== undefined) {
    hasData = true;
    if (indicators.roe >= 15) {
      score += max * 0.25;
      reasons.push(`ROE ${indicators.roe.toFixed(1)}%`);
    } else if (indicators.roe >= 10) {
      score += max * 0.15;
    }
  }
  if (indicators.grossMargin !== undefined) {
    hasData = true;
    if (indicators.grossMargin >= 40) {
      score += max * 0.25;
      reasons.push(`매출총이익률 ${indicators.grossMargin.toFixed(1)}%`);
    } else if (indicators.grossMargin >= 20) {
      score += max * 0.12;
    }
  }

  return { score: capScore(score, max), max, reasons, hasData };
}

export function scoreRisk(indicators: StockIndicatorDetail, max: number): FactorComponent {
  let score = 0;
  const reasons: string[] = [];
  let hasData = false;

  if (indicators.debtRatio !== undefined) {
    hasData = true;
    if (indicators.debtRatio < 100) {
      score += max * 0.2;
      reasons.push(`부채비율 ${indicators.debtRatio.toFixed(0)}% 안정적`);
    } else if (indicators.debtRatio < 200) {
      score += max * 0.1;
    }
  }
  if (indicators.currentRatio !== undefined) {
    hasData = true;
    if (indicators.currentRatio >= 150) {
      score += max * 0.15;
      reasons.push(`유동비율 ${indicators.currentRatio.toFixed(0)}%`);
    } else if (indicators.currentRatio >= 100) {
      score += max * 0.08;
    }
  }
  if (indicators.interestCoverageRatio !== undefined) {
    hasData = true;
    if (indicators.interestCoverageRatio >= 3) {
      score += max * 0.15;
      reasons.push(`이자보상배율 ${indicators.interestCoverageRatio.toFixed(1)}배`);
    } else if (indicators.interestCoverageRatio >= 1.5) {
      score += max * 0.08;
    }
  }
  if (indicators.shortSaleRatio !== undefined) {
    hasData = true;
    if (indicators.shortSaleRatio < 2) {
      score += max * 0.1;
    } else if (indicators.shortSaleRatio > 5) {
      reasons.push(`공매도 비중 ${indicators.shortSaleRatio.toFixed(1)}% 주의`);
    }
  }
  if (indicators.creditBalanceRate !== undefined || indicators.loanBalanceRate !== undefined) {
    hasData = true;
    const leverageRate = indicators.creditBalanceRate ?? indicators.loanBalanceRate ?? 0;
    if (leverageRate < 5) {
      score += max * 0.08;
    } else {
      reasons.push(`신용/융자 비율 ${leverageRate.toFixed(1)}%`);
    }
  }
  if (indicators.atrPercent !== undefined) {
    hasData = true;
    if (indicators.atrPercent < 2) {
      score += max * 0.12;
      reasons.push(`ATR% ${indicators.atrPercent.toFixed(1)}% 저변동`);
    } else if (indicators.atrPercent < 4) {
      score += max * 0.06;
    }
  }
  if (indicators.maxDrawdown60d !== undefined) {
    hasData = true;
    if (indicators.maxDrawdown60d > -10) {
      score += max * 0.1;
      reasons.push(`MDD60d ${indicators.maxDrawdown60d.toFixed(1)}%`);
    } else if (indicators.maxDrawdown60d > -20) {
      score += max * 0.05;
    }
  }
  if (indicators.borrowingDependency !== undefined) {
    hasData = true;
    if (indicators.borrowingDependency < 20) {
      score += max * 0.1;
      reasons.push(`차입금의존도 ${indicators.borrowingDependency.toFixed(0)}%`);
    } else if (indicators.borrowingDependency < 30) {
      score += max * 0.05;
    }
  }

  return { score: capScore(score, max), max, reasons, hasData };
}

export function scoreSupplyDemand(indicators: StockIndicatorDetail, max: number): FactorComponent {
  let score = 0;
  const reasons: string[] = [];
  const volumeRate = indicators.volumeIncreaseRate ?? indicators.volumeSurgeRate;
  const hasData =
    indicators.foreignNetBuy !== undefined ||
    indicators.institutionNetBuy !== undefined ||
    indicators.foreignNetBuyStreak !== undefined ||
    indicators.insiderOwnershipChangeRate !== undefined ||
    indicators.volumeToAvgRatio !== undefined ||
    volumeRate !== undefined ||
    indicators.investCautionYn !== undefined ||
    indicators.shortOverheatYn !== undefined ||
    indicators.marketWarnCode !== undefined;

  if (indicators.foreignNetBuy && indicators.institutionNetBuy) {
    score += max * 0.3;
    reasons.push('외인/기관 동시 순매수');
  } else if (indicators.foreignNetBuy || indicators.institutionNetBuy) {
    score += max * 0.18;
    reasons.push(indicators.foreignNetBuy ? '외국인 순매수' : '기관 순매수');
  }

  if ((indicators.foreignNetBuyStreak ?? 0) >= 3) {
    score += max * 0.15;
    reasons.push(`외국인 연속 순매수 ${indicators.foreignNetBuyStreak}일`);
  }
  if ((indicators.foreignNetBuyAmount ?? 0) > 5000) {
    score += max * 0.08;
    reasons.push(`외국인 순매수 대금 ${Math.round((indicators.foreignNetBuyAmount ?? 0) / 1000)}십억`);
  }
  if (indicators.programTradeDirection === 'BUY') {
    score += max * 0.1;
    reasons.push('프로그램 매수 우위');
  }
  if (indicators.fundNetBuy) score += max * 0.08;
  if (indicators.trustNetBuy) score += max * 0.06;

  if (volumeRate !== undefined) {
    if (volumeRate >= 50) {
      score += max * 0.15;
      reasons.push(`거래량 +${volumeRate.toFixed(0)}%`);
    } else if (volumeRate >= 20) {
      score += max * 0.08;
    }
  }
  if ((indicators.volumeToAvgRatio ?? 0) >= 1.5) {
    score += max * 0.12;
    reasons.push(`평균 대비 거래량 ${indicators.volumeToAvgRatio?.toFixed(1)}배`);
  }
  if ((indicators.insiderOwnershipChangeRate ?? 0) > 0.05) {
    score += max * 0.1;
    reasons.push(`주요주주 지분 +${indicators.insiderOwnershipChangeRate?.toFixed(2)}%p`);
  }

  if (indicators.investCautionYn) {
    score -= max * 0.18;
    reasons.push('투자유의 종목');
  }
  if (indicators.shortOverheatYn) {
    score -= max * 0.15;
    reasons.push('단기과열 종목');
  }
  if (indicators.marketWarnCode && !['00', '0', 'NONE'].includes(indicators.marketWarnCode.toUpperCase())) {
    score -= max * 0.12;
    reasons.push(`시장경고 ${indicators.marketWarnCode}`);
  }

  return { score: capScore(score, max), max, reasons: dedupeReasons(reasons), hasData };
}

export function scoreOverseasSupply(indicators: StockIndicatorDetail, candidate: ScreeningCandidate, max: number): FactorComponent {
  let score = 0;
  const reasons: string[] = [];
  const hasData =
    indicators.prevDayVolumeChangeRate !== undefined ||
    indicators.volumeToAvgRatio !== undefined ||
    candidate.marketCap > 0;

  if ((indicators.prevDayVolumeChangeRate ?? 0) >= 30) {
    score += max * 0.3;
    reasons.push(`전일 대비 거래량 +${(indicators.prevDayVolumeChangeRate ?? 0).toFixed(0)}%`);
  }
  if ((indicators.volumeToAvgRatio ?? 0) >= 1.5) {
    score += max * 0.25;
    reasons.push(`평균 대비 거래량 ${indicators.volumeToAvgRatio?.toFixed(1)}배`);
  }
  if (candidate.marketCap >= MIN_MARKET_CAP_BY_EXCHANGE[candidate.exchangeCode]) {
    score += max * 0.2;
    reasons.push('대형주 유동성');
  }
  if ((indicators.volumeSurgeRate ?? 0) >= 40) {
    score += max * 0.1;
    reasons.push('거래량 급증');
  }

  return { score: capScore(score, max), max, reasons, hasData };
}

export function scoreDividend(indicators: StockIndicatorDetail, max: number): FactorComponent {
  let score = 0;
  const reasons: string[] = [];
  const hasData = indicators.dividendYield !== undefined || indicators.payoutRatio !== undefined || indicators.consecutiveDividendYears !== undefined;

  if (indicators.dividendYield !== undefined) {
    if (indicators.dividendYield >= 3) {
      score += max * 0.4;
      reasons.push(`배당수익률 ${indicators.dividendYield.toFixed(1)}%`);
    } else if (indicators.dividendYield >= 1.5) {
      score += max * 0.2;
    }
  }
  if (indicators.payoutRatio !== undefined && indicators.payoutRatio >= 20 && indicators.payoutRatio <= 60) {
    score += max * 0.25;
    reasons.push(`배당성향 ${indicators.payoutRatio.toFixed(1)}%`);
  }
  if ((indicators.consecutiveDividendYears ?? 0) >= 5) {
    score += max * 0.35;
    reasons.push(`연속 배당 ${indicators.consecutiveDividendYears}년`);
  }

  return { score: capScore(score, max), max, reasons, hasData };
}

export function scoreConsensus(indicators: StockIndicatorDetail, max: number): FactorComponent {
  let score = 0;
  const reasons: string[] = [];
  const hasData = indicators.targetPriceUpside !== undefined || indicators.consensusRating !== undefined || indicators.earningsSurprise !== undefined;

  if (indicators.targetPriceUpside !== undefined) {
    if (indicators.targetPriceUpside >= 20) {
      score += max * 0.45;
      reasons.push(`목표가 괴리 +${indicators.targetPriceUpside.toFixed(1)}%`);
    } else if (indicators.targetPriceUpside >= 10) {
      score += max * 0.25;
    }
  }
  if (indicators.consensusRating) {
    if (/(매수|BUY|STRONG BUY)/i.test(indicators.consensusRating)) {
      score += max * 0.3;
      reasons.push(`컨센서스 ${indicators.consensusRating}`);
    } else if (/(중립|HOLD)/i.test(indicators.consensusRating)) {
      score += max * 0.1;
    }
  }
  if (indicators.earningsSurprise !== undefined) {
    if (indicators.earningsSurprise > 5) {
      score += max * 0.25;
      reasons.push(`어닝 서프라이즈 +${indicators.earningsSurprise.toFixed(1)}%`);
    } else if (indicators.earningsSurprise > 0) {
      score += max * 0.1;
    }
  }

  return { score: capScore(score, max), max, reasons, hasData };
}
