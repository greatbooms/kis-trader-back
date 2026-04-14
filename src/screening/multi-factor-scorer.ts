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

function capScore(score: number, max: number): number {
  return Math.round(Math.min(score, max) * 10) / 10;
}

function emptyFactor(max: number): FactorComponent {
  return { score: 0, max, reasons: [], hasData: false };
}

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

export function buildDomesticScore(candidate: ScreeningCandidate, indicators: StockIndicatorDetail) {
  const technical = scoreTechnical(indicators, candidate, 15);
  const valuation = scoreValuation(indicators, 15);
  const growth = scoreGrowth(indicators, 10);
  const profitability = scoreProfitability(indicators, 10);
  const risk = scoreRisk(indicators, 10);
  const momentum = scoreMomentum(indicators, candidate, 10);
  const supplyDemand = scoreSupplyDemand(indicators, 10);
  const dividend = scoreDividend(indicators, 5);
  const consensus = scoreConsensus(indicators, 10);
  const pattern = scorePattern(indicators, candidate, 5, false);

  return composeScore(candidate, indicators, {
    technical, valuation, growth, profitability, risk,
    momentum, supplyDemand, dividend, consensus, pattern,
  });
}

export function buildOverseasScore(candidate: ScreeningCandidate, indicators: StockIndicatorDetail) {
  const technical = scoreTechnical(indicators, candidate, 20);
  const valuation = scoreValuation(indicators, 10);
  const growth = scoreGrowth(indicators, 15);
  const profitability = scoreProfitability(indicators, 15);
  const risk = scoreRisk(indicators, 10);
  const momentum = scoreMomentum(indicators, candidate, 10);
  const supplyDemand = scoreOverseasSupply(indicators, candidate, 10);
  const dividend = scoreDividend(indicators, 5);
  const pattern = scorePattern(indicators, candidate, 20, true);

  return composeScore(candidate, indicators, {
    technical, valuation, growth, profitability, risk,
    momentum, supplyDemand,
    dividend, consensus: emptyFactor(0),
    pattern,
  });
}

export function buildEtfScore(candidate: ScreeningCandidate, indicators: StockIndicatorDetail, isOverseas: boolean) {
  const technical = scoreTechnical(indicators, candidate, 25);
  const momentum = scoreMomentum(indicators, candidate, 25);
  const supplyDemand = isOverseas
    ? scoreOverseasSupply(indicators, candidate, 20)
    : scoreSupplyDemand(indicators, 20);
  const pattern = scorePattern(indicators, candidate, 30, isOverseas, true);

  return composeScore(candidate, indicators, {
    technical,
    valuation: emptyFactor(0), growth: emptyFactor(0), profitability: emptyFactor(0), risk: emptyFactor(0),
    momentum, supplyDemand,
    dividend: emptyFactor(0), consensus: emptyFactor(0),
    pattern,
  });
}

