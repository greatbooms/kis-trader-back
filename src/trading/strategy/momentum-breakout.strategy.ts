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
  takeProfitHalf: 0.05,
  takeProfitFull: 0.08,
  stopLossRate: 0.03,
  trailingStopRate: 0.02,
  timeStopDays: 3,
  volumeThreshold: 1.5,
};

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function countTradingDaysInclusive(fromDate: string, toDate: string): number {
  const start = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return 0;
  }

  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      count += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

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

@Injectable()
export class MomentumBreakoutStrategy implements PerStockTradingStrategy {
  readonly name = 'momentum-breakout';
  readonly displayName = '모멘텀 돌파';
  readonly executionMode: ExecutionMode = { type: 'continuous' };
  readonly description = [
    '래리 윌리엄스의 변동성 돌파 전략을 기반으로, 강한 상승 모멘텀이 감지될 때 진입하는 단기 전략입니다.',
    '',
    '【진입 조건 (모두 충족 시 매수)】',
    '- 현재가 > 20일 이동평균선 (상승 추세 확인)',
    '- RSI 50~70 구간 (과열되지 않은 상승 구간)',
    '- 거래량 >= 전일 대비 1.5배 (거래량 확인)',
    '- 시가 + 전일 변동폭 × K(0.5) 돌파 (변동성 돌파)',
    '',
    '【익절 조건】',
    '- +5% 도달: 보유량의 50% 매도 (1차 익절)',
    '- +8% 도달: 전량 매도 (2차 익절)',
    '',
    '【손절 조건】',
    '- -3% 또는 ATR 기반 동적 손절 중 더 넓은 기준 적용',
    '- 당일 고가 대비 -2% 또는 ATR 기반 동적 트레일링 스탑 적용',
    '- 리스크 전량청산 시그널 시 즉시 매도',
    '',
    '【특징】',
    '- 단기 매매에 적합 (보유기간 1~3일)',
    '- 손절 폭이 작아 리스크 관리에 유리',
    '- 강한 추세가 있는 종목에서 효과적',
    '',
    '【안전장치】',
    '- 투자유의/시장경고/단기과열 종목은 진입 차단',
    '- 수급 데이터가 있으면 외인/기관/프로그램 중 하나 이상 매수 우위일 때만 진입',
    '- 단일 종목 포트폴리오 비중 15% 초과 시 추가 매수 차단',
    '- 연중 최고가 근접 시 돌파 확인 시그널 추가 표기',
  ].join('\n');
  readonly meta: StrategyMeta = {
    riskLevel: 'high',
    mddBuyBlock: -0.08,
    mddLiquidate: -0.12,
    expectedReturn: '건당 +5~8%',
    maxLoss: '-3% (손절) / -2% (트레일링)',
    investmentPeriod: '1~3일',
    tradingFrequency: '실시간 감시, 조건 충족 시 즉시 매매',
    suitableFor: ['단기 트레이딩 선호', '변동성 높은 종목', '적극적 투자자'],
    tags: ['단기매매', '변동성돌파', '모멘텀', '국내/해외'],
  };
  private readonly logger = new Logger(MomentumBreakoutStrategy.name);

