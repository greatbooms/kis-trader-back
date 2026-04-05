import { suggestStrategies } from './strategy-matcher';
import {
  PerStockTradingStrategy,
  StockStrategyContext,
  StrategyEvaluationResult,
  TradingSignal,
} from '../trading/types';

function createSignal(stockCode: string, side: 'BUY' | 'SELL', reason: string): TradingSignal {
  return {
    market: 'DOMESTIC',
    exchangeCode: 'KRX',
    stockCode,
    side,
    quantity: 1,
    price: 70000,
    reason,
  };
}

function createContext(): StockStrategyContext {
  return {
    watchStock: {
      id: 'screening:KRX:005930',
      market: 'DOMESTIC',
      exchangeCode: 'KRX',
      stockCode: '005930',
      stockName: 'Samsung',
      strategyName: 'test',
      quota: 1000000,
      cycle: 1,
      maxCycles: 40,
      stopLossRate: 0.3,
      maxPortfolioRate: 0.15,
    },
    price: {
      stockCode: '005930',
      stockName: 'Samsung',
      currentPrice: 70000,
      openPrice: 69000,
      highPrice: 71000,
      lowPrice: 68000,
      volume: 1000000,
    },
    alreadyExecutedToday: false,
    marketCondition: {
      referenceIndexAboveMA200: true,
      referenceIndexName: 'KOSPI',
      interestRateRising: false,
    },
    stockIndicators: {
      currentAboveMA200: true,
      volatility30d: 20,
      foreignNetBuy: true,
    },
    fundamentals: {},
    buyableAmount: 1000000,
    totalPortfolioValue: 10000000,
  };
}

function createStrategy(
  name: string,
  displayName: string,
  signalsOrEvaluator: TradingSignal[] | ((context: StockStrategyContext) => Promise<StrategyEvaluationResult>),
): PerStockTradingStrategy {
  return {
    name,
    displayName,
    description: `${displayName} test strategy`,
    executionMode: { type: 'continuous' },
    meta: {
      riskLevel: 'medium',
      mddBuyBlock: -0.1,
      mddLiquidate: -0.2,
      expectedReturn: 'test',
      maxLoss: 'test',
      investmentPeriod: 'test',
      tradingFrequency: 'test',
      suitableFor: ['test'],
      tags: ['test'],
    },
    evaluateStock: async (context) => (
      typeof signalsOrEvaluator === 'function'
        ? signalsOrEvaluator(context)
        : { signals: signalsOrEvaluator, skipReasons: [] }
    ),
  };
}

