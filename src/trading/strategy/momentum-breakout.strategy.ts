import { Injectable, Logger } from '@nestjs/common';
import {
  PerStockTradingStrategy,
  StockStrategyContext,
  TradingSignal,
  StrategyEvaluationResult,
  ExecutionMode,
  StrategyMeta,
  evaluateStrategyMdd,
  MomentumBreakoutStrategyParams,
} from '../types';

const DEFAULT_PARAMS = {
  kValue: 0.5,
  stopLossRate: 0.02,
  trailingStopEnabled: true,
  trailingStopRate: 0.02,
  takeProfitEnabled: false,
  takeProfitRate: 0.05,
  useMa20Filter: true,
  volumeMultiplier: 1.0,
  minSoftConditions: 2,
  maxChaseRate: 0.01,
  entryStartTime: '09:05',
  entryEndTime: '14:30',
  exitTime: '15:10',
};

type ResolvedParams = typeof DEFAULT_PARAMS & MomentumBreakoutStrategyParams;

const KRX_OPEN_MINUTES = 9 * 60; // 09:00
const KRX_SESSION_MINUTES = 390; // 09:00 ~ 15:30
const MIN_ELAPSED_MINUTES = 5; // 시간보정 거래량 분모 하한 (장 시작 직후 0 나누기 방지)

/** KST 기준 날짜(YYYY-MM-DD)와 자정 이후 경과 분 */
function toKst(now: Date): { date: string; minutes: number } {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return {
    date: kst.toISOString().slice(0, 10),
    minutes: kst.getUTCHours() * 60 + kst.getUTCMinutes(),
  };
}

function parseTimeToMinutes(value: string | undefined, fallbackMinutes: number): number {
  if (!value) return fallbackMinutes;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return fallbackMinutes;
  return Number(match[1]) * 60 + Number(match[2]);
}

interface SoftConditionScore {
  evaluable: number;
  passed: number;
  required: number;
  satisfied: boolean;
  notes: string[];
}

@Injectable()
export class MomentumBreakoutStrategy implements PerStockTradingStrategy {
  readonly name = 'momentum-breakout';
  readonly displayName = '변동성 돌파 (당일청산)';
  readonly executionMode: ExecutionMode = { type: 'continuous' };
  readonly description = [
    '래리 윌리엄스 변동성 돌파 기반의 국내(KRX) 전용 당일청산 데이트레이딩 전략입니다.',
    '돌파가 = 당일 시가 + 전일 변동폭 × K(기본 0.5). 장중 매 분 평가하며 1일 최대 1회 진입합니다.',
    '',
    '【진입 (hard 조건 — 모두 충족)】',
    '- 진입 시간 윈도우 내 (기본 09:05~14:30 KST)',
    '- 현재가 ≥ 돌파가, 그리고 돌파가 +1% 이내 (추격 매수 금지)',
    '- 현재가 > 20일 이동평균 (추세 필터 — MA20 아래 돌파는 통계적 엣지 없음)',
    '- RSI14 ≤ 75 (과열 차단)',
    '- 투자유의/시장경고/단기과열 종목 제외, MDD 리스크 매수차단 준수',
    '',
    '【진입 (soft 조건 — 평가 가능한 항목 중 2개 이상)】',
    '- 시간보정 거래량: 당일 누적거래량 ≥ 20일 평균 × 경과시간 비율',
    '- 현재가 ≥ 당일 VWAP (누적거래대금/누적거래량)',
    '- 수급 매수 우위 (외인/기관/프로그램 중 하나 이상)',
    '',
    '【청산 (우선순위 순, 전량 시장가)】',
    '1. 리스크 전량청산 (MDD 임계 초과)',
    '2. 이월청산: 전일 진입분이 남아있으면 즉시 정리 (당일청산 실패 안전망)',
    '3. 손절: 평균단가 대비 -2% (기본)',
    '4. 트레일링: 당일 고가 대비 -2% (기본 활성)',
    '5. 익절: +5% (기본 비활성 — 당일청산이 기본 출구)',
    '6. 당일청산: 15:10 (기본) 장 마감 전 전량 정리',
    '',
    '【주의】',
    '- 국내 전용. 해외 종목에는 신호를 생성하지 않습니다.',
    '- 모든 주문은 시장가 — 유동성 좋은 종목에만 사용하세요.',
    '- 매도세(거래세+수수료+슬리피지) 왕복 약 0.3~0.5%를 고려해 빈번한 소액 매매는 불리합니다.',
  ].join('\n');
  readonly meta: StrategyMeta = {
    riskLevel: 'high',
    mddBuyBlock: -0.08,
    mddLiquidate: -0.12,
    expectedReturn: '건당 +0.5~3% (당일)',
    maxLoss: '-2% (손절) + 슬리피지',
    investmentPeriod: '당일 (오버나잇 없음)',
    tradingFrequency: '장중 매 분 감시, 1일 최대 1회 진입',
    suitableFor: ['데이트레이딩 선호', '유동성 높은 대형주', '적극적 투자자'],
    tags: ['단기매매', '변동성돌파', '데이트레이딩', '국내전용'],
  };
  private readonly logger = new Logger(MomentumBreakoutStrategy.name);

