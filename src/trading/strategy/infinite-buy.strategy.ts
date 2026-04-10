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
  evaluateStrategyMdd,
} from '../types';

function hasNegativeConsensus(stockIndicators: StockStrategyContext['stockIndicators']): boolean {
  const rating = stockIndicators.consensusRating ?? '';
  const negativeRating = /(SELL|REDUCE|비중축소|매도)/i.test(rating);
  return negativeRating || (stockIndicators.targetPriceUpside !== undefined && stockIndicators.targetPriceUpside < -15);
}

function hasStrongSellFlow(stockIndicators: StockStrategyContext['stockIndicators']): boolean {
  const hasFlowData =
    stockIndicators.foreignNetBuy !== undefined ||
    stockIndicators.institutionNetBuy !== undefined ||
    stockIndicators.programTradeDirection !== undefined;
  if (!hasFlowData) return false;
  return stockIndicators.foreignNetBuy === false
    && stockIndicators.institutionNetBuy === false
    && stockIndicators.programTradeDirection === 'SELL';
}

function hasEventDrivenRisk(stockIndicators: StockStrategyContext['stockIndicators']): boolean {
  return (stockIndicators.recentMaterialDisclosureCount30d ?? 0) >= 2
    || (stockIndicators.recentSecForm8KCount30d ?? 0) >= 3;
}

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

function getTargetProfitRate(T: number): number {
  if (T < 2) return 0.15;
  if (T < 4) return 0.14;
  if (T < 6) return 0.13;
  if (T < 8) return 0.12;
  if (T < 10) return 0.11;
  if (T < 12) return 0.10;
  if (T < 14) return 0.095;
  if (T < 16) return 0.09;
  if (T < 18) return 0.085;
  if (T < 20) return 0.08;
  if (T < 24) return 0.077;
  if (T < 28) return 0.074;
  if (T < 32) return 0.072;
  if (T < 36) return 0.07;
  return 0.068;
}

