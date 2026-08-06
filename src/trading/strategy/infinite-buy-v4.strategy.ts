import { Injectable, Logger } from '@nestjs/common';
import {
  PerStockTradingStrategy,
  StockStrategyContext,
  TradingSignal,
  StrategyEvaluationResult,
  ExecutionMode,
  StrategyMeta,
  InfiniteBuyV4Params,
  InfiniteBuyV4Mode,
  InfiniteBuyV4RecentClose,
} from '../types';
import {
  allocateLadderOrders,
  calculateDailyBuyBudget,
  calculateStarPoint,
  roundToCent,
  shouldEnterReverseMode,
  shouldExitReverseMode,
  StarPointResult,
} from './infinite-buy-v4-math.util';

/**
 * 원본 방법론이 TQQQ/SOXL 전제로 튜닝된 계수 — 다른 종목은 strategyParams.v4.starBasePct 명시 필요 (D8).
 * `WatchStockService.convertToInfiniteBuyV4`도 동일 표를 참조 — 중복 정의 금지.
 */
export const DEFAULT_STAR_BASE_PCT_BY_STOCK: Record<string, number> = {
  TQQQ: 15,
  SOXL: 20,
};
const DEFAULT_FIRST_BUY_MARKUP_PCT = 0.12;
const DEFAULT_MAX_BUY_PREMIUM_PCT = 0.1;
const DEFAULT_LADDER_STEPS_PCT = [0.05, 0.1, 0.15];
const MAX_RECENT_CLOSES = 5;
const MIN_RECENT_CLOSES_FOR_REVERSE = 3;

// KIS 해외주식 주문 API(TTTT1002U 매수/TTTT1006U 매도)의 ord_dvsn 코드값 기준
// (출처: kis-code-assistant MCP 데이터셋, 해외주식 주문 API 필드 설명).
// 34=LOC(장마감지정가)는 매수/매도 공통. 33=MOC(장마감시장가)는 매도에만 존재 —
// V4에서도 MOC는 리버스 진입 첫날 매도에만 쓰이므로 매수 측 MOC 코드는 필요 없다.
const LOC_ORDER_DIVISION = '34';
const LIMIT_ORDER_DIVISION = '00';
const MOC_SELL_ORDER_DIVISION = '33';

interface ResolvedCoefficients {
  starBasePct: number;
  finalTargetPct: number;
  firstBuyMarkupPct: number;
  maxBuyPremiumPct: number;
  ladderStepsPct: number[];
  compoundMode: boolean;
}

interface BuildResult {
  signals: TradingSignal[];
  skipReasons: string[];
  details: Record<string, any>;
}