  async evaluateStock(ctx: StockStrategyContext): Promise<StrategyEvaluationResult> {
    const signals: TradingSignal[] = [];
    const skipReasons: string[] = [];
    const params: ResolvedParams = {
      ...DEFAULT_PARAMS,
      ...((ctx.watchStock.strategyParams as MomentumBreakoutStrategyParams | undefined) ?? {}),
    };
    const kstNow = toKst(ctx.now ?? new Date());

    if (ctx.price.currentPrice <= 0) {
      skipReasons.push('유효하지 않은 현재가');
      return { signals, skipReasons };
    }

    const hasPosition = !!ctx.position && ctx.position.quantity > 0;
    const mddCheck = ctx.riskState
      ? evaluateStrategyMdd(ctx.riskState.drawdown, this.meta.mddBuyBlock, this.meta.mddLiquidate)
      : undefined;

    if (hasPosition) {
      return this.evaluateExit(ctx, params, kstNow, mddCheck);
    }

    if (ctx.evaluationMode === 'daily-bar') {
      return this.evaluateDailyBarEntry(ctx, params);
    }
    return this.evaluateRealtimeEntry(ctx, params, kstNow, mddCheck);
  }

  // ── 청산 ──────────────────────────────────────────────

  private evaluateExit(
    ctx: StockStrategyContext,
    params: ResolvedParams,
    kstNow: { date: string; minutes: number },
    mddCheck?: { buyBlocked: boolean; liquidateAll: boolean },
  ): StrategyEvaluationResult {
    const signals: TradingSignal[] = [];
    const skipReasons: string[] = [];
    const position = ctx.position!;
    const curPrice = ctx.price.currentPrice;

    // 백테스트(daily-bar)에서는 진입 신호의 stop/eod 메타데이터로 엔진이
    // 같은 bar 안에서 청산을 처리하므로 포지션이 이월되지 않는다.
    if (ctx.evaluationMode === 'daily-bar') {
      skipReasons.push('관망: daily-bar 모드 청산은 백테스트 엔진이 처리');
      return { signals, skipReasons };
    }

    const sellAll = (reason: string, phase: string): StrategyEvaluationResult => {
      this.logger.log(`[${ctx.watchStock.stockCode}] SELL(${phase}): ${reason}`);
      signals.push({
        market: ctx.watchStock.market,
        exchangeCode: ctx.watchStock.exchangeCode,
        stockCode: ctx.watchStock.stockCode,
        side: 'SELL',
        quantity: position.quantity,
        // price 미지정 = 시장가. 데이트레이드 청산은 체결 확실성 우선
        reason,
        metadata: { phase },
      });
      return { signals, skipReasons };
    };

    // ── 강제 청산 (1~3) — 미체결 매도 가드를 우회한다.
    // stale 미체결 SELL(수동 지정가 등)이 가드를 영구 점유하면 포지션이 밤을 넘기므로,
    // 오버나잇 방지가 우선. 중복 제출은 KIS 주문가능수량 검증에서 거부된다.

    // 1. 리스크 전량청산
    if (mddCheck?.liquidateAll) {
      const drawdown = ctx.riskState!.drawdown;
      return sellAll(
        `리스크 전량청산: MDD ${(drawdown * 100).toFixed(1)}% (임계 ${(this.meta.mddLiquidate * 100).toFixed(0)}%)`,
        'risk-liquidation',
      );
    }

    // 2. 이월청산 — 전일 진입분 잔존 (당일청산 실패/재시작 안전망)
    const strategyParams = (ctx.watchStock.strategyParams ?? {}) as MomentumBreakoutStrategyParams;
    if (strategyParams.entryDate && strategyParams.entryDate < kstNow.date) {
      return sellAll(
        `이월청산: ${strategyParams.entryDate} 진입 포지션 정리`,
        'carryover-exit',
      );
    }

    // 3. 당일청산 (15:10 이후엔 손절/트레일링과 결과 동일 — 전량 시장가)
    const exitMinutes = parseTimeToMinutes(params.exitTime, parseTimeToMinutes(DEFAULT_PARAMS.exitTime, 910));
    if (kstNow.minutes >= exitMinutes) {
      return sellAll(`당일청산: ${params.exitTime} 장 마감 전 전량 정리`, 'eod-exit');
    }

    // ── 일반 청산 (4~6) — 미체결 매도 주문이 있으면 중복 발행 금지 (다음 루프 재평가)
    if (ctx.hasOpenSellOrder === true) {
      skipReasons.push('관망: 미체결 매도 주문 처리 대기');
      return { signals, skipReasons };
    }

    // 4. 손절
    const profitRate = (curPrice - position.avgPrice) / position.avgPrice;
    if (profitRate <= -params.stopLossRate) {
      return sellAll(
        `손절청산: ${(profitRate * 100).toFixed(1)}% <= -${(params.stopLossRate * 100).toFixed(1)}%`,
        'intraday-stop',
      );
    }

    // 5. 트레일링 — 당일 고가 대비
    const highPrice = ctx.price.highPrice;
    if (
      params.trailingStopEnabled
      && highPrice > 0
      && curPrice < highPrice * (1 - params.trailingStopRate)
    ) {
      return sellAll(
        `트레일링청산: 고가 ${highPrice} 대비 -${(params.trailingStopRate * 100).toFixed(1)}%`,
        'trailing-stop',
      );
    }

    // 6. 익절 (기본 비활성)
    if (params.takeProfitEnabled && profitRate >= params.takeProfitRate) {
      return sellAll(
        `익절청산: +${(profitRate * 100).toFixed(1)}% >= +${(params.takeProfitRate * 100).toFixed(1)}%`,
        'take-profit',
      );
    }

    skipReasons.push(`관망: 보유 유지 (수익률 ${(profitRate * 100).toFixed(1)}%)`);
    return { signals, skipReasons };
  }