export function composeScore(
  candidate: ScreeningCandidate,
  indicators: StockIndicatorDetail,
  factors: Record<string, FactorComponent>,
) {
  const entries = Object.entries(factors);
  const totalWeight = entries.reduce((sum, [, factor]) => sum + factor.max, 0);
  const availableWeight = entries.reduce((sum, [, factor]) => sum + (factor.hasData ? factor.max : 0), 0);
  const rawScore = entries.reduce((sum, [, factor]) => sum + factor.score, 0);
  const totalScore = availableWeight > 0 ? Math.round((rawScore / availableWeight) * 1000) / 10 : 0;
  const dataAvailability = totalWeight > 0 ? Math.round((availableWeight / totalWeight) * 100) : 0;

  const factorScores = {
    technical: factors.technical.score,
    valuation: factors.valuation.score,
    growth: factors.growth.score,
    profitability: factors.profitability.score,
    risk: factors.risk.score,
    momentum: factors.momentum.score,
    supplyDemand: factors.supplyDemand.score,
    dividend: factors.dividend.score,
    consensus: factors.consensus.score,
    pattern: factors.pattern.score,
  };

  const compatibilityTechnicalRaw = factors.technical.score + factors.pattern.score;
  const compatibilityTechnicalMax = (factors.technical.hasData ? factors.technical.max : 0) + (factors.pattern.hasData ? factors.pattern.max : 0);
  const compatibilityMomentumRaw = factors.momentum.score + factors.supplyDemand.score;
  const compatibilityMomentumMax = (factors.momentum.hasData ? factors.momentum.max : 0) + (factors.supplyDemand.hasData ? factors.supplyDemand.max : 0);
  const compatibilityFundamentalRaw =
    factors.valuation.score + factors.growth.score + factors.profitability.score +
    factors.risk.score + factors.dividend.score + factors.consensus.score;
  const compatibilityFundamentalMax =
    (factors.valuation.hasData ? factors.valuation.max : 0) +
    (factors.growth.hasData ? factors.growth.max : 0) +
    (factors.profitability.hasData ? factors.profitability.max : 0) +
    (factors.risk.hasData ? factors.risk.max : 0) +
    (factors.dividend.hasData ? factors.dividend.max : 0) +
    (factors.consensus.hasData ? factors.consensus.max : 0);

  const technicalScore = compatibilityTechnicalMax > 0
    ? Math.round((compatibilityTechnicalRaw / compatibilityTechnicalMax) * 400) / 10 : 0;
  const momentumScore = compatibilityMomentumMax > 0
    ? Math.round((compatibilityMomentumRaw / compatibilityMomentumMax) * 300) / 10 : 0;
  const fundamentalScore = compatibilityFundamentalMax > 0
    ? Math.round((compatibilityFundamentalRaw / compatibilityFundamentalMax) * 300) / 10 : 0;

  const reasons = entries.flatMap(([, factor]) => factor.reasons).slice(0, 12);
  if (candidate.market === 'DOMESTIC' && indicators.targetPriceUpside !== undefined && indicators.targetPriceUpside > 20) {
    reasons.unshift(`목표가 괴리율 +${indicators.targetPriceUpside.toFixed(1)}%`);
  }

  return {
    totalScore, technicalScore, fundamentalScore, momentumScore,
    factorScores: { ...factorScores, fundamental: Math.round((fundamentalScore / 30) * 100) / 10 },
    dataAvailability, reasons,
  };
}

export function scoreTechnical(indicators: StockIndicatorDetail, candidate: ScreeningCandidate, max: number): FactorComponent {
  let score = 0;
  const reasons: string[] = [];
  let hasData = false;

  const technicalRatings = indicators.technicalRatings;
  if (technicalRatings) {
    hasData = true;
    const detailed = scoreTechnicalRatings(technicalRatings, max * 0.6);
    score += detailed.score;
    reasons.push(...detailed.reasons);

    const overall = technicalRatings.overallSummary.score;
    const oscillators = technicalRatings.oscillatorSummary.score;
    const movingAverages = technicalRatings.movingAverageSummary.score;

    if (overall > 0.5) {
      score += max * 0.1;
      reasons.push('기술 요약 강한 매수');
    } else if (overall > 0.1) {
      score += max * 0.07;
      reasons.push('기술 요약 매수 우위');
    } else if (overall < -0.5) {
      reasons.push('기술 요약 강한 매도');
    } else if (overall < -0.1) {
      reasons.push('기술 요약 매도 우위');
    }

    if (oscillators > 0.1) score += max * 0.04;
    if (movingAverages > 0.1) score += max * 0.06;
  }

  if (indicators.rsi14 !== undefined) {
    hasData = true;
    if (indicators.rsi14 >= 40 && indicators.rsi14 <= 60) { score += max * 0.08; reasons.push(`RSI ${indicators.rsi14.toFixed(1)} 안정권`); }
    else if (indicators.rsi14 >= 30 && indicators.rsi14 < 40) { score += max * 0.06; reasons.push(`RSI ${indicators.rsi14.toFixed(1)} 반등 구간`); }
  }
  if (indicators.ma20 && indicators.ma60) {
    hasData = true;
    if (candidate.currentPrice > indicators.ma20 && indicators.ma20 > indicators.ma60) { score += max * 0.08; reasons.push('MA20 > MA60, 가격이 단기 추세 상단'); }
    else if (indicators.goldenCrossNear) { score += max * 0.05; reasons.push('골든크로스 근접'); }
  }
  if (indicators.macd) { hasData = true; if (indicators.macd.histogram > 0) { score += max * 0.05; reasons.push('MACD 매수 우위'); } }
  if (indicators.bollingerBands) { hasData = true; if (indicators.bollingerBands.percentB >= 0.35 && indicators.bollingerBands.percentB <= 0.75) { score += max * 0.04; reasons.push('볼린저 밴드 중상단 위치'); } }
  if (indicators.adx14 !== undefined) { hasData = true; if (indicators.adx14 >= 25) { score += max * 0.04; reasons.push(`ADX ${indicators.adx14.toFixed(1)} 추세 형성`); } else if (indicators.adx14 >= 18) { score += max * 0.02; } }

  return { score: capScore(score, max), max, reasons, hasData };
}

