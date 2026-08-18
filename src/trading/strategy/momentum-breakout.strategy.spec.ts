import { MomentumBreakoutStrategy } from './momentum-breakout.strategy';
import { Broker } from '@prisma/client';
import {
  StockStrategyContext,
  WatchStockConfig,
  MarketCondition,
  StockIndicators,
  RiskState,
} from '../types';
import { StockPriceResult } from '../../kis/types/kis-api.types';

/**
 * 당일청산 변동성 돌파 전략 테스트.
 * 시간 의존 로직(진입 윈도우, 당일청산)은 ctx.now 주입으로 결정적으로 검증한다.
 */
describe('MomentumBreakoutStrategy (당일청산 변동성 돌파)', () => {
  let strategy: MomentumBreakoutStrategy;

  /** 2026-06-10(수) KST hh:mm 시각 생성 */
  function kst(hour: number, minute: number): Date {
    return new Date(Date.UTC(2026, 5, 10, hour - 9, minute));
  }

  const TODAY = '2026-06-10';
  const YESTERDAY = '2026-06-09';

  beforeEach(() => {
    strategy = new MomentumBreakoutStrategy();
  });

  /**
   * 기본 컨텍스트: 진입 조건 전부 충족 상태 (10:00 KST).
   * - 돌파가 = 69000 + (71000-67000)×0.5 = 71000
   * - 현재가 71500: 돌파 충족 + 추격 가드(71000×1.01=71710) 이내
   * - soft 4개 모두 평가 가능 + 충족:
   *   ① 71500 > MA20(70000) ② 거래량 1.2M ≥ 2M×(60/390)≈0.31M
   *   ③ VWAP = 84e9/1.2e6 = 70000 ≤ 71500 ④ 외인 순매수
   */
  function createContext(
    overrides: Partial<StockStrategyContext> = {},
  ): StockStrategyContext {
    const defaultWatchStock: WatchStockConfig = {
      id: 'ws-1',
      broker: Broker.KIS,
      market: 'DOMESTIC',
      exchangeCode: 'KRX',
      stockCode: '005930',
      stockName: '삼성전자',
      strategyName: 'momentum-breakout',
      quota: 1000000,
      cycle: 1,
      maxCycles: 40,
      stopLossRate: 0.3,
      maxPortfolioRate: 0.15,
    };

    const defaultPrice: StockPriceResult = {
      stockCode: '005930',
      stockName: '삼성전자',
      currentPrice: 71500,
      openPrice: 69000,
      highPrice: 71600,
      lowPrice: 68800,
      volume: 1200000,
      tradingValue: 84000000000,
    } as StockPriceResult;

    const defaultMarketCondition: MarketCondition = {
      referenceIndexAboveMA200: true,
      referenceIndexName: 'KOSPI',
      interestRateRising: false,
    };

    const defaultStockIndicators: StockIndicators = {
      currentAboveMA200: true,
      ma200: 65000,
      ma20: 70000,
      rsi14: 60,
      avgVolume20: 2000000,
      prevHigh: 71000,
      prevLow: 67000,
      todayOpen: 69000,
      foreignNetBuy: true,
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
      now: kst(10, 0),
      ...overrides,
    };
  }

  function withPosition(
    overrides: Partial<StockStrategyContext> = {},
    position?: Partial<NonNullable<StockStrategyContext['position']>>,
    entryDate: string | undefined = TODAY,
  ): StockStrategyContext {
    const ctx = createContext(overrides);
    ctx.position = {
      stockCode: '005930',
      quantity: 13,
      avgPrice: 71500,
      currentPrice: ctx.price.currentPrice,
      totalInvested: 71500 * 13,
      ...position,
    };
    if (entryDate !== undefined) {
      ctx.watchStock.strategyParams = {
        ...(ctx.watchStock.strategyParams ?? {}),
        entryDate,
      };
    }
    return ctx;
  }

  // ============================================================
  // 기본 가드
  // ============================================================

  describe('basic guards', () => {
    it('현재가 0 → 시그널 없음', async () => {
      const ctx = createContext();
      ctx.price.currentPrice = 0;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('현재가 음수 → 시그널 없음', async () => {
      const ctx = createContext();
      ctx.price.currentPrice = -100;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('해외 종목 → 진입 안 함 (국내 전용)', async () => {
      const ctx = createContext();
      ctx.watchStock.market = 'OVERSEAS';
      ctx.watchStock.exchangeCode = 'NASD';
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });
  });

  // ============================================================
  // 진입
  // ============================================================

  describe('진입 (변동성 돌파)', () => {
    it('모든 조건 충족 → 시장가 매수', async () => {
      const ctx = createContext();
      const { signals } = await strategy.evaluateStock(ctx);

      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('BUY');
      expect(signals[0].price).toBeUndefined(); // 시장가
      expect(signals[0].quantity).toBe(Math.floor(1000000 / 71500)); // 13
      expect(signals[0].metadata?.phase).toBe('vb-entry');
      expect(signals[0].metadata?.breakoutPrice).toBe(71000);
      expect(signals[0].reason).toContain('변동성돌파');
    });

    it('돌파가 경계: 현재가 == 돌파가 → 매수', async () => {
      const ctx = createContext();
      ctx.price.currentPrice = 71000;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('BUY');
    });

    it('돌파 미달 → 관망', async () => {
      const ctx = createContext();
      ctx.price.currentPrice = 70900;
      const { signals, skipReasons } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
      expect(skipReasons.some((r) => r.startsWith('관망'))).toBe(true);
    });

    it('추격 가드: 돌파가 +1% 초과 → 관망', async () => {
      const ctx = createContext();
      ctx.price.currentPrice = 72000; // > 71000 × 1.01 = 71710
      const { signals, skipReasons } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
      expect(skipReasons.some((r) => r.includes('추격'))).toBe(true);
    });

    it('진입 윈도우 이전(09:03) → 관망', async () => {
      const ctx = createContext({ now: kst(9, 3) });
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('진입 윈도우 이후(14:31) → 관망', async () => {
      const ctx = createContext({ now: kst(14, 31) });
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('진입 윈도우 경계(09:05, 14:30) → 매수 허용', async () => {
      // 09:05 — elapsedFraction이 작아 시간보정 거래량 기준도 낮아짐
      const ctxStart = createContext({ now: kst(9, 5) });
      const { signals: s1 } = await strategy.evaluateStock(ctxStart);
      expect(s1).toHaveLength(1);

      const ctxEnd = createContext({ now: kst(14, 30) });
      const { signals: s2 } = await strategy.evaluateStock(ctxEnd);
      expect(s2).toHaveLength(1);
    });

    it('RSI 75 초과 → 관망', async () => {
      const ctx = createContext();
      ctx.stockIndicators.rsi14 = 76;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('RSI undefined → 차단하지 않음', async () => {
      const ctx = createContext();
      ctx.stockIndicators.rsi14 = undefined;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
    });

    it('전일 변동폭 0 → 진입 안 함 (돌파 의미 없음)', async () => {
      const ctx = createContext();
      ctx.stockIndicators.prevHigh = 70000;
      ctx.stockIndicators.prevLow = 70000;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('prevHigh/prevLow 부재 → 진입 안 함', async () => {
      const ctx = createContext();
      ctx.stockIndicators.prevHigh = undefined;
      ctx.stockIndicators.prevLow = undefined;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('시가는 fresh price.openPrice 우선', async () => {
      const ctx = createContext();
      // 캐시된 indicators.todayOpen(69000)이 잘못돼도 fresh openPrice 사용
      ctx.stockIndicators.todayOpen = 50000;
      ctx.price.openPrice = 69000;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].metadata?.breakoutPrice).toBe(71000);
    });

    it('price.openPrice가 0이면 indicators.todayOpen으로 fallback', async () => {
      const ctx = createContext();
      ctx.price.openPrice = 0;
      ctx.stockIndicators.todayOpen = 69000;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
    });

    it('시가 정보 전무 → 진입 안 함', async () => {
      const ctx = createContext();
      ctx.price.openPrice = 0;
      ctx.stockIndicators.todayOpen = undefined;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('오늘 이미 체결 이력 → 재진입 금지 (1일 1진입)', async () => {
      const ctx = createContext({ alreadyExecutedToday: true });
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('미체결 매수 주문 존재 → 중복 진입 금지', async () => {
      const ctx = createContext({ hasOpenBuyOrder: true });
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('미체결 매도 주문 존재 → 진입 금지', async () => {
      const ctx = createContext({ hasOpenSellOrder: true });
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('riskState.buyBlocked → 진입 차단', async () => {
      const riskState: RiskState = {
        buyBlocked: true,
        liquidateAll: false,
        positionCount: 3,
        investedRate: 0.5,
        dailyPnlRate: 0,
        drawdown: -0.09,
        reasons: ['MDD -9%'],
      };
      const ctx = createContext({ riskState });
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('투자유의 종목 → 진입 차단', async () => {
      const ctx = createContext();
      ctx.stockIndicators.investCautionYn = true;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('시장경고 종목 → 진입 차단', async () => {
      const ctx = createContext();
      ctx.stockIndicators.marketWarnCode = '01';
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('단기과열 종목 → 진입 차단', async () => {
      const ctx = createContext();
      ctx.stockIndicators.shortOverheatYn = true;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('단일 종목 비중 15% 초과 → 진입 차단', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 0,
          avgPrice: 71500,
          currentPrice: 71500,
          totalInvested: 2000000, // 20% > 15%
        },
        totalPortfolioValue: 10000000,
      });
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('buyableAmount가 quota보다 작으면 buyableAmount 기준 수량', async () => {
      const ctx = createContext({ buyableAmount: 200000 });
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].quantity).toBe(Math.floor(200000 / 71500)); // 2
    });

    it('quota 0 → 진입 안 함', async () => {
      const ctx = createContext();
      ctx.watchStock.quota = 0;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('1주도 못 사는 금액 → 진입 안 함', async () => {
      const ctx = createContext({ buyableAmount: 100 });
      ctx.watchStock.quota = 100;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });
  });

  // ============================================================
  // MA20 추세 필터 (hard)
  // ============================================================
  // 2023-06~2026-05 일봉 레짐 분석: K=0.5 돌파 거래의 gross 엣지가
  // MA20 위에서만 유의 (005930 +0.176% vs +0.007%, 122630 +0.110% vs -0.032%)
  // → soft 채점이 아닌 hard 필터로 적용한다.

  describe('MA20 추세 필터 (hard)', () => {
    it('현재가 ≤ MA20 → 진입 차단', async () => {
      const ctx = createContext();
      ctx.stockIndicators.ma20 = 73000; // 71500 ≤ 73000
      const { signals, skipReasons } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
      expect(skipReasons.some((r) => r.includes('MA20'))).toBe(true);
    });

    it('MA20 데이터 부재 시 차단하지 않음', async () => {
      const ctx = createContext();
      ctx.stockIndicators.ma20 = undefined;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
    });

    it('useMa20Filter=false면 MA20 아래에서도 진입', async () => {
      const ctx = createContext();
      ctx.watchStock.strategyParams = { useMa20Filter: false };
      ctx.stockIndicators.ma20 = 73000;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
    });
  });

  // ============================================================
  // Soft 조건 채점 (시간보정 거래량 / VWAP / 수급)
  // ============================================================

  describe('soft 조건 채점', () => {
    it('3개 평가 가능 중 1개만 충족 → 관망', async () => {
      const ctx = createContext();
      ctx.price.volume = 100000; // ① fail (100000 < 2M×0.1538)
      ctx.price.tradingValue = 7200000000; // ② VWAP=72000 > 71500 → fail
      ctx.stockIndicators.foreignNetBuy = true; // ③ pass
      const { signals, skipReasons } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
      expect(skipReasons.some((r) => r.includes('soft'))).toBe(true);
    });

    it('3개 중 정확히 2개 충족 → 진입', async () => {
      const ctx = createContext();
      ctx.price.volume = 100000; // ① fail
      // ② VWAP: 100000주 × 평균 70000 = 7e9 → VWAP 70000 ≤ 71500 pass
      ctx.price.tradingValue = 7000000000;
      ctx.stockIndicators.foreignNetBuy = true; // ③ pass
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
    });

    it('평가 가능 항목이 1개뿐이면 1개 충족으로 진입', async () => {
      const ctx = createContext();
      ctx.stockIndicators.avgVolume20 = undefined; // ① 평가 불가
      ctx.price.tradingValue = undefined; // ② 평가 불가
      // ③ 수급만 평가 가능 + 충족 (foreignNetBuy=true)
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
    });

    it('평가 가능 항목 0개 → 진입 차단 (fail-closed — 데이터 공백 시 시장가 매수 금지)', async () => {
      // 거래량 0/거래대금 없음/수급 없음이 동시에 발생하는 상태는
      // 거래정지·API 이상 등 비정상 — 정보 없이 시장가 매수하지 않는다.
      const ctx = createContext();
      ctx.stockIndicators.avgVolume20 = undefined;
      ctx.price.tradingValue = undefined;
      ctx.stockIndicators.foreignNetBuy = undefined;
      const { signals, skipReasons } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
      expect(skipReasons.some((r) => r.includes('soft'))).toBe(true);
    });

    it('수급: 프로그램 매도 방향이면 미충족으로 집계', async () => {
      const ctx = createContext();
      ctx.stockIndicators.foreignNetBuy = undefined;
      ctx.stockIndicators.institutionNetBuy = undefined;
      ctx.stockIndicators.programTradeDirection = 'SELL';
      // soft: ① pass ② pass ③ fail → 2/3 ≥ 2 → 진입은 됨
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
    });

    it('시간보정 거래량: 장 초반엔 낮은 기준 적용', async () => {
      // 09:10 — 경과 10분, 기준 = 2M × (10/390) ≈ 51,282주
      const ctx = createContext({ now: kst(9, 10) });
      ctx.price.volume = 60000; // 기준 통과
      ctx.price.tradingValue = 4200000000; // VWAP=70000 ≤ 71500 pass
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
    });

    it('minSoftConditions 커스텀: 3 요구 시 2개 충족이면 관망', async () => {
      const ctx = createContext();
      ctx.watchStock.strategyParams = { minSoftConditions: 3 };
      ctx.price.volume = 100000; // ① fail, ②③ pass
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('minSoftConditions 비정상 값(0)은 기본값(2)으로 보정 — fail-closed 우회 금지', async () => {
      const ctx = createContext();
      ctx.watchStock.strategyParams = { minSoftConditions: 0 };
      ctx.price.volume = 100000; // ① fail
      ctx.price.tradingValue = 7200000000; // ② VWAP 72000 > 71500 → fail
      ctx.stockIndicators.foreignNetBuy = true; // ③ pass — 1/3 < 2
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('minSoftConditions 비정상 값(0)이어도 기본 요구치(2) 충족 시 진입', async () => {
      const ctx = createContext();
      ctx.watchStock.strategyParams = { minSoftConditions: 0 };
      // 기본 ctx: ①②③ 모두 충족 (3/3 ≥ 2)
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
    });
  });

  // ============================================================
  // 청산 (포지션 보유)
  // ============================================================

  describe('청산', () => {
    it('손절: -2% 이하 → 시장가 전량 매도', async () => {
      const ctx = withPosition({}, { currentPrice: 70000 });
      ctx.price.currentPrice = 70000; // (70000-71500)/71500 = -2.1%
      const { signals } = await strategy.evaluateStock(ctx);

      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('SELL');
      expect(signals[0].quantity).toBe(13);
      expect(signals[0].price).toBeUndefined(); // 시장가
      expect(signals[0].metadata?.phase).toBe('intraday-stop');
      expect(signals[0].reason).toContain('손절');
      // 수동 승인 게이트(TradingService.isStopLossSignal) 우회 보장
      expect(signals[0].reason.toLowerCase()).not.toContain('stop loss');
    });

    it('손실 -1% 수준 → 청산 안 함', async () => {
      const ctx = withPosition({}, { currentPrice: 70900 });
      ctx.price.currentPrice = 70900;
      ctx.price.highPrice = 71500;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('트레일링: 진입 후 고가 대비 -2% → 전량 매도', async () => {
      const ctx = withPosition({}, { currentPrice: 73500 });
      ctx.price.currentPrice = 73500;
      ctx.price.highPrice = 75500; // 75500×0.98 = 73990 > 73500
      ctx.watchStock.strategyParams = {
        ...(ctx.watchStock.strategyParams ?? {}),
        entryDayHigh: 71600, // 진입 시점 고가 < 75500 → 진입 후 형성된 고가로 인정
      };
      const { signals } = await strategy.evaluateStock(ctx);

      expect(signals).toHaveLength(1);
      expect(signals[0].metadata?.phase).toBe('trailing-stop');
      expect(signals[0].reason.toLowerCase()).not.toContain('stop loss');
    });

    it('트레일링: 진입 전 스파이크(고가 ≤ entryDayHigh)는 기준으로 쓰지 않음', async () => {
      // 아침 스파이크 75500 후 눌림에서 진입한 케이스 — 구버전은 세션 고가 기준으로
      // 진입 직후 즉시 트레일링이 오발동했다 (75500×0.98 = 73990 > 71500)
      const ctx = withPosition({}, { currentPrice: 71500 });
      ctx.price.currentPrice = 71500; // 평단 부근 (손절 미해당)
      ctx.price.highPrice = 75500;
      ctx.watchStock.strategyParams = {
        ...(ctx.watchStock.strategyParams ?? {}),
        entryDayHigh: 75500, // 진입 시점에 이미 형성된 고가 — 진입 후 신고가 없음
      };
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('트레일링: entryDayHigh 기록 없으면 미발동 (수동/레거시 포지션은 손절만 동작)', async () => {
      const ctx = withPosition({}, { currentPrice: 71000 });
      ctx.price.currentPrice = 71000; // -0.7% (손절 미해당)
      ctx.price.highPrice = 75500;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('트레일링 비활성화 시 미발동', async () => {
      const ctx = withPosition({}, { currentPrice: 73500 });
      ctx.watchStock.strategyParams = {
        ...(ctx.watchStock.strategyParams ?? {}),
        trailingStopEnabled: false,
      };
      ctx.price.currentPrice = 73500;
      ctx.price.highPrice = 75500;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('highPrice 0이면 트레일링 미발동', async () => {
      const ctx = withPosition({}, { currentPrice: 71600 });
      ctx.price.currentPrice = 71600;
      ctx.price.highPrice = 0;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('익절: 기본 비활성 — +5%여도 청산 안 함', async () => {
      const ctx = withPosition({}, { currentPrice: 75100 });
      ctx.price.currentPrice = 75100; // +5.03%
      ctx.price.highPrice = 75100; // 트레일링 미발동
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('익절: 활성화 + 도달 → 전량 매도', async () => {
      const ctx = withPosition({}, { currentPrice: 73700 });
      ctx.watchStock.strategyParams = {
        ...(ctx.watchStock.strategyParams ?? {}),
        takeProfitEnabled: true,
        takeProfitRate: 0.03,
      };
      ctx.price.currentPrice = 73700; // +3.08%
      ctx.price.highPrice = 73700;
      const { signals } = await strategy.evaluateStock(ctx);

      expect(signals).toHaveLength(1);
      expect(signals[0].metadata?.phase).toBe('take-profit');
    });

    it('당일청산: 15:10 도달 → 전량 매도', async () => {
      const ctx = withPosition({ now: kst(15, 10) }, { currentPrice: 71600 });
      ctx.price.currentPrice = 71600;
      ctx.price.highPrice = 71600;
      const { signals } = await strategy.evaluateStock(ctx);

      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('SELL');
      expect(signals[0].quantity).toBe(13);
      expect(signals[0].metadata?.phase).toBe('eod-exit');
      expect(signals[0].reason).toContain('당일청산');
    });

    it('당일청산: 15:09에는 미발동', async () => {
      const ctx = withPosition({ now: kst(15, 9) }, { currentPrice: 71600 });
      ctx.price.currentPrice = 71600;
      ctx.price.highPrice = 71600;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('이월청산: entryDate가 어제면 즉시 전량 매도', async () => {
      const ctx = withPosition({}, { currentPrice: 71600 }, YESTERDAY);
      ctx.price.currentPrice = 71600;
      ctx.price.highPrice = 71600;
      const { signals } = await strategy.evaluateStock(ctx);

      expect(signals).toHaveLength(1);
      expect(signals[0].metadata?.phase).toBe('carryover-exit');
      expect(signals[0].reason).toContain('이월청산');
    });

    it('entryDate 없는 포지션은 당일 포지션으로 간주 (15:10 당일청산)', async () => {
      const ctx = withPosition({ now: kst(15, 10) }, { currentPrice: 71600 }, undefined);
      ctx.price.currentPrice = 71600;
      ctx.price.highPrice = 71600;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].metadata?.phase).toBe('eod-exit');
    });

    it('현재가 0이어도 당일청산(15:10)은 발행 — 시세 이상이 강제청산을 막지 않음', async () => {
      // KIS 시세 글리치(현재가 0)가 15:10 강제 청산을 막으면 포지션이 밤을 넘긴다.
      // 강제 청산은 시장가라 현재가가 필요 없다.
      const ctx = withPosition({ now: kst(15, 10) }, { currentPrice: 0 });
      ctx.price.currentPrice = 0;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].metadata?.phase).toBe('eod-exit');
      expect(signals[0].quantity).toBe(13);
      expect(signals[0].price).toBeUndefined(); // 시장가
    });

    it('현재가 0이어도 이월청산은 발행', async () => {
      const ctx = withPosition({ now: kst(9, 6) }, { currentPrice: 0 }, YESTERDAY);
      ctx.price.currentPrice = 0;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].metadata?.phase).toBe('carryover-exit');
    });

    it('현재가 0이면 가격의존 청산(손절/트레일링)은 보류 — 오판 시장가 매도 방지', async () => {
      // curPrice=0이 그대로 흘러가면 손절식이 -100%로 오판되어 잘못된 전량 매도가 나간다
      const ctx = withPosition({ now: kst(11, 0) }, { currentPrice: 0 });
      ctx.price.currentPrice = 0;
      ctx.watchStock.strategyParams = {
        ...(ctx.watchStock.strategyParams ?? {}),
        entryDayHigh: 71600,
      };
      const { signals, skipReasons } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
      expect(skipReasons.some((r) => r.includes('보류'))).toBe(true);
    });

    it('미체결 매도 주문 존재 → 일반 청산(손절)은 중복 매도 금지', async () => {
      const ctx = withPosition(
        { hasOpenSellOrder: true },
        { currentPrice: 70000 },
      );
      ctx.price.currentPrice = 70000; // -2.1% 손절 조건
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('미체결 매도 주문이 있어도 당일청산(15:10)은 발행 — 오버나잇 방지가 우선', async () => {
      // stale 미체결 SELL(수동 지정가 등)이 가드를 영구 점유하면 포지션이 밤을 넘긴다.
      // 강제 청산은 우회하고, 중복 제출은 KIS 주문가능수량 검증에서 거부된다.
      const ctx = withPosition(
        { now: kst(15, 10), hasOpenSellOrder: true },
        { currentPrice: 71600 },
      );
      ctx.price.currentPrice = 71600;
      ctx.price.highPrice = 71600;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].metadata?.phase).toBe('eod-exit');
    });

    it('미체결 매도 주문이 있어도 이월청산은 발행', async () => {
      const ctx = withPosition(
        { hasOpenSellOrder: true },
        { currentPrice: 71600 },
        YESTERDAY,
      );
      ctx.price.currentPrice = 71600;
      ctx.price.highPrice = 71600;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].metadata?.phase).toBe('carryover-exit');
    });

    it('미체결 매수 주문은 청산을 막지 않음', async () => {
      const ctx = withPosition(
        { hasOpenBuyOrder: true },
        { currentPrice: 70000 },
      );
      ctx.price.currentPrice = 70000; // -2.1% 손절
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].metadata?.phase).toBe('intraday-stop');
    });
  });

  // ============================================================
  // 청산 우선순위
  // ============================================================

  describe('청산 우선순위', () => {
    it('MDD 전량청산이 최우선 (미체결 매도 가드도 우회)', async () => {
      const riskState: RiskState = {
        buyBlocked: true,
        liquidateAll: true,
        positionCount: 1,
        investedRate: 0.5,
        dailyPnlRate: -0.05,
        drawdown: -0.13,
        reasons: ['MDD -13%'],
      };
      const ctx = withPosition(
        { riskState, hasOpenSellOrder: true },
        { currentPrice: 70000 },
      );
      ctx.price.currentPrice = 70000; // 손절 조건도 충족
      const { signals } = await strategy.evaluateStock(ctx);

      expect(signals).toHaveLength(1);
      expect(signals[0].reason).toContain('리스크 전량청산');
    });

    it('이월청산이 손절보다 우선', async () => {
      const ctx = withPosition({}, { currentPrice: 70000 }, YESTERDAY);
      ctx.price.currentPrice = 70000; // -2.1% 손절 조건도 충족
      const { signals } = await strategy.evaluateStock(ctx);

      expect(signals).toHaveLength(1);
      expect(signals[0].metadata?.phase).toBe('carryover-exit');
    });

    it('손절이 트레일링보다 우선', async () => {
      const ctx = withPosition({}, { currentPrice: 69000 });
      ctx.price.currentPrice = 69000; // -3.5%
      ctx.price.highPrice = 75000; // 트레일링 조건도 충족
      ctx.watchStock.strategyParams = {
        ...(ctx.watchStock.strategyParams ?? {}),
        entryDayHigh: 71600, // 트레일링이 실제로 armed 상태인지 보장
      };
      const { signals } = await strategy.evaluateStock(ctx);

      expect(signals).toHaveLength(1);
      expect(signals[0].metadata?.phase).toBe('intraday-stop');
    });
  });

  // ============================================================
  // 커스텀 파라미터
  // ============================================================

  describe('커스텀 파라미터', () => {
    it('kValue 커스텀: 더 높은 돌파 기준', async () => {
      const ctx = createContext();
      ctx.watchStock.strategyParams = { kValue: 0.7 };
      // 돌파가 = 69000 + 4000×0.7 = 71800 > 현재가 71500
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('stopLossRate 커스텀: -5%로 확장', async () => {
      const ctx = withPosition({}, { currentPrice: 70000 });
      ctx.watchStock.strategyParams = {
        ...(ctx.watchStock.strategyParams ?? {}),
        stopLossRate: 0.05,
      };
      ctx.price.currentPrice = 70000; // -2.1%, 기준 -5%엔 미달
      ctx.price.highPrice = 70000; // 트레일링 간섭 제거
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('exitTime 커스텀: 14:00 당일청산', async () => {
      const ctx = withPosition({ now: kst(14, 0) }, { currentPrice: 71600 });
      ctx.watchStock.strategyParams = {
        ...(ctx.watchStock.strategyParams ?? {}),
        exitTime: '14:00',
      };
      ctx.price.currentPrice = 71600;
      ctx.price.highPrice = 71600;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].metadata?.phase).toBe('eod-exit');
    });

    it('maxChaseRate 커스텀: 3% 추격 허용', async () => {
      const ctx = createContext();
      ctx.watchStock.strategyParams = { maxChaseRate: 0.03 };
      ctx.price.currentPrice = 72000; // 71000×1.03=73130 이내
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
    });
  });

  // ============================================================
  // daily-bar 모드 (백테스트)
  // ============================================================

  describe('daily-bar 모드 (백테스트)', () => {
    function createDailyBarContext(
      overrides: Partial<StockStrategyContext> = {},
    ): StockStrategyContext {
      const ctx = createContext({
        evaluationMode: 'daily-bar',
        now: undefined,
        ...overrides,
      });
      // 백테스트 엔진 ctx 근사: 시가 기준 평가, 장중 시세 정보 없음
      ctx.price.currentPrice = 69000;
      ctx.price.openPrice = 69000;
      ctx.price.tradingValue = undefined;
      ctx.stockIndicators.ma20 = 68000; // MA20 hard 필터 통과 (69000 > 68000)
      return ctx;
    }

    it('진입 조건 충족 → stop-entry 조건부 매수 신호', async () => {
      const ctx = createDailyBarContext();
      const { signals } = await strategy.evaluateStock(ctx);

      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('BUY');
      expect(signals[0].price).toBe(71000); // 돌파가 지정
      expect(signals[0].quantity).toBe(Math.floor(1000000 / 71000)); // 14
      expect(signals[0].metadata?.fillModel).toBe('stop-entry');
      expect(signals[0].metadata?.exitModel).toBe('eod');
      // 가격이 아닌 rate 전달 — 엔진이 실제 체결가(슬리피지 포함) 기준으로 계산
      expect(signals[0].metadata?.stopLossRate).toBe(0.02);
      expect(signals[0].metadata?.takeProfitRate).toBeUndefined(); // 기본 off
    });

    it('익절 활성화 시 takeProfitRate 포함', async () => {
      const ctx = createDailyBarContext();
      ctx.watchStock.strategyParams = {
        takeProfitEnabled: true,
        takeProfitRate: 0.05,
      };
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].metadata?.takeProfitRate).toBe(0.05);
    });

    it('RSI 과열 → 신호 없음', async () => {
      const ctx = createDailyBarContext();
      ctx.stockIndicators.rsi14 = 80;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('MA20 아래 → 신호 없음 (hard 필터는 daily-bar에도 적용)', async () => {
      const ctx = createDailyBarContext();
      ctx.stockIndicators.ma20 = 69500; // 시가 69000 ≤ 69500
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('포지션 보유 시 신호 없음 (엔진이 동일 bar 청산 처리)', async () => {
      const ctx = createDailyBarContext({
        position: {
          stockCode: '005930',
          quantity: 10,
          avgPrice: 71000,
          currentPrice: 69000,
          totalInvested: 710000,
        },
      });
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('riskState.buyBlocked → 신호 없음', async () => {
      const ctx = createDailyBarContext({
        riskState: {
          buyBlocked: true,
          liquidateAll: false,
          positionCount: 0,
          investedRate: 0,
          dailyPnlRate: 0,
          drawdown: -0.3,
          reasons: ['MDD'],
        },
      });
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('meta MDD 매수차단(-8%)은 daily-bar에서 미적용 (단일 전략 equity의 영구 잠금 방지)', async () => {
      // 백테스트에서는 거래가 멈추면 드로다운이 회복될 수 없어 -8% 차단이
      // absorbing state가 된다. 실거래의 포트폴리오 MDD와 달리 의미가 없으므로
      // daily-bar 모드에서는 엔진의 riskState.buyBlocked(-25% 파국 방지선)만 따른다.
      const ctx = createDailyBarContext({
        riskState: {
          buyBlocked: false, // 엔진 기준(-25%)으로는 차단 아님
          liquidateAll: false,
          positionCount: 0,
          investedRate: 0,
          dailyPnlRate: 0,
          drawdown: -0.1, // meta.mddBuyBlock(-8%)보다 깊은 드로다운
          reasons: [],
        },
      });
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
    });
  });
});
