import { Logger } from '@nestjs/common';
import {
  PerStockTradingStrategy,
  StockStrategyContext,
  TradingSignal,
  WatchStockConfig,
  StockIndicators,
  MarketCondition,
  InfiniteBuyV4Mode,
} from '../../trading/types';
import { Market } from '@prisma/client';
import { OHLCV, computeIndicators } from '../data/indicator-calculator';
import { BacktestTrade } from './metrics';
import { applyV4Fill, V4LedgerState } from '../../trading/strategy/infinite-buy-v4-ledger.util';
import { roundToCent } from '../../trading/strategy/infinite-buy-v4-math.util';

const INFINITE_BUY_V4_STRATEGY_NAME = 'infinite-buy-v4';

/** OHLCV.date는 'YYYYMMDD'(압축) 또는 'YYYY-MM-DD' 둘 다 나타날 수 있어 방어적으로 파싱한다. */
function parseBarDate(date: string): Date {
  const compact = /^\d{8}$/.test(date);
  const iso = compact ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : date;
  return new Date(iso);
}

export interface BacktestConfig {
  market: Market;
  exchangeCode: string;
  stockCode: string;
  stockName?: string;
  quota: number;
  maxCycles: number;
  stopLossRate: number;       // e.g., 0.3 for -30%
  strategyParams?: Record<string, any>;
  startingCash: number;       // cash available for this backtest (>= quota)
  slippageRate?: number;      // default 0.005 (0.5%) for infinite-buy
  warmupBars?: number;        // minimum bars required before first trade (default 200 for MA200)
  /**
   * 거래비용 모델 — 현재 fillModel 기반 체결(stop-entry 데이트레이드)에만 적용.
   * 미설정 시 0 (기존 infinite-buy reason-prefix 경로 결과 보존).
   */
  feeConfig?: {
    buyFeeRate?: number;      // 매수 수수료율 (예: 0.00015)
    sellFeeRate?: number;     // 매도 수수료율
    sellTaxRate?: number;     // 매도 거래세율 (예: 0.0018)
  };
  /**
   * 일봉 근사에서 같은 bar 손절 판정 기준 (stop-entry 전용).
   * 'low'(기본): 장중 저가가 stop에 닿으면 손절 — 보수적 (터치 기반)
   * 'close': 종가가 stop 아래일 때만 손절 — 장중 회복분을 무손절 처리 (낙관적)
   */
  stopFill?: 'low' | 'close';
  /**
   * 지표 계산 기준 bar 시프트. 0(기본)이면 당일 bar 포함(종가까지) — 기존
   * infinite-buy 결과 보존용. 1이면 전일까지의 지표로 평가 — 시가 시점에
   * 알 수 없는 당일 종가가 진입 필터(MA20/RSI)에 새는 lookahead를 제거.
   */
  indicatorLag?: number;
}

interface DayTradeFillConfig {
  buyFeeRate: number;
  sellFeeRate: number;
  sellTaxRate: number;
  stopFill: 'low' | 'close';
}

export interface BacktestResult {
  config: BacktestConfig;
  dailyValues: number[];      // end-of-day portfolio value
  dailyDates: string[];
  trades: BacktestTrade[];
  finalPosition: {
    quantity: number;
    avgPrice: number;
    totalInvested: number;
  };
  finalCash: number;
  /** strategy.name === 'infinite-buy-v4'일 때만 채워지는 전용 리포트 지표 (§7). */
  v4Summary?: {
    finalMode: InfiniteBuyV4Mode;
    finalTurn: number;
    finalCashRemaining: number;
    cycleCount: number;
    reverseEntryCount: number;
  };
}

interface PendingLimitOrder {
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  reason: string;
  placedDate: string;
  expiresDate: string;        // next trading day close cancels
}

interface SimState {
  cash: number;
  quantity: number;
  avgPrice: number;
  totalInvested: number;
  strategyParams: Record<string, any>;
  peakValue: number;
  initialEquity: number;
  // infinite-buy 전용 이월 추적은 simulation.service.ts 로직 간략화해서 반영
}

const DEFAULT_SLIPPAGE = 0.005;