function scoreTechnicalRatings(
  technicalRatings: TechnicalRatingsSnapshot,
  max: number,
): { score: number; reasons: string[] } {
  const allIndicators = [
    ...technicalRatings.oscillators,
    ...technicalRatings.movingAverages,
  ];

  const totalWeight = allIndicators.reduce((sum, indicator) => {
    return sum + (TECHNICAL_INDICATOR_WEIGHT[indicator.key] ?? 1);
  }, 0);

  if (totalWeight <= 0) {
    return { score: 0, reasons: [] };
  }

  const weightedScore = allIndicators.reduce((sum, indicator) => {
    const weight = TECHNICAL_INDICATOR_WEIGHT[indicator.key] ?? 1;
    const actionWeight = TECHNICAL_ACTION_MULTIPLIER[indicator.action] ?? 0.45;
    return sum + weight * actionWeight;
  }, 0);

  const score = (weightedScore / totalWeight) * max;
  const buySignals = topTechnicalSignals(allIndicators, 'BUY').slice(0, 3);
  const sellSignals = topTechnicalSignals(allIndicators, 'SELL').slice(0, 2);
  const reasons: string[] = [];

  if (buySignals.length > 0) {
    reasons.push(`기술지표 매수 우위: ${buySignals.map((signal) => signal.label).join(', ')}`);
  }
  if (sellSignals.length > 0) {
    reasons.push(`기술지표 주의: ${sellSignals.map((signal) => signal.label).join(', ')}`);
  }

  return {
    score,
    reasons,
  };
}

function topTechnicalSignals(indicators: TechnicalIndicatorSnapshot[], action: 'BUY' | 'SELL') {
  return indicators
    .filter((indicator) => indicator.action === action)
    .sort((left, right) => (TECHNICAL_INDICATOR_WEIGHT[right.key] ?? 1) - (TECHNICAL_INDICATOR_WEIGHT[left.key] ?? 1));
}

export function scoreValuation(indicators: StockIndicatorDetail, max: number): FactorComponent {
  let score = 0;
  const reasons: string[] = [];
  let hasData = false;

  if (indicators.per !== undefined && indicators.per > 0) { hasData = true; if (indicators.per <= 10) { score += max * 0.25; reasons.push(`PER ${indicators.per.toFixed(1)} 저평가`); } else if (indicators.per <= 18) { score += max * 0.15; } }
  if (indicators.pbr !== undefined && indicators.pbr > 0) { hasData = true; if (indicators.pbr <= 1.0) { score += max * 0.2; reasons.push(`PBR ${indicators.pbr.toFixed(2)} 저평가`); } else if (indicators.pbr <= 2.0) { score += max * 0.1; } }
  if (indicators.evEbitda !== undefined && indicators.evEbitda > 0) { hasData = true; if (indicators.evEbitda <= 8) { score += max * 0.2; reasons.push(`EV/EBITDA ${indicators.evEbitda.toFixed(1)} 매력적`); } else if (indicators.evEbitda <= 12) { score += max * 0.1; } }
  if (indicators.marginOfSafety !== undefined) { hasData = true; if (indicators.marginOfSafety >= 20) { score += max * 0.35; reasons.push(`안전마진 ${indicators.marginOfSafety.toFixed(1)}%`); } else if (indicators.marginOfSafety >= 10) { score += max * 0.2; } }

  return { score: capScore(score, max), max, reasons, hasData };
}

