import { Injectable, Logger } from '@nestjs/common';
import {
  PerStockTradingStrategy,
  StockStrategyContext,
  TradingSignal,
  StrategyEvaluationResult,
  ExecutionMode,
  StrategyMeta,
  InfiniteBuyStrategyParams,
  InfiniteBuySecondaryExitPlan,
  Buy2DipMode,
  RsiPolicy,
} from '../types';
import { lookupTargetProfitRate, lookupSecondaryBonusRate } from './infinite-buy-target-table';
import { applyAccumulatedQuota } from './infinite-buy-quota.util';
import { tickSize } from '../../common/utils/tick-size.util';

const MDD_LIQUIDATE_STOCK_LOSS_THRESHOLD_DEFAULT = 0.20;
const SAME_CYCLE_MIN_PROFIT_RATE_DEFAULT = 0.006;

function pushQuotaAdjustment(
  details: Record<string, any>,
  label: string,
  multiplier: number,
): void {
  if (!Array.isArray(details.quotaAdjustments)) {
    details.quotaAdjustments = [];
  }
  details.quotaAdjustments.push({ label, multiplier });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getBuy2DipRate(
  stockIndicators: StockStrategyContext['stockIndicators'],
  mode: Buy2DipMode = 'atr-strong',
): number {
  const atrPercent = stockIndicators.atrPercent;
  const hasAtr = atrPercent !== undefined && Number.isFinite(atrPercent) && atrPercent > 0;
  switch (mode) {
    case 'atr-light':
      return hasAtr ? clamp((atrPercent! / 100) * 0.5, 0.005, 0.015) : 0.01;
    case 'atr-strong':
      return hasAtr ? clamp((atrPercent! / 100) * 1.0, 0.015, 0.05) : 0.025;
    case 'fixed-3pct':
      return 0.03;
    case 'fixed-5pct':
      return 0.05;
    default:
      return hasAtr ? clamp((atrPercent! / 100) * 1.0, 0.015, 0.05) : 0.025;
  }
}

// RSI 기반 매수금액 배수 (P4)
// 의도: 과열 구간에서만 매수금액 축소 + 하드 임계값(60/70/80) 경계 점프 제거
//  - RSI < 30: 1.25x (과매도 부스트)
//  - 30 ≤ RSI < 60: 1.0x (건전 구간, 조정 없음)
//  - 60 ≤ RSI < 80: 1.0 → 0.4 연속 선형 하향
//  - RSI ≥ 80: 0.4x (극단 과열)
//
// Backtest에서는 `policy`로 세 정책을 스위칭:
//  - 'none': 항상 1.0x (순수 DCA 효과)
//  - 'legacy-hard': 이전 4단계 하드 임계값 (30/60/70/80)
//  - 'continuous' (기본): 현재 정책
export function getRsiMultiplier(rsi: number | undefined, policy: RsiPolicy = 'hard-stop-70'): number {
  if (policy === 'none') return 1.0;
  if (rsi === undefined || !Number.isFinite(rsi)) return 1.0;

  if (policy === 'legacy-hard') {
    if (rsi < 30) return 1.25;
    if (rsi >= 80) return 0.4;
    if (rsi >= 70) return 0.6;
    if (rsi >= 60) return 0.85;
    return 1.0;
  }

  // Hard-stop 정책: 임계값 이상 → 매수 완전 중단 (quota 이월).
  if (policy === 'hard-stop-70' || policy === 'hard-stop-75' || policy === 'hard-stop-80') {
    const threshold = policy === 'hard-stop-70' ? 70 : policy === 'hard-stop-75' ? 75 : 80;
    if (rsi < 30) return 1.25;
    if (rsi >= threshold) return 0;
    return 1.0;
  }

  // continuous (default)
  if (rsi < 30) return 1.25;
  if (rsi < 60) return 1.0;
  if (rsi >= 80) return 0.4;
  return clamp(1.0 - (rsi - 60) * (0.6 / 20), 0.4, 1.0);
}

// buy2OnlyMode (Buy1 차단 + Buy2만 허용) 임계값을 rsiPolicy 와 일치시킴.
// hard-stop-* 만 활성: getRsiMultiplier 의 quota 차단 임계값과 동일한 RSI.
// none/continuous/legacy-hard 는 quota 감산만 적용 — buy2 강제 모드 비활성.
export function getBuy2OnlyThreshold(policy: RsiPolicy = 'hard-stop-70'): number | null {
  if (policy === 'hard-stop-70') return 70;
  if (policy === 'hard-stop-75') return 75;
  if (policy === 'hard-stop-80') return 80;
  return null;
}

function shouldUseSameDaySecondTarget(ctx: StockStrategyContext): boolean {
  const currentPrice = ctx.price.currentPrice;
  const ma20 = ctx.stockIndicators.ma20;
  const adx14 = ctx.stockIndicators.adx14;
  const rsi14 = ctx.stockIndicators.rsi14;
  const todayOpen = ctx.stockIndicators.todayOpen ?? ctx.price.openPrice;

  const aboveOpen = Number.isFinite(todayOpen) ? currentPrice >= Number(todayOpen) : true;
  const aboveMa20 = Number.isFinite(ma20) ? currentPrice >= Number(ma20) : true;
  const strongAdx = adx14 === undefined || adx14 >= 20;
  const healthyMomentum = rsi14 !== undefined && rsi14 >= 55 && rsi14 < 78;

  return aboveOpen && aboveMa20 && strongAdx && healthyMomentum;
}

function getTodayDate(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function getSecondaryExitPlan(strategyParams?: Record<string, any>): InfiniteBuySecondaryExitPlan | undefined {
  const plan = (strategyParams as InfiniteBuyStrategyParams | undefined)?.secondaryExitPlan;
  if (!plan) return undefined;
  if (
    !plan.firstTargetDate
    || !Number.isFinite(plan.secondTargetPrice)
    || !Number.isFinite(plan.secondTargetRate)
    || !Number.isFinite(plan.secondTargetQuantity)
  ) {
    return undefined;
  }
  return plan;
}

function isActiveSecondaryExitPlan(
  plan: InfiniteBuySecondaryExitPlan | undefined,
  today: string,
): boolean {
  if (!plan) return false;
  if (plan.secondTargetQuantity <= 0) return false;
  if (plan.firstTargetDate >= today) return false;
  return !plan.secondTargetAttemptedDate || plan.secondTargetAttemptedDate === today;
}


@Injectable()
export class InfiniteBuyStrategy implements PerStockTradingStrategy {
  readonly name = 'infinite-buy';
  readonly displayName = '무한매수법';
  readonly executionMode: ExecutionMode = {
    type: 'once-daily',
    hours: { domestic: 11, overseas: { basis: 'afterOpen', offsetHours: 2 } }, // 국내 11시, 해외 장 시작 2시간 후
  };
  readonly description = [
    '설정한 투자금(quota)을 분할 매수하는 전략입니다.',
    '',
    '【사이클(T) 계산 방식】',
    '- T = 누적 투자금액 / 1회 매수금액 (실제 체결 기준)',
    '- maxCycles(기본 40)는 "quota를 다 쓰는 기준"',
    '- Buy1만 체결되고 Buy2 미체결 시 T가 0.5만 증가',
    '- 둘 다 미체결 시 T 변동 없음, 다음 날 재시도',
    '- quota를 모두 소진하면(T ≥ maxCycles) 매수 중단 → 목표가 +5%로 탈출 가속',
    '- 사용자가 증권사 앱에서 수동 매수해도 자동 동기화(10분 주기)로 T에 반영됨',
    '',
    '【매수 조건】',
    '- 하루 1회, 장중 실행 (국내 11시, 해외 장 시작 2시간 후)',
    '- 하락장에서도 분할매수를 이어가되, RSI 과열/과매도와 초고변동성만 반영',
    '',
    '【RSI 과열 정책 (rsiPolicy, 기본: hard-stop-70)】',
    '- RSI < 30 과매도 구간: 매수금액 1.25배 증가 (모든 정책 공통)',
    '- hard-stop-70 (기본, 권장): RSI ≥ 70 시 매수 완전 중단 → 누적 이월',
    '- hard-stop-75: RSI ≥ 75 시 매수 중단 (완화)',
    '- hard-stop-80: RSI ≥ 80 시 매수 중단 (보수)',
    '- continuous: 60~80 구간 점진 감산 (RSI 60→1.0x, 80→0.4x 선형)',
    '- none: RSI 미반영 (순수 DCA)',
    '- 백테스트 결과 hard-stop-70이 7/8 티커에서 우위 (CAGR +0.5%p, MaxDD 개선)',
    '',
    '【매수 방식】',
    '- 기본적으로 Buy1(현재가) 70% + Buy2(현재가 아래 지정가) 30%로 분할 매수',
    '- 한쪽 주문 수량이 0주면 남는 예산을 반대쪽 주문으로 재배분해 총 매수 수량을 최대화',
    '- 매수금액이 1주 가격 미만이면 다음 사이클로 이월, 누적 후 매수',
    '- Buy2 지정가 할인폭(buy2DipMode, 기본 atr-strong): ATR%×1.0, 범위 1.5%~5% (무 ATR 시 2.5%)',
    '  · atr-light: 기존 정책 (ATR%×0.5, 0.5~1.5%)',
    '  · fixed-3pct / fixed-5pct: 고정 할인폭',
    '- Buy1은 즉시 체결, Buy2는 장중 가격 하락 시 체결',
    '- 미체결 시 장 마감 후 자동 취소, 다음 날 새 가격으로 재주문',
    '',
    '【누적 이월 + 일일 투입 상한】',
    '- RSI 과열 스킵이나 1주 미만 이월 시 perCycleQuota가 누적(accumulatedQuota)',
    '- 다음 매수 기회에 (perCycleQuota + accumulatedQuota) 투입',
    '- 일일 투입 상한(maxDailyQuotaMultiple, 기본 3): 하루 최대 3×perCycleQuota까지만 투입',
    '- 초과 누적은 다음 날로 이월되어 장기 과열 후 대량 일괄 투입을 방지',
    '',
    '【매도 조건】',
    '- 기본적으로 1차 목표가 1개만 계산하고, 도달 시 보유 수량의 50% 매도',
    '- 1차 매도 후 남은 50%는 체결 시점의 최신 시세/지표를 다시 평가해, 강한 추세면 같은 날 2차 목표가를 즉시 시도',
    '- 같은 날 2차 조건이 약하거나 주문 제출에 실패하면, 다음 거래일에 2차 목표가를 한 번 더 시도',
    '- 같은 날 2차 판단은 시가, 장중 VWAP, MA20, ADX, RSI, 고점 대비 눌림, 모멘텀 둔화, 장 마감 여유시간을 함께 확인',
    '- 국내는 누적 거래대금/거래량 기반 장중 VWAP, 해외는 5분봉 기반 분봉 VWAP를 사용',
    '- 2차 목표가 미체결 시 분할매도 상태를 해제하고 일반 무한매수 모드로 복귀',
    '- 목표수익률은 T가 높을수록 단계적으로 낮아져 탈출 우선 (사이클 완주 후 +5%)',
    '- 손절: 평균단가 대비 설정 손절률(기본 50%) 하회 시 전량 매도',
    '',
    '  T 구간    | 1차 목표 | 2차 추가',
    '  ----------+----------+----------',
    '   0 ~ <2   | +17.0%   | +3.0%p',
    '   2 ~ <4   | +15.0%   | +3.0%p',
    '   4 ~ <6   | +13.5%   | +2.6%p',
    '   6 ~ <8   | +12.0%   | +2.6%p',
    '   8 ~ <10  | +11.0%   | +2.2%p',
    '  10 ~ <12  | +10.0%   | +2.2%p',
    '  12 ~ <14  |  +9.5%   | +1.8%p',
    '  14 ~ <16  |  +9.0%   | +1.8%p',
    '  16 ~ <18  |  +8.5%   | +1.8%p',
    '  18 ~ <20  |  +8.0%   | +1.8%p',
    '  20 ~ <24  |  +7.7%   | +1.4%p',
    '  24 ~ <28  |  +7.4%   | +1.4%p',
    '  28 ~ <32  |  +7.2%   | +1.1%p',
    '  32 ~ <36  |  +7.0%   | +1.1%p',
    '  36 ~ <40  |  +6.8%   | +1.1%p',
    '  ≥ 40 완주 |  +5.0%   | +1.1%p',
    '',
    '【특징】',
    '- 장기 분할매수에 적합, 하락장에서 평균단가를 낮추는 전략',
    '- 시초가 변동 안정 후 주문하여 적정 가격에 진입',
    '- Buy2 지정가는 장 마감까지 체결 기회를 가짐',
    '- 1차 익절 후 강한 장중 추세면 같은 날 2차 익절까지 노리고, 아니면 다음 거래일에 한 번 더 노림',
    '',
    '【안전장치】',
    '- 투자유의/시장경고 종목은 신규 진입 차단',
    '- 실예수금 한도 내에서만 주문하며, 1주 미만이면 다음 날로 이월',
    '- 초고변동성 구간(30일 변동성 45% 이상)에서는 매수금액 15% 축소',
    '- 일일 투입 상한: 누적 이월금이 한 번에 투입되는 리스크 차단',
    '- 손절: 평균단가 대비 설정 손절률 하회 시 전량 매도',
    '- 포트폴리오 단위 MDD 관리 없음 (무한매수법 철학: "하락 시 매수")',
    '- 대신 종목 단위 방어선으로 리스크 제한:',
    '  · stopLossRate(기본 -50%): 종목 평단 대비 손실 시 청산',
    '  · quota 상한: 각 종목 투입 금액이 설정 한도 초과 불가',
    '  · 수학적으로 최대 손실 = sum(quota × stopLossRate)',
  ].join('\n');
  readonly meta: StrategyMeta = {
    riskLevel: 'medium',
    // 무한매수법은 종목별 손절(stopLossRate, 기본 -50%) + quota 상한으로 리스크 관리.
    // 포트폴리오 단위 MDD는 "하락 시 매수" 철학과 충돌하므로 사실상 비활성화.
    // 최대 손실은 수학적으로 sum(quota × stopLossRate)로 자연 제한됨.
    mddBuyBlock: -0.99,
    mddLiquidate: -0.99,
    expectedReturn: '1차 +5.0~17%, 2차 +6.1~20%',
    maxLoss: '-50% (종목별 손절 기본값)',
    investmentPeriod: '3개월~1년',
    tradingFrequency: '하루 1회 장중 자동 매수 (국내 11시, 해외 장 시작 2시간 후), RSI 과열 시 스킵',
    suitableFor: ['장기 분할매수 선호 투자자', '하락장 대응', '적립식 투자'],
    tags: ['분할매수', 'DCA', '장기투자', '국내/해외', 'RSI 필터'],
  };
  private readonly logger = new Logger(InfiniteBuyStrategy.name);

  async evaluateStock(ctx: StockStrategyContext): Promise<StrategyEvaluationResult> {
    const { watchStock, price, position, marketCondition, stockIndicators, riskState } = ctx;
    const signals: TradingSignal[] = [];
    const skipReasons: string[] = [];
    const details: Record<string, any> = {};

    // 2. quota 미설정 → skip
    if (!watchStock.quota || watchStock.quota <= 0) {
      this.logger.debug(`[${watchStock.stockCode}] No quota set, skip`);
      skipReasons.push('Quota 미설정');
      return { signals, skipReasons };
    }

    const curPrice = price.currentPrice;
    if (curPrice <= 0) {
      this.logger.warn(`[${watchStock.stockCode}] Invalid current price: ${curPrice}`);
      skipReasons.push(`유효하지 않은 현재가 (${curPrice})`);
      return { signals, skipReasons };
    }

    const market = watchStock.market;
    const exchangeCode = watchStock.exchangeCode;
    const isOverseas = market === 'OVERSEAS';
    const hasPosition = !!position && position.quantity > 0;
    const strategyParams = (watchStock.strategyParams as InfiniteBuyStrategyParams | undefined) || {};
    const today = getTodayDate();
    const configuredSameCycleMinProfitRate = Number(strategyParams.sameCycleMinProfitRate);
    const sameCycleMinProfitRate =
      Number.isFinite(configuredSameCycleMinProfitRate) && configuredSameCycleMinProfitRate >= 0
        ? configuredSameCycleMinProfitRate
        : SAME_CYCLE_MIN_PROFIT_RATE_DEFAULT;

    // --- 기본 무한매수법 계산 ---
    const quota = watchStock.quota;
    const totalInvested = position?.totalInvested || 0;
    const perCycleQuota = quota / watchStock.maxCycles;
    const remainingQuota = Math.max(0, quota - totalInvested);
    const T = totalInvested > 0 ? totalInvested / perCycleQuota : 0; // T = 완료 사이클 수
    const avgPrice = position?.avgPrice || curPrice;
    const holdQty = position?.quantity || 0;
    const riskReason = riskState?.reasons?.join(', ')
      || `MDD ${((riskState?.drawdown ?? 0) * 100).toFixed(1)}%`;

    details.T = T;
    details.avgPrice = avgPrice;
    details.holdQty = holdQty;
    details.perCycleQuota = perCycleQuota;
    details.remainingQuota = remainingQuota;

    // 가격 반올림 함수
    const roundPrice = isOverseas
      ? (p: number) => Math.round(p * 100) / 100  // 소수점 2자리
      : (p: number) => Math.round(p);              // 정수
    const ceilPriceToTick = (p: number) => {
      const tick = tickSize(isOverseas, p);
      const ceiled = Math.ceil((p / tick) - 1e-9) * tick;
      return roundPrice(ceiled);
    };
    // 익절 매도 주문 가격 결정:
    // - target이 현재가 1틱 이상 위 → target 그대로 (호가창 위쪽 등록, 정상)
    // - target이 현재가 이하 + 같은 사이클 BUY가 있음 → 비용버퍼 위로 호가를 올려
    //   상승 중 의미 없는 즉시 왕복매매를 방지한다.
    // - target이 현재가 이하 + 같은 사이클 BUY가 없음 → 기존 즉시 청산 동작 유지.
    const takeProfitOrderPrice = (targetPrice: number, sameCycleBuyPrices: number[] = []) => {
      const targetRounded = roundPrice(targetPrice);
      const currentRounded = roundPrice(curPrice);
      const tick = tickSize(isOverseas, currentRounded);
      if (targetRounded >= currentRounded + tick) return targetRounded;
      if (sameCycleBuyPrices.length > 0) {
        const referenceBuyPrice = Math.max(currentRounded, ...sameCycleBuyPrices);
        return ceilPriceToTick(referenceBuyPrice * (1 + sameCycleMinProfitRate));
      }
      return roundPrice(currentRounded - tick);
    };
    const takeProfitPriceNote = (
      orderPrice: number,
      targetPrice: number,
      sameCycleBuyPrices: number[] = [],
    ) => {
      const currentRounded = roundPrice(curPrice);
      const tick = tickSize(isOverseas, currentRounded);
      // 정상: target이 현재가 +1틱 이상 위 → orderPrice = target → 표기 없음
      if (targetPrice >= currentRounded + tick) return '';
      if (sameCycleBuyPrices.length > 0 && orderPrice >= currentRounded + tick) {
        return (
          ` (목표가 ${targetPrice} ≤ 현재가 → ${orderPrice} 비용버퍼 ` +
          `${(sameCycleMinProfitRate * 100).toFixed(1)}% 상향, 자전거래/수수료 방지)`
        );
      }
      return ` (목표가 ${targetPrice} ≤ 현재가 → ${orderPrice} 즉시 청산, 자전거래 회피)`;
    };

    // 기존 riskState가 전량청산을 요청해도 손실이 큰 종목만 정리한다.
    // 수익/소폭 손실 종목은 유지해 포트폴리오 MDD가 건강한 종목까지 휩쓸지 않게 한다.
    if (riskState?.liquidateAll && hasPosition) {
      const configuredThreshold = strategyParams.mddLiquidateStockLossThreshold;
      const stockLossThreshold = typeof configuredThreshold === 'number'
        && Number.isFinite(configuredThreshold)
        ? configuredThreshold
        : MDD_LIQUIDATE_STOCK_LOSS_THRESHOLD_DEFAULT;
      const stockLossRate = avgPrice > 0 ? (avgPrice - curPrice) / avgPrice : 0;
      details.mddTriggered = true;
      details.mddStockLossRate = stockLossRate;
      details.mddStockLossThreshold = stockLossThreshold;

      if (stockLossRate >= stockLossThreshold) {
        this.logger.log(
          `[${watchStock.stockCode}] RISK LIQUIDATION: ${riskReason}, ` +
          `stockLoss=${(stockLossRate * 100).toFixed(1)}%, ` +
          `threshold=${(stockLossThreshold * 100).toFixed(0)}%, quantity=${holdQty}`,
        );
        signals.push({
          market,
          exchangeCode,
          stockCode: watchStock.stockCode,
          side: 'SELL',
          quantity: holdQty,
          price: roundPrice(curPrice),
          reason:
            `리스크 청산: ${riskReason}, 종목 손실 ${(stockLossRate * 100).toFixed(1)}% ` +
            `≥ ${(stockLossThreshold * 100).toFixed(0)}%`,
          orderDivision: '00',
          metadata: { phase: 'risk-liquidation' },
        });
        return { signals, skipReasons };
      }
    }

    // --- 손절: 포지션 보유 중이면 항상 체크 (alreadyExecutedToday, maxCycles 무관) ---
    if (hasPosition && curPrice < avgPrice * (1 - watchStock.stopLossRate)) {
      this.logger.log(
        `[${watchStock.stockCode}] STOP LOSS triggered: cur=${curPrice}, avg=${avgPrice}, rate=${watchStock.stopLossRate}`,
      );
      signals.push({
        market,
        exchangeCode,
        stockCode: watchStock.stockCode,
        side: 'SELL',
        quantity: holdQty,
        price: roundPrice(curPrice),
        reason: `Stop loss: T=${T.toFixed(1)}, loss=${((1 - curPrice / avgPrice) * 100).toFixed(1)}%`,
        orderDivision: '00', // 손절은 지정가
      });
      return { signals, skipReasons };
    }

    // 1. 오늘 이미 실행 → skip (손절은 위에서 이미 체크)
    if (ctx.alreadyExecutedToday) {
      skipReasons.push('오늘 이미 실행됨');
      return { signals, skipReasons };
    }

    const secondaryExitPlan = getSecondaryExitPlan(strategyParams);
    if (hasPosition && isActiveSecondaryExitPlan(secondaryExitPlan, today)) {
      const remainingQty = Math.min(holdQty, secondaryExitPlan!.secondTargetQuantity);
      const targetPrice = roundPrice(secondaryExitPlan!.secondTargetPrice);
      const orderPrice = takeProfitOrderPrice(secondaryExitPlan!.secondTargetPrice);

      if (remainingQty > 0 && orderPrice > 0) {
        signals.push({
          market,
          exchangeCode,
          stockCode: watchStock.stockCode,
          side: 'SELL',
          quantity: remainingQty,
          price: orderPrice,
          reason:
            `Take profit 2: T=${T.toFixed(1)}, +${(secondaryExitPlan!.secondTargetRate * 100).toFixed(1)}%, ` +
            `${remainingQty}주 @ ${orderPrice}${takeProfitPriceNote(orderPrice, targetPrice)}`,
          orderDivision: '00',
          metadata: {
            phase: 'take-profit-2',
            targetPrice,
          },
        });
      }

      return { signals, skipReasons };
    }

    // 가격 과열/과매도와 초고변동성만 최소 반영
    details.marketCondition = marketCondition;
    details.stockIndicators = stockIndicators;

    if (!hasPosition) {
      if (riskState?.buyBlocked) {
        skipReasons.push(`리스크 매수 차단: ${riskReason}`);
        return { signals, skipReasons };
      }
      if (stockIndicators.investCautionYn) {
        skipReasons.push('투자유의 종목');
        return { signals, skipReasons };
      }
      if (stockIndicators.marketWarnCode && stockIndicators.marketWarnCode !== '00') {
        skipReasons.push(`시장경고 종목 (코드: ${stockIndicators.marketWarnCode})`);
        return { signals, skipReasons };
      }
    }

    // T >= maxCycles → 매수 중단 (매도 시그널은 계속 생성)
    const maxCyclesReached = T >= watchStock.maxCycles || remainingQuota <= 0;
    const cycleCompleted = maxCyclesReached;
    details.cycleCompleted = cycleCompleted;
    if (maxCyclesReached) {
      this.logger.log(`[${watchStock.stockCode}] Cycle completed (T=${T.toFixed(1)}/${watchStock.maxCycles}), buy stopped`);
    }

    // --- 1회 매수금액 (P3: accumulatedQuota 유틸 사용) ---
    const quotaResult = applyAccumulatedQuota({
      baseQuota: perCycleQuota,
      params: strategyParams,
      remainingQuota,
    });
    const accumulatedQuota = quotaResult.carriedIn;
    const baseQuota = quotaResult.combinedQuota;
    let adjustedQuota = maxCyclesReached ? 0 : quotaResult.cappedQuota;
    details.accumulatedQuota = accumulatedQuota;
    details.accumulatedQuotaCarriedIn = quotaResult.carriedIn;
    details.baseQuota = baseQuota;

    // RSI 기반 매수금액 조정 (P4: 선형 연속 곡선, backtest 시 policy 스위칭 지원)
    if (stockIndicators.rsi14 !== undefined) {
      const rsi = stockIndicators.rsi14;
      const rsiMultiplier = getRsiMultiplier(rsi, strategyParams.rsiPolicy);
      if (rsiMultiplier !== 1.0) {
        adjustedQuota *= rsiMultiplier;
        details.quotaAdjust_rsi = true;
        pushQuotaAdjustment(
          details,
          `RSI ${rsi.toFixed(1)} → ${rsiMultiplier.toFixed(2)}x`,
          rsiMultiplier,
        );
      }
    }

    if ((stockIndicators.volatility30d ?? 0) >= 45) {
      adjustedQuota *= 0.85;
      details.quotaAdjust_volatility = true;
      pushQuotaAdjustment(details, `30일 변동성 ${stockIndicators.volatility30d!.toFixed(1)}% ≥ 45%`, 0.85);
    }

    // 일일 투입 상한 (P7: hard-stop 정책 후 누적 quota 일괄 투입 방지)
    //   baseQuota + accumulatedQuota가 너무 크면 N×perCycleQuota로 제한.
    //   초과분은 details.dailyCapCarryOut에 기록되어 백테스트/시뮬레이션 엔진이 이월 처리.
    const maxDailyMultiple = Number(strategyParams.maxDailyQuotaMultiple) > 0
      ? Number(strategyParams.maxDailyQuotaMultiple)
      : 3;
    const dailyCap = maxDailyMultiple * perCycleQuota;
    if (adjustedQuota > dailyCap) {
      const carryOut = adjustedQuota - dailyCap;
      details.dailyCapApplied = true;
      details.dailyCapCarryOut = carryOut;
      adjustedQuota = dailyCap;
      pushQuotaAdjustment(details, `일일 상한 ${maxDailyMultiple}×perCycle → ${dailyCap.toFixed(0)}`, dailyCap / (baseQuota || 1));
    }

    details.preCashCappedQuota = adjustedQuota;

    // 개선 D: 가용자금 한도
    adjustedQuota = Math.min(adjustedQuota, ctx.buyableAmount);

    details.adjustedQuota = adjustedQuota;

    const riskBuyBlocked = Boolean(riskState?.buyBlocked);
    const buyAllowed = adjustedQuota > 0 && !riskBuyBlocked;

    if (!buyAllowed && !maxCyclesReached && !riskBuyBlocked && ctx.buyableAmount <= 0) {
      details.minimumExecutablePrice = 0;
      skipReasons.push(
        `매수 수량 부족: 주문가능금액 ${ctx.buyableAmount.toFixed(0)}으로 1주 매수 불가`,
      );
    } else if (!buyAllowed && !maxCyclesReached && !riskBuyBlocked && ctx.buyableAmount > 0) {
      // RSI policy에 의해 quota가 0이 된 경우 (예: hard-stop-70): 이월 가능한 skip reason 발행
      const rsi = stockIndicators.rsi14;
      details.minimumExecutablePrice = 0;
      skipReasons.push(
        `매수 수량 부족: RSI 과열 (${rsi !== undefined ? rsi.toFixed(1) : 'n/a'}) 정책에 따른 매수 중단`,
      );
    }

    let buySignalCount = 0;
    let buy1QtyLogged = 0;
    let buy2QtyLogged = 0;
    let buy1PriceLogged = 0;
    let buy2PriceLogged = 0;
    let dipRateLogged = 0;

    if (buyAllowed) {
      // --- 매수 시그널 ---
      const dipRate = getBuy2DipRate(stockIndicators, strategyParams.buy2DipMode);
      details.buy2DipMode = strategyParams.buy2DipMode ?? 'atr-strong';
      const buy1Price = roundPrice(curPrice);
      const buy2Price = roundPrice(curPrice * (1 - dipRate));

      const buy1Quota = adjustedQuota * 0.7;
      const buy2Quota = adjustedQuota * 0.3;
      const buy2OnlyThreshold = getBuy2OnlyThreshold(strategyParams.rsiPolicy);
      const buy2OnlyMode =
        buy2OnlyThreshold !== null
        && stockIndicators.rsi14 !== undefined
        && stockIndicators.rsi14 >= buy2OnlyThreshold;
      let buy1Qty = buy2OnlyMode ? 0 : Math.floor(buy1Quota / buy1Price);
      let buy2Qty = Math.floor(buy2Quota / buy2Price);
      let buy1ReasonShare = buy2OnlyMode ? '차단' : '70%';
      let buy2ReasonShare = '30%';

      buy1PriceLogged = buy1Price;
      buy2PriceLogged = buy2Price;
      dipRateLogged = dipRate;
      details.buy2OnlyMode = buy2OnlyMode;

      // 분할 매수 불가 시 전액으로 단일 매수 (고가주 대응)
      if (buy1Qty === 0 && buy2Qty === 0) {
        if (buy2OnlyMode) {
          buy2Qty = Math.floor(adjustedQuota / buy2Price);
          if (buy2Qty > 0) {
            buy2ReasonShare = '100%';
          }
        } else {
          buy1Qty = Math.floor(adjustedQuota / buy1Price);
          if (buy1Qty > 0) {
            buy1ReasonShare = '100%';
          }
        }
      }

      const spentBySplit = buy1Qty * buy1Price + buy2Qty * buy2Price;
      let remainingBudget = Math.max(0, adjustedQuota - spentBySplit);

      // 한쪽 주문이 0주가 되면 남은 예산을 반대쪽 주문으로 재배분해 총 수량 낭비를 줄인다.
      if (buy1Qty > 0 && buy2Qty === 0 && buy1Price > 0) {
        const extraBuy1Qty = Math.floor(remainingBudget / buy1Price);
        if (extraBuy1Qty > 0) {
          buy1Qty += extraBuy1Qty;
          remainingBudget -= extraBuy1Qty * buy1Price;
          buy1ReasonShare = '70%+잔여재배분';
          details.buyQuotaReallocatedTo = 'Buy1';
          details.reallocatedQuantity = extraBuy1Qty;
          details.remainingBudgetAfterReallocation = remainingBudget;
        }
      } else if (buy1Qty === 0 && buy2Qty > 0 && buy2Price > 0) {
        const extraBuy2Qty = Math.floor(remainingBudget / buy2Price);
        if (extraBuy2Qty > 0) {
          buy2Qty += extraBuy2Qty;
          remainingBudget -= extraBuy2Qty * buy2Price;
          buy2ReasonShare = buy2OnlyMode ? '100%+잔여재배분' : '30%+잔여재배분';
          details.buyQuotaReallocatedTo = 'Buy2';
          details.reallocatedQuantity = extraBuy2Qty;
          details.remainingBudgetAfterReallocation = remainingBudget;
        }
      }

      buy1QtyLogged = buy1Qty;
      buy2QtyLogged = buy2Qty;
      details.buy1Qty = buy1Qty;
      details.buy2Qty = buy2Qty;
      details.buy1Price = buy1Price;
      details.buy2Price = buy2Price;
      details.dipRate = dipRate;

      if (buy1Qty > 0 && buy1Price > 0) {
        signals.push({
          market,
          exchangeCode,
          stockCode: watchStock.stockCode,
          side: 'BUY',
          quantity: buy1Qty,
          price: buy1Price,
          reason: `Buy1: T=${T.toFixed(1)}, ${buy1ReasonShare}, ${buy1Qty}주 @ ${buy1Price}`,
          orderDivision: '00',
        });
        buySignalCount++;
      }

      if (buy2Qty > 0 && buy2Price > 0) {
        signals.push({
          market,
          exchangeCode,
          stockCode: watchStock.stockCode,
          side: 'BUY',
          quantity: buy2Qty,
          price: buy2Price,
          reason: `Buy2: T=${T.toFixed(1)}, dip=${(dipRate * 100).toFixed(2)}%, ${buy2ReasonShare}, ${buy2Qty}주 @ ${buy2Price}`,
          orderDivision: '00',
        });
        buySignalCount++;
      }

      if (buySignalCount === 0) {
        const referencePrice = Math.min(buy1Price, buy2Price);
        details.minimumExecutablePrice = roundPrice(referencePrice);
        if (remainingQuota > 0 && remainingQuota < referencePrice) {
          details.terminalQuotaReached = true;
          skipReasons.push(
            `사이클 완주 임박: 잔여 투자한도 ${remainingQuota.toFixed(0)} < 기준가 ${roundPrice(referencePrice)}`,
          );
        } else {
          skipReasons.push(
            `매수 수량 부족: 조정 할당금 ${adjustedQuota.toFixed(0)} < 기준가 ${roundPrice(referencePrice)} ` +
            `(1주 매수 가능 기준가 ${roundPrice(adjustedQuota)} 이하)`,
          );
        }
      }
    }

    // --- 매도 시그널 (항상 생성, 지수 상태 무관) ---
    if (holdQty > 0) {
      const sameCycleBuyPrices = signals
        .filter((signal) => signal.side === 'BUY' && typeof signal.price === 'number')
        .map((signal) => signal.price as number);
      const sameCycleProfitMetadata = sameCycleBuyPrices.length > 0
        ? { sameCycleMinProfitRate }
        : {};
      const tableOverride = strategyParams.targetTableOverride;
      const targetProfitRate = lookupTargetProfitRate(T, tableOverride);
      const targetPrice = roundPrice(avgPrice * (1 + targetProfitRate));
      const orderPrice = takeProfitOrderPrice(avgPrice * (1 + targetProfitRate), sameCycleBuyPrices);
      const firstSellQty = holdQty >= 2 ? Math.ceil(holdQty / 2) : holdQty;
      const secondSellQty = holdQty - firstSellQty;
      const secondaryTargetRate = targetProfitRate + lookupSecondaryBonusRate(T, tableOverride);
      const secondaryTargetPrice = takeProfitOrderPrice(
        avgPrice * (1 + secondaryTargetRate),
        sameCycleBuyPrices,
      );
      const takeProfitNote = takeProfitPriceNote(orderPrice, targetPrice, sameCycleBuyPrices);

      if (orderPrice > 0) {
        signals.push({
          market,
          exchangeCode,
          stockCode: watchStock.stockCode,
          side: 'SELL',
          quantity: firstSellQty,
          price: orderPrice,
          reason:
            secondSellQty > 0
              ? `Take profit 1: T=${T.toFixed(1)}, +${(targetProfitRate * 100).toFixed(1)}%, ${firstSellQty}주 @ ${orderPrice}${takeProfitNote}`
              : `Take profit: T=${T.toFixed(1)}, +${(targetProfitRate * 100).toFixed(1)}%, ${firstSellQty}주 @ ${orderPrice}${takeProfitNote}`,
          orderDivision: '00',
          metadata: secondSellQty > 0
            ? {
                phase: 'take-profit-1',
                tValue: T,
                targetPrice,
                secondaryTargetPrice,
                secondaryTargetRate,
                secondaryTargetQuantity: secondSellQty,
                sameDaySecondaryEligible: shouldUseSameDaySecondTarget(ctx),
                ...sameCycleProfitMetadata,
              }
            : sameCycleBuyPrices.length > 0
              ? sameCycleProfitMetadata
              : undefined,
        });
      }
    }
    if (!hasPosition && !buyAllowed) {
      // 포지션 없고 매수 불가
      if (maxCyclesReached) {
        skipReasons.push(`사이클 완주 (T=${T.toFixed(1)}/${watchStock.maxCycles}), 청산 대기 중`);
      } else if (riskBuyBlocked) {
        skipReasons.push(`리스크 매수 차단: ${riskReason}`);
      }
    }

    if (hasPosition && cycleCompleted && holdQty > 0) {
      skipReasons.push(`사이클 완주 (T=${T.toFixed(1)}/${watchStock.maxCycles}), 매수 중단`);
    }

    const quotaAdjustments = Array.isArray(details.quotaAdjustments)
      ? details.quotaAdjustments
          .map((item: { label?: string; multiplier?: number }) =>
            `${item.label ?? 'unknown'} x${Number(item.multiplier ?? 1).toFixed(2)}`,
          )
          .join(', ')
      : 'none';

    this.logger.log(
      `[${watchStock.stockCode}] T=${T.toFixed(1)}, signals=${signals.length}, buySignals=${buySignalCount}, ` +
      `baseQuota=${perCycleQuota.toFixed(0)}, accumulated=${accumulatedQuota.toFixed(0)}, adjustedQuota=${adjustedQuota.toFixed(0)}, ` +
      `buyable=${ctx.buyableAmount.toFixed(0)}, RSI=${stockIndicators.rsi14?.toFixed(2) ?? 'n/a'}, ` +
      `vol30=${stockIndicators.volatility30d?.toFixed(2) ?? 'n/a'}, adjustments=${quotaAdjustments}, ` +
      `buy2Only=${details.buy2OnlyMode ? 'Y' : 'N'}, ` +
      `buy1=${buy1QtyLogged}@${buy1PriceLogged || 0}, buy2=${buy2QtyLogged}@${buy2PriceLogged || 0}, ` +
      `dip=${(dipRateLogged * 100).toFixed(2)}%`,
    );

    return { signals, skipReasons, details };
  }
}