export async function runBacktest(
  strategy: PerStockTradingStrategy,
  bars: OHLCV[],
  config: BacktestConfig,
): Promise<BacktestResult> {
  const logger = new Logger(`Backtest:${config.stockCode}`);
  const slippage = config.slippageRate ?? DEFAULT_SLIPPAGE;
  const warmup = config.warmupBars ?? 200;
  const isOverseas = config.market === 'OVERSEAS';
  const dayTradeFill: DayTradeFillConfig = {
    buyFeeRate: config.feeConfig?.buyFeeRate ?? 0,
    sellFeeRate: config.feeConfig?.sellFeeRate ?? 0,
    sellTaxRate: config.feeConfig?.sellTaxRate ?? 0,
    stopFill: config.stopFill ?? 'low',
  };

  const state: SimState = {
    cash: config.startingCash,
    quantity: 0,
    avgPrice: 0,
    totalInvested: 0,
    strategyParams: { ...(config.strategyParams ?? {}) },
    peakValue: config.startingCash,
    initialEquity: config.startingCash,
  };

  const trades: BacktestTrade[] = [];
  const dailyValues: number[] = [];
  const dailyDates: string[] = [];
  const pendingOrders: PendingLimitOrder[] = [];

  const marketCondition: MarketCondition = {
    referenceIndexAboveMA200: true, // backtest에서는 종목 독립 평가
    referenceIndexName: isOverseas ? 'S&P500' : 'KOSPI',
    interestRateRising: false,
  };

  // infinite-buy-v4 전용 bar간 상태 스레딩(§7) — 다른 전략의 기존 동작에는 영향 없음.
  const isV4Strategy = strategy.name === INFINITE_BUY_V4_STRATEGY_NAME;
  let v4CycleCount = 0;
  let v4ReverseEntryCount = 0;
  let v4PrevMode: InfiniteBuyV4Mode | undefined;

  for (let i = 0; i < bars.length; i++) {
    const today = bars[i];

    // 1. 예약된 지정가 주문 체결 시도 (장중 high/low 레인지 검사)
    for (let j = pendingOrders.length - 1; j >= 0; j--) {
      const order = pendingOrders[j];
      if (today.date > order.expiresDate) {
        pendingOrders.splice(j, 1);
        continue;
      }
      if (order.side === 'BUY' && today.low <= order.price) {
        fillBuy(state, order.price, order.quantity);
        trades.push({
          date: today.date,
          side: 'BUY',
          price: order.price,
          quantity: order.quantity,
          reason: order.reason,
        });
        pendingOrders.splice(j, 1);
      } else if (order.side === 'SELL' && today.high >= order.price) {
        const pnl = (order.price - state.avgPrice) * order.quantity;
        fillSell(state, order.price, order.quantity);
        trades.push({
          date: today.date,
          side: 'SELL',
          price: order.price,
          quantity: order.quantity,
          reason: order.reason,
          pnl,
        });
        pendingOrders.splice(j, 1);
      }
    }

    // 2. 인디케이터 계산 (warmup 전에는 skip)
    if (i < warmup) {
      dailyValues.push(state.cash + state.quantity * today.close);
      dailyDates.push(today.date);
      continue;
    }

    const indicators = computeIndicators(bars, Math.max(0, i - (config.indicatorLag ?? 0)));
    const prevBar = i > 0 ? bars[i - 1] : undefined;
    const stockIndicators: StockIndicators = {
      currentAboveMA200: indicators.ma200 !== undefined ? today.close > indicators.ma200 : true,
      ma20: indicators.ma20,
      ma60: indicators.ma60,
      ma200: indicators.ma200,
      rsi14: indicators.rsi14,
      atr14: indicators.atr14,
      atrPercent: indicators.atrPercent,
      adx14: indicators.adx14,
      bollingerUpper: indicators.bollingerUpper,
      bollingerMiddle: indicators.bollingerMiddle,
      bollingerLower: indicators.bollingerLower,
      volatility30d: indicators.volatility30d,
      avgVolume20: indicators.avgVolume20,
      todayOpen: today.open,
      prevHigh: prevBar?.high,
      prevLow: prevBar?.low,
      prevClose: prevBar?.close,
    };

    // 3. 전략 컨텍스트 구성
    const watchStock: WatchStockConfig = {
      id: `bt-${config.stockCode}`,
      market: config.market,
      exchangeCode: config.exchangeCode,
      stockCode: config.stockCode,
      stockName: config.stockName ?? config.stockCode,
      strategyName: strategy.name,
      quota: config.quota,
      cycle: state.avgPrice > 0 && config.quota > 0 && config.maxCycles > 0
        ? state.totalInvested / (config.quota / config.maxCycles)
        : 0,
      maxCycles: config.maxCycles,
      stopLossRate: config.stopLossRate,
      maxPortfolioRate: 1.0,
      strategyParams: state.strategyParams,
    } as any;

    const currentPrice = today.open; // once-daily 전략: 장중 결정 기준 = 당일 시가 근사
    const portfolioValue = state.cash + state.quantity * currentPrice;
    state.peakValue = Math.max(state.peakValue, portfolioValue);
    const drawdown = state.peakValue > 0 ? (portfolioValue - state.peakValue) / state.peakValue : 0;

    const ctx: StockStrategyContext = {
      watchStock,
      price: {
        stockCode: config.stockCode,
        stockName: watchStock.stockName,
        currentPrice,
        openPrice: today.open,
        highPrice: today.high,
        lowPrice: today.low,
        volume: today.volume,
      } as any,
      position: state.quantity > 0
        ? {
            stockCode: config.stockCode,
            quantity: state.quantity,
            avgPrice: state.avgPrice,
            currentPrice,
            totalInvested: state.totalInvested,
          }
        : undefined,
      alreadyExecutedToday: false,
      marketCondition,
      stockIndicators,
      evaluationMode: 'daily-bar',
      // 시뮬레이션 bar의 날짜 — 전략이 "오늘" 기준으로 날짜별 상태(예: 롤링 종가 윈도우)를
      // 갱신할 때 실제 wall-clock 대신 참조한다 (백테스트는 수천 bar를 밀리초 단위로 순회하므로
      // wall-clock 기준으로는 모든 bar가 "같은 날"로 보인다).
      now: parseBarDate(today.date),
      buyableAmount: state.cash,
      totalPortfolioValue: portfolioValue,
      riskState: {
        buyBlocked: drawdown <= -0.25,
        liquidateAll: drawdown <= -0.35,
        positionCount: state.quantity > 0 ? 1 : 0,
        investedRate: portfolioValue > 0 ? (state.quantity * currentPrice) / portfolioValue : 0,
        dailyPnlRate: 0,
        drawdown,
        reasons: drawdown < -0.1 ? [`MDD ${(drawdown * 100).toFixed(1)}%`] : [],
      },
    };

    // 4. 전략 호출
    const result = await strategy.evaluateStock(ctx);

    // 4-1. v4 전용: 평가 시점 상태(mode/recentCloses)를 다음 bar 평가에 전달할 strategyParams.v4에 반영.
    //      T/cashRemaining/cycleSeq/lastKnownHoldQty는 아래 체결 반영(applyV4Fill)에서만 갱신한다
    //      (실거래의 persistInfiniteBuyV4State/handleInfiniteBuyV4SignalFill 분리와 동일한 시점 규칙).
    if (isV4Strategy && result.details?.v4StateUpdate) {
      const v4StateUpdate = result.details.v4StateUpdate as {
        mode: InfiniteBuyV4Mode;
        recentCloses: unknown[];
      };
      state.strategyParams.v4 = {
        ...(state.strategyParams.v4 ?? {}),
        mode: v4StateUpdate.mode,
        recentCloses: v4StateUpdate.recentCloses,
      };
      if (v4PrevMode !== 'REVERSE' && v4StateUpdate.mode === 'REVERSE') {
        v4ReverseEntryCount++;
      }
      v4PrevMode = v4StateUpdate.mode;
    }

    // 5. 시그널 체결
    const prevQuantity = state.quantity;
    // v4 전용: 같은 bar에 SELL·BUY가 함께 체결되면 SELL 먼저 장부에 반영 — 실거래 제출 순서(§3, 매도 먼저 반영 후 매수 반영)와 동일 규칙.
    // sort는 stable이므로 각 side 그룹 내 원래 순서(쿼터매도→최종매도, 평단매수→별지점매수→사다리)는 보존된다.
    const orderedSignals = isV4Strategy
      ? [...result.signals].sort((a, b) => (a.side === b.side ? 0 : a.side === 'SELL' ? -1 : 1))
      : result.signals;
    for (const signal of orderedSignals) {
      const holdBeforeSignal = state.quantity;
      const fillResult = executeSignal(signal, state, today, trades, pendingOrders, slippage, isOverseas, dayTradeFill);
      if (isV4Strategy && fillResult) {
        const cycleCompleted = applyV4LedgerFill(state, signal, fillResult, holdBeforeSignal, config);
        if (cycleCompleted) v4CycleCount++;
      }
    }
    const boughtToday = state.quantity > prevQuantity;

    // 6. accumulatedQuota 이월 처리
    //    - BUY 체결 시:
    //        · dailyCap이 적용되어 미투입 잔액(dailyCapCarryOut)이 있으면 그걸 이월
    //        · 아니면 초기화
    //    - "매수 수량 부족:" 스킵 시: perCycleQuota 누적 (remainingQuota 상한)
    const perCycleQuota = config.quota / config.maxCycles;
    const remainingForCarry = Math.max(0, config.quota - state.totalInvested);
    const isCarryEligible = result.skipReasons.some((r) => r.startsWith('매수 수량 부족:'));
    const dailyCapCarryOut = Number(result.details?.dailyCapCarryOut) || 0;
    if (boughtToday) {
      state.strategyParams.accumulatedQuota = Math.min(dailyCapCarryOut, remainingForCarry);
    } else if (isCarryEligible) {
      const current = Number(state.strategyParams.accumulatedQuota) || 0;
      state.strategyParams.accumulatedQuota = Math.min(current + perCycleQuota, remainingForCarry);
    }

    // 7. EOD 포트폴리오 가치 기록 (종가 기준)
    const eodValue = state.cash + state.quantity * today.close;
    dailyValues.push(eodValue);
    dailyDates.push(today.date);
  }

  // 종료: 남은 포지션 종가 청산 (선택적, 여기서는 hold로 둠 — 메트릭은 mark-to-market)
  const v4 = state.strategyParams.v4 as Record<string, any> | undefined;
  return {
    config,
    dailyValues,
    dailyDates,
    trades,
    finalPosition: {
      quantity: state.quantity,
      avgPrice: state.avgPrice,
      totalInvested: state.totalInvested,
    },
    finalCash: state.cash,
    v4Summary: isV4Strategy
      ? {
          finalMode: (v4?.mode as InfiniteBuyV4Mode) ?? 'NORMAL',
          finalTurn: Number.isFinite(v4?.turn) ? (v4!.turn as number) : 0,
          finalCashRemaining: Number.isFinite(v4?.cashRemaining) ? (v4!.cashRemaining as number) : config.quota,
          cycleCount: v4CycleCount,
          reverseEntryCount: v4ReverseEntryCount,
        }
      : undefined,
  };
}