export function scoreGrowth(indicators: StockIndicatorDetail, max: number): FactorComponent {
  let score = 0; const reasons: string[] = []; let hasData = false;
  if (indicators.revenueGrowthRate !== undefined) { hasData = true; if (indicators.revenueGrowthRate >= 10) { score += max * 0.3; reasons.push(`매출 성장률 ${indicators.revenueGrowthRate.toFixed(1)}%`); } else if (indicators.revenueGrowthRate >= 5) { score += max * 0.15; } }
  if (indicators.operatingProfitGrowthRate !== undefined) { hasData = true; if (indicators.operatingProfitGrowthRate >= 10) { score += max * 0.3; reasons.push(`영업이익 성장률 ${indicators.operatingProfitGrowthRate.toFixed(1)}%`); } else if (indicators.operatingProfitGrowthRate >= 5) { score += max * 0.15; } }
  if (indicators.epsGrowthRate !== undefined) { hasData = true; if (indicators.epsGrowthRate >= 10) { score += max * 0.2; reasons.push(`EPS 성장률 ${indicators.epsGrowthRate.toFixed(1)}%`); } else if (indicators.epsGrowthRate >= 5) { score += max * 0.1; } }
  if (indicators.equityGrowthRate !== undefined) { hasData = true; if (indicators.equityGrowthRate >= 10) { score += max * 0.2; reasons.push(`자기자본 성장률 ${indicators.equityGrowthRate.toFixed(1)}%`); } else if (indicators.equityGrowthRate >= 5) { score += max * 0.1; } }
  if (indicators.secPeriodicReportAgeDays !== undefined) { hasData = true; if (indicators.secPeriodicReportAgeDays <= 120) { score += max * 0.1; reasons.push('최근 10-Q/10-K 반영'); } }
  if ((indicators.recentPeriodicDisclosureCount30d ?? 0) > 0) { hasData = true; score += max * 0.08; reasons.push('최근 정기공시 반영'); }
  return { score: capScore(score, max), max, reasons, hasData };
}

export function scoreProfitability(indicators: StockIndicatorDetail, max: number): FactorComponent {
  let score = 0; const reasons: string[] = []; let hasData = false;
  if (indicators.operatingMargin !== undefined) { hasData = true; if (indicators.operatingMargin >= 15) { score += max * 0.25; reasons.push(`영업이익률 ${indicators.operatingMargin.toFixed(1)}%`); } else if (indicators.operatingMargin >= 8) { score += max * 0.15; } }
  if (indicators.netMargin !== undefined) { hasData = true; if (indicators.netMargin >= 10) { score += max * 0.25; reasons.push(`순이익률 ${indicators.netMargin.toFixed(1)}%`); } else if (indicators.netMargin >= 5) { score += max * 0.12; } }
  if (indicators.roe !== undefined) { hasData = true; if (indicators.roe >= 15) { score += max * 0.25; reasons.push(`ROE ${indicators.roe.toFixed(1)}%`); } else if (indicators.roe >= 10) { score += max * 0.15; } }
  if (indicators.grossMargin !== undefined) { hasData = true; if (indicators.grossMargin >= 40) { score += max * 0.25; reasons.push(`매출총이익률 ${indicators.grossMargin.toFixed(1)}%`); } else if (indicators.grossMargin >= 20) { score += max * 0.12; } }
  return { score: capScore(score, max), max, reasons, hasData };
}

export function scoreRisk(indicators: StockIndicatorDetail, max: number): FactorComponent {
  let score = 0; const reasons: string[] = []; let hasData = false;
  if (indicators.debtRatio !== undefined) { hasData = true; if (indicators.debtRatio < 100) { score += max * 0.2; reasons.push(`부채비율 ${indicators.debtRatio.toFixed(0)}% 안정적`); } else if (indicators.debtRatio < 200) { score += max * 0.1; } }
  if (indicators.currentRatio !== undefined) { hasData = true; if (indicators.currentRatio >= 150) { score += max * 0.15; reasons.push(`유동비율 ${indicators.currentRatio.toFixed(0)}%`); } else if (indicators.currentRatio >= 100) { score += max * 0.08; } }
  if (indicators.interestCoverageRatio !== undefined) { hasData = true; if (indicators.interestCoverageRatio >= 3) { score += max * 0.15; reasons.push(`이자보상배율 ${indicators.interestCoverageRatio.toFixed(1)}배`); } else if (indicators.interestCoverageRatio >= 1.5) { score += max * 0.08; } }
  if (indicators.shortSaleRatio !== undefined) { hasData = true; if (indicators.shortSaleRatio < 2) score += max * 0.1; else if (indicators.shortSaleRatio > 5) reasons.push(`공매도 비중 ${indicators.shortSaleRatio.toFixed(1)}% 주의`); }
  if (indicators.creditBalanceRate !== undefined || indicators.loanBalanceRate !== undefined) { hasData = true; const leverageRate = indicators.creditBalanceRate ?? indicators.loanBalanceRate ?? 0; if (leverageRate < 5) score += max * 0.08; else reasons.push(`신용/융자 비율 ${leverageRate.toFixed(1)}%`); }
  if (indicators.atrPercent !== undefined) { hasData = true; if (indicators.atrPercent < 2) { score += max * 0.12; reasons.push(`ATR% ${indicators.atrPercent.toFixed(1)}% 저변동`); } else if (indicators.atrPercent < 4) { score += max * 0.06; } }
  if (indicators.maxDrawdown60d !== undefined) { hasData = true; if (indicators.maxDrawdown60d > -10) { score += max * 0.1; reasons.push(`MDD60d ${indicators.maxDrawdown60d.toFixed(1)}%`); } else if (indicators.maxDrawdown60d > -20) { score += max * 0.05; } }
  if (indicators.borrowingDependency !== undefined) { hasData = true; if (indicators.borrowingDependency < 20) { score += max * 0.1; reasons.push(`차입금의존도 ${indicators.borrowingDependency.toFixed(0)}%`); } else if (indicators.borrowingDependency < 30) { score += max * 0.05; } }
  return { score: capScore(score, max), max, reasons, hasData };
}

