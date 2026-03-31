import { PerStockTradingStrategy, StockStrategyContext, TradingSignal } from '../trading/types';
import { SuggestedStrategy } from './types';

const SCREENING_RECOMMENDATION_PRIORITY = [
  'momentum-breakout',
  'trend-following',
  'value-factor',
  'grid-mean-reversion',
  'conservative',
  'infinite-buy',
] as const;

const SCREENING_RECOMMENDATION_SET = new Set<string>(SCREENING_RECOMMENDATION_PRIORITY);
const RECOMMENDATION_CAPITAL_MULTIPLIER: Record<string, number> = {
  'momentum-breakout': 1.5,
  'trend-following': 1.5,
  'value-factor': 1.5,
  'grid-mean-reversion': 4,
  conservative: 4,
  'infinite-buy': 180,
};

function hasStrongSellFlow(stockIndicators: StockStrategyContext['stockIndicators']): boolean {
  const hasFlowData =
    stockIndicators.foreignNetBuy !== undefined ||
    stockIndicators.institutionNetBuy !== undefined ||
    stockIndicators.programTradeDirection !== undefined;
  if (!hasFlowData) return false;
  return stockIndicators.foreignNetBuy === false
    && stockIndicators.institutionNetBuy === false
    && stockIndicators.programTradeDirection === 'SELL';
}

function passesRecommendationGate(strategyName: string, context: StockStrategyContext): boolean {
  if (strategyName !== 'infinite-buy') return true;

  const { stockIndicators } = context;
  const stableDividend = (stockIndicators.dividendYield ?? 0) >= 1.5
    && (stockIndicators.consecutiveDividendYears ?? 0) >= 3;
  const flowSupportive = Boolean(
    stockIndicators.foreignNetBuy ||
      stockIndicators.institutionNetBuy ||
      stockIndicators.programTradeDirection === 'BUY',
  );
  const hasSupportData =
    stockIndicators.dividendYield !== undefined ||
    stockIndicators.consecutiveDividendYears !== undefined ||
    stockIndicators.foreignNetBuy !== undefined ||
    stockIndicators.institutionNetBuy !== undefined ||
    stockIndicators.programTradeDirection !== undefined;
  const volatility30d = stockIndicators.volatility30d;
  const atrPercent = stockIndicators.atrPercent;
  const ma20 = stockIndicators.ma20;
  const priceExtendedAboveMa20 = ma20 !== undefined
    && ma20 > 0
    && context.price.currentPrice >= ma20 * 1.25;
  const overheatedMomentum = (stockIndicators.rsi14 ?? 0) >= 75
    && (
      (volatility30d !== undefined && volatility30d >= 120)
      || (atrPercent !== undefined && atrPercent >= 10)
    );
  const extremeVolatility = (volatility30d !== undefined && volatility30d >= 180)
    || (atrPercent !== undefined && atrPercent >= 15);

  if (stockIndicators.investCautionYn || stockIndicators.shortOverheatYn) return false;
  if (stockIndicators.marketWarnCode && stockIndicators.marketWarnCode !== '00') return false;
  if (hasStrongSellFlow(stockIndicators) || overheatedMomentum || priceExtendedAboveMa20) return false;
  if (!hasSupportData) return context.watchStock.market === 'OVERSEAS';
  if (extremeVolatility && !stableDividend) return false;
  return stableDividend || flowSupportive;
}

function buildRecommendationExecutionContext(
  strategyName: string,
  context: StockStrategyContext,
): StockStrategyContext {
  const currentPrice = Math.max(context.price.currentPrice, 1);
  const multiplier = RECOMMENDATION_CAPITAL_MULTIPLIER[strategyName] ?? 1.5;
  const recommendationQuota = Math.max(
    context.watchStock.quota ?? 0,
    Math.ceil(currentPrice * multiplier),
  );
  const recommendationBuyableAmount = Math.max(context.buyableAmount, recommendationQuota);
  const maxPortfolioRate = Math.max(context.watchStock.maxPortfolioRate || 0.15, 0.01);
  const recommendationPortfolioValue = Math.max(
    context.totalPortfolioValue,
    Math.ceil(recommendationQuota / maxPortfolioRate),
  );

  return {
    ...context,
    watchStock: {
      ...context.watchStock,
      quota: recommendationQuota,
    },
    buyableAmount: recommendationBuyableAmount,
    totalPortfolioValue: recommendationPortfolioValue,
  };
}

function extractPrimaryBuyReason(signals: TradingSignal[]): string {
  return signals.find((signal) => signal.side === 'BUY')?.reason ?? '전략 진입 조건 충족';
}