/** v4 전용 체결 결과 — SELL/BUY 체결이 실제로 일어났을 때만 반환되어 호출자가 장부(T/cashRemaining)를 갱신할 수 있게 한다. 다른 전략 경로는 사용하지 않으므로 undefined로 둔다. */
interface FillOutcome {
  price: number;
  quantity: number;
}

/**
 * infinite-buy-v4 전용: 체결 1건을 strategyParams.v4 장부(T/cashRemaining/cycleSeq/lastKnownHoldQty)에
 * 반영한다. `TradingService.handleInfiniteBuyV4SignalFill`과 동일한 infinite-buy-v4-ledger.util을
 * 공유하므로 실거래와 계산 규칙이 갈라지지 않는다.
 */
function applyV4LedgerFill(
  state: SimState,
  signal: TradingSignal,
  fill: FillOutcome,
  previousHoldingQty: number,
  config: BacktestConfig,
): boolean {
  const v4 = (state.strategyParams.v4 ?? {}) as Record<string, any>;
  const before: V4LedgerState = {
    turn: Number.isFinite(v4.turn) ? v4.turn : 0,
    cashRemaining: Number.isFinite(v4.cashRemaining) ? v4.cashRemaining : config.quota,
    cycleSeq: v4.cycleSeq ?? 0,
    lastKnownHoldQty: previousHoldingQty,
  };
  const fillAmount = roundToCent(fill.price * fill.quantity);

  const result = applyV4Fill(before, {
    side: signal.side,
    phase: String(signal.metadata?.phase || ''),
    quantity: fill.quantity,
    fillAmount,
    previousHoldingQty,
    sellRatioPrevHolding: Number(signal.metadata?.v4PrevHolding ?? previousHoldingQty),
    attemptAmount: Number(signal.metadata?.v4DayBuyAttemptTotal ?? signal.metadata?.v4AttemptAmount ?? fillAmount),
    N: config.maxCycles,
    quota: config.quota,
    compoundMode: v4.compoundMode ?? true,
  });

  state.strategyParams.v4 = {
    ...v4,
    turn: result.state.turn,
    cashRemaining: result.state.cashRemaining,
    cycleSeq: result.state.cycleSeq,
    lastKnownHoldQty: result.state.lastKnownHoldQty,
  };

  return result.cycleCompleted;
}

