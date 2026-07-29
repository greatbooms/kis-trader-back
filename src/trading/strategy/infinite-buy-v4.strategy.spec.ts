import { InfiniteBuyV4Strategy } from './infinite-buy-v4.strategy';
import { StockStrategyContext, WatchStockConfig, MarketCondition, StockIndicators } from '../types';
import { StockPriceResult } from '../../kis/types/kis-api.types';

describe('InfiniteBuyV4Strategy', () => {
  let strategy: InfiniteBuyV4Strategy;

  beforeEach(() => {
    strategy = new InfiniteBuyV4Strategy();
  });

  function createContext(overrides: Partial<StockStrategyContext> = {}): StockStrategyContext {
    const defaultWatchStock: WatchStockConfig = {
      id: 'ws-v4-1',
      market: 'OVERSEAS',
      exchangeCode: 'NASD',
      stockCode: 'TQQQ',
      stockName: 'ProShares UltraPro QQQ',
      strategyName: 'infinite-buy-v4',
      quota: 20000,
      cycle: 1,
      maxCycles: 40,
      stopLossRate: 0.5, // v4는 미사용이지만 필드는 공용 타입이라 채워둠
      maxPortfolioRate: 0.2,
      strategyParams: {},
    };

    const defaultPrice: StockPriceResult = {
      stockCode: 'TQQQ',
      stockName: 'ProShares UltraPro QQQ',
      currentPrice: 50,
      openPrice: 49.5,
      highPrice: 51,
      lowPrice: 49,
      volume: 1_000_000,
    };

    const defaultMarketCondition: MarketCondition = {
      referenceIndexAboveMA200: true,
      referenceIndexName: 'NASDAQ',
      interestRateRising: false,
    };

    const defaultStockIndicators: StockIndicators = {
      currentAboveMA200: true,
      prevClose: 49.8,
    };

    return {
      watchStock: defaultWatchStock,
      price: defaultPrice,
      position: undefined,
      alreadyExecutedToday: false,
      marketCondition: defaultMarketCondition,
      stockIndicators: defaultStockIndicators,
      buyableAmount: 20_000,
      totalPortfolioValue: 20_000,
      ...overrides,
    };
  }

  function withV4(ctx: StockStrategyContext, v4: Record<string, any>): StockStrategyContext {
    ctx.watchStock.strategyParams = { ...ctx.watchStock.strategyParams, v4 };
    return ctx;
  }

  describe('기본 거부', () => {
    it('국내 종목이면 skipReason 반환', async () => {
      const ctx = createContext();
      ctx.watchStock.market = 'DOMESTIC';
      const result = await strategy.evaluateStock(ctx);
      expect(result.signals).toHaveLength(0);
      expect(result.skipReasons.some((r) => r.includes('해외'))).toBe(true);
    });

    it('TQQQ/SOXL 외 종목이고 starBasePct 미설정이면 skip (D8)', async () => {
      const ctx = createContext();
      ctx.watchStock.stockCode = 'AAPL';
      const result = await strategy.evaluateStock(ctx);
      expect(result.signals).toHaveLength(0);
      expect(result.skipReasons.some((r) => r.includes('계수'))).toBe(true);
    });

    it('quota 미설정이면 skip', async () => {
      const ctx = createContext();
      ctx.watchStock.quota = 0;
      const result = await strategy.evaluateStock(ctx);
      expect(result.signals).toHaveLength(0);
    });

    it('오늘 이미 실행됐으면 skip', async () => {
      const ctx = createContext({ alreadyExecutedToday: true });
      const result = await strategy.evaluateStock(ctx);
      expect(result.signals).toHaveLength(0);
    });
  });

  describe('수동매매 불일치 (D5)', () => {
    it('T=0인데 broker 보유수량이 있으면 skip + 경고', async () => {
      const ctx = createContext({
        position: { stockCode: 'TQQQ', quantity: 50, avgPrice: 50, currentPrice: 55, totalInvested: 2500 },
      });
      const result = await strategy.evaluateStock(ctx);
      expect(result.signals).toHaveLength(0);
      expect(result.details?.v4LedgerMismatch).toBe(true);
      expect(result.skipReasons.some((r) => r.includes('장부 불일치'))).toBe(true);
    });

    it('T>0인데 broker 보유수량이 0이면 skip + 경고', async () => {
      const ctx = withV4(createContext(), { turn: 5 });
      const result = await strategy.evaluateStock(ctx);
      expect(result.signals).toHaveLength(0);
      expect(result.details?.v4LedgerMismatch).toBe(true);
    });
  });

  describe('수동매매 감지 강화 (F2): lastKnownHoldQty 우선 비교', () => {
    it('lastKnownHoldQty가 실제 보유수량과 일치하면 정상 평가', async () => {
      const ctx = withV4(
        createContext({
          position: { stockCode: 'TQQQ', quantity: 100, avgPrice: 50, currentPrice: 55, totalInvested: 5000 },
        }),
        { turn: 10, cashRemaining: 15000, lastKnownHoldQty: 100 },
      );
      const result = await strategy.evaluateStock(ctx);
      expect(result.details?.v4LedgerMismatch).toBeUndefined();
      expect(result.signals.length).toBeGreaterThan(0);
    });

    it('lastKnownHoldQty가 실제 보유수량과 다르면 T>0/보유 유무가 같아도 skip', async () => {
      // 기존 "T>0 vs 보유 유무" 체크만으로는 25주가 30주로 바뀌어도 (둘 다 "보유 있음") 못 잡는다.
      const ctx = withV4(
        createContext({
          position: { stockCode: 'TQQQ', quantity: 130, avgPrice: 50, currentPrice: 55, totalInvested: 6500 },
        }),
        { turn: 10, cashRemaining: 15000, lastKnownHoldQty: 100 },
      );
      const result = await strategy.evaluateStock(ctx);
      expect(result.signals).toHaveLength(0);
      expect(result.details?.v4LedgerMismatch).toBe(true);
      expect(result.details?.lastKnownHoldQty).toBe(100);
      expect(result.skipReasons.some((r) => r.includes('장부 불일치'))).toBe(true);
    });

    it('lastKnownHoldQty가 없으면 기존 T>0 vs 보유 유무 체크로 fallback', async () => {
      const ctx = withV4(createContext(), { turn: 5 }); // lastKnownHoldQty 미설정, 보유 0
      const result = await strategy.evaluateStock(ctx);
      expect(result.signals).toHaveLength(0);
      expect(result.details?.v4LedgerMismatch).toBe(true);
      expect(result.details?.lastKnownHoldQty).toBeUndefined();
    });
  });

  describe('NORMAL 모드 — 첫 매수 (보유 0, T=0)', () => {
    it('큰 마크업 LOC 1건 + 사다리로 D를 소진한다', async () => {
      const ctx = withV4(createContext(), { turn: 0, cashRemaining: 20000 });
      const result = await strategy.evaluateStock(ctx);

      const firstBuy = result.signals.find((s) => s.metadata?.phase === 'v4-first-buy');
      expect(firstBuy).toBeDefined();
      expect(firstBuy!.price).toBeCloseTo(56, 2); // 50 × 1.12
      expect(firstBuy!.orderDivision).toBe('34');
      expect(firstBuy!.metadata!.fillModel).toBe('loc');
      expect(firstBuy!.metadata!.v4AttemptAmount).toBeCloseTo(firstBuy!.price! * firstBuy!.quantity, 2);

      // D = 20000/40 = 500, firstBuyQty = floor(500/56) = 8 (448 소진), 잔여 52 → 사다리 50.4에 1주
      expect(firstBuy!.quantity).toBe(8);
      const ladderBuys = result.signals.filter((s) => s.metadata?.phase === 'v4-ladder-buy');
      expect(ladderBuys.length).toBeGreaterThan(0);
      expect(ladderBuys[0].price).toBeCloseTo(50.4, 2);
      expect(ladderBuys[0].metadata!.fillModel).toBe('loc');

      // 보유가 없으므로 매도 신호는 없어야 함
      expect(result.signals.some((s) => s.side === 'SELL')).toBe(false);
    });

    it('가용자금(buyableAmount)이 D보다 작으면 매수 예산을 가용자금으로 제한한다', async () => {
      const ctx = withV4(createContext(), { turn: 0, cashRemaining: 20000 });
      ctx.price.currentPrice = 10;
      ctx.buyableAmount = 100; // D = 500 이지만 가용자금은 100
      const result = await strategy.evaluateStock(ctx);

      expect(result.details?.v4BuyableCapApplied).toBe(true);
      expect(result.details?.dailyBuyBudget).toBeCloseTo(500, 2);
      expect(result.details?.dailyBuyBudgetCapped).toBeCloseTo(100, 2);

      const firstBuy = result.signals.find((s) => s.metadata?.phase === 'v4-first-buy');
      expect(firstBuy!.quantity).toBe(8); // floor(100 / 11.2)
    });
  });

  describe('NORMAL 모드 — 전반전 (0 < T < N/2)', () => {
    it('D/2 평단 매수 + D/2 별지점 매수 + 쿼터매도/최종매도를 함께 생성한다', async () => {
      const ctx = withV4(
        createContext({
          position: { stockCode: 'TQQQ', quantity: 100, avgPrice: 50, currentPrice: 55, totalInvested: 5000 },
        }),
        { turn: 10, cashRemaining: 15000 },
      );
      const result = await strategy.evaluateStock(ctx);

      const avgBuy = result.signals.find((s) => s.metadata?.phase === 'v4-avg-buy');
      const starBuy = result.signals.find((s) => s.metadata?.phase === 'v4-star-buy');
      expect(avgBuy).toBeDefined();
      expect(starBuy).toBeDefined();
      expect(avgBuy!.price).toBeCloseTo(50, 2); // 평단 그대로
      // starPct = 15 × (1 − 20/40) = 7.5 → starPrice = 53.75 → buyLimitPrice = 53.74
      expect(starBuy!.price).toBeCloseTo(53.74, 2);

      const quarterSell = result.signals.find((s) => s.metadata?.phase === 'v4-quarter-sell');
      const finalSell = result.signals.find((s) => s.metadata?.phase === 'v4-final-sell');
      expect(quarterSell).toBeDefined();
      expect(quarterSell!.quantity).toBe(25); // floor(100/4)
      expect(quarterSell!.price).toBeCloseTo(53.75, 2); // 별지점(sellLimitPrice)
      expect(quarterSell!.orderDivision).toBe('34');
      expect(quarterSell!.metadata!.v4PrevHolding).toBe(100);

      expect(finalSell).toBeDefined();
      expect(finalSell!.quantity).toBe(75);
      expect(finalSell!.price).toBeCloseTo(57.5, 2); // 50 × 1.15
      expect(finalSell!.orderDivision).toBe('00');
      // 최종매도는 실제 지정가 주문(orderDivision='00')이라 장중 고가 터치로 체결돼야 함 — 종가 전용 loc 아님
      expect(finalSell!.metadata?.fillModel).toBe('limit-touch');
      expect(finalSell!.metadata!.v4PrevHolding).toBe(100);

      // 모든 신호에 fillModel/price가 채워져 있어야 함 (백테스트 엔진 executeCloseFill 계약)
      for (const signal of result.signals) {
        expect(['loc', 'moc', 'limit-touch']).toContain(signal.metadata?.fillModel);
        expect(typeof signal.price).toBe('number');
        if (signal.side === 'BUY') expect(signal.metadata?.v4AttemptAmount).toBeGreaterThan(0);
        if (signal.side === 'SELL') expect(signal.metadata?.v4PrevHolding).toBe(100);
      }
    });
  });

  describe('NORMAL 모드 — 후반전 (N/2 ≤ T ≤ N-1)', () => {
    it('D 전액을 별지점 LOC 매수(+사다리)로만 배정하고, 평단 매수 다리는 없다', async () => {
      const ctx = withV4(
        createContext({
          position: { stockCode: 'TQQQ', quantity: 300, avgPrice: 50, currentPrice: 55, totalInvested: 15000 },
        }),
        { turn: 25, cashRemaining: 5000 },
      );
      const result = await strategy.evaluateStock(ctx);

      expect(result.signals.some((s) => s.metadata?.phase === 'v4-avg-buy')).toBe(false);
      const starBuy = result.signals.find((s) => s.metadata?.phase === 'v4-star-buy');
      expect(starBuy).toBeDefined();
      // starPct = 15 × (1 − 50/40) = −3.75 → starPrice = 48.13 → buyLimitPrice = 48.12
      expect(starBuy!.price).toBeCloseTo(48.12, 2);

      const ladderBuys = result.signals.filter((s) => s.metadata?.phase === 'v4-ladder-buy');
      expect(ladderBuys.length).toBeGreaterThan(0);

      const quarterSell = result.signals.find((s) => s.metadata?.phase === 'v4-quarter-sell');
      const finalSell = result.signals.find((s) => s.metadata?.phase === 'v4-final-sell');
      expect(quarterSell!.quantity).toBe(75); // floor(300/4)
      expect(finalSell!.quantity).toBe(225);
    });
  });

  describe('REVERSE 모드 — 진입 첫날', () => {
    it('보유의 1/(N/2)를 MOC로 무조건 매도하고, 매수는 없다', async () => {
      const ctx = withV4(
        createContext({
          position: { stockCode: 'TQQQ', quantity: 200, avgPrice: 50, currentPrice: 55, totalInvested: 10000 },
        }),
        { turn: 39.5, cashRemaining: 100, mode: 'NORMAL' },
      );
      const result = await strategy.evaluateStock(ctx);

      expect(result.signals).toHaveLength(1);
      const sell = result.signals[0];
      expect(sell.side).toBe('SELL');
      expect(sell.metadata?.phase).toBe('v4-reverse-sell');
      expect(sell.orderDivision).toBe('33'); // MOC
      expect(sell.metadata?.fillModel).toBe('moc');
      expect(sell.quantity).toBe(10); // floor(200/20), M=N/2=20
      expect(sell.metadata?.v4PrevHolding).toBe(200);
      expect(typeof sell.price).toBe('number'); // MOC도 price는 참고용으로 필수

      expect(result.details?.v4StateUpdate?.mode).toBe('REVERSE');
    });
  });

  describe('REVERSE 모드 — 이후 매일', () => {
    it('리버스 별지점(최근 종가 평균) 기준 LOC 매도 + 잔금/4 LOC 매수를 생성한다', async () => {
      const ctx = withV4(
        createContext({
          position: { stockCode: 'TQQQ', quantity: 190, avgPrice: 50, currentPrice: 45, totalInvested: 9500 },
        }),
        {
          turn: 39.5,
          cashRemaining: 400,
          mode: 'REVERSE',
          recentCloses: [
            { date: '2026-07-20', close: 48 },
            { date: '2026-07-21', close: 49 },
            { date: '2026-07-22', close: 47 },
          ],
        },
      );
      ctx.stockIndicators.prevClose = 40; // 회복 임계값(42.5) 미만 → REVERSE 유지
      ctx.now = new Date('2026-07-23T00:00:00Z');

      const result = await strategy.evaluateStock(ctx);

      // recentCloses = [48,49,47,40] → 평균 46
      const sell = result.signals.find((s) => s.metadata?.phase === 'v4-reverse-sell');
      const buy = result.signals.find((s) => s.metadata?.phase === 'v4-reverse-buy');
      expect(sell).toBeDefined();
      expect(sell!.price).toBeCloseTo(46, 2);
      expect(sell!.orderDivision).toBe('34');
      expect(sell!.metadata?.fillModel).toBe('loc');
      expect(sell!.quantity).toBe(9); // floor(190/20)

      expect(buy).toBeDefined();
      expect(buy!.price).toBeCloseTo(45.99, 2);
      expect(buy!.orderDivision).toBe('34');
      expect(buy!.quantity).toBe(2); // floor((400/4)/45.99)

      expect(result.details?.v4StateUpdate?.mode).toBe('REVERSE'); // 아직 회복 안 됨
      expect(result.details?.v4StateUpdate?.recentCloses).toHaveLength(4);
    });

    it('recentCloses가 3개 미만이면 매도/매수 없이 보류하되 상태는 계속 갱신한다', async () => {
      const ctx = withV4(
        createContext({
          position: { stockCode: 'TQQQ', quantity: 50, avgPrice: 50, currentPrice: 45, totalInvested: 2500 },
        }),
        {
          turn: 39.5,
          cashRemaining: 400,
          mode: 'REVERSE',
          recentCloses: [{ date: '2026-07-20', close: 48 }],
        },
      );
      ctx.stockIndicators.prevClose = 40;
      ctx.now = new Date('2026-07-21T00:00:00Z');

      const result = await strategy.evaluateStock(ctx);

      expect(result.signals).toHaveLength(0);
      expect(result.skipReasons.some((r) => r.includes('리버스 별지점'))).toBe(true);
      expect(result.details?.v4StateUpdate?.recentCloses).toHaveLength(2);
    });

    it('종가가 회복 임계값을 넘으면 같은 평가에서 NORMAL로 즉시 복귀한다', async () => {
      const ctx = withV4(
        createContext({
          position: { stockCode: 'TQQQ', quantity: 190, avgPrice: 50, currentPrice: 45, totalInvested: 9500 },
        }),
        {
          turn: 39.5,
          cashRemaining: 400,
          mode: 'REVERSE',
          recentCloses: [
            { date: '2026-07-20', close: 48 },
            { date: '2026-07-21', close: 49 },
            { date: '2026-07-22', close: 47 },
          ],
        },
      );
      // 회복 임계값 = 50 × (1 − 15/100) = 42.5, prevClose=43 > 42.5 → NORMAL 복귀
      ctx.stockIndicators.prevClose = 43;
      ctx.now = new Date('2026-07-23T00:00:00Z');

      const result = await strategy.evaluateStock(ctx);

      expect(result.details?.mode).toBe('NORMAL');
      expect(result.details?.v4StateUpdate?.mode).toBe('NORMAL');
      // NORMAL 복귀 후 이 평가에서 바로 NORMAL 규칙(전반전/후반전)으로 신호가 구성돼야 함
      expect(result.signals.some((s) => s.metadata?.phase === 'v4-reverse-sell')).toBe(false);
    });
  });
});