@Injectable()
export class InfiniteBuyV4Strategy implements PerStockTradingStrategy {
  readonly name = 'infinite-buy-v4';
  readonly displayName = '무한매수법 V4';
  readonly executionMode: ExecutionMode = {
    type: 'once-daily',
    hours: { domestic: 11, overseas: { basis: 'afterOpen', offsetHours: 2 } },
  };
  readonly description = [
    '라오어 무한매수법 V4.0 원본 규칙을 그대로 따르는 해외(미국) 전용 전략입니다.',
    '기존 "무한매수법"과는 별개 전략이며, 3배 레버리지 ETF(TQQQ/SOXL) 전제로 튜닝된 계수를 사용합니다.',
    '',
    '【NORMAL 모드】',
    '- 매일 1회 LOC(장마감지정가) 매수: 첫 매수는 큰 마크업 1건, 이후엔 평단/별지점 분할 + 사다리(폭락 대비 저가 예비주문)',
    '- 매일 쿼터매도(보유의 1/4, 별지점) + 최종매도(평단 대비 목표수익률, 지정가)를 함께 제출',
    '- 별지점 = 평단 × (1 + starBasePct × (1 − 2T/N)/100) — 회차(T)가 절반을 넘으면 별%가 음수로 전환되어 쿼터매도가 사실상 손절이 됩니다 (의도된 규칙)',
    '',
    '【REVERSE 모드 (T > N-1, 원금 소진 후)】',
    '- 손절 대신 리버스 모드로 전환: 진입 첫날은 보유의 1/(N/2)를 MOC(장마감시장가)로 무조건 매도',
    '- 이후 매일은 최근 5거래일 종가 평균("리버스 별지점")을 기준으로 LOC 매도 + 잔금의 1/4로 LOC 매수',
    '- 종가가 평단 대비 (1 − finalTargetPct%) 선을 회복하면 NORMAL로 복귀 (T/잔금/평단은 그대로 이어짐)',
    '',
    '【특징】',
    '- stopLossRate 미사용 — REVERSE 모드가 손절을 대체 (하락 시에도 매수를 이어간다는 철학은 유지)',
    '- 사이클(T)/잔금 회계는 체결 확정 시점에만 갱신 — 신호 생성 시점에는 갱신하지 않음',
    '- 수동 매매로 broker 보유수량과 v4 장부(T)가 어긋나면 자동 흡수하지 않고 평가를 중단합니다',
  ].join('\n');
  readonly meta: StrategyMeta = {
    riskLevel: 'high',
    // 3배 레버리지 ETF 전제 + 종목 손절 없음(REVERSE 모드가 대체) → 무한매수법 원본보다 상향
    mddBuyBlock: -0.99,
    mddLiquidate: -0.99,
    expectedReturn: '완주 시 +starBasePct%, 소진 시 REVERSE 모드에서 가격 회복 대기',
    maxLoss: '하드 손절 없음 (REVERSE 모드로 리스크 완화 — 손실 상한 아님)',
    investmentPeriod: '수개월~수년 (3배 레버리지 ETF 장기 분할매수)',
    tradingFrequency: '하루 1회 장중 자동 매수/매도 (해외 장 시작 2시간 후)',
    suitableFor: ['3배 레버리지 ETF(TQQQ/SOXL) 장기 분할매수', '무한매수법 V4.0 원본 준수 트랙'],
    tags: ['무한매수', 'V4', 'LOC', 'MOC', '해외전용', '레버리지ETF'],
  };
  private readonly logger = new Logger(InfiniteBuyV4Strategy.name);