function buildRecommendationReason(
  strategyName: string,
  context: StockStrategyContext,
  buySignals: TradingSignal[],
): string {
  const { stockIndicators, fundamentals } = context;

  switch (strategyName) {
    case 'momentum-breakout':
      return stockIndicators.volumeRatio && stockIndicators.volumeRatio >= 1.5
        ? '거래량이 동반된 돌파 흐름이 확인됐습니다.'
        : '가격 돌파와 모멘텀 진입 조건이 맞았습니다.';

    case 'trend-following': {
      const hasSupportiveFlow = Boolean(
        stockIndicators.foreignNetBuy ||
        stockIndicators.institutionNetBuy ||
        stockIndicators.programTradeDirection === 'BUY',
      );
      if (hasSupportiveFlow) return '상승 추세에 수급 지지까지 확인됐습니다.';
      if ((stockIndicators.adx14 ?? 0) >= 25) return '상승 추세와 추세 강도가 함께 살아 있습니다.';
      return '추세 추종 전략의 진입 조건을 충족했습니다.';
    }

    case 'value-factor': {
      const valueSignals: string[] = [];
      if ((fundamentals?.per ?? Number.POSITIVE_INFINITY) < 10) valueSignals.push('저PER');
      if ((fundamentals?.pbr ?? Number.POSITIVE_INFINITY) < 1) valueSignals.push('저PBR');
      if ((fundamentals?.roe ?? 0) >= 10) valueSignals.push('수익성');
      if ((stockIndicators.dividendYield ?? 0) >= 1.5) valueSignals.push('배당');
      if (valueSignals.length > 0) return `${valueSignals.join('·')} 조건이 고르게 맞습니다.`;
      return '저평가와 재무 안정성 조건을 함께 충족했습니다.';
    }

    case 'grid-mean-reversion':
      return '과매도 구간에서 반등 진입 조건이 확인됐습니다.';

    case 'conservative':
      return '리스크를 낮춘 보수적 진입 조건에 맞는 흐름입니다.';

    case 'infinite-buy': {
      const stableDividend = (stockIndicators.dividendYield ?? 0) >= 1.5
        && (stockIndicators.consecutiveDividendYears ?? 0) >= 3;
      const flowSupportive = Boolean(
        stockIndicators.foreignNetBuy ||
        stockIndicators.institutionNetBuy ||
        stockIndicators.programTradeDirection === 'BUY',
      );

      if (stableDividend && flowSupportive) return '분할매수 시작 조건과 배당·수급 안정성이 함께 확인됐습니다.';
      if (stableDividend) return '분할매수 시작 조건과 배당 안정성이 확인됐습니다.';
      if (flowSupportive) return '분할매수 시작 조건과 수급 지지가 확인됐습니다.';
      return '분할매수 시작 조건이 충족된 종목입니다.';
    }

    default:
      return extractPrimaryBuyReason(buySignals)
        .replace(/\s*\d+주\s*@\s*[\d.]+/g, '')
        .replace(/\s*T=\d+(\.\d+)?/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim() || '전략 진입 조건을 충족했습니다.';
  }
}

function buildSignalBackedMatchScore(strategyName: string, buySignals: TradingSignal[]): number {
  const priorityIndex = SCREENING_RECOMMENDATION_PRIORITY.indexOf(strategyName as typeof SCREENING_RECOMMENDATION_PRIORITY[number]);
  const baseScore = priorityIndex >= 0 ? 96 - priorityIndex * 2 : 84;
  const layeredEntryBonus = Math.min(3, Math.max(0, buySignals.length - 1)) * 2;
  return Math.min(99, baseScore + layeredEntryBonus);
}

export async function suggestStrategies(
  strategies: PerStockTradingStrategy[],
  context: StockStrategyContext,
): Promise<SuggestedStrategy[]> {
  const results = await Promise.all(
    strategies
      .filter((strategy) => SCREENING_RECOMMENDATION_SET.has(strategy.name))
      .map(async (strategy) => {
        if (!passesRecommendationGate(strategy.name, context)) return undefined;
        const recommendationContext = buildRecommendationExecutionContext(strategy.name, context);
        const signals = await strategy.evaluateStock({
          ...recommendationContext,
          watchStock: {
            ...recommendationContext.watchStock,
            strategyName: strategy.name,
          },
        });
        const buySignals = signals.filter((signal) => signal.side === 'BUY');
        if (buySignals.length === 0) return undefined;

        return {
          name: strategy.name,
          displayName: strategy.displayName,
          matchScore: buildSignalBackedMatchScore(strategy.name, buySignals),
          reason: buildRecommendationReason(strategy.name, recommendationContext, buySignals),
        } satisfies SuggestedStrategy;
      }),
  );

  return results
    .filter((item): item is SuggestedStrategy => !!item)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 4);
}