describe('suggestStrategies', () => {
  it('recommends only strategies that produce BUY signals', async () => {
    const strategies = [
      createStrategy('momentum-breakout', '모멘텀 돌파', [createSignal('005930', 'BUY', '모멘텀돌파')]),
      createStrategy('trend-following', '추세 추종', [createSignal('005930', 'SELL', '추세청산')]),
      createStrategy('value-factor', '밸류 팩터', []),
    ];

    const results = await suggestStrategies(strategies, createContext());

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('momentum-breakout');
    expect(results[0].reason).toBe('가격 돌파와 모멘텀 진입 조건이 맞았습니다.');
  });

  it('excludes daily-dca even if it can BUY', async () => {
    const strategies = [
      createStrategy('daily-dca', '일별 분할매수', [createSignal('005930', 'BUY', 'DCA buy')]),
      createStrategy('infinite-buy', '무한매수법', [createSignal('005930', 'BUY', 'Initial buy')]),
    ];

    const results = await suggestStrategies(strategies, createContext());

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('infinite-buy');
  });

  it('filters infinite-buy out when recommendation-only quality gate is not met', async () => {
    const context = createContext();
    context.stockIndicators = {
      currentAboveMA200: true,
      volatility30d: 48,
      foreignNetBuy: false,
      institutionNetBuy: false,
      programTradeDirection: 'SELL',
    };

    const strategies = [
      createStrategy('infinite-buy', '무한매수법', [createSignal('005930', 'BUY', 'Initial buy')]),
    ];

    const results = await suggestStrategies(strategies, context);

    expect(results).toHaveLength(0);
  });

  it('keeps infinite-buy when volatility is controlled and dividend stability is confirmed', async () => {
    const context = createContext();
    context.stockIndicators = {
      currentAboveMA200: true,
      volatility30d: 24,
      dividendYield: 2.2,
      consecutiveDividendYears: 5,
    };

    const strategies = [
      createStrategy('infinite-buy', '무한매수법', [createSignal('005930', 'BUY', 'Initial buy')]),
    ];

    const results = await suggestStrategies(strategies, context);

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('infinite-buy');
    expect(results[0].reason).toBe('분할매수 시작 조건과 배당 안정성이 확인됐습니다.');
  });

  it('filters domestic infinite-buy out when support data is absent even if volatility is reasonable', async () => {
    const context = createContext();
    context.stockIndicators = {
      currentAboveMA200: true,
      volatility30d: 28,
    };

    const strategies = [
      createStrategy('infinite-buy', '무한매수법', [createSignal('005930', 'BUY', 'Initial buy')]),
    ];

    const results = await suggestStrategies(strategies, context);

    expect(results).toHaveLength(0);
  });

  it('allows infinite-buy overseas when support data is absent but other risk flags are clean', async () => {
    const context = createContext();
    context.watchStock.market = 'OVERSEAS';
    context.watchStock.exchangeCode = 'NASD';
    context.price.currentPrice = 320;
    context.stockIndicators = {
      currentAboveMA200: true,
      volatility30d: 24,
      rsi14: 48,
      ma20: 300,
    };

    const strategies = [
      createStrategy('infinite-buy', '무한매수법', [createSignal('005930', 'BUY', 'Initial buy')]),
    ];

    const results = await suggestStrategies(strategies, context);

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('infinite-buy');
    expect(results[0].reason).toBe('분할매수 시작 조건이 충족된 종목입니다.');
  });

  it('filters infinite-buy out when momentum is overheated even with positive flow', async () => {
    const context = createContext();
    context.stockIndicators = {
      currentAboveMA200: true,
      rsi14: 79,
      volatility30d: 132,
      foreignNetBuy: true,
    };

    const strategies = [
      createStrategy('infinite-buy', '무한매수법', [createSignal('005930', 'BUY', 'Initial buy')]),
    ];

    const results = await suggestStrategies(strategies, context);

    expect(results).toHaveLength(0);
  });

  it('keeps infinite-buy when support exists and volatility is elevated but not extreme', async () => {
    const context = createContext();
    context.stockIndicators = {
      currentAboveMA200: true,
      rsi14: 49,
      volatility30d: 84,
      atrPercent: 5.2,
      institutionNetBuy: true,
      dividendYield: 0.9,
      consecutiveDividendYears: 10,
    };

    const strategies = [
      createStrategy('infinite-buy', '무한매수법', [createSignal('005930', 'BUY', 'Initial buy')]),
    ];

    const results = await suggestStrategies(strategies, context);

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('infinite-buy');
  });

  it('filters infinite-buy out when price is too stretched above MA20', async () => {
    const context = createContext();
    context.price.currentPrice = 94000;
    context.stockIndicators = {
      currentAboveMA200: true,
      ma20: 70000,
      rsi14: 66,
      volatility30d: 82,
      atrPercent: 5.4,
      foreignNetBuy: true,
    };

    const strategies = [
      createStrategy('infinite-buy', '무한매수법', [createSignal('005930', 'BUY', 'Initial buy')]),
    ];

    const results = await suggestStrategies(strategies, context);

    expect(results).toHaveLength(0);
  });

  it('sorts recommendations by configured priority and layered buy bonus', async () => {
    const strategies = [
      createStrategy('infinite-buy', '무한매수법', [
        createSignal('005930', 'BUY', 'Buy1'),
        createSignal('005930', 'BUY', 'Buy2'),
      ]),
      createStrategy('trend-following', '추세 추종', [createSignal('005930', 'BUY', '추세진입')]),
      createStrategy('momentum-breakout', '모멘텀 돌파', [createSignal('005930', 'BUY', '모멘텀돌파')]),
    ];

    const results = await suggestStrategies(strategies, createContext());

    expect(results.map((item) => item.name)).toEqual([
      'momentum-breakout',
      'trend-following',
      'infinite-buy',
    ]);
    expect(results[2].matchScore).toBeGreaterThanOrEqual(86);
  });

  it('uses recommendation capital so high-priced stocks are not filtered only by synthetic quota', async () => {
    const context = createContext();
    context.price.currentPrice = 1_000_000;
    context.watchStock.quota = 10_000;
    context.buyableAmount = 10_000;
    context.totalPortfolioValue = 100_000;

    const strategies = [
      createStrategy('trend-following', '추세 추종', async (strategyContext) => ({
        signals: strategyContext.buyableAmount >= strategyContext.price.currentPrice * 1.5
          ? [createSignal('005930', 'BUY', '추세진입')]
          : [],
        skipReasons: [],
      })),
    ];

    const results = await suggestStrategies(strategies, context);

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('trend-following');
  });

  it('does not expose raw order quantity or price details in screening recommendation reasons', async () => {
    const context = createContext();
    context.stockIndicators = {
      currentAboveMA200: true,
      volatility30d: 24,
      dividendYield: 2.4,
      consecutiveDividendYears: 6,
    };

    const strategies = [
      createStrategy('infinite-buy', '무한매수법', [
        createSignal('005930', 'BUY', 'Initial buy: 5주 @ 4210, 배당안정성+'),
      ]),
    ];

    const results = await suggestStrategies(strategies, context);

    expect(results).toHaveLength(1);
    expect(results[0].reason).toBe('분할매수 시작 조건과 배당 안정성이 확인됐습니다.');
    expect(results[0].reason).not.toContain('5주');
    expect(results[0].reason).not.toContain('@ 4210');
  });
});
