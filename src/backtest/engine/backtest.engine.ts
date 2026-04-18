import { Logger } from '@nestjs/common';
import {
  PerStockTradingStrategy,
  StockStrategyContext,
  TradingSignal,
  WatchStockConfig,
  StockIndicators,
  MarketCondition,
} from '../../trading/types';
import { Market } from '@prisma/client';
import { OHLCV, computeIndicators } from '../data/indicator-calculator';
import { BacktestTrade } from './metrics';

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

    const indicators = computeIndicators(bars, i);
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

    // 5. 시그널 체결
    const prevQuantity = state.quantity;
    for (const signal of result.signals) {
      executeSignal(signal, state, today, trades, pendingOrders, slippage, isOverseas);
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
  };
}

function executeSignal(
  signal: TradingSignal,
  state: SimState,
  today: OHLCV,
  trades: BacktestTrade[],
  pendingOrders: PendingLimitOrder[],
  slippage: number,
  isOverseas: boolean,
) {
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