  async evaluateStock(ctx: StockStrategyContext): Promise<StrategyEvaluationResult> {
    const { watchStock, price, position } = ctx;
    const skipReasons: string[] = [];
    const details: Record<string, any> = {};

    if (watchStock.market !== 'OVERSEAS') {
      skipReasons.push('무한매수 V4는 해외 전용 전략입니다 (국내 미지원)');
      return { signals: [], skipReasons };
    }

    const N = watchStock.maxCycles;
    const principal = watchStock.quota;
    if (!principal || principal <= 0 || !N || N <= 0) {
      skipReasons.push('quota(원금) 또는 maxCycles(분할수) 미설정');
      return { signals: [], skipReasons };
    }

    const curPrice = price.currentPrice;
    if (curPrice <= 0) {
      this.logger.warn(`[${watchStock.stockCode}] Invalid current price: ${curPrice}`);
      skipReasons.push(`유효하지 않은 현재가 (${curPrice})`);
      return { signals: [], skipReasons };
    }

    const v4 = ((watchStock.strategyParams?.v4 as Partial<InfiniteBuyV4Params>) ?? {});
    const coeff = this.resolveCoefficients(watchStock.stockCode, v4);
    if (!coeff) {
      skipReasons.push(
        '종목 계수(starBasePct) 미설정 — TQQQ/SOXL 외 종목은 strategyParams.v4.starBasePct 명시 필요',
      );
      return { signals: [], skipReasons };
    }

    const holdQty = position?.quantity ?? 0;
    const hasPosition = holdQty > 0;
    const avgPrice = position?.avgPrice ?? 0;
    if (hasPosition && avgPrice <= 0) {
      this.logger.warn(`[${watchStock.stockCode}] Invalid avgPrice with position: ${avgPrice}`);
      skipReasons.push(`유효하지 않은 평단가 (${avgPrice})`);
      return { signals: [], skipReasons };
    }

    if (ctx.alreadyExecutedToday) {
      skipReasons.push('오늘 이미 실행됨');
      return { signals: [], skipReasons };
    }

    const T = Number.isFinite(v4.turn) ? (v4.turn as number) : 0;
    let mode: InfiniteBuyV4Mode = v4.mode ?? 'NORMAL';
    const cashRemaining = Number.isFinite(v4.cashRemaining) ? (v4.cashRemaining as number) : principal;
    const cycleSeq = v4.cycleSeq ?? 0;
    const recentClosesIn = Array.isArray(v4.recentCloses) ? v4.recentCloses : [];

    // D5/F2: v4 장부와 broker 보유수량이 어긋나면 흡수하지 않고 중단 — v4는 자체 장부 무결성을 우선한다.
    // lastKnownHoldQty(마지막 체결 확정 시점 보유수량)가 있으면 정확한 수량 일치를 요구하고,
    // 없으면(레거시/최초 배정 등) 기존 "T>0 vs 보유 유무" 체크로 fallback한다.
    const lastKnownHoldQty = v4.lastKnownHoldQty;
    if (Number.isFinite(lastKnownHoldQty)) {
      if (lastKnownHoldQty !== holdQty) {
        skipReasons.push(
          `v4 장부 불일치: 마지막 체결 기록 보유수량 ${lastKnownHoldQty} vs 실제 보유수량 ${holdQty} — ` +
          '수동매매 개입 의심, 평가 중단',
        );
        details.v4LedgerMismatch = true;
        details.T = T;
        details.holdQty = holdQty;
        details.lastKnownHoldQty = lastKnownHoldQty;
        return { signals: [], skipReasons, details };
      }
    } else {
      const ledgerImpliesHolding = T > 0;
      if (ledgerImpliesHolding !== hasPosition) {
        skipReasons.push(
          `v4 장부 불일치: T=${T.toFixed(2)}(보유 ${ledgerImpliesHolding ? '있음' : '없음'} 가정) vs ` +
          `실제 보유수량 ${holdQty} — 수동매매 개입 의심, 평가 중단`,
        );
        details.v4LedgerMismatch = true;
        details.T = T;
        details.holdQty = holdQty;
        return { signals: [], skipReasons, details };
      }
    }

    const evalDate = (ctx.now ?? new Date()).toISOString().slice(0, 10);
    const recentCloses = this.updateRecentCloses(recentClosesIn, ctx.stockIndicators.prevClose, evalDate);

    let justEnteredReverse = false;
    if (mode === 'NORMAL' && shouldEnterReverseMode({ T, N })) {
      mode = 'REVERSE';
      justEnteredReverse = true;
      this.logger.log(`[${watchStock.stockCode}] REVERSE 모드 진입: T=${T.toFixed(2)} > N-1=${N - 1}`);
    } else if (
      mode === 'REVERSE'
      && hasPosition
      && shouldExitReverseMode({
        closePrice: ctx.stockIndicators.prevClose ?? curPrice,
        avgPrice,
        finalTargetPct: coeff.finalTargetPct,
      })
    ) {
      mode = 'NORMAL';
      this.logger.log(`[${watchStock.stockCode}] NORMAL 모드 복귀: 종가 회복 확인`);
    }

    details.T = T;
    details.mode = mode;
    details.cashRemaining = cashRemaining;
    details.cycleSeq = cycleSeq;
    details.avgPrice = avgPrice;
    details.holdQty = holdQty;
    // 영속화는 TradingService가 담당 — 전략은 DB를 직접 쓰지 않는다.
    details.v4StateUpdate = { mode, recentCloses };

    const built = mode === 'REVERSE'
      ? (justEnteredReverse
        ? this.buildReverseFirstDaySignals(ctx, N, holdQty, curPrice)
        : this.buildReverseOngoingSignals(
          ctx,
          N,
          cashRemaining,
          holdQty,
          recentCloses,
          coeff.maxBuyPremiumPct,
        ))
      : this.buildNormalSignals(ctx, coeff, T, N, cashRemaining, avgPrice, holdQty, curPrice);

    skipReasons.push(...built.skipReasons);
    Object.assign(details, built.details);

    this.logger.log(
      `[${watchStock.stockCode}] mode=${mode}, T=${T.toFixed(2)}/${N}, hold=${holdQty}, ` +
      `signals=${built.signals.length}`,
    );

    return { signals: built.signals, skipReasons, details };
  }