  // ── 진입 (실시간) ──────────────────────────────────────

  private evaluateRealtimeEntry(
    ctx: StockStrategyContext,
    params: ResolvedParams,
    kstNow: { date: string; minutes: number },
    mddCheck?: { buyBlocked: boolean; liquidateAll: boolean },
  ): StrategyEvaluationResult {
    const signals: TradingSignal[] = [];
    const skipReasons: string[] = [];
    const curPrice = ctx.price.currentPrice;

    if (ctx.watchStock.market !== 'DOMESTIC') {
      // 설정 오류이지만 매 분 반복 평가되므로 관망 처리 (Slack/DB 로그 스팸 방지)
      this.logger.warn(`[${ctx.watchStock.stockCode}] momentum-breakout은 국내 전용 — 해외 종목 진입 불가`);
      skipReasons.push('관망: 국내 전용 전략 (해외 종목 미지원)');
      return { signals, skipReasons };
    }

    if (ctx.riskState?.buyBlocked || mddCheck?.buyBlocked) {
      skipReasons.push(`관망: 리스크 매수 차단 (${ctx.riskState?.reasons?.join(', ') || 'MDD'})`);
      return { signals, skipReasons };
    }

    if (ctx.hasOpenBuyOrder === true || ctx.hasOpenSellOrder === true) {
      skipReasons.push('관망: 미체결 주문 처리 대기');
      return { signals, skipReasons };
    }

    if (ctx.alreadyExecutedToday) {
      skipReasons.push('관망: 오늘 이미 매매 완료 (1일 1진입)');
      return { signals, skipReasons };
    }

    // 단일 종목 비중 한도
    if (ctx.position && ctx.totalPortfolioValue > 0) {
      const weight = ctx.position.totalInvested / ctx.totalPortfolioValue;
      if (weight > 0.15) {
        skipReasons.push(`관망: 단일 종목 비중 초과 (${(weight * 100).toFixed(1)}% > 15%)`);
        return { signals, skipReasons };
      }
    }

    // 투자유의/시장경고/단기과열 차단
    const ind = ctx.stockIndicators;
    if (ind.investCautionYn || ind.shortOverheatYn) {
      skipReasons.push(ind.investCautionYn ? '관망: 투자유의 종목 진입 제외' : '관망: 단기과열 종목 진입 제외');
      return { signals, skipReasons };
    }
    if (ind.marketWarnCode && ind.marketWarnCode !== '00') {
      skipReasons.push(`관망: 시장경고 종목 진입 제외 (코드 ${ind.marketWarnCode})`);
      return { signals, skipReasons };
    }

    // 진입 시간 윈도우
    const startMinutes = parseTimeToMinutes(params.entryStartTime, 545);
    const endMinutes = parseTimeToMinutes(params.entryEndTime, 870);
    if (kstNow.minutes < startMinutes || kstNow.minutes > endMinutes) {
      skipReasons.push(`관망: 진입 시간 윈도우 외 (${params.entryStartTime}~${params.entryEndTime})`);
      return { signals, skipReasons };
    }

    // RSI 과열 차단 (데이터 없으면 통과)
    if (ind.rsi14 !== undefined && ind.rsi14 > 75) {
      skipReasons.push(`관망: RSI 과열 (${ind.rsi14.toFixed(1)} > 75)`);
      return { signals, skipReasons };
    }

    // MA20 추세 필터 (hard) — 레짐 분석상 MA20 아래 돌파는 엣지 없음
    if (params.useMa20Filter && ind.ma20 !== undefined && curPrice <= ind.ma20) {
      skipReasons.push(`관망: MA20 하회 (${curPrice} <= ${ind.ma20.toFixed(0)}) — 추세 미확인`);
      return { signals, skipReasons };
    }

    // 돌파가 계산 — 시가는 fresh price.openPrice 우선 (일봉 캐시 오염 방어)
    const breakout = this.resolveBreakoutPrice(ctx, params);
    if ('skip' in breakout) {
      skipReasons.push(breakout.skip);
      return { signals, skipReasons };
    }
    const { breakoutPrice } = breakout;

    if (curPrice < breakoutPrice) {
      skipReasons.push(`관망: 돌파 대기 (현재가 ${curPrice} < 돌파가 ${breakoutPrice.toFixed(0)})`);
      return { signals, skipReasons };
    }

    const chaseLimit = breakoutPrice * (1 + params.maxChaseRate);
    if (curPrice > chaseLimit) {
      skipReasons.push(
        `관망: 추격 금지 (현재가 ${curPrice} > 돌파가 +${(params.maxChaseRate * 100).toFixed(1)}% = ${chaseLimit.toFixed(0)})`,
      );
      return { signals, skipReasons };
    }

    // soft 조건 채점
    const soft = this.scoreSoftConditions(ctx, params, kstNow.minutes);
    if (!soft.satisfied) {
      skipReasons.push(
        `관망: soft 조건 미충족 (${soft.passed}/${soft.evaluable}, 필요 ${soft.required}) — ${soft.notes.join(', ')}`,
      );
      return { signals, skipReasons, details: { breakoutPrice, soft } };
    }

    const quota = ctx.watchStock.quota || 0;
    const buyAmount = Math.min(quota, ctx.buyableAmount);
    const buyQty = Math.floor(buyAmount / curPrice);
    if (buyQty <= 0) {
      skipReasons.push(`관망: 주문 가능 수량 0 (할당금 ${quota}, 주문가능금액 ${ctx.buyableAmount})`);
      return { signals, skipReasons, details: { breakoutPrice, soft } };
    }

    this.logger.log(
      `[${ctx.watchStock.stockCode}] VB BUY: cur=${curPrice}, breakout=${breakoutPrice.toFixed(0)}, ` +
      `soft=${soft.passed}/${soft.evaluable}, qty=${buyQty}`,
    );
    signals.push({
      market: ctx.watchStock.market,
      exchangeCode: ctx.watchStock.exchangeCode,
      stockCode: ctx.watchStock.stockCode,
      side: 'BUY',
      quantity: buyQty,
      // price 미지정 = 시장가 — 돌파 직후 체결 확실성 우선 (추격 가드로 상한 보호)
      reason: `변동성돌파: 돌파가 ${breakoutPrice.toFixed(0)}, 현재가 ${curPrice}, soft ${soft.passed}/${soft.evaluable}`,
      metadata: { phase: 'vb-entry', breakoutPrice },
    });
    return { signals, skipReasons, details: { breakoutPrice, soft } };
  }