export function scoreMomentum(indicators: StockIndicatorDetail, candidate: ScreeningCandidate, max: number): FactorComponent {
  let score = 0; const reasons: string[] = []; const hasData = true;
  if (candidate.changeRate >= 1 && candidate.changeRate <= 8) { score += max * 0.35; reasons.push(`등락률 +${candidate.changeRate.toFixed(1)}%`); } else if (candidate.changeRate > 8) { score += max * 0.15; reasons.push(`급등 +${candidate.changeRate.toFixed(1)}%`); } else if (candidate.changeRate >= -3 && candidate.changeRate < 0) { score += max * 0.1; }
  const volumeRate = indicators.volumeIncreaseRate ?? indicators.volumeSurgeRate ?? indicators.prevDayVolumeChangeRate;
  if (volumeRate !== undefined) { if (volumeRate >= 50) { score += max * 0.35; reasons.push(`거래량 +${volumeRate.toFixed(0)}%`); } else if (volumeRate >= 20) { score += max * 0.2; } }
  if (indicators.ma20 && indicators.ma60 && indicators.ma20 > indicators.ma60) { score += max * 0.3; reasons.push('MA20 > MA60 모멘텀'); }
  return { score: capScore(score, max), max, reasons, hasData };
}

export function scoreSupplyDemand(indicators: StockIndicatorDetail, max: number): FactorComponent {
  let score = 0; const reasons: string[] = [];
  const hasData =
    indicators.foreignNetBuy !== undefined ||
    indicators.institutionNetBuy !== undefined ||
    indicators.foreignNetBuyStreak !== undefined ||
    indicators.insiderOwnershipChangeRate !== undefined;
  if (indicators.foreignNetBuy && indicators.institutionNetBuy) { score += max * 0.45; reasons.push('외인/기관 동시 순매수'); } else if (indicators.foreignNetBuy || indicators.institutionNetBuy) { score += max * 0.25; reasons.push(indicators.foreignNetBuy ? '외국인 순매수' : '기관 순매수'); }
  if ((indicators.foreignNetBuyStreak ?? 0) >= 3) { score += max * 0.25; reasons.push(`외국인 연속 순매수 ${indicators.foreignNetBuyStreak}일`); }
  if (indicators.programTradeDirection === 'BUY') { score += max * 0.15; reasons.push('프로그램 매수 우위'); }
  if (indicators.fundNetBuy) score += max * 0.15;
  if ((indicators.insiderOwnershipChangeRate ?? 0) > 0.05) {
    score += max * 0.15;
    reasons.push(`주요주주 지분 +${indicators.insiderOwnershipChangeRate?.toFixed(2)}%p`);
  }
  return { score: capScore(score, max), max, reasons, hasData };
}

export function scoreOverseasSupply(indicators: StockIndicatorDetail, candidate: ScreeningCandidate, max: number): FactorComponent {
  let score = 0; const reasons: string[] = []; const hasData = true;
  if ((indicators.prevDayVolumeChangeRate ?? 0) >= 30) { score += max * 0.45; reasons.push(`전일 대비 거래량 +${(indicators.prevDayVolumeChangeRate ?? 0).toFixed(0)}%`); }
  if ((indicators.volumeToAvgRatio ?? 0) >= 1.5) { score += max * 0.25; reasons.push(`평균 대비 거래량 ${indicators.volumeToAvgRatio?.toFixed(1)}배`); }
  if (candidate.marketCap >= MIN_MARKET_CAP_BY_EXCHANGE[candidate.exchangeCode]) { score += max * 0.3; reasons.push('대형주 유동성'); }
  return { score: capScore(score, max), max, reasons, hasData };
}