  private resolveCoefficients(
    stockCode: string,
    v4: Partial<InfiniteBuyV4Params>,
  ): ResolvedCoefficients | undefined {
    const starBasePct = Number.isFinite(v4.starBasePct)
      ? (v4.starBasePct as number)
      : DEFAULT_STAR_BASE_PCT_BY_STOCK[stockCode.toUpperCase()];
    if (starBasePct === undefined) return undefined;

    return {
      starBasePct,
      finalTargetPct: Number.isFinite(v4.finalTargetPct) ? (v4.finalTargetPct as number) : starBasePct,
      firstBuyMarkupPct: Number.isFinite(v4.firstBuyMarkupPct)
        ? (v4.firstBuyMarkupPct as number)
        : DEFAULT_FIRST_BUY_MARKUP_PCT,
      maxBuyPremiumPct: Number.isFinite(v4.maxBuyPremiumPct)
        ? (v4.maxBuyPremiumPct as number)
        : DEFAULT_MAX_BUY_PREMIUM_PCT,
      ladderStepsPct: Array.isArray(v4.ladderStepsPct) && v4.ladderStepsPct.length > 0
        ? v4.ladderStepsPct
        : DEFAULT_LADDER_STEPS_PCT,
      compoundMode: v4.compoundMode ?? true,
    };
  }

  private updateRecentCloses(
    recentCloses: InfiniteBuyV4RecentClose[],
    prevClose: number | undefined,
    evalDate: string,
  ): InfiniteBuyV4RecentClose[] {
    if (!Number.isFinite(prevClose) || (prevClose as number) <= 0) return recentCloses;
    if (recentCloses.some((c) => c.date === evalDate)) return recentCloses;
    return [...recentCloses, { date: evalDate, close: prevClose as number }].slice(-MAX_RECENT_CLOSES);
  }

  private buildBuySignal(
    ctx: StockStrategyContext,
    quantity: number,
    price: number,
    phase: string,
    maxBuyPremiumPct: number,
  ): TradingSignal {
    const { watchStock } = ctx;
    const capPrice = roundToCent(ctx.price.currentPrice * (1 + maxBuyPremiumPct));
    // 첫 매수는 원본 V4의 "사실상 무조건 체결" 의도를 보존하고, 보유 중 생성되는 BUY만 상한 적용한다.
    const clampedPrice = phase !== 'v4-first-buy' && ctx.price.currentPrice > 0
      ? Math.min(price, capPrice)
      : price;
    const priceClamp = clampedPrice < price
      ? { originalPrice: price, clampedPrice, capPrice, maxBuyPremiumPct }
      : undefined;
    return {
      market: watchStock.market,
      exchangeCode: watchStock.exchangeCode,
      stockCode: watchStock.stockCode,
      side: 'BUY',
      quantity,
      price: clampedPrice,
      reason: `V4 ${phase}: ${quantity}주 @ ${clampedPrice}`,
      orderDivision: LOC_ORDER_DIVISION,
      metadata: {
        phase,
        fillModel: 'loc',
        // quantity는 항상 clamp 이전(D 기반) price로 산정되므로, T 회계 분모도 그 price
        // 기준으로 유지한다 — clampedPrice로 계산하면 clamp가 발동한 날 실제 투입액이
        // D보다 작아도 전량 체결 시 ΔT가 여전히 +1(전체 회차)로 잡혀 T가 실제 자금
        // 투입 속도보다 빨리 진행된다.
        v4AttemptAmount: roundToCent(price * quantity),
        ...(priceClamp ? { v4BuyPriceClamp: priceClamp } : {}),
      },
    };
  }

