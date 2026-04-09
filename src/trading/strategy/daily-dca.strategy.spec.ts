import { DailyDcaStrategy } from './daily-dca.strategy';
import {
  StockStrategyContext,
  WatchStockConfig,
  MarketCondition,
  StockIndicators,
} from '../types';
import { StockPriceResult } from '../../kis/types/kis-api.types';

describe('DailyDcaStrategy', () => {
  let strategy: DailyDcaStrategy;

  beforeEach(() => {
    strategy = new DailyDcaStrategy();
  });

  function createContext(overrides: Partial<StockStrategyContext> = {}): StockStrategyContext {
    const defaultWatchStock: WatchStockConfig = {
      id: 'ws-dca-1',
      market: 'DOMESTIC',
      exchangeCode: 'KRX',
      stockCode: '005930',
      stockName: 'Samsung',
      strategyName: 'daily-dca',
      quota: 1000000,
      cycle: 1,
      maxCycles: 40,
      stopLossRate: 0.3,
      maxPortfolioRate: 0.15,
    };

    const defaultPrice: StockPriceResult = {
      stockCode: '005930',
      stockName: 'Samsung',
      currentPrice: 70000,
      openPrice: 69500,
      highPrice: 70500,
      lowPrice: 69000,
      volume: 1000000,
    };

    const defaultMarketCondition: MarketCondition = {
      referenceIndexAboveMA200: true,
      referenceIndexName: 'KOSPI',
      interestRateRising: false,
    };

    const defaultStockIndicators: StockIndicators = {
      currentAboveMA200: true,
    };

    return {
      watchStock: defaultWatchStock,
      price: defaultPrice,
      position: undefined,
      alreadyExecutedToday: false,
      marketCondition: defaultMarketCondition,
      stockIndicators: defaultStockIndicators,
      buyableAmount: 1000000,
      totalPortfolioValue: 10000000,
      ...overrides,
    };
  }

  it('should block new entry for invest caution stocks', async () => {
    const ctx = createContext({
      stockIndicators: {
        currentAboveMA200: true,
        investCautionYn: true,
      },
    });

    const { signals, skipReasons } = await strategy.evaluateStock(ctx);

    expect(signals).toHaveLength(0);
    expect(skipReasons).toContain('투자유의 종목');
  });

  it('should block new entry for market warning stocks', async () => {
    const ctx = createContext({
      stockIndicators: {
        currentAboveMA200: true,
        marketWarnCode: '01',
      },
    });

    const { signals, skipReasons } = await strategy.evaluateStock(ctx);

    expect(signals).toHaveLength(0);
    expect(skipReasons[0]).toContain('시장경고 종목');
  });

  it('should liquidate position when common risk requests full exit', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 5,
        avgPrice: 70000,
        currentPrice: 65000,
        totalInvested: 350000,
      },
      riskState: {
        buyBlocked: true,
        liquidateAll: true,
        positionCount: 1,
        investedRate: 0.2,
        dailyPnlRate: -0.03,
        drawdown: -0.31,
        reasons: ['MDD -31%'],
      },
    });
    ctx.price.currentPrice = 65000;

    const { signals } = await strategy.evaluateStock(ctx);

    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].quantity).toBe(5);
    expect(signals[0].reason).toContain('리스크 전량청산');
  });

  it('should block buys when common risk blocks additional entries', async () => {
    const ctx = createContext({
      riskState: {
        buyBlocked: true,
        liquidateAll: false,
        positionCount: 6,
        investedRate: 0.85,
        dailyPnlRate: -0.02,
        drawdown: -0.22,
        reasons: ['MDD -22%'],
      },
    });

    const { signals, skipReasons } = await strategy.evaluateStock(ctx);

    expect(signals).toHaveLength(0);
    expect(skipReasons[0]).toContain('리스크 매수 차단');
  });
});
