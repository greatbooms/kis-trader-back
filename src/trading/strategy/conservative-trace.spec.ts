import { ConservativeStrategy } from './conservative.strategy';
import { StockStrategyContext, WatchStockConfig, MarketCondition, StockIndicators } from '../types';
import { StockPriceResult } from '../../kis/types/kis-api.types';

/**
 * 보수적 매매 전략 — 실제 시나리오 기반 트레이싱 테스트
 */
describe('ConservativeStrategy — Realistic Trace', () => {
  const strategy = new ConservativeStrategy();

  function createContext(overrides: Partial<StockStrategyContext> = {}): StockStrategyContext {
    const defaultWatchStock: WatchStockConfig = {
      id: 'ws-con-1',
      market: 'DOMESTIC',
      exchangeCode: 'KRX',
      stockCode: '005930',
      stockName: '삼성전자',
      strategyName: 'conservative',
      quota: 3000000,
      cycle: 1,
      maxCycles: 40,
      stopLossRate: 0.05,
      maxPortfolioRate: 0.15,
    };

    const defaultPrice: StockPriceResult = {
      stockCode: '005930',
      stockName: '삼성전자',
      currentPrice: 70000,
      openPrice: 70500,
      highPrice: 71000,
      lowPrice: 69500,
      volume: 1000000,
    };

    const defaultMarketCondition: MarketCondition = {
      referenceIndexAboveMA200: true,
      referenceIndexName: 'KOSPI',
      interestRateRising: false,
    };

    const defaultStockIndicators: StockIndicators = {
      currentAboveMA200: true,
      ma200: 65000,
      rsi14: 20,
      volumeRatio: 2.5,
    };

    return {
      watchStock: defaultWatchStock,
      price: defaultPrice,
      position: undefined,
      alreadyExecutedToday: false,
      marketCondition: defaultMarketCondition,
      stockIndicators: defaultStockIndicators,
      buyableAmount: 3000000,
      totalPortfolioValue: 50000000,
      ...overrides,
    };
  }

  // ============================================================
  // 1. 진입 조건
  // ============================================================

  it('RSI<25 + volumeRatio>=2 → 매수 (자금의 30%만)', async () => {
    const ctx = createContext();
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('BUY');
    // buyAmount = min(3000000 * 0.3, 3000000) = 900000 / 70000 = 12
    expect(signals[0].quantity).toBe(Math.floor(900000 / 70000));
    expect(signals[0].price).toBe(70000);
  });

  it('RSI=25 (경계값, >= threshold) → 매수 안함', async () => {
    const ctx = createContext({
      stockIndicators: { currentAboveMA200: true, rsi14: 25, volumeRatio: 2.5 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('RSI=24 (바로 아래) → 매수', async () => {
    const ctx = createContext({
      stockIndicators: { currentAboveMA200: true, rsi14: 24, volumeRatio: 2.5 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('BUY');
  });

  it('volumeRatio < 2.0 → 매수 안함', async () => {
    const ctx = createContext({
      stockIndicators: { currentAboveMA200: true, rsi14: 20, volumeRatio: 1.5 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('volumeRatio 정확히 2.0 → 매수', async () => {
    const ctx = createContext({
      stockIndicators: { currentAboveMA200: true, rsi14: 20, volumeRatio: 2.0 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
  });

  // ============================================================
  // 2. 익절
  // ============================================================

  it('+3% 이상 → 전량 매도', async () => {
    // avgPrice=70000, +3% = 72100
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 12,
        avgPrice: 70000,
        currentPrice: 72200,
        totalInvested: 840000,
      },
    });
    ctx.price.currentPrice = 72200;
    // profitRate = (72200-70000)/70000 = 3.14%

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].quantity).toBe(12);
    expect(signals[0].reason).toContain('익절');
  });

  it('+2.5% (3% 미만) → 매도 안함', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 12,
        avgPrice: 70000,
        currentPrice: 71750,
        totalInvested: 840000,
      },
    });
    ctx.price.currentPrice = 71750;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  // ============================================================
  // 3. 손절
  // ============================================================

  it('-5% 이상 → 전량 손절', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 12,
        avgPrice: 70000,
        currentPrice: 66000, // -5.7%
        totalInvested: 840000,
      },
    });
    ctx.price.currentPrice = 66000;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].quantity).toBe(12);
    expect(signals[0].reason).toContain('손절');
  });

  it('-4.5% (5% 미만) → 손절 아님', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 12,
        avgPrice: 70000,
        currentPrice: 66850, // -4.5%
        totalInvested: 840000,
      },
    });
    ctx.price.currentPrice = 66850;

    const signals = await strategy.evaluateStock(ctx);
    const stopLoss = signals.find(s => s.reason?.includes('손절'));
    expect(stopLoss).toBeUndefined();
  });

  // ============================================================
  // 4. 손절 vs 익절 우선순위
  // ============================================================

  it('손절이 익절보다 먼저 체크', async () => {
    // 이 경우는 동시에 발생할 수 없지만 (한 가격이 동시에 +3%와 -5%일 수 없음)
    // 손절이 먼저 체크되는 코드 순서만 확인
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 12,
        avgPrice: 70000,
        currentPrice: 66000,
        totalInvested: 840000,
      },
    });
    ctx.price.currentPrice = 66000;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals[0].reason).toContain('손절');
  });

  // ============================================================
  // 5. cashRate 조절
  // ============================================================

  it('cashRate=0.5 → 자금 50% 사용', async () => {
    const ctx = createContext();
    ctx.watchStock.strategyParams = { cashRate: 0.5 };
    // buyAmount = 3000000 * 0.5 = 1500000 / 70000 = 21
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].quantity).toBe(Math.floor(1500000 / 70000));
  });

  it('cashRate=1.0 → 100% 현금 → 매수 불가', async () => {
    const ctx = createContext();
    ctx.watchStock.strategyParams = { cashRate: 1.0 };
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  // ============================================================
  // 6. buyableAmount 제한
  // ============================================================

  it('buyableAmount < quota*availableRate → buyableAmount 기준', async () => {
    const ctx = createContext({ buyableAmount: 200000 });
    // buyAmount = min(900000, 200000) = 200000 / 70000 = 2
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].quantity).toBe(Math.floor(200000 / 70000));
  });

  // ============================================================
  // 7. 해외 종목
  // ============================================================

  it('해외 종목: 소수점 2자리 반올림', async () => {
    const ctx = createContext();
    ctx.watchStock.market = 'OVERSEAS';
    ctx.watchStock.exchangeCode = 'NYSE';
    ctx.price.currentPrice = 45.678;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].price).toBe(45.68);
    expect(signals[0].exchangeCode).toBe('NYSE');
  });

  // ============================================================
  // 8. riskState
  // ============================================================

  it('riskState.liquidateAll + 포지션 → 전량 청산', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 12,
        avgPrice: 70000,
        currentPrice: 68000,
        totalInvested: 840000,
      },
      riskState: {
        liquidateAll: true,
        buyBlocked: true,
        positionCount: 1,
        investedRate: 0.3,
        dailyPnlRate: -0.05,
        drawdown: 0.15,
        reasons: ['MDD 15%'],
      },
    });
    ctx.price.currentPrice = 68000;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].reason).toContain('리스크 전량청산');
  });

  // ============================================================
  // 9. 포지션 보유 중 추가 매수 안하는지 확인
  // ============================================================

  it('포지션 보유 중 + 진입 조건 충족 → 추가 매수 없음 (익절/손절만)', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 12,
        avgPrice: 70000,
        currentPrice: 71000, // +1.4%, 익절 미달
        totalInvested: 840000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        rsi14: 20, // 진입 조건 충족
        volumeRatio: 3.0,
      },
    });
    ctx.price.currentPrice = 71000;

    const signals = await strategy.evaluateStock(ctx);
    // 포지션 있으면 hasPosition=true → 익절/손절 분기로 감
    // +1.4%라 익절(3%) 미달, 손절(-5%) 미달 → 시그널 없음
    expect(signals).toHaveLength(0);
  });
});