  async evaluateStock(ctx: StockStrategyContext): Promise<StrategyEvaluationResult> {
    const { watchStock, price, position, stockIndicators, riskState } = ctx;
    const signals: TradingSignal[] = [];
    const skipReasons: string[] = [];
    const params = { ...DEFAULT_PARAMS, ...watchStock.strategyParams };
    const strategyParams = (watchStock.strategyParams as MomentumBreakoutStrategyParams | undefined) || {};
    const today = getTodayDate();

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
      atrRate ? Math.min(0.06, atrRate * 1.2) : 0,
    );
    const effectiveTrailingStopRate = Math.max(
      params.trailingStopRate,
      atrRate ? Math.min(0.04, atrRate * 0.8) : 0,
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

    if (hasPosition) {
      // --- 포지션 보유 중: 익절/손절/트레일링 ---
      const avgPrice = position!.avgPrice;
      const profitRate = (curPrice - avgPrice) / avgPrice;
      const holdQty = position!.quantity;

      // 손절: -3%
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

      // 트레일링 스탑: 고점 대비 -2% (당일 고가 기준)
      if (price.highPrice > 0 && curPrice < price.highPrice * (1 - effectiveTrailingStopRate)) {
        this.logger.log(
          `[${watchStock.stockCode}] TRAILING STOP: high=${price.highPrice}, cur=${curPrice}`,
        );
        signals.push({
          market,
          exchangeCode,
          stockCode: watchStock.stockCode,
          side: 'SELL',
          quantity: holdQty,
          price: roundPrice(curPrice),
          reason: `트레일링스탑: 고점 ${price.highPrice} 대비 -${(effectiveTrailingStopRate * 100).toFixed(1)}%`,
        });
        return { signals, skipReasons };
      }

      // 익절(전): +8% 전량 매도
      if (profitRate >= params.takeProfitFull) {
        signals.push({
          market,
          exchangeCode,
          stockCode: watchStock.stockCode,
          side: 'SELL',
          quantity: holdQty,
          price: roundPrice(curPrice),
          reason: `익절(전량): +${(profitRate * 100).toFixed(1)}% >= +${(params.takeProfitFull * 100).toFixed(0)}%`,
          metadata: { phase: 'take-profit-full' },
        });
        return { signals, skipReasons };
      }

      // 익절(반): +5% 50% 매도
      if (!strategyParams.halfTakeProfitDone && profitRate >= params.takeProfitHalf) {
        const sellQty = Math.max(1, Math.floor(holdQty / 2));
        signals.push({
          market,
          exchangeCode,
          stockCode: watchStock.stockCode,
          side: 'SELL',
          quantity: sellQty,
          price: roundPrice(curPrice),
          reason: `익절(반): +${(profitRate * 100).toFixed(1)}% >= +${(params.takeProfitHalf * 100).toFixed(0)}%`,
          metadata: { phase: 'take-profit-half' },
        });
        return { signals, skipReasons };
      }

      const tradingDaysHeld = strategyParams.entryDate
        ? countTradingDaysInclusive(strategyParams.entryDate, today)
        : 0;
      if (strategyParams.entryDate && tradingDaysHeld > params.timeStopDays) {
        signals.push({
          market,
          exchangeCode,
          stockCode: watchStock.stockCode,
          side: 'SELL',
          quantity: holdQty,
          price: roundPrice(curPrice),
          reason: `시간손절: ${tradingDaysHeld}거래일 보유 > ${params.timeStopDays}거래일`,
          metadata: { phase: 'time-stop' },
        });
        return { signals, skipReasons };
      }
    } else {
      // --- 포지션 없음: 진입 조건 ---

      // 리스크 체크: 매수 차단
      if (riskState?.buyBlocked || mddCheck?.buyBlocked) {
        const reason = riskState?.reasons?.join(', ') ?? 'MDD';
        this.logger.debug(`[${watchStock.stockCode}] Buy blocked by risk: ${reason}`);
        skipReasons.push(`리스크 매수 차단: ${reason}`);
        return { signals, skipReasons };
      }

      // 단일 종목 비중 체크
      if (position && ctx.totalPortfolioValue > 0) {
        if (position.totalInvested / ctx.totalPortfolioValue > 0.15) {
          skipReasons.push(`단일 종목 비중 초과: ${(position.totalInvested / ctx.totalPortfolioValue * 100).toFixed(1)}% > 15%`);
          return { signals, skipReasons };
        }
      }

      const { ma20, rsi14, volumeRatio, prevHigh, prevLow, todayOpen } = stockIndicators;

      // 투자유의/시장경고/단기과열 종목 진입 차단
      if (stockIndicators.investCautionYn || stockIndicators.shortOverheatYn) {
        skipReasons.push(stockIndicators.investCautionYn ? '투자유의 종목' : '단기과열 종목');
        return { signals, skipReasons };
      }
      if (stockIndicators.marketWarnCode && stockIndicators.marketWarnCode !== '00') {
        skipReasons.push(`시장경고 종목 (코드: ${stockIndicators.marketWarnCode})`);
        return { signals, skipReasons };
      }

      // 진입 조건 체크
      if (ma20 === undefined || rsi14 === undefined || volumeRatio === undefined) {
        skipReasons.push('필수 지표 부재 (MA20, RSI14, 거래량비율)');
        return { signals, skipReasons };
      }
      if (prevHigh === undefined || prevLow === undefined || todayOpen === undefined) {
        skipReasons.push('필수 지표 부재 (전일고가, 전일저가, 시가)');
        return { signals, skipReasons };
      }

      // 가격 > MA20
      if (curPrice <= ma20) {
        skipReasons.push(`현재가(${curPrice.toFixed(0)}) ≤ MA20(${ma20.toFixed(0)}), 상승추세 미확인`);
        return { signals, skipReasons };
      }

      // RSI 50-70
      if (rsi14 < 50 || rsi14 > 70) {
        skipReasons.push(`RSI=${rsi14.toFixed(1)} (범위 50~70 벗어남)`);
        return { signals, skipReasons };
      }

      // 거래량 >= 1.5배
      if (volumeRatio < params.volumeThreshold) {
        skipReasons.push(`거래량비율=${volumeRatio.toFixed(1)} < 최소 ${params.volumeThreshold}배`);
        return { signals, skipReasons };
      }

      // 수급 데이터가 있다면 최소한 하나의 매수 우위 확인
      if (!hasFlowConfirmation(stockIndicators)) {
        skipReasons.push('수급 데이터 확인: 외인/기관/프로그램 매수 우위 없음');
        return { signals, skipReasons };
      }

      // 시가 + 전일레인지 × K 돌파
      const prevRange = prevHigh - prevLow;
      const breakoutPrice = todayOpen + prevRange * params.kValue;
      if (curPrice < breakoutPrice) {
        skipReasons.push(`K값 돌파 미달성: 현재가(${curPrice.toFixed(0)}) < 돌파가(${breakoutPrice.toFixed(0)})`);
        return { signals, skipReasons };
      }

      // 모든 조건 충족 → 매수
      const quota = watchStock.quota || 0;
      const buyAmount = Math.min(quota, ctx.buyableAmount);
      const buyQty = Math.floor(buyAmount / curPrice);

      if (buyQty > 0) {
        // 연중 최고가 근접/돌파 시 reason에 표기 (추가 확신 시그널)
        const yearHighNote = stockIndicators.yearHighRate !== undefined && stockIndicators.yearHighRate >= -3
          ? `, 연중최고근접` : '';
        const flowNote = stockIndicators.foreignNetBuy || stockIndicators.institutionNetBuy || stockIndicators.programTradeDirection === 'BUY'
          ? ', 수급확인'
          : '';

        this.logger.log(
          `[${watchStock.stockCode}] BUY signal: price=${curPrice}, MA20=${ma20.toFixed(2)}, RSI=${rsi14.toFixed(1)}, vol=${volumeRatio.toFixed(1)}x, breakout=${breakoutPrice.toFixed(2)}${yearHighNote}${flowNote}`,
        );
        signals.push({
          market,
          exchangeCode,
          stockCode: watchStock.stockCode,
          side: 'BUY',
          quantity: buyQty,
          price: roundPrice(curPrice),
          reason: `모멘텀돌파: RSI=${rsi14.toFixed(0)}, vol=${volumeRatio.toFixed(1)}x, K돌파=${breakoutPrice.toFixed(0)}${yearHighNote}${flowNote}`,
        });
      }
    }

    return { signals, skipReasons };
  }
}