function getSecondaryTargetBonusRate(T: number): number {
  if (T < 4) return 0.03;
  if (T < 8) return 0.026;
  if (T < 12) return 0.022;
  if (T < 20) return 0.018;
  if (T < 28) return 0.014;
  return 0.011;
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
    '- 40회는 "최대 횟수"가 아니라 "quota를 다 쓰는 기준"',
    '- Buy1만 체결되고 Buy2 미체결 시 T가 0.5만 증가',
    '- 둘 다 미체결 시 T 변동 없음, 다음 날 재시도',
    '- quota를 모두 소진하면(T >= maxCycles) 매수 중단',
    '',
    '【매수 조건】',
    '- 하루 1회, 장중 실행 (국내 11시, 해외 장 시작 2시간 후)',
    '- 하락장에서도 분할매수를 이어가되, 시장/종목 리스크에 따라 매수금액만 조절',
    '- RSI < 30 과매도 구간에서는 매수금액 1.25배 증가',
    '- RSI 60 이상 과열 구간에서는 단계적으로 매수금액 축소',
    '- 금리 급등 시 매수금액 20% 축소',
    '- RSI 60~70: 15% 축소, 70~80: 40% 축소, 80 이상: 60% 축소',
    '',
    '【매수 방식】',
    '- T < 20: Buy1(현재가 지정가) + Buy2(현재가 아래 지정가) 두 건 분할',
    '- T >= 20: Buy2(현재가 아래 지정가)만 실행',
    '- 매수금액이 1주 가격 미만이면 다음 사이클로 이월, 누적 후 매수',
    '- Buy2 지정가: T<10 -1%, T<20 -2%, T>=20 -3% (일중 변동 내 체결 가능)',
    '- Buy1은 즉시 체결, Buy2는 장중 가격 하락 시 체결',
    '- 미체결 시 장 마감 후 자동 취소, 다음 날 새 가격으로 재주문',
    '',
    '【매도 조건】',
    '- 기본적으로 1차 목표가 1개만 계산하고, 도달 시 보유 수량의 50% 매도',
    '- 1차 매도 후 남은 50%는 다음 거래일에만 2차 목표가를 시도',
    '- 2차 목표가 미체결 시 분할매도 상태를 해제하고 일반 무한매수 모드로 복귀',
    '- 목표수익률은 T가 높을수록 단계적으로 낮아져 탈출 우선',
    '- 손절: 평균단가 대비 설정 손절률(기본 30%) 하회 시 전량 매도',
    '',
    '  T 구간    | 1차 목표 | 2차 추가',
    '  ----------+----------+----------',
    '   0 ~ <2   | +15.0%   | +3.0%p',
    '   2 ~ <4   | +14.0%   | +3.0%p',
    '   4 ~ <6   | +13.0%   | +2.6%p',
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
    '  36 이상   |  +6.8%   | +1.1%p',
    '',
    '【특징】',
    '- 장기 분할매수에 적합, 하락장에서 평균단가를 낮추는 전략',
    '- 시초가 변동 안정 후 주문하여 적정 가격에 진입',
    '- Buy2 지정가는 장 마감까지 체결 기회를 가짐',
    '- 1차 익절 후 다음 거래일에만 추가 상승을 한 번 더 노림',
    '',
    '【안전장치】',
    '- 투자유의/시장경고 종목은 신규 진입 차단',
    '- 융자잔고 10% 초과 시 매수금액 30% 축소 (레버리지 청산 리스크 방어)',
    '- 지수 MA200 하회 시 매수금액 25% 축소',
    '- 금리 급등 시 매수금액 20% 축소',
    '- 부정적 컨센서스면 매수금액 30% 축소, 배당 안정성 높으면 매수금액 소폭 확대',
    '- 최근 주요 공시/8-K가 과도하면 매수금액 40% 축소, 내부자 지분 증가는 매수금액 소폭 확대',
  ].join('\n');
  readonly meta: StrategyMeta = {
    riskLevel: 'medium',
    mddBuyBlock: -0.25,
    mddLiquidate: -0.35,
    expectedReturn: '1차 +6.8~15%, 2차 +7.9~18%',
    maxLoss: '-30% (손절 기본값)',
    investmentPeriod: '3개월~1년',
    tradingFrequency: '하루 1회 장중 자동 매수 (국내 11시, 해외 02시)',
    suitableFor: ['장기 분할매수 선호 투자자', '하락장 대응', '적립식 투자'],
    tags: ['분할매수', 'DCA', '장기투자', '국내/해외'],
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

    // --- 기본 무한매수법 계산 ---
    const quota = watchStock.quota;
    const totalInvested = position?.totalInvested || 0;
    const perCycleQuota = quota / watchStock.maxCycles;
    const T = totalInvested > 0 ? totalInvested / perCycleQuota : 0; // T = 완료 사이클 수
    const avgPrice = position?.avgPrice || curPrice;
    const holdQty = position?.quantity || 0;
    const mddCheck = riskState
      ? evaluateStrategyMdd(riskState.drawdown, this.meta.mddBuyBlock, this.meta.mddLiquidate)
      : undefined;
    const riskReason = riskState?.reasons?.join(', ')
      || `MDD ${((riskState?.drawdown ?? 0) * 100).toFixed(1)}%`;

    details.T = T;
    details.avgPrice = avgPrice;
    details.holdQty = holdQty;
    details.perCycleQuota = perCycleQuota;

    // 가격 반올림 함수
    const roundPrice = isOverseas
      ? (p: number) => Math.round(p * 100) / 100  // 소수점 2자리
      : (p: number) => Math.round(p);              // 정수

    if ((riskState?.liquidateAll || mddCheck?.liquidateAll) && hasPosition) {
      signals.push({
        market,
        exchangeCode,
        stockCode: watchStock.stockCode,
        side: 'SELL',
        quantity: holdQty,
        price: roundPrice(curPrice),
        reason: `리스크 전량청산: ${riskReason}`,
        orderDivision: '00',
      });
      return { signals, skipReasons };
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

      if (remainingQty > 0 && targetPrice > 0) {
        signals.push({
          market,
          exchangeCode,
          stockCode: watchStock.stockCode,
          side: 'SELL',
          quantity: remainingQty,
          price: targetPrice,
          reason:
            `Take profit 2: T=${T.toFixed(1)}, +${(secondaryExitPlan!.secondTargetRate * 100).toFixed(1)}%, ` +
            `${remainingQty}주 @ ${targetPrice}`,
          orderDivision: '00',
          metadata: {
            phase: 'take-profit-2',
          },
        });
      }

      return { signals, skipReasons };
    }

    // --- 개선 E: 시장 상황 필터 ---
    details.marketCondition = marketCondition;
    const indexBelowMA200 = !marketCondition.referenceIndexAboveMA200;

    // --- 개선 C: 종목 선별 필터 ---
    details.stockIndicators = stockIndicators;

    if (!hasPosition) {
      if (riskState?.buyBlocked || mddCheck?.buyBlocked) {
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
    const maxCyclesReached = T >= watchStock.maxCycles;
    if (maxCyclesReached) {
      this.logger.log(`[${watchStock.stockCode}] Max cycles reached (T=${T.toFixed(1)}), buy stopped`);
    }

    // --- 1회 매수금액 ---
    const accumulatedQuota = (watchStock.strategyParams?.accumulatedQuota as number) || 0;
    let adjustedQuota = maxCyclesReached ? 0 : perCycleQuota + accumulatedQuota;
    details.accumulatedQuota = accumulatedQuota;
    details.baseQuota = adjustedQuota;

    if (indexBelowMA200) {
      adjustedQuota *= 0.75;
      details.quotaAdjust_indexTrend = true;
      pushQuotaAdjustment(
        details,
        `${marketCondition.referenceIndexName ?? '지수'} MA200 하회`,
        0.75,
      );
    }

    // 개선 E: 금리 급등시 20% 축소
    if (marketCondition.interestRateRising) {
      adjustedQuota *= 0.8;
      details.quotaAdjust_interestRate = true;
      pushQuotaAdjustment(details, '금리 급등', 0.8);
    }

    // 개선 C: RSI 과매도/과열 구간별 조정
    if (stockIndicators.rsi14 !== undefined) {
      if (stockIndicators.rsi14 < 30) {
        adjustedQuota *= 1.25;
        details.quotaAdjust_rsi = true;
        pushQuotaAdjustment(details, `RSI ${stockIndicators.rsi14.toFixed(1)} < 30`, 1.25);
      } else if (stockIndicators.rsi14 >= 80) {
        adjustedQuota *= 0.4;
        details.quotaAdjust_rsi = true;
        pushQuotaAdjustment(details, `RSI ${stockIndicators.rsi14.toFixed(1)} ≥ 80`, 0.4);
      } else if (stockIndicators.rsi14 >= 70) {
        adjustedQuota *= 0.6;
        details.quotaAdjust_rsi = true;
        pushQuotaAdjustment(details, `RSI ${stockIndicators.rsi14.toFixed(1)} ≥ 70`, 0.6);
      } else if (stockIndicators.rsi14 >= 60) {
        adjustedQuota *= 0.85;
        details.quotaAdjust_rsi = true;
        pushQuotaAdjustment(details, `RSI ${stockIndicators.rsi14.toFixed(1)} ≥ 60`, 0.85);
      }
    }

    if (hasNegativeConsensus(stockIndicators)) {
      adjustedQuota *= 0.7;
      details.quotaAdjust_consensus = true;
      pushQuotaAdjustment(details, `부정적 컨센서스${stockIndicators.consensusRating ? ` (${stockIndicators.consensusRating})` : ''}`, 0.7);
    }

    if (hasEventDrivenRisk(stockIndicators)) {
      adjustedQuota *= 0.6;
      details.quotaAdjust_eventRisk = true;
      pushQuotaAdjustment(
        details,
        `최근 공시 과다 (${stockIndicators.recentMaterialDisclosureCount30d ?? 0}건 / 8-K ${(stockIndicators.recentSecForm8KCount30d ?? 0)}건)`,
        0.6,
      );
    }

    // 융자잔고 10% 초과 시 quota 30% 감소 (레버리지 청산 위험)
    if (stockIndicators.loanBalanceRate !== undefined && stockIndicators.loanBalanceRate > 10) {
      adjustedQuota *= 0.7;
      details.quotaAdjust_loanBalance = true;
      pushQuotaAdjustment(details, `융자잔고 ${stockIndicators.loanBalanceRate.toFixed(1)}% > 10%`, 0.7);
    }

    if ((stockIndicators.dividendYield ?? 0) >= 2 && (stockIndicators.consecutiveDividendYears ?? 0) >= 5) {
      adjustedQuota *= 1.15;
      details.quotaAdjust_dividend = true;
      pushQuotaAdjustment(
        details,
        `배당안정성 ${stockIndicators.dividendYield?.toFixed(1)}% / ${stockIndicators.consecutiveDividendYears}년`,
        1.15,
      );
    }

    if ((stockIndicators.insiderOwnershipChangeRate ?? 0) > 0.05) {
      adjustedQuota *= 1.1;
      details.quotaAdjust_insider = true;
      pushQuotaAdjustment(
        details,
        `내부자 지분 증가 ${(stockIndicators.insiderOwnershipChangeRate! * 100).toFixed(1)}bp`,
        1.1,
      );
    }

    if ((stockIndicators.volatility30d ?? 0) >= 45) {
      adjustedQuota *= 0.85;
      details.quotaAdjust_volatility = true;
      pushQuotaAdjustment(details, `30일 변동성 ${stockIndicators.volatility30d!.toFixed(1)}% ≥ 45%`, 0.85);
    }

    if (hasStrongSellFlow(stockIndicators)) {
      adjustedQuota *= 0.7;
      details.quotaAdjust_flow = true;
      pushQuotaAdjustment(details, '수급 약세 (외인/기관/프로그램 동반 매도)', 0.7);
    }

    // 개선 D: 가용자금 한도
    adjustedQuota = Math.min(adjustedQuota, ctx.buyableAmount);

    details.adjustedQuota = adjustedQuota;

    const riskBuyBlocked = Boolean(riskState?.buyBlocked || mddCheck?.buyBlocked);
    const buyAllowed = adjustedQuota > 0 && !riskBuyBlocked;

    if (!buyAllowed && !maxCyclesReached && !riskBuyBlocked && ctx.buyableAmount <= 0) {
      details.minimumExecutablePrice = 0;
      skipReasons.push(
        `매수 수량 부족: 주문가능금액 ${ctx.buyableAmount.toFixed(0)}으로 1주 매수 불가`,
      );
    }

    let buySignalCount = 0;

    if (!hasPosition && buyAllowed) {
      // --- 첫 매수 (포지션 없음) ---
      const buyQty = Math.floor(adjustedQuota / curPrice);
      if (buyQty > 0) {
        const dividendNote = (stockIndicators.dividendYield ?? 0) >= 2 && (stockIndicators.consecutiveDividendYears ?? 0) >= 5
          ? ', 배당안정성+'
          : '';
        signals.push({
          market,
          exchangeCode,
          stockCode: watchStock.stockCode,
          side: 'BUY',
          quantity: buyQty,
          price: roundPrice(curPrice),
          reason: `Initial buy: ${buyQty}주 @ ${roundPrice(curPrice)}${dividendNote}`,
          orderDivision: '00',
        });
        buySignalCount++;
      } else {
        details.minimumExecutablePrice = adjustedQuota;
        skipReasons.push(
          `매수 수량 부족: 조정 할당금 ${adjustedQuota.toFixed(0)} < 현재가 ${roundPrice(curPrice)} ` +
          `(1주 매수 가능 기준가 ${roundPrice(adjustedQuota)} 이하)`,
        );
      }
    } else if (hasPosition) {
      // --- 매수 시그널 ---
      // Buy2 dipRate: T가 높을수록 더 낮은 가격에 지정가 (보수적)
      const dipRate = T < 10 ? 0.01 : T < 20 ? 0.02 : 0.03;

      if (T < 20 && buyAllowed) {
        // Buy1 + Buy2 분할 매수
        // Buy1: 현재가에 즉시 매수
        const buy1Price = roundPrice(curPrice);
        // Buy2: 현재가보다 낮은 지정가 (더 떨어지면 체결)
        const buy2Price = roundPrice(curPrice * (1 - dipRate));

        const halfQuota = adjustedQuota / 2;
        let buy1Qty = Math.floor(halfQuota / buy1Price);
        let buy2Qty = Math.floor(halfQuota / buy2Price);

        // 분할 매수 불가 시 전액으로 단일 매수 (고가주 대응)
        if (buy1Qty === 0 && buy2Qty === 0) {
          buy1Qty = Math.floor(adjustedQuota / buy1Price);
        }

        if (buy1Qty > 0 && buy1Price > 0) {
          signals.push({
            market,
            exchangeCode,
            stockCode: watchStock.stockCode,
            side: 'BUY',
            quantity: buy1Qty,
            price: buy1Price,
            reason: `Buy1: T=${T.toFixed(1)}, ${buy1Qty}주 @ ${buy1Price}`,
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
            reason: `Buy2: T=${T.toFixed(1)}, dip=${(dipRate * 100).toFixed(0)}%, ${buy2Qty}주 @ ${buy2Price}`,
            orderDivision: '00', // buy2는 지정가
          });
          buySignalCount++;
        }

        if (buySignalCount === 0) {
          const referencePrice = Math.min(buy1Price, buy2Price);
          details.minimumExecutablePrice = adjustedQuota;
          skipReasons.push(
            `매수 수량 부족: 조정 할당금 ${adjustedQuota.toFixed(0)} < 기준가 ${roundPrice(referencePrice)} ` +
            `(1주 매수 가능 기준가 ${roundPrice(adjustedQuota)} 이하)`,
          );
        }
      } else if (T >= 20 && buyAllowed) {
        // T>=20: Buy2만 (현재가 아래 지정가)
        const buy2Price = roundPrice(curPrice * (1 - dipRate));
        const buy2Qty = Math.floor(adjustedQuota / buy2Price);

        if (buy2Qty > 0 && buy2Price > 0) {
          signals.push({
            market,
            exchangeCode,
            stockCode: watchStock.stockCode,
            side: 'BUY',
            quantity: buy2Qty,
            price: buy2Price,
            reason: `Buy2(T≥20): T=${T.toFixed(1)}, dip=${(dipRate * 100).toFixed(0)}%, ${buy2Qty}주 @ ${buy2Price}`,
            orderDivision: '00',
          });
          buySignalCount++;
        } else {
          details.minimumExecutablePrice = adjustedQuota;
          skipReasons.push(
            `매수 수량 부족: 조정 할당금 ${adjustedQuota.toFixed(0)} < 기준가 ${roundPrice(buy2Price)} ` +
            `(1주 매수 가능 기준가 ${roundPrice(adjustedQuota)} 이하)`,
          );
        }
      }

      // --- 매도 시그널 (항상 생성, 지수 상태 무관) ---
      if (holdQty > 0) {
        const targetProfitRate = getTargetProfitRate(T);
        const targetPrice = roundPrice(avgPrice * (1 + targetProfitRate));
        const firstSellQty = holdQty >= 2 ? Math.ceil(holdQty / 2) : holdQty;
        const secondSellQty = holdQty - firstSellQty;
        const secondaryTargetRate = targetProfitRate + getSecondaryTargetBonusRate(T);
        const secondaryTargetPrice = roundPrice(avgPrice * (1 + secondaryTargetRate));

        if (targetPrice > 0) {
          signals.push({
            market,
            exchangeCode,
            stockCode: watchStock.stockCode,
            side: 'SELL',
            quantity: firstSellQty,
            price: targetPrice,
            reason:
              secondSellQty > 0
                ? `Take profit 1: T=${T.toFixed(1)}, +${(targetProfitRate * 100).toFixed(1)}%, ${firstSellQty}주 @ ${targetPrice}`
                : `Take profit: T=${T.toFixed(1)}, +${(targetProfitRate * 100).toFixed(1)}%, ${firstSellQty}주 @ ${targetPrice}`,
            orderDivision: '00',
            metadata: secondSellQty > 0
              ? {
                  phase: 'take-profit-1',
                  secondaryTargetPrice,
                  secondaryTargetRate,
                  secondaryTargetQuantity: secondSellQty,
                }
              : undefined,
          });
        }
      }
    } else if (!hasPosition && !buyAllowed) {
      // 포지션 없고 매수 불가
      if (maxCyclesReached) {
        skipReasons.push(`최대 사이클 도달: T=${T.toFixed(1)} ≥ ${watchStock.maxCycles}`);
      } else if (riskBuyBlocked) {
        skipReasons.push(`리스크 매수 차단: ${riskReason}`);
      }
    }

    this.logger.log(
      `[${watchStock.stockCode}] T=${T.toFixed(1)}, signals=${signals.length}, quota=${adjustedQuota.toFixed(0)}`,
    );

    return { signals, skipReasons, details };
  }
}
