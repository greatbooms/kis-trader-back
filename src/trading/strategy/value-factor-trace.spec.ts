import { ValueFactorStrategy } from './value-factor.strategy';
import { StockStrategyContext, WatchStockConfig, MarketCondition, StockIndicators, StockFundamentals } from '../types';
import { StockPriceResult } from '../../kis/types/kis-api.types';

/**
 * 밸류 팩터 전략 — 실제 시나리오 기반 트레이싱 테스트
 *
 * 국내: PER + PBR + ROE + 부채비율 + RSI
 * 해외: PER + RSI만 사용 (KIS API 제약)
 */
describe('ValueFactorStrategy — Realistic Trace', () => {
  const strategy = new ValueFactorStrategy();

  function createContext(overrides: Partial<StockStrategyContext> = {}): StockStrategyContext {
    const defaultWatchStock: WatchStockConfig = {
      id: 'ws-vf-1',
      market: 'DOMESTIC',
      exchangeCode: 'KRX',
      stockCode: '005930',
      stockName: '삼성전자',
      strategyName: 'value-factor',
      quota: 5000000,
      cycle: 1,
      maxCycles: 40,
      stopLossRate: 0.10,
      maxPortfolioRate: 0.15,
    };

    const defaultPrice: StockPriceResult = {
      stockCode: '005930',
      stockName: '삼성전자',
      currentPrice: 60000,
      openPrice: 60500,
      highPrice: 61000,
      lowPrice: 59500,
      volume: 2000000,
    };

    const defaultMarketCondition: MarketCondition = {
      referenceIndexAboveMA200: true,
      referenceIndexName: 'KOSPI',
      interestRateRising: false,
    };

    const defaultStockIndicators: StockIndicators = {
      currentAboveMA200: true,
      ma200: 55000,
      rsi14: 35,
    };

    const defaultFundamentals: StockFundamentals = {
      per: 7.5,
      pbr: 0.8,
      roe: 15,
      debtRatio: 80,
      eps: 5000,
      salesGrowthRate: 5.0,
    };

    return {
      watchStock: defaultWatchStock,
      price: defaultPrice,
      position: undefined,
      alreadyExecutedToday: false,
      marketCondition: defaultMarketCondition,
      stockIndicators: defaultStockIndicators,
      fundamentals: defaultFundamentals,
      buyableAmount: 5000000,
      totalPortfolioValue: 50000000,
      ...overrides,
    };
  }

  // ============================================================
  // 메타데이터
  // ============================================================

  it('name, displayName 확인', () => {
    expect(strategy.name).toBe('value-factor');
    expect(strategy.displayName).toBe('밸류 팩터');
  });

  it('once-daily 실행 모드', () => {
    expect(strategy.executionMode).toEqual({
      type: 'once-daily',
      hours: { domestic: 15, overseas: { basis: 'beforeClose', offsetHours: 1 } },
    });
  });

  // ============================================================
  // 1. 국내 종목 — 모든 조건 충족 → 매수
  // ============================================================

  it('국내: PER<10, PBR<1, ROE>10%, 부채<150%, RSI<40 → 매수', async () => {
    const ctx = createContext();
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('BUY');
    expect(signals[0].quantity).toBe(Math.floor(5000000 / 60000)); // 83
    expect(signals[0].reason).toContain('밸류진입');
    expect(signals[0].reason).toContain('PER=7.5');
    expect(signals[0].reason).toContain('PBR=0.8');
    expect(signals[0].reason).toContain('ROE=15%');
    expect(signals[0].reason).toContain('EPS=5000');
  });

  // ============================================================
  // 2. PER 필터
  // ============================================================

  it('PER=10 (경계값, >= maxPer) → 매수 안함', async () => {
    const ctx = createContext({
      fundamentals: { per: 10, pbr: 0.8, roe: 15, debtRatio: 80 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('PER=9.9 → 매수', async () => {
    const ctx = createContext({
      fundamentals: { per: 9.9, pbr: 0.8, roe: 15, debtRatio: 80 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('BUY');
  });

  it('PER=0 (데이터 없음) → 매수 안함', async () => {
    const ctx = createContext({
      fundamentals: { per: 0, pbr: 0.8, roe: 15, debtRatio: 80 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('PER=-5 (적자 기업) → 매수 안함', async () => {
    const ctx = createContext({
      fundamentals: { per: -5, pbr: 0.8, roe: 15, debtRatio: 80 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  // ============================================================
  // 3. PBR 필터 (국내만)
  // ============================================================

  it('PBR=1.0 (경계값) → 매수 안함', async () => {
    const ctx = createContext({
      fundamentals: { per: 7, pbr: 1.0, roe: 15, debtRatio: 80 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('PBR=0.99 → 매수', async () => {
    const ctx = createContext({
      fundamentals: { per: 7, pbr: 0.99, roe: 15, debtRatio: 80 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
  });

  // ============================================================
  // 4. ROE 필터 (국내만)
  // ============================================================

  it('ROE=9 (< 10%) → 매수 안함', async () => {
    const ctx = createContext({
      fundamentals: { per: 7, pbr: 0.8, roe: 9, debtRatio: 80 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('ROE=10 (경계값) → 매수', async () => {
    const ctx = createContext({
      fundamentals: { per: 7, pbr: 0.8, roe: 10, debtRatio: 80 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
  });

  // ============================================================
  // 5. 부채비율 필터 (국내만)
  // ============================================================

  it('부채비율=150% (경계값) → 매수 안함', async () => {
    const ctx = createContext({
      fundamentals: { per: 7, pbr: 0.8, roe: 15, debtRatio: 150 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('부채비율=149% → 매수', async () => {
    const ctx = createContext({
      fundamentals: { per: 7, pbr: 0.8, roe: 15, debtRatio: 149 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
  });

  // ============================================================
  // 5-1. EPS 필터 (국내만)
  // ============================================================

  it('EPS=0 (적자기업) → 매수 안함', async () => {
    const ctx = createContext({
      fundamentals: { per: 7, pbr: 0.8, roe: 15, debtRatio: 80, eps: 0, salesGrowthRate: 5 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('EPS=-500 (적자기업) → 매수 안함', async () => {
    const ctx = createContext({
      fundamentals: { per: 7, pbr: 0.8, roe: 15, debtRatio: 80, eps: -500, salesGrowthRate: 5 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('EPS=100 (흑자기업) → 매수', async () => {
    const ctx = createContext({
      fundamentals: { per: 7, pbr: 0.8, roe: 15, debtRatio: 80, eps: 100, salesGrowthRate: 5 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
  });

  it('EPS=undefined → EPS 체크 스킵', async () => {
    const ctx = createContext({
      fundamentals: { per: 7, pbr: 0.8, roe: 15, debtRatio: 80, eps: undefined, salesGrowthRate: 5 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
  });

  // ============================================================
  // 5-2. 매출액증가율 필터 (국내만)
  // ============================================================

  it('매출액증가율=-25% (심한 역성장) → 매수 안함', async () => {
    const ctx = createContext({
      fundamentals: { per: 7, pbr: 0.8, roe: 15, debtRatio: 80, eps: 5000, salesGrowthRate: -25 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('매출액증가율=-20% (경계값) → 매수', async () => {
    const ctx = createContext({
      fundamentals: { per: 7, pbr: 0.8, roe: 15, debtRatio: 80, eps: 5000, salesGrowthRate: -20 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
  });

  it('매출액증가율=-19% → 매수', async () => {
    const ctx = createContext({
      fundamentals: { per: 7, pbr: 0.8, roe: 15, debtRatio: 80, eps: 5000, salesGrowthRate: -19 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
  });

  it('해외: 매출액증가율/ROE/부채비율/EV-EBITDA 필터 적용 안함 (EPS는 공통 적용)', async () => {
    const ctx = createContext({
      fundamentals: { per: 8, pbr: 0.5, eps: 100, salesGrowthRate: -50, roe: 1, debtRatio: 300, evEbitda: 50 }, // 국내면 실패하는 값이지만 해외는 ROE/부채/매출증가율/EV-EBITDA 미적용
      stockIndicators: { currentAboveMA200: true, rsi14: 35 },
    });
    ctx.watchStock.market = 'OVERSEAS';
    ctx.watchStock.exchangeCode = 'NASD';
    ctx.price.currentPrice = 25.50;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('BUY');
  });

  it('해외: EPS 음수 → 매수 차단 (EPS 공통 필터)', async () => {
    const ctx = createContext({
      fundamentals: { per: 8, pbr: 0.5, eps: -500 },
      stockIndicators: { currentAboveMA200: true, rsi14: 35 },
    });
    ctx.watchStock.market = 'OVERSEAS';
    ctx.watchStock.exchangeCode = 'NASD';
    ctx.price.currentPrice = 25.50;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  // ============================================================
  // 6. RSI 필터
  // ============================================================

  it('RSI=40 (경계값, >= threshold) → 매수 안함', async () => {
    const ctx = createContext({
      stockIndicators: { currentAboveMA200: true, rsi14: 40 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('RSI=39 → 매수', async () => {
    const ctx = createContext({
      stockIndicators: { currentAboveMA200: true, rsi14: 39 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
  });

  // ============================================================
  // 7. 해외 종목 — PER + RSI만 사용
  // ============================================================

  it('해외: PER<10, PBR<1, RSI<40 → 매수', async () => {
    const ctx = createContext({
      fundamentals: { per: 8.5, pbr: 0.7 },
      stockIndicators: { currentAboveMA200: true, rsi14: 35 },
    });
    ctx.watchStock.market = 'OVERSEAS';
    ctx.watchStock.exchangeCode = 'NASD';
    ctx.watchStock.stockCode = 'INTC';
    ctx.watchStock.stockName = 'Intel';
    ctx.price.currentPrice = 25.50;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('BUY');
    expect(signals[0].price).toBe(25.50);
    expect(signals[0].exchangeCode).toBe('NASD');
    expect(signals[0].reason).toContain('해외');
    expect(signals[0].reason).toContain('PBR=0.7');
  });

  it('해외: PER<10, PBR 없음 → PBR 스킵, 매수', async () => {
    const ctx = createContext({
      fundamentals: { per: 8.5 }, // PBR 없음
      stockIndicators: { currentAboveMA200: true, rsi14: 35 },
    });
    ctx.watchStock.market = 'OVERSEAS';
    ctx.watchStock.exchangeCode = 'NASD';
    ctx.price.currentPrice = 25.50;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('BUY');
  });

  it('해외: PBR=1.5 (>=1.0) → 매수 안함', async () => {
    const ctx = createContext({
      fundamentals: { per: 8, pbr: 1.5 },
      stockIndicators: { currentAboveMA200: true, rsi14: 35 },
    });
    ctx.watchStock.market = 'OVERSEAS';
    ctx.watchStock.exchangeCode = 'NASD';
    ctx.price.currentPrice = 25.50;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('해외: PER=12 (>10) → 매수 안함', async () => {
    const ctx = createContext({
      fundamentals: { per: 12, pbr: 0.8 },
      stockIndicators: { currentAboveMA200: true, rsi14: 35 },
    });
    ctx.watchStock.market = 'OVERSEAS';
    ctx.watchStock.exchangeCode = 'NASD';

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('해외: fundamentals 없음 → 매수 안함', async () => {
    const ctx = createContext({
      fundamentals: undefined,
    });
    ctx.watchStock.market = 'OVERSEAS';
    ctx.watchStock.exchangeCode = 'NASD';

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  // ============================================================
  // 8. 손절
  // ============================================================

  it('-10% 손실 → 전량 손절', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 83,
        avgPrice: 60000,
        currentPrice: 53500, // -10.8%
        totalInvested: 4980000,
      },
    });
    ctx.price.currentPrice = 53500;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].quantity).toBe(83);
    expect(signals[0].reason).toContain('손절');
  });

  it('-9% 손실 (10% 미만) → 손절 아님', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 83,
        avgPrice: 60000,
        currentPrice: 54600, // -9%
        totalInvested: 4980000,
      },
    });
    ctx.price.currentPrice = 54600;

    const signals = await strategy.evaluateStock(ctx);
    const stopLoss = signals.find(s => s.reason?.includes('손절'));
    expect(stopLoss).toBeUndefined();
  });

  // ============================================================
  // 9. 익절
  // ============================================================

  it('+15% 수익 → 전량 익절', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 83,
        avgPrice: 60000,
        currentPrice: 69000, // +15%
        totalInvested: 4980000,
      },
    });
    ctx.price.currentPrice = 69000;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].quantity).toBe(83);
    expect(signals[0].reason).toContain('익절');
  });

  // ============================================================
  // 10. RSI > 70 과열 청산
  // ============================================================

  it('RSI=75 + 포지션 보유 → 과열 청산', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 83,
        avgPrice: 60000,
        currentPrice: 65000,
        totalInvested: 4980000,
      },
      stockIndicators: { currentAboveMA200: true, rsi14: 75 },
    });
    ctx.price.currentPrice = 65000;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].quantity).toBe(83);
    expect(signals[0].reason).toContain('과열청산');
  });

  it('RSI=70 (경계값) → 과열 아님', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 83,
        avgPrice: 60000,
        currentPrice: 65000,
        totalInvested: 4980000,
      },
      stockIndicators: { currentAboveMA200: true, rsi14: 70 },
    });
    ctx.price.currentPrice = 65000;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  // ============================================================
  // 11. 매도 우선순위: 손절 > 익절 > RSI과열
  // ============================================================

  it('손절과 RSI>70 동시 충족 → 손절 우선', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 83,
        avgPrice: 60000,
        currentPrice: 53000, // -11.7%
        totalInvested: 4980000,
      },
      stockIndicators: { currentAboveMA200: true, rsi14: 75 },
    });
    ctx.price.currentPrice = 53000;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].reason).toContain('손절');
  });

  // ============================================================
  // 12. alreadyExecutedToday
  // ============================================================

  it('alreadyExecutedToday=true + 손절 조건 → 손절은 동작', async () => {
    const ctx = createContext({
      alreadyExecutedToday: true,
      position: {
        stockCode: '005930',
        quantity: 83,
        avgPrice: 60000,
        currentPrice: 53000,
        totalInvested: 4980000,
      },
    });
    ctx.price.currentPrice = 53000;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].reason).toContain('손절');
  });

  it('alreadyExecutedToday=true + 신규 진입 → 차단', async () => {
    const ctx = createContext({ alreadyExecutedToday: true });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  // ============================================================
  // 13. riskState
  // ============================================================

  it('riskState.liquidateAll → 전량 청산', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 83,
        avgPrice: 60000,
        currentPrice: 58000,
        totalInvested: 4980000,
      },
      riskState: {
        liquidateAll: true,
        buyBlocked: true,
        positionCount: 1,
        investedRate: 0.5,
        dailyPnlRate: -0.1,
        drawdown: 0.15,
        reasons: ['MDD 15%'],
      },
    });
    ctx.price.currentPrice = 58000;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].reason).toContain('리스크 전량청산');
  });

  it('riskState.buyBlocked → 매수 차단', async () => {
    const ctx = createContext({
      riskState: {
        liquidateAll: false,
        buyBlocked: true,
        positionCount: 5,
        investedRate: 0.9,
        dailyPnlRate: 0,
        drawdown: 0.05,
        reasons: ['포지션 초과'],
      },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  // ============================================================
  // 14. fundamentals 없음 → skip
  // ============================================================

  it('fundamentals=undefined → 매수 안함', async () => {
    const ctx = createContext({ fundamentals: undefined });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  // ============================================================
  // 15. 커스텀 파라미터
  // ============================================================

  it('커스텀 maxPer=15: PER=12에서도 매수', async () => {
    const ctx = createContext({
      fundamentals: { per: 12, pbr: 0.8, roe: 15, debtRatio: 80 },
    });
    ctx.watchStock.strategyParams = { maxPer: 15 };

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
  });

  it('커스텀 takeProfitRate=0.20: +15%에서는 익절 안함', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 83,
        avgPrice: 60000,
        currentPrice: 69000, // +15%
        totalInvested: 4980000,
      },
    });
    ctx.watchStock.strategyParams = { takeProfitRate: 0.20 };
    ctx.price.currentPrice = 69000;

    const signals = await strategy.evaluateStock(ctx);
    const takeProfit = signals.find(s => s.reason?.includes('익절'));
    expect(takeProfit).toBeUndefined();
  });

  // ============================================================
  // 16. 국내 PBR undefined → PBR 체크 스킵
  // ============================================================

  it('PBR=undefined → PBR 체크 스킵, 나머지 조건으로 판단', async () => {
    const ctx = createContext({
      fundamentals: { per: 7, pbr: undefined, roe: 15, debtRatio: 80 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1); // PBR undefined면 체크 안함
  });

  // ============================================================
  // 17. quota=0
  // ============================================================

  it('quota=0 → 매수 0주', async () => {
    const ctx = createContext();
    ctx.watchStock.quota = 0;
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  // ============================================================
  // 18. 포지션 보유 중 + 변화 없음
  // ============================================================

  it('포지션 보유 + 수익률 범위 내 + RSI 정상 → 시그널 없음', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 83,
        avgPrice: 60000,
        currentPrice: 63000, // +5%
        totalInvested: 4980000,
      },
      stockIndicators: { currentAboveMA200: true, rsi14: 55 },
    });
    ctx.price.currentPrice = 63000;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  // ============================================================
  // 19. 투자유의/시장경고 진입 차단
  // ============================================================

  it('투자유의 종목 → 매수 차단', async () => {
    const ctx = createContext({
      stockIndicators: { currentAboveMA200: true, rsi14: 35, investCautionYn: true },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('시장경고 종목 (경고) → 매수 차단', async () => {
    const ctx = createContext({
      stockIndicators: { currentAboveMA200: true, rsi14: 35, marketWarnCode: '01' },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('시장경고 코드 00 (정상) → 매수 허용', async () => {
    const ctx = createContext({
      stockIndicators: { currentAboveMA200: true, rsi14: 35, marketWarnCode: '00' },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('BUY');
  });

  // ============================================================
  // 20. 영업이익증가율 필터 (국내 전용)
  // ============================================================

  it('영업이익증가율=-31% (<-30%) → 매수 차단', async () => {
    const ctx = createContext({
      fundamentals: { per: 7, pbr: 0.8, roe: 15, debtRatio: 80, eps: 5000, salesGrowthRate: 5, operatingProfitGrowthRate: -31 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('영업이익증가율=-30% (경계값) → 매수 허용', async () => {
    const ctx = createContext({
      fundamentals: { per: 7, pbr: 0.8, roe: 15, debtRatio: 80, eps: 5000, salesGrowthRate: 5, operatingProfitGrowthRate: -30 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
  });

  // ============================================================
  // 21. EV/EBITDA 필터 (국내 전용)
  // ============================================================

  it('EV/EBITDA=16 (>15) → 매수 차단', async () => {
    const ctx = createContext({
      fundamentals: { per: 7, pbr: 0.8, roe: 15, debtRatio: 80, eps: 5000, salesGrowthRate: 5, evEbitda: 16 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('EV/EBITDA=15 (경계값) → 매수 허용', async () => {
    const ctx = createContext({
      fundamentals: { per: 7, pbr: 0.8, roe: 15, debtRatio: 80, eps: 5000, salesGrowthRate: 5, evEbitda: 15 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
  });

  it('EV/EBITDA=undefined → 체크 스킵, 매수 허용', async () => {
    const ctx = createContext({
      fundamentals: { per: 7, pbr: 0.8, roe: 15, debtRatio: 80, eps: 5000, salesGrowthRate: 5 },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
  });
});
