import { Injectable, Logger } from '@nestjs/common';
import {
  PerStockTradingStrategy,
  StockStrategyContext,
  TradingSignal,
  StrategyEvaluationResult,
  ExecutionMode,
  StrategyMeta,
  evaluateStrategyMdd,
} from '../types';

const DEFAULT_PARAMS = {
  adxThreshold: 25,
  adxExitThreshold: 20,
  stopLossRate: 0.07,
  pyramidingProfitRate: 0.05,
  pyramidingRatio: 0.5,
};

function resolveAtrRate(ctx: StockStrategyContext): number | undefined {
  if (ctx.stockIndicators.atrPercent !== undefined) return ctx.stockIndicators.atrPercent / 100;
  if (ctx.stockIndicators.atr14 !== undefined && ctx.price.currentPrice > 0) {
    return ctx.stockIndicators.atr14 / ctx.price.currentPrice;
  }
  return undefined;
}

function hasFlowConfirmation(stockIndicators: StockStrategyContext['stockIndicators']): boolean {
  const hasFlowData =
    stockIndicators.foreignNetBuy !== undefined ||
    stockIndicators.institutionNetBuy !== undefined ||
    stockIndicators.programTradeDirection !== undefined;
  if (!hasFlowData) return true;
  return Boolean(
    stockIndicators.foreignNetBuy ||
      stockIndicators.institutionNetBuy ||
      stockIndicators.programTradeDirection === 'BUY',
  );
}

function hasNegativeConsensus(stockIndicators: StockStrategyContext['stockIndicators']): boolean {
  const rating = stockIndicators.consensusRating ?? '';
  const negativeRating = /(SELL|REDUCE|비중축소|매도)/i.test(rating);
  return negativeRating || (stockIndicators.targetPriceUpside !== undefined && stockIndicators.targetPriceUpside < -10);
}

@Injectable()
export class TrendFollowingStrategy implements PerStockTradingStrategy {
  readonly name = 'trend-following';
  readonly displayName = '추세 추종';
  readonly executionMode: ExecutionMode = {
    type: 'once-daily',
    hours: { domestic: 15, overseas: { basis: 'beforeClose', offsetHours: 1 } }, // 장 마감 1시간 전
  };
  readonly description = [
    'MA 골든크로스와 ADX를 활용하여 강한 추세에 진입하고, 추세가 소멸할 때 청산하는 중장기 전략입니다.',
    '',
    '【진입 조건 (모두 충족 시 매수)】',
    '- MA20 > MA60 (골든크로스, 상승 추세)',
    '- ADX > 25 (강한 추세 확인)',
    '- 현재가 > MA20 (추세 위에서 거래)',
    '',
    '【피라미딩 (추가 매수)】',
    '- 수익률 > 5% + 추세 유지(골든크로스 + ADX > 25) 시',
    '- 투자금(quota)의 50%로 추가 매수',
    '',
    '【매도 조건】',
    '- MA20 < MA60 (데드크로스, 추세 전환)',
    '- ADX < 20 (추세 소멸)',
    '- -7% 또는 ATR 기반 동적 손절 중 더 넓은 기준 적용',
    '- 리스크 전량청산 시그널 시 즉시 매도',
    '',
    '【특징】',
    '- 수주~수개월 보유하는 중장기 전략',
    '- 강한 추세를 따라가며 수익을 극대화',
    '- 모멘텀 돌파와 달리 추세 소멸 시점까지 보유',
    '',
    '【안전장치】',
    '- 투자유의/시장경고 종목은 진입 차단',
    '- 수급 데이터가 있으면 외인/기관/프로그램 매수 우위 확인 후 진입',
    '- 목표가 괴리가 크게 음수이거나 부정적 컨센서스면 진입 차단',
    '- 250일 최고가 근접(-5% 이내) 시 피라미딩 비율 30% 확대 (추세 강도 보강)',
    '- 리스크 전량청산 시그널 시 즉시 매도',
  ].join('\n');
  readonly meta: StrategyMeta = {
    riskLevel: 'medium',
    mddBuyBlock: -0.15,
    mddLiquidate: -0.20,
    expectedReturn: '연 15~40%',
    maxLoss: '-7% (손절)',
    investmentPeriod: '수주~수개월',
    tradingFrequency: '하루 1회 추세 확인',
    suitableFor: ['중장기 투자자', '추세장 활용', '피라미딩 전략'],
    tags: ['추세추종', '골든크로스', 'ADX', '국내/해외'],
  };
  private readonly logger = new Logger(TrendFollowingStrategy.name);