  /**
   * 당일 BUY 신호 전체(사다리 포함) 금액을 합산해 v4DayBuyAttemptTotal로 각 BUY 신호에
   * 주입한다 — T 회계(§3) 분모는 leg 자체(v4AttemptAmount)가 아니라 그날 매수 시도
   * 총액이어야 "당일 1회매수분 전량 체결 = +1" 규칙과 동치가 된다 (분할 시 leg별로
   * 독립 집계하면 전량 체결 시 ΔT가 leg 수만큼 배로 늘어나는 오류가 생긴다).
   * leg별 v4AttemptAmount(= clamp 이전 price 기준)를 그대로 합산 — clampedPrice(신호
   * 제출가)로 다시 계산하면 위 clamp-vs-T 회계 불일치가 재발한다.
   */
  private injectDayBuyAttemptTotal(signals: TradingSignal[], details: Record<string, any>): void {
    const buySignals = signals.filter((s) => s.side === 'BUY');
    if (buySignals.length === 0) return;
    const total = roundToCent(
      buySignals.reduce((sum, s) => sum + Number(s.metadata?.v4AttemptAmount ?? (s.price ?? 0) * s.quantity), 0),
    );
    const priceClamps: Record<string, any>[] = [];
    for (const s of buySignals) {
      s.metadata = { ...s.metadata, v4DayBuyAttemptTotal: total };
      if (s.metadata.v4BuyPriceClamp) {
        priceClamps.push({ phase: s.metadata.phase, ...s.metadata.v4BuyPriceClamp });
      }
    }
    if (priceClamps.length > 0) details.v4BuyPriceClamps = priceClamps;
  }

  private buildSellSignal(
    ctx: StockStrategyContext,
    quantity: number,
    price: number,
    phase: string,
    prevHolding: number,
    orderDivision: string,
    fillModel: 'loc' | 'moc' | 'limit-touch',
  ): TradingSignal {
    const { watchStock } = ctx;
    return {
      market: watchStock.market,
      exchangeCode: watchStock.exchangeCode,
      stockCode: watchStock.stockCode,
      side: 'SELL',
      quantity,
      price,
      reason: `V4 ${phase}: ${quantity}주 @ ${price}`,
      orderDivision,
      metadata: { phase, fillModel, v4PrevHolding: prevHolding },
    };
  }