function executeSignal(
  signal: TradingSignal,
  state: SimState,
  today: OHLCV,
  trades: BacktestTrade[],
  pendingOrders: PendingLimitOrder[],
  slippage: number,
  isOverseas: boolean,
  dayTradeFill: DayTradeFillConfig,
): FillOutcome | undefined {
  // metadata.fillModel 기반 체결 — reason-prefix 분기(infinite-buy 전용)보다 먼저 처리
  if (signal.side === 'BUY' && signal.metadata?.fillModel === 'stop-entry') {
    executeStopEntryDayTrade(signal, state, today, trades, slippage, dayTradeFill);
    return undefined;
  }
  if (
    signal.metadata?.fillModel === 'loc' ||
    signal.metadata?.fillModel === 'moc' ||
    signal.metadata?.fillModel === 'limit-touch'
  ) {
    return executeCloseFill(signal, state, today, trades, dayTradeFill);
  }

  const reason = signal.reason ?? '';
  const isBuy1 = reason.startsWith('Buy1');
  const isBuy2 = reason.startsWith('Buy2');
  const isStopLoss = reason.toLowerCase().includes('stop loss');
  const isRiskLiquidation = reason.includes('리스크 청산') || reason.includes('리스크 전량청산');
  const isTakeProfit = reason.includes('Take profit');

  if (signal.side === 'BUY') {
    if (isBuy1) {
      // 시장가 근사: 시가 + 슬리피지
      const fillPrice = today.open * (1 + slippage);
      const cost = fillPrice * signal.quantity;
      if (cost <= state.cash) {
        fillBuy(state, fillPrice, signal.quantity);
        trades.push({ date: today.date, side: 'BUY', price: fillPrice, quantity: signal.quantity, reason });
      }
    } else if (isBuy2) {
      // 지정가: 장중 low로 체결 판정 (당일 내)
      const limitPrice = signal.price ?? 0;
      if (today.low <= limitPrice) {
        const cost = limitPrice * signal.quantity;
        if (cost <= state.cash) {
          fillBuy(state, limitPrice, signal.quantity);
          trades.push({ date: today.date, side: 'BUY', price: limitPrice, quantity: signal.quantity, reason });
        }
      }
      // 미체결 시 장 마감 후 자동 취소 (다음날 넘기지 않음)
    }
  } else if (signal.side === 'SELL') {
    if (isStopLoss || isRiskLiquidation) {
      // 즉시 종가 청산 (보수적 근사)
      const fillPrice = today.close * (1 - slippage);
      const qty = Math.min(state.quantity, signal.quantity);
      if (qty > 0) {
        const pnl = (fillPrice - state.avgPrice) * qty;
        fillSell(state, fillPrice, qty);
        trades.push({ date: today.date, side: 'SELL', price: fillPrice, quantity: qty, reason, pnl });
      }
    } else if (isTakeProfit) {
      // 목표가 지정가: 당일 high 체크
      const targetPrice = signal.price ?? 0;
      if (today.high >= targetPrice) {
        const qty = Math.min(state.quantity, signal.quantity);
        if (qty > 0) {
          const pnl = (targetPrice - state.avgPrice) * qty;
          fillSell(state, targetPrice, qty);
          trades.push({ date: today.date, side: 'SELL', price: targetPrice, quantity: qty, reason, pnl });
        }
      }
      // 미체결은 다음 날 자동 재주문(전략이 매일 생성)
    }
  }
}