  async evaluateStock(ctx: StockStrategyContext): Promise<StrategyEvaluationResult> {
    const { watchStock, price, position, stockIndicators, riskState } = ctx;
    const signals: TradingSignal[] = [];
    const skipReasons: string[] = [];
    const params = { ...DEFAULT_PARAMS, ...watchStock.strategyParams };

    const curPrice = price.currentPrice;
    if (curPrice <= 0) {
      skipReasons.push('유효하지 않은 현재가');
      return { signals, skipReasons };
    }

    const market = watchStock.market;
    const exchangeCode = watchStock.exchangeCode;
    const isOverseas = market === 'OVERSEAS';
    const hasPosition = !!position && position.quantity > 0;

    const roundPrice = isOverseas
      ? (p: number) => Math.round(p * 100) / 100
      : (p: number) => Math.round(p);
    const atrRate = resolveAtrRate(ctx);
    const effectiveStopLossRate = Math.max(
      params.stopLossRate,
      atrRate ? Math.min(0.12, atrRate * 1.8) : 0,
    );

    // 리스크 체크: 전략별 MDD 기준 전량 청산
    const mddCheck = riskState ? evaluateStrategyMdd(riskState.drawdown, this.meta.mddBuyBlock, this.meta.mddLiquidate) : undefined;
    if (mddCheck?.liquidateAll && hasPosition) {
      signals.push({
        market,
        exchangeCode,
        stockCode: watchStock.stockCode,
        side: 'SELL',
        quantity: position!.quantity,
        price: roundPrice(curPrice),
        reason: `리스크 전량청산: MDD ${(riskState!.drawdown * 100).toFixed(1)}% (임계값 ${(this.meta.mddLiquidate * 100).toFixed(0)}%)`,
      });
      return { signals, skipReasons };
    }

    const { ma20, ma60, adx14 } = stockIndicators;

    // 지표 부족 시 skip
    if (ma20 === undefined || ma60 === undefined || adx14 === undefined) {
      skipReasons.push('필수 지표 부재 (MA20, MA60, ADX14)');
      return { signals, skipReasons };
    }

    const goldenCross = ma20 > ma60;
    const deadCross = ma20 < ma60;
    const strongTrend = adx14 > params.adxThreshold;
    const weakTrend = adx14 < params.adxExitThreshold;

    // --- 손절: 포지션 보유 중이면 항상 체크 (alreadyExecutedToday 무관) ---
    if (hasPosition) {
      const avgPrice = position!.avgPrice;
      const profitRate = (curPrice - avgPrice) / avgPrice;
      const holdQty = position!.quantity;

      if (profitRate <= -effectiveStopLossRate) {
        this.logger.log(
          `[${watchStock.stockCode}] STOP LOSS: ${(profitRate * 100).toFixed(1)}%`,
        );
        signals.push({
          market,
          exchangeCode,
          stockCode: watchStock.stockCode,
          side: 'SELL',
          quantity: holdQty,
          price: roundPrice(curPrice),
          reason: `손절: ${(profitRate * 100).toFixed(1)}% <= -${(effectiveStopLossRate * 100).toFixed(1)}%`,
        });
        return { signals, skipReasons };
      }

      // 추세 소멸 매도: 데드크로스 또는 ADX < 20
      if (deadCross || weakTrend) {
        const reason = deadCross
          ? `데드크로스: MA20(${ma20.toFixed(0)}) < MA60(${ma60.toFixed(0)})`
          : `추세소멸: ADX=${adx14.toFixed(1)} < ${params.adxExitThreshold}`;
        this.logger.log(`[${watchStock.stockCode}] TREND EXIT: ${reason}`);
        signals.push({
          market,
          exchangeCode,
          stockCode: watchStock.stockCode,
          side: 'SELL',
          quantity: holdQty,
          price: roundPrice(curPrice),
          reason,
        });
        return { signals, skipReasons };
      }

      // 오늘 이미 실행 → 피라미딩 skip (손절/추세소멸은 위에서 이미 체크)
      if (ctx.alreadyExecutedToday) {
        skipReasons.push('오늘 이미 실행됨 (피라미딩 스킵)');
        return { signals, skipReasons };
      }

      // 피라미딩: 수익 > 5% + 추세 유지
      if (
        profitRate > params.pyramidingProfitRate &&
        goldenCross &&
        strongTrend &&
        !riskState?.buyBlocked &&
        !mddCheck?.buyBlocked
      ) {
        const quota = watchStock.quota || 0;
        let pyramidRatio = params.pyramidingRatio;

        // 250일/연중 최고가 근접 시 피라미딩 비율 확대 (추세 강도 보강)
        if (stockIndicators.d250HighRate !== undefined && stockIndicators.d250HighRate >= -5) {
          pyramidRatio = Math.min(pyramidRatio * 1.3, 0.8);
        }

        const pyramidAmount = Math.min(quota * pyramidRatio, ctx.buyableAmount);
        const pyramidQty = Math.floor(pyramidAmount / curPrice);

        if (pyramidQty > 0) {
          const highProximity = stockIndicators.d250HighRate !== undefined && stockIndicators.d250HighRate >= -5
            ? `, 250d고점근접` : '';
          this.logger.log(
            `[${watchStock.stockCode}] PYRAMIDING: profit=${(profitRate * 100).toFixed(1)}%, ADX=${adx14.toFixed(1)}${highProximity}`,
          );
          signals.push({
            market,
            exchangeCode,
            stockCode: watchStock.stockCode,
            side: 'BUY',
            quantity: pyramidQty,
            price: roundPrice(curPrice),
            reason: `피라미딩: +${(profitRate * 100).toFixed(1)}%, ADX=${adx14.toFixed(1)}${highProximity}`,
          });
        }
      }
    } else {
      // --- 포지션 없음: 진입 조건 ---

      // 오늘 이미 실행 → 신규 진입 skip
      if (ctx.alreadyExecutedToday) {
        skipReasons.push('오늘 이미 실행됨');
        return { signals, skipReasons };
      }

      // 리스크 체크
      if (riskState?.buyBlocked || mddCheck?.buyBlocked) {
        const reason = riskState?.reasons?.join(', ') ?? 'MDD';
        this.logger.debug(
          `[${watchStock.stockCode}] Buy blocked by risk: ${reason}`,
        );
        skipReasons.push(`리스크 매수 차단: ${reason}`);
        return { signals, skipReasons };
      }

      // 투자유의/시장경고 종목 진입 차단
      if (stockIndicators.investCautionYn) {
        skipReasons.push('투자유의 종목');
        return { signals, skipReasons };
      }
      if (stockIndicators.marketWarnCode && stockIndicators.marketWarnCode !== '00') {
        skipReasons.push(`시장경고 종목 (코드: ${stockIndicators.marketWarnCode})`);
        return { signals, skipReasons };
      }
      if (!hasFlowConfirmation(stockIndicators)) {
        skipReasons.push('수급 데이터 확인: 외인/기관/프로그램 매수 우위 없음');
        return { signals, skipReasons };
      }
      if (hasNegativeConsensus(stockIndicators)) {
        skipReasons.push(`부정적 컨센서스: ${stockIndicators.consensusRating ?? '목표가 하락'}`);
        return { signals, skipReasons };
      }

      // 진입: 골든크로스 + 강한 추세 + 현재가 > MA20
      if (!goldenCross) {
        skipReasons.push(`골든크로스 없음: MA20(${ma20.toFixed(0)}) < MA60(${ma60.toFixed(0)})`);
        return { signals, skipReasons };
      }
      if (!strongTrend) {
        skipReasons.push(`추세 부족: ADX=${adx14.toFixed(1)} < ${params.adxThreshold}`);
        return { signals, skipReasons };
      }
      if (curPrice <= ma20) {
        skipReasons.push(`현재가(${curPrice.toFixed(0)}) ≤ MA20(${ma20.toFixed(0)})`);
        return { signals, skipReasons };
      }

      const quota = watchStock.quota || 0;
      const buyAmount = Math.min(quota, ctx.buyableAmount);
      const buyQty = Math.floor(buyAmount / curPrice);

      if (buyQty > 0) {
        const flowNote = stockIndicators.foreignNetBuy || stockIndicators.institutionNetBuy || stockIndicators.programTradeDirection === 'BUY'
          ? ', 수급확인'
          : '';
        this.logger.log(
          `[${watchStock.stockCode}] TREND ENTRY: MA20=${ma20.toFixed(0)} > MA60=${ma60.toFixed(0)}, ADX=${adx14.toFixed(1)}, price=${curPrice}${flowNote}`,
        );
        signals.push({
          market,
          exchangeCode,
          stockCode: watchStock.stockCode,
          side: 'BUY',
          quantity: buyQty,
          price: roundPrice(curPrice),
          reason: `추세진입: MA20(${ma20.toFixed(0)})>MA60(${ma60.toFixed(0)}), ADX=${adx14.toFixed(1)}${flowNote}`,
        });
      }
    }

    return { signals, skipReasons };
  }
}