  private buildNormalSignals(
    ctx: StockStrategyContext,
    coeff: ResolvedCoefficients,
    T: number,
    N: number,
    cashRemaining: number,
    avgPrice: number,
    holdQty: number,
    curPrice: number,
  ): BuildResult {
    const signals: TradingSignal[] = [];
    const skipReasons: string[] = [];
    const details: Record<string, any> = {};
    const hasPosition = holdQty > 0;

    const rawD = calculateDailyBuyBudget({ cashRemaining, N, T });
    const D = Math.max(0, Math.min(rawD, ctx.buyableAmount));
    details.dailyBuyBudget = rawD;
    details.dailyBuyBudgetCapped = D;
    if (D < rawD) details.v4BuyableCapApplied = true;

    let star: StarPointResult | undefined;
    if (hasPosition) {
      star = calculateStarPoint({ avgPrice, T, N, starBasePct: coeff.starBasePct });
      details.star = star;
    }

    if (D > 0) {
      let mainBudgetSpent = 0;
      let ladderBasePrice = 0;

      if (!hasPosition) {
        const firstBuyPrice = roundToCent(curPrice * (1 + coeff.firstBuyMarkupPct));
        const firstBuyQty = Math.floor(D / firstBuyPrice);
        if (firstBuyQty > 0) {
          signals.push(this.buildBuySignal(
            ctx,
            firstBuyQty,
            firstBuyPrice,
            'v4-first-buy',
            coeff.maxBuyPremiumPct,
          ));
          mainBudgetSpent += firstBuyQty * firstBuyPrice;
        }
        ladderBasePrice = firstBuyPrice;
      } else if (T < N / 2) {
        const halfD = D / 2;
        const avgLegPrice = roundToCent(avgPrice);
        const avgLegQty = Math.floor(halfD / avgLegPrice);
        if (avgLegQty > 0) {
          signals.push(this.buildBuySignal(ctx, avgLegQty, avgLegPrice, 'v4-avg-buy', coeff.maxBuyPremiumPct));
          mainBudgetSpent += avgLegQty * avgLegPrice;
        }
        const starLegPrice = star!.buyLimitPrice;
        const starLegQty = starLegPrice > 0 ? Math.floor(halfD / starLegPrice) : 0;
        if (starLegQty > 0) {
          signals.push(this.buildBuySignal(ctx, starLegQty, starLegPrice, 'v4-star-buy', coeff.maxBuyPremiumPct));
          mainBudgetSpent += starLegQty * starLegPrice;
        }
        ladderBasePrice = starLegPrice > 0 ? Math.min(avgLegPrice, starLegPrice) : avgLegPrice;
      } else {
        const starLegPrice = star!.buyLimitPrice;
        const starLegQty = starLegPrice > 0 ? Math.floor(D / starLegPrice) : 0;
        if (starLegQty > 0) {
          signals.push(this.buildBuySignal(ctx, starLegQty, starLegPrice, 'v4-star-buy', coeff.maxBuyPremiumPct));
          mainBudgetSpent += starLegQty * starLegPrice;
        }
        ladderBasePrice = starLegPrice;
      }

      const ladderBudget = Math.max(0, D - mainBudgetSpent);
      if (ladderBasePrice > 0 && ladderBudget > 0) {
        const ladderOrders = allocateLadderOrders({
          remainingBudget: ladderBudget,
          basePrice: ladderBasePrice,
          steps: coeff.ladderStepsPct,
        });
        for (const order of ladderOrders) {
          signals.push(this.buildBuySignal(
            ctx,
            order.quantity,
            order.price,
            'v4-ladder-buy',
            coeff.maxBuyPremiumPct,
          ));
        }
        details.ladderOrders = ladderOrders;
      }

      const buySignalCount = signals.length;
      if (buySignalCount === 0) {
        skipReasons.push(`매수 수량 부족: 일일 매수 시도액 ${D.toFixed(2)}으로 1주 매수 불가`);
      }
    } else {
      skipReasons.push(`매수 예산 없음 (D=${rawD.toFixed(2)}, 가용자금=${ctx.buyableAmount.toFixed(2)})`);
    }

    // 매도는 D(매수 예산)와 무관하게 항상 평가한다.
    // 매수 쪽(starLegQty 등)과 대칭으로 가격이 0 이하면 신호를 생성하지 않는다 —
    // 후반전 별%가 과도하게 음전환되는 극단값(오설정 등)에서 음수/0 지정가 주문 제출 방지.
    if (hasPosition) {
      let quarterSellQty = 0;
      if (holdQty >= 2) {
        const candidateQuarterSellQty = Math.max(1, Math.floor(holdQty / 4));
        const quarterSellPrice = star!.sellLimitPrice;
        if (quarterSellPrice > 0) {
          quarterSellQty = candidateQuarterSellQty;
          signals.push(
            this.buildSellSignal(ctx, quarterSellQty, quarterSellPrice, 'v4-quarter-sell', holdQty, LOC_ORDER_DIVISION, 'loc'),
          );
        } else {
          skipReasons.push(`쿼터매도 가격 비정상 (${quarterSellPrice}) — 매도 스킵`);
        }
      }
      const finalSellQty = holdQty - quarterSellQty;
      if (finalSellQty > 0) {
        const finalSellPrice = roundToCent(avgPrice * (1 + coeff.finalTargetPct / 100));
        if (finalSellPrice > 0) {
          signals.push(
            this.buildSellSignal(ctx, finalSellQty, finalSellPrice, 'v4-final-sell', holdQty, LIMIT_ORDER_DIVISION, 'limit-touch'),
          );
        } else {
          skipReasons.push(`최종매도 가격 비정상 (${finalSellPrice}) — 매도 스킵`);
        }
      }
    }

    this.injectDayBuyAttemptTotal(signals, details);
    return { signals, skipReasons, details };
  }