export function scoreDividend(indicators: StockIndicatorDetail, max: number): FactorComponent {
  let score = 0; const reasons: string[] = [];
  const hasData = indicators.dividendYield !== undefined || indicators.payoutRatio !== undefined || indicators.consecutiveDividendYears !== undefined;
  if (indicators.dividendYield !== undefined) { if (indicators.dividendYield >= 3) { score += max * 0.4; reasons.push(`배당수익률 ${indicators.dividendYield.toFixed(1)}%`); } else if (indicators.dividendYield >= 1.5) { score += max * 0.2; } }
  if (indicators.payoutRatio !== undefined && indicators.payoutRatio >= 20 && indicators.payoutRatio <= 60) { score += max * 0.25; reasons.push(`배당성향 ${indicators.payoutRatio.toFixed(1)}%`); }
  if ((indicators.consecutiveDividendYears ?? 0) >= 5) { score += max * 0.35; reasons.push(`연속 배당 ${indicators.consecutiveDividendYears}년`); }
  return { score: capScore(score, max), max, reasons, hasData };
}

export function scoreConsensus(indicators: StockIndicatorDetail, max: number): FactorComponent {
  let score = 0; const reasons: string[] = [];
  const hasData = indicators.targetPriceUpside !== undefined || indicators.consensusRating !== undefined || indicators.earningsSurprise !== undefined;
  if (indicators.targetPriceUpside !== undefined) { if (indicators.targetPriceUpside >= 20) { score += max * 0.45; reasons.push(`목표가 괴리 +${indicators.targetPriceUpside.toFixed(1)}%`); } else if (indicators.targetPriceUpside >= 10) { score += max * 0.25; } }
  if (indicators.consensusRating) { if (/(매수|BUY|STRONG BUY)/i.test(indicators.consensusRating)) { score += max * 0.3; reasons.push(`컨센서스 ${indicators.consensusRating}`); } else if (/(중립|HOLD)/i.test(indicators.consensusRating)) { score += max * 0.1; } }
  if (indicators.earningsSurprise !== undefined) { if (indicators.earningsSurprise > 5) { score += max * 0.25; reasons.push(`어닝 서프라이즈 +${indicators.earningsSurprise.toFixed(1)}%`); } else if (indicators.earningsSurprise > 0) { score += max * 0.1; } }
  return { score: capScore(score, max), max, reasons, hasData };
}

export function scorePattern(
  indicators: StockIndicatorDetail, candidate: ScreeningCandidate,
  max: number, isOverseas: boolean, isEtf = false,
): FactorComponent {
  let score = 0; const reasons: string[] = []; const hasData = true;
  if (indicators.chartPattern) { score += isOverseas ? max * 0.2 : max * 0.35; reasons.push(`패턴 ${indicators.chartPattern}`); }
  if ((indicators.volumeToAvgRatio ?? 0) >= 3) { score += isEtf ? max * 0.25 : max * 0.15; reasons.push('이상 거래량 감지'); }
  if ((indicators.shortSaleRatio ?? 0) > 5 && (indicators.volumeSurgeRate ?? 0) > 30) { score += max * 0.2; reasons.push('숏스퀴즈 가능성'); }
  if (indicators.consecutiveDividendYears && indicators.consecutiveDividendYears >= 5 && !isOverseas) { score += max * 0.1; }
  if (isEtf && indicators.ma20 && indicators.ma60) {
    const trackingProxy = Math.abs((candidate.currentPrice - indicators.ma20) / Math.max(indicators.ma20, 1));
    if (trackingProxy <= 0.03) { score += max * 0.3; reasons.push('추적 오차 안정'); }
  }
  if (isOverseas) { score += scoreSector(indicators.sector) * (max / 25); if (indicators.sector) reasons.push(`섹터 ${indicators.sector}`); }
  return { score: capScore(score, max), max, reasons, hasData };
}

function scoreSector(sector?: string): number {
  if (!sector) return 0;
  const normalized = sector.toUpperCase();
  if (/(SEMI|TECH|CLOUD|AI|SOFTWARE|CHIP|DEFENSE|ENERGY|HEALTH)/.test(normalized)) return 15;
  if (/(FIN|INDUSTRIAL|CONSUMER)/.test(normalized)) return 8;
  return 5;
}