/**
 * stop-entry 데이트레이드 체결 근사 (당일청산 변동성 돌파 등):
 * - 진입: 장중 고가가 trigger(=돌파가)에 닿으면 trigger가 체결.
 *   trigger는 당일 시가 기준으로 산출되므로 항상 시가 위 — 갭 체결 케이스 없음.
 *   비용(슬리피지+수수료)이 현금을 초과하면 수량을 줄여 체결 (조용한 드랍 금지).
 * - 같은 bar 청산 (exitModel 'eod'): 손절 → 익절 → 종가 순으로 판정.
 *   손절/익절가는 metadata의 rate × 실제 체결가로 계산 — 실거래(평균단가 기준)와 동일 의미.
 *   손절/익절 동시 터치 시 손절 우선 (경로를 알 수 없으므로 보수적 가정).
 * - 한계: 트레일링 스탑은 일봉으로 검증 불가 (고가 도달 경로 미상) — 미반영.
 */
function executeStopEntryDayTrade(
  signal: TradingSignal,
  state: SimState,
  today: OHLCV,
  trades: BacktestTrade[],
  slippage: number,
  fill: DayTradeFillConfig,
) {
  const trigger = signal.price ?? 0;
  if (trigger <= 0 || signal.quantity <= 0) return;

  // 체결 판정은 슬리피지 포함가 기준 — (a) 기록상 고가보다 높은 "불가능한 체결" 방지,
  // (b) 돌파가를 한 틱 스치고 꺾인 날은 1분 폴링 라이브도 놓치기 쉬움 (샘플링 지연 근사)
  const entryPrice = trigger * (1 + slippage);
  if (today.high < entryPrice) return; // 미돌파 — 신호는 당일로 소멸 (다음 bar에서 재생성)
  const unitCost = entryPrice * (1 + fill.buyFeeRate);
  const quantity = Math.min(signal.quantity, Math.floor(state.cash / unitCost));
  if (quantity <= 0) return;

  const buyFee = entryPrice * quantity * fill.buyFeeRate;
  fillBuy(state, entryPrice, quantity);
  state.cash -= buyFee;
  trades.push({
    date: today.date,
    side: 'BUY',
    price: entryPrice,
    quantity,
    reason: signal.reason,
  });

  // 같은 bar 청산 — stop/익절가는 실제 체결가 기준
  const stopLossRate = Number(signal.metadata?.stopLossRate) || undefined;
  const takeProfitRate = Number(signal.metadata?.takeProfitRate) || undefined;
  const stopPrice = stopLossRate !== undefined ? entryPrice * (1 - stopLossRate) : undefined;
  const takeProfitPrice = takeProfitRate !== undefined ? entryPrice * (1 + takeProfitRate) : undefined;
  const stopHit = stopPrice !== undefined
    && (fill.stopFill === 'low' ? today.low <= stopPrice : today.close <= stopPrice);

  let exitBase: number;
  let exitReason: string;
  if (stopHit) {
    exitBase = stopPrice!;
    exitReason = '손절청산(백테스트 근사)';
  } else if (takeProfitPrice !== undefined && today.high >= takeProfitPrice) {
    exitBase = takeProfitPrice;
    exitReason = '익절청산(백테스트 근사)';
  } else {
    exitBase = today.close;
    exitReason = '당일청산(백테스트 근사)';
  }

  const exitPrice = exitBase * (1 - slippage);
  const sellFees = exitPrice * quantity * (fill.sellFeeRate + fill.sellTaxRate);
  const pnl = (exitPrice - entryPrice) * quantity - buyFee - sellFees;

  fillSell(state, exitPrice, quantity);
  state.cash -= sellFees;
  trades.push({
    date: today.date,
    side: 'SELL',
    price: exitPrice,
    quantity,
    reason: exitReason,
    pnl,
  });
}

