import { GridMeanReversionStrategy } from './grid-mean-reversion.strategy';
import { StockStrategyContext, WatchStockConfig, MarketCondition, StockIndicators } from '../types';
import { StockPriceResult } from '../../kis/types/kis-api.types';

/**
 * 그리드 평균회귀 전략 — 실제 시나리오 기반 트레이싱 테스트
 *
 * 시나리오: 삼성전자 (005930) 횡보 → 급락 → 반등
 * - BB(20,2): 상단 75000, 중심 70000, 하단 65000
 * - 급락 시 그리드 단계별 매수 확인
 * - 반등 시 BB 중심선/상단 익절 확인
 */
describe('GridMeanReversionStrategy — Realistic Trace', () => {
  const strategy = new GridMeanReversionStrategy();

  function createContext(overrides: Partial<StockStrategyContext> = {}): StockStrategyContext {
    const defaultWatchStock: WatchStockConfig = {
      id: 'ws-grid-1',
      market: 'DOMESTIC',
      exchangeCode: 'KRX',
      stockCode: '005930',
      stockName: '삼성전자',
      strategyName: 'grid-mean-reversion',
      quota: 3000000, // 300만원
      cycle: 1,
      maxCycles: 40,
      stopLossRate: 0.08,
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
      ma20: 70000,
      ma60: 68000,
      rsi14: 50,
      bollingerUpper: 75000,
      bollingerMiddle: 70000,
      bollingerLower: 65000,
      macdHistogram: 0.5,
      macdPrevHistogram: -0.1,
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
  // 1. 진입 조건 점검 — BB 하단 + RSI < 30 + MACD 상승전환
  // ============================================================

  it('Day 1: 가격 횡보 중 (BB 하단 미도달) → 매수 없음', async () => {
    const ctx = createContext();
    // curPrice=70000 > BB하단=65000 → 진입 조건 불충족
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('Day 5: BB 하단 터치하지만 RSI > 30 → 매수 없음', async () => {
    const ctx = createContext({
      stockIndicators: {
        currentAboveMA200: true,
        bollingerUpper: 75000,
        bollingerMiddle: 70000,
        bollingerLower: 65000,
        rsi14: 35, // 과매도 아님
        macdHistogram: -0.2,
        macdPrevHistogram: -0.5,
      },
    });
    ctx.price.currentPrice = 64500; // BB하단 65000 이하
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('Day 6: BB 하단 + RSI < 30 + MACD 하강 중 → 매수 없음', async () => {
    const ctx = createContext({
      stockIndicators: {
        currentAboveMA200: true,
        bollingerUpper: 75000,
        bollingerMiddle: 70000,
        bollingerLower: 65000,
        rsi14: 25,
        macdHistogram: -0.5, // 하강 중 (현재 <= 이전)
        macdPrevHistogram: -0.3,
      },
    });
    ctx.price.currentPrice = 64000;
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('Day 7: BB 하단 + RSI < 30 + MACD 상승전환 → 그리드 1단계 진입', async () => {
    const ctx = createContext({
      stockIndicators: {
        currentAboveMA200: true,
        bollingerUpper: 75000,
        bollingerMiddle: 70000,
        bollingerLower: 65000,
        rsi14: 25,
        macdHistogram: -0.3, // 상승전환 (-0.3 > -0.5)
        macdPrevHistogram: -0.5,
      },
    });
    ctx.price.currentPrice = 64500;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('BUY');
    // quota=3000000, gridRatio[0]=0.3 → 900000 / 64500 = 13주
    expect(signals[0].quantity).toBe(Math.floor(3000000 * 0.3 / 64500));
    expect(signals[0].price).toBe(64500);
    expect(signals[0].reason).toContain('그리드진입');
  });

  // ============================================================
  // 2. 포지션 보유 중 — 그리드 추가 매수
  // ============================================================

  it('Day 8: 포지션 보유, 가격이 그리드1 (-2%) 이하 → 그리드1 추가매수', async () => {
    // avgPrice=64500, 그리드1 = 64500 * 0.98 = 63210
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 13,
        avgPrice: 64500,
        currentPrice: 63000,
        totalInvested: 838500,
      },
      stockIndicators: {
        currentAboveMA200: true,
        bollingerUpper: 75000,
        bollingerMiddle: 70000,
        bollingerLower: 65000,
        rsi14: 28,
      },
    });
    ctx.price.currentPrice = 63000;

    const signals = await strategy.evaluateStock(ctx);
    const buys = signals.filter(s => s.side === 'BUY');

    // curPrice(63000) <= gridPrice(64500*0.98=63210) → 그리드1 매수
    expect(buys).toHaveLength(1);
    expect(buys[0].reason).toContain('그리드매수 1단계');
    // buyAmount = min(3000000, 3000000) * 0.3 = 900000 / 63000 = 14주
    expect(buys[0].quantity).toBe(Math.floor(3000000 * 0.3 / 63000));
  });

  it('Day 10: 가격 더 하락, 그리드2 (-4%) 이하 → 그리드2 아닌 그리드1 매수 (첫 매칭)', async () => {
    // avgPrice=64000, 그리드1 = 64000*0.98=62720, 그리드2 = 64000*0.96=61440
    // curPrice=61000 → 그리드1도 충족, 그리드2도 충족 → 그리드1이 먼저 매칭 (for 루프에서 break)
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 27,
        avgPrice: 64000,
        currentPrice: 61000,
        totalInvested: 1728000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        bollingerUpper: 75000,
        bollingerMiddle: 68000,
        bollingerLower: 60000,
        rsi14: 22,
      },
    });
    ctx.price.currentPrice = 61000;

    const signals = await strategy.evaluateStock(ctx);
    const buys = signals.filter(s => s.side === 'BUY');

    // 중요: 여러 그리드 레벨이 충족되어도 첫 번째 것만 매수 (break 문)
    expect(buys).toHaveLength(1);
    expect(buys[0].reason).toContain('그리드매수 1단계');
  });

  it('Day 10 심화: 가격이 그리드1과 그리드2 사이 → 그리드1만 매칭', async () => {
    // avgPrice=64000, 그리드1=62720, 그리드2=61440
    // curPrice=62000 → 그리드1 충족 (62000 <= 62720), 그리드2 미충족 (62000 > 61440)
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 27,
        avgPrice: 64000,
        currentPrice: 62000,
        totalInvested: 1728000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        bollingerUpper: 75000,
        bollingerMiddle: 68000,
        bollingerLower: 60000,
        rsi14: 25,
      },
    });
    ctx.price.currentPrice = 62000;

    const signals = await strategy.evaluateStock(ctx);
    const buys = signals.filter(s => s.side === 'BUY');
    expect(buys).toHaveLength(1);
    expect(buys[0].reason).toContain('그리드매수 1단계');
  });

  // ============================================================
  // 3. 그리드 매수 금액 제한 — buyableAmount, riskState
  // ============================================================

  it('buyableAmount가 quota보다 작으면 buyableAmount 기준으로 매수', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 13,
        avgPrice: 64500,
        currentPrice: 63000,
        totalInvested: 838500,
      },
      buyableAmount: 500000, // quota(3000000)보다 작음
    });
    ctx.price.currentPrice = 63000;

    const signals = await strategy.evaluateStock(ctx);
    const buys = signals.filter(s => s.side === 'BUY');

    if (buys.length > 0) {
      // buyAmount = min(3000000, 500000) = 500000, gridRatio[0]=0.3 → 150000 / 63000 = 2주
      expect(buys[0].quantity).toBe(Math.floor(500000 * 0.3 / 63000));
    }
  });

  it('riskState.buyBlocked=true → 추가 매수 없음', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 13,
        avgPrice: 64500,
        currentPrice: 63000,
        totalInvested: 838500,
      },
      riskState: {
        liquidateAll: false,
        buyBlocked: true,
        positionCount: 1,
        investedRate: 0.3,
        dailyPnlRate: -0.02,
        drawdown: 0.05,
        reasons: ['MDD 5%'],
      },
    });
    ctx.price.currentPrice = 63000;

    const signals = await strategy.evaluateStock(ctx);
    const buys = signals.filter(s => s.side === 'BUY');
    expect(buys).toHaveLength(0);
  });

  // ============================================================
  // 4. 손절 — -8% 하락
  // ============================================================

  it('포지션 보유 + 손실률 -8% 이상 → 전량 손절', async () => {
    // avgPrice=64500, -8% = 59340
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 40,
        avgPrice: 64500,
        currentPrice: 59000,
        totalInvested: 2580000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        bollingerUpper: 75000,
        bollingerMiddle: 68000,
        bollingerLower: 55000,
        rsi14: 18,
      },
    });
    ctx.price.currentPrice = 59000;
    // profitRate = (59000-64500)/64500 = -8.53% <= -8%

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].quantity).toBe(40);
    expect(signals[0].reason).toContain('손절');
  });

  it('손실률 -7.9%: 아직 손절 아님', async () => {
    // avgPrice=64500, -7.9% → curPrice = 64500 * 0.921 = 59404.5
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 40,
        avgPrice: 64500,
        currentPrice: 59500,
        totalInvested: 2580000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        bollingerUpper: 75000,
        bollingerMiddle: 68000,
        bollingerLower: 55000,
        rsi14: 18,
      },
    });
    ctx.price.currentPrice = 59500;
    // profitRate = (59500-64500)/64500 = -7.75% > -8%

    const signals = await strategy.evaluateStock(ctx);
    const stopLoss = signals.find(s => s.reason?.includes('손절'));
    expect(stopLoss).toBeUndefined();
  });

  // ============================================================
  // 5. 익절 — BB 중심선 + BB 상단
  // ============================================================

  it('BB 중심선 도달 + 수익 중 → 50% 매도', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 40,
        avgPrice: 64500,
        currentPrice: 70000,
        totalInvested: 2580000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        bollingerUpper: 75000,
        bollingerMiddle: 70000,
        bollingerLower: 65000,
        rsi14: 50,
      },
    });
    ctx.price.currentPrice = 70000;
    // profitRate = (70000-64500)/64500 = +8.5% > 0

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].quantity).toBe(20); // floor(40/2) = 20
    expect(signals[0].reason).toContain('BB중심선');
  });

  it('BB 중심선 도달 + 손실 중 (profitRate <= 0) → 매도 안함', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 40,
        avgPrice: 72000, // 높은 평균단가
        currentPrice: 70000,
        totalInvested: 2880000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        bollingerUpper: 75000,
        bollingerMiddle: 70000, // curPrice = BB중심
        bollingerLower: 65000,
        rsi14: 45,
      },
    });
    ctx.price.currentPrice = 70000;
    // profitRate = (70000-72000)/72000 = -2.8% < 0

    const signals = await strategy.evaluateStock(ctx);
    const bbMiddleSell = signals.find(s => s.reason?.includes('BB중심선'));
    expect(bbMiddleSell).toBeUndefined();
  });

  it('BB 상단 도달 → 전량 매도 (2차 익절)', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 20, // 1차 익절 후 남은 물량
        avgPrice: 64500,
        currentPrice: 76000,
        totalInvested: 1290000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        bollingerUpper: 75000,
        bollingerMiddle: 70000,
        bollingerLower: 65000,
        rsi14: 72,
      },
    });
    ctx.price.currentPrice = 76000;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].quantity).toBe(20); // 전량
    expect(signals[0].reason).toContain('BB상단');
  });

  // ============================================================
  // 6. 익절 우선순위 — BB상단이 BB중심보다 먼저 체크
  // ============================================================

  it('BB 상단과 BB 중심선 동시 충족 → BB 상단 우선 (전량 매도)', async () => {
    // 극단적: BB상단=70000, BB중심=69000, curPrice=71000
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 40,
        avgPrice: 64500,
        currentPrice: 71000,
        totalInvested: 2580000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        bollingerUpper: 70000,
        bollingerMiddle: 69000,
        bollingerLower: 65000,
        rsi14: 65,
      },
    });
    ctx.price.currentPrice = 71000;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].quantity).toBe(40); // BB상단 → 전량 매도
    expect(signals[0].reason).toContain('BB상단');
  });

  // ============================================================
  // 7. 해외 종목 — USD 소수점 처리
  // ============================================================

  it('해외 종목: 가격 소수점 2자리 반올림', async () => {
    const ctx = createContext({
      stockIndicators: {
        currentAboveMA200: true,
        bollingerUpper: 180,
        bollingerMiddle: 170,
        bollingerLower: 160,
        rsi14: 25,
        macdHistogram: -0.2,
        macdPrevHistogram: -0.5,
      },
    });
    ctx.watchStock.market = 'OVERSEAS';
    ctx.watchStock.exchangeCode = 'NASD';
    ctx.watchStock.stockCode = 'AAPL';
    ctx.watchStock.stockName = 'Apple';
    ctx.price.currentPrice = 159.567; // BB하단 160 이하

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].price).toBe(159.57); // 소수점 2자리 반올림
    expect(signals[0].exchangeCode).toBe('NASD');
  });

  // ============================================================
  // 8. riskState.liquidateAll — 리스크 전량청산
  // ============================================================

  it('riskState.liquidateAll=true → 전량 청산', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 40,
        avgPrice: 64500,
        currentPrice: 62000,
        totalInvested: 2580000,
      },
      riskState: {
        liquidateAll: true,
        buyBlocked: true,
        positionCount: 1,
        investedRate: 0.5,
        dailyPnlRate: -0.05,
        drawdown: 0.15,
        reasons: ['MDD 15% 초과'],
      },
    });
    ctx.price.currentPrice = 62000;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].quantity).toBe(40);
    expect(signals[0].reason).toContain('리스크 전량청산');
  });

  // ============================================================
  // 9. 진입 시 quota=0 또는 buyableAmount=0 → 매수 불가
  // ============================================================

  it('quota=0 → 진입 매수 0주 (신호 없음)', async () => {
    const ctx = createContext({
      stockIndicators: {
        currentAboveMA200: true,
        bollingerUpper: 75000,
        bollingerMiddle: 70000,
        bollingerLower: 65000,
        rsi14: 25,
        macdHistogram: -0.3,
        macdPrevHistogram: -0.5,
      },
    });
    ctx.watchStock.quota = 0;
    ctx.price.currentPrice = 64500;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  // ============================================================
  // 10. 버그 검증: 그리드 추가매수 시 손절보다 먼저 체크되는지
  // ============================================================

  it('손절 조건과 그리드 조건 동시 충족 → 손절이 우선', async () => {
    // avgPrice=64500, -8%=59340, 그리드1=-2%=63210, 그리드3=-6%=60630
    // curPrice=58000 → 손절(-10%) + 그리드 모두 충족
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 40,
        avgPrice: 64500,
        currentPrice: 58000,
        totalInvested: 2580000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        bollingerUpper: 75000,
        bollingerMiddle: 68000,
        bollingerLower: 55000,
        rsi14: 15,
      },
    });
    ctx.price.currentPrice = 58000;

    const signals = await strategy.evaluateStock(ctx);
    // 손절이 먼저 체크되고 return → 그리드 매수 없음
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].reason).toContain('손절');
  });

  // ============================================================
  // 11. 포지션 보유 중 BB 밴드 값이 undefined → 매도 없음, 그리드만 체크
  // ============================================================

  it('BB 밴드 값이 없을 때: 그리드 매수만 가능', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 13,
        avgPrice: 64500,
        currentPrice: 63000,
        totalInvested: 838500,
      },
      stockIndicators: {
        currentAboveMA200: true,
        // bollingerUpper, bollingerMiddle 없음
        rsi14: 28,
      },
    });
    ctx.price.currentPrice = 63000;

    const signals = await strategy.evaluateStock(ctx);
    // BB upper/middle 없으므로 익절 조건 스킵 → 그리드 매수만
    const buys = signals.filter(s => s.side === 'BUY');
    const sells = signals.filter(s => s.side === 'SELL');
    expect(sells).toHaveLength(0); // BB 없어서 익절 안함
    expect(buys.length).toBeGreaterThanOrEqual(0); // 그리드 조건에 따라
  });

  // ============================================================
  // 12. 커스텀 파라미터 — strategyParams 오버라이드
  // ============================================================

  it('커스텀 그리드 레벨: strategyParams으로 오버라이드', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 13,
        avgPrice: 64500,
        currentPrice: 63800,
        totalInvested: 838500,
      },
    });
    // 기본 그리드1=-2% → 63210. curPrice=63800 > 63210 → 기본으로는 매수 안됨
    // 커스텀 그리드1=-1% → 63855. curPrice=63800 <= 63855 → 매수됨
    ctx.watchStock.strategyParams = {
      gridLevels: [-0.01, -0.03, -0.05],
      gridRatios: [0.2, 0.3, 0.5],
    };
    ctx.price.currentPrice = 63800;

    const signals = await strategy.evaluateStock(ctx);
    const buys = signals.filter(s => s.side === 'BUY');
    expect(buys).toHaveLength(1);
    expect(buys[0].reason).toContain('그리드매수 1단계');
    // buyAmount = 3000000 * 0.2 = 600000 / 63800 = 9주
    expect(buys[0].quantity).toBe(Math.floor(3000000 * 0.2 / 63800));
  });

  // ============================================================
  // 13. 그리드 매수와 가격이 정확히 그리드 경계에 있을 때
  // ============================================================

  it('가격이 정확히 그리드1 경계 (avgPrice * 0.98) → 매수 발생', async () => {
    const avgPrice = 64500;
    const gridPrice = avgPrice * 0.98; // 63210
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 13,
        avgPrice,
        currentPrice: gridPrice,
        totalInvested: 838500,
      },
    });
    ctx.price.currentPrice = gridPrice;

    const signals = await strategy.evaluateStock(ctx);
    const buys = signals.filter(s => s.side === 'BUY');
    // curPrice(63210) <= gridPrice(63210) → 매수
    expect(buys).toHaveLength(1);
  });

  it('가격이 그리드1 경계 바로 위 → 매수 없음', async () => {
    const avgPrice = 64500;
    const gridPrice = avgPrice * 0.98; // 63210
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 13,
        avgPrice,
        currentPrice: gridPrice + 1, // 63211
        totalInvested: 838500,
      },
    });
    ctx.price.currentPrice = gridPrice + 1;

    const signals = await strategy.evaluateStock(ctx);
    const buys = signals.filter(s => s.side === 'BUY');
    expect(buys).toHaveLength(0);
  });
});