  // ── 진입 (백테스트 daily-bar) ──────────────────────────

  /**
   * 일봉 단위 평가: 장중 시세 의존 조건(시간 윈도우/추격 가드/soft)은 평가 불가하므로
   * 일봉 기반 hard 조건만 확인하고, 체결 판정은 백테스트 엔진에 위임하는
   * stop-entry 조건부 신호를 발행한다 (high ≥ 돌파가 → 체결, 같은 bar 청산).
   */
  private evaluateDailyBarEntry(
    ctx: StockStrategyContext,
    params: ResolvedParams,
  ): StrategyEvaluationResult {
    const signals: TradingSignal[] = [];
    const skipReasons: string[] = [];

    if (ctx.watchStock.market !== 'DOMESTIC') {
      skipReasons.push('국내 전용 전략 (해외 종목 미지원)');
      return { signals, skipReasons };
    }

    // meta MDD 매수차단(-8%)은 의도적으로 미적용: 단일 전략 equity 백테스트에서는
    // 거래가 멈추면 드로다운이 회복될 수 없어 영구 잠금(absorbing state)이 된다.
    // 엔진의 riskState.buyBlocked(-25% 파국 방지선)만 따른다.
    if (ctx.riskState?.buyBlocked) {
      skipReasons.push('리스크 매수 차단');
      return { signals, skipReasons };
    }

    const ind = ctx.stockIndicators;
    if (ind.rsi14 !== undefined && ind.rsi14 > 75) {
      skipReasons.push(`RSI 과열 (${ind.rsi14.toFixed(1)} > 75)`);
      return { signals, skipReasons };
    }

    // MA20 추세 필터 (hard) — realtime과 동일 기준 (백테스트 ctx의 ma20은
    // 당일 종가가 1/20 가중치로 섞인 근사치지만 필터 목적상 영향 미미)
    if (params.useMa20Filter && ind.ma20 !== undefined && ctx.price.currentPrice <= ind.ma20) {
      skipReasons.push(`MA20 하회 (${ctx.price.currentPrice} <= ${ind.ma20.toFixed(0)})`);
      return { signals, skipReasons };
    }

    const breakout = this.resolveBreakoutPrice(ctx, params);
    if ('skip' in breakout) {
      skipReasons.push(breakout.skip);
      return { signals, skipReasons };
    }
    const breakoutPrice = Math.round(breakout.breakoutPrice);

    const quota = ctx.watchStock.quota || 0;
    const buyAmount = Math.min(quota, ctx.buyableAmount);
    const buyQty = Math.floor(buyAmount / breakoutPrice);
    if (buyQty <= 0) {
      skipReasons.push('주문 가능 수량 0');
      return { signals, skipReasons };
    }

    signals.push({
      market: ctx.watchStock.market,
      exchangeCode: ctx.watchStock.exchangeCode,
      stockCode: ctx.watchStock.stockCode,
      side: 'BUY',
      quantity: buyQty,
      price: breakoutPrice,
      reason: `변동성돌파(백테스트): 돌파가 ${breakoutPrice}`,
      metadata: {
        phase: 'vb-entry',
        fillModel: 'stop-entry',
        exitModel: 'eod',
        breakoutPrice,
        // 가격이 아닌 rate 전달 — 엔진이 실제 체결가(슬리피지 포함) 기준으로
        // stop/익절가를 계산해 실거래(평균단가 기준)와 동일한 의미를 유지
        stopLossRate: params.stopLossRate,
        takeProfitRate: params.takeProfitEnabled ? params.takeProfitRate : undefined,
      },
    });
    return { signals, skipReasons, details: { breakoutPrice } };
  }