/**
 * LOC(Limit-On-Close)/MOC(Market-On-Close)/장중 지정가(limit-touch) 체결 근사:
 * - 'loc': BUY는 종가 ≤ limit, SELL은 종가 ≥ limit 일 때만 종가로 체결. 미충족 시 그날로 소멸 (이월 없음 — 전략이 다음 bar에서 재생성해야 다시 시도됨).
 * - 'moc': 방향 무관 종가로 무조건 체결.
 * - 'limit-touch': 실제 지정가 주문(orderDivision='00' 등) 근사 — BUY는 장중 저가 ≤ limit, SELL은 장중 고가 ≥ limit 이면 지정가 그대로 체결 (종가 아님). 미충족 시 그날로 소멸.
 * - loc/moc 체결가는 종가 그대로 (슬리피지 미적용 — 단일가 체결이 정의 자체이므로 근사가 아니라 실제 체결 방식).
 * - 수수료/거래세는 stop-entry와 동일한 feeConfig 적용. 현금/보유수량 초과분은 조용히 드랍하지 않고 수량을 줄여 체결.
 */
function executeCloseFill(
  signal: TradingSignal,
  state: SimState,
  today: OHLCV,
  trades: BacktestTrade[],
  fill: DayTradeFillConfig,
): FillOutcome | undefined {
  if (signal.quantity <= 0) return undefined;
  const fillModel = signal.metadata?.fillModel;
  const limitPrice = signal.price;

  let fillPrice: number;
  if (fillModel === 'limit-touch') {
    if (limitPrice === undefined) return undefined;
    if (signal.side === 'BUY' && today.low > limitPrice) return undefined;
    if (signal.side === 'SELL' && today.high < limitPrice) return undefined;
    fillPrice = limitPrice;
  } else {
    if (
      fillModel === 'loc' &&
      (limitPrice === undefined ||
        (signal.side === 'BUY' && today.close > limitPrice) ||
        (signal.side === 'SELL' && today.close < limitPrice))
    ) {
      return undefined;
    }
    fillPrice = today.close;
  }

  if (signal.side === 'BUY') {
    const unitCost = fillPrice * (1 + fill.buyFeeRate);
    const quantity = Math.min(signal.quantity, Math.floor(state.cash / unitCost));
    if (quantity <= 0) return undefined;
    const buyFee = fillPrice * quantity * fill.buyFeeRate;
    fillBuy(state, fillPrice, quantity);
    state.cash -= buyFee;
    trades.push({ date: today.date, side: 'BUY', price: fillPrice, quantity, reason: signal.reason });
    return { price: fillPrice, quantity };
  } else {
    const quantity = Math.min(signal.quantity, state.quantity);
    if (quantity <= 0) return undefined;
    const sellFees = fillPrice * quantity * (fill.sellFeeRate + fill.sellTaxRate);
    const pnl = (fillPrice - state.avgPrice) * quantity - sellFees;
    fillSell(state, fillPrice, quantity);
    state.cash -= sellFees;
    trades.push({ date: today.date, side: 'SELL', price: fillPrice, quantity, reason: signal.reason, pnl });
    return { price: fillPrice, quantity };
  }
}

function fillBuy(state: SimState, price: number, qty: number) {
  const cost = price * qty;
  state.cash -= cost;
  const newQty = state.quantity + qty;
  state.avgPrice = newQty > 0 ? (state.avgPrice * state.quantity + cost) / newQty : 0;
  state.quantity = newQty;
  state.totalInvested += cost;
}

function fillSell(state: SimState, price: number, qty: number) {
  const proceeds = price * qty;
  state.cash += proceeds;
  // 부분/전량 매도 시 totalInvested는 비례 감소
  const portion = state.quantity > 0 ? qty / state.quantity : 0;
  state.totalInvested *= 1 - portion;
  state.quantity -= qty;
  if (state.quantity === 0) {
    state.avgPrice = 0;
    state.totalInvested = 0;
  }
}