  private buildReverseFirstDaySignals(
    ctx: StockStrategyContext,
    N: number,
    holdQty: number,
    curPrice: number,
  ): BuildResult {
    const signals: TradingSignal[] = [];
    const skipReasons: string[] = [];
    const M = N / 2;
    const sellQty = Math.floor(holdQty / M);
    const sellPrice = roundToCent(curPrice);
    if (sellQty > 0 && sellPrice > 0) {
      signals.push(
        this.buildSellSignal(ctx, sellQty, sellPrice, 'v4-reverse-sell', holdQty, MOC_SELL_ORDER_DIVISION, 'moc'),
      );
    } else if (sellQty > 0) {
      skipReasons.push(`리버스 진입 첫날 매도 가격 비정상 (${sellPrice}) — 매도 스킵`);
    } else {
      skipReasons.push(`리버스 진입 첫날 매도 수량 0 (보유 ${holdQty} / M=${M})`);
    }
    return { signals, skipReasons, details: {} };
  }

  private buildReverseOngoingSignals(
    ctx: StockStrategyContext,
    N: number,
    cashRemaining: number,
    holdQty: number,
    recentCloses: InfiniteBuyV4RecentClose[],
    maxBuyPremiumPct: number,
  ): BuildResult {
    const signals: TradingSignal[] = [];
    const skipReasons: string[] = [];
    const details: Record<string, any> = {};

    if (recentCloses.length < MIN_RECENT_CLOSES_FOR_REVERSE) {
      skipReasons.push(
        `리버스 별지점 계산에 필요한 최근 종가 부족 (${recentCloses.length}/${MIN_RECENT_CLOSES_FOR_REVERSE})`,
      );
      return { signals, skipReasons, details };
    }

    const reverseStarPrice = roundToCent(
      recentCloses.reduce((sum, c) => sum + c.close, 0) / recentCloses.length,
    );
    details.reverseStarPrice = reverseStarPrice;

    const M = N / 2;
    if (holdQty > 0) {
      const sellQty = Math.floor(holdQty / M);
      if (sellQty > 0) {
        if (reverseStarPrice > 0) {
          signals.push(
            this.buildSellSignal(ctx, sellQty, reverseStarPrice, 'v4-reverse-sell', holdQty, LOC_ORDER_DIVISION, 'loc'),
          );
        } else {
          skipReasons.push(`리버스 매도 가격 비정상 (${reverseStarPrice}) — 매도 스킵`);
        }
      }
    }

    const cappedBuyAmount = Math.max(0, Math.min(cashRemaining / 4, ctx.buyableAmount));
    const reverseBuyPrice = roundToCent(reverseStarPrice - 0.01);
    const reverseBuyQty = reverseBuyPrice > 0 ? Math.floor(cappedBuyAmount / reverseBuyPrice) : 0;
    if (reverseBuyQty > 0) {
      signals.push(this.buildBuySignal(
        ctx,
        reverseBuyQty,
        reverseBuyPrice,
        'v4-reverse-buy',
        maxBuyPremiumPct,
      ));
    }

    if (signals.length === 0) {
      skipReasons.push('리버스 모드: 매도/매수 수량 모두 0 (잔금 또는 보유수량 부족)');
    }

    this.injectDayBuyAttemptTotal(signals, details);
    return { signals, skipReasons, details };
  }
}