  // ── 공통 헬퍼 ──────────────────────────────────────────

  private resolveBreakoutPrice(
    ctx: StockStrategyContext,
    params: ResolvedParams,
  ): { breakoutPrice: number } | { skip: string } {
    const { prevHigh, prevLow } = ctx.stockIndicators;
    if (prevHigh === undefined || prevLow === undefined) {
      return { skip: '관망: 지표 부재 (전일 고가/저가)' };
    }

    const todayOpen = ctx.price.openPrice > 0 ? ctx.price.openPrice : ctx.stockIndicators.todayOpen;
    if (todayOpen === undefined || todayOpen <= 0) {
      return { skip: '관망: 지표 부재 (당일 시가)' };
    }

    const prevRange = prevHigh - prevLow;
    if (prevRange <= 0) {
      return { skip: '관망: 전일 변동폭 0 — 돌파 기준 없음' };
    }

    return { breakoutPrice: todayOpen + prevRange * params.kValue };
  }

  /**
   * soft 조건 채점 — 데이터가 없는 항목은 분모에서 제외하고,
   * 필요 충족 수는 min(minSoftConditions, 평가 가능 항목 수)로 제한한다.
   * (24h 캐시로 동결되는 indicators.volumeRatio 대신 fresh price.volume 사용)
   * MA20 추세는 hard 필터로 승격되어 여기서 제외 (레짐 분석 근거).
   */
  private scoreSoftConditions(
    ctx: StockStrategyContext,
    params: ResolvedParams,
    nowKstMinutes: number,
  ): SoftConditionScore {
    const ind = ctx.stockIndicators;
    const curPrice = ctx.price.currentPrice;
    let evaluable = 0;
    let passed = 0;
    const notes: string[] = [];

    // ① 시간보정 거래량: 누적거래량 ≥ 20일 평균 × 경과 비율 × 배수
    if (ind.avgVolume20 !== undefined && ind.avgVolume20 > 0 && ctx.price.volume > 0) {
      evaluable += 1;
      const elapsed = Math.min(
        Math.max(nowKstMinutes - KRX_OPEN_MINUTES, MIN_ELAPSED_MINUTES),
        KRX_SESSION_MINUTES,
      );
      const expectedVolume = ind.avgVolume20 * (elapsed / KRX_SESSION_MINUTES) * params.volumeMultiplier;
      if (ctx.price.volume >= expectedVolume) passed += 1;
      else notes.push(`거래량 부족(${ctx.price.volume} < ${expectedVolume.toFixed(0)})`);
    }

    // ② 당일 VWAP 위: 현재가 ≥ 누적거래대금/누적거래량
    const tradingValue = ctx.price.tradingValue;
    if (tradingValue !== undefined && tradingValue > 0 && ctx.price.volume > 0) {
      evaluable += 1;
      const vwap = tradingValue / ctx.price.volume;
      if (curPrice >= vwap) passed += 1;
      else notes.push(`VWAP 하회(${vwap.toFixed(0)})`);
    }

    // ③ 수급 매수 우위
    const hasFlowData =
      ind.foreignNetBuy !== undefined
      || ind.institutionNetBuy !== undefined
      || ind.programTradeDirection !== undefined;
    if (hasFlowData) {
      evaluable += 1;
      const flowPositive = Boolean(
        ind.foreignNetBuy || ind.institutionNetBuy || ind.programTradeDirection === 'BUY',
      );
      if (flowPositive) passed += 1;
      else notes.push('수급 매수우위 없음');
    }

    // 비정상 설정값(0, null, NaN 등)이 fail-closed를 우회하지 못하도록 기본값으로 보정
    const requestedMin = Number(params.minSoftConditions);
    const sanitizedMin = Number.isFinite(requestedMin) && requestedMin >= 1
      ? Math.floor(requestedMin)
      : DEFAULT_PARAMS.minSoftConditions;
    const required = Math.min(sanitizedMin, evaluable);
    if (evaluable === 0) {
      // fail-closed: 거래량/거래대금/수급이 전부 없는 상태(거래정지·API 이상 등)에서
      // 정보 없이 시장가 매수하지 않는다
      notes.push('평가 가능한 soft 조건 없음 (데이터 공백)');
    }
    return {
      evaluable,
      passed,
      required,
      satisfied: evaluable > 0 && passed >= required,
      notes,
    };
  }
}
