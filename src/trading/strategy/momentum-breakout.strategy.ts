import { Injectable, Logger } from '@nestjs/common';
import {
  PerStockTradingStrategy,
  StockStrategyContext,
  TradingSignal,
  ExecutionMode,
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
    '- -3% 하락 시 전량 매도 (손절)',
    '- 당일 고가 대비 -2% 하락 시 전량 매도 (트레일링 스탑)',
    '- 리스크 전량청산 시그널 시 즉시 매도',
    '',
    '【특징】',
    '- 단기 매매에 적합 (보유기간 1~3일)',
    '- 손절 폭이 작아 리스크 관리에 유리',
    '- 강한 추세가 있는 종목에서 효과적',
  ].join('\n');
  private readonly logger = new Logger(MomentumBreakoutStrategy.name);

  async evaluateStock(ctx: StockStrategyContext): Promise<TradingSignal[]> {
    const { watchStock, price, position, stockIndicators, riskState } = ctx;
    const signals: TradingSignal[] = [];
    const params = { ...DEFAULT_PARAMS, ...watchStock.strategyParams };

    const curPrice = price.currentPrice;
    if (curPrice <= 0) return signals;

    const market = watchStock.market;
    const exchangeCode = watchStock.exchangeCode || 'KRX';
    const isOverseas = market === 'OVERSEAS';
    const hasPosition = !!position && position.quantity > 0;

    const roundPrice = isOverseas
      ? (p: number) => Math.round(p * 100) / 100
      : (p: number) => Math.round(p);

    // 리스크 체크: 전량 청산 시그널
    if (riskState?.liquidateAll && hasPosition) {
      signals.push({
        market,
        exchangeCode: isOverseas ? exchangeCode : undefined,
        stockCode: watchStock.stockCode,
        side: 'SELL',
        quantity: position!.quantity,
        price: roundPrice(curPrice),
        reason: `리스크 전량청산: MDD ${(riskState.drawdown * 100).toFixed(1)}%`,
      });
      return signals;
    }

    if (hasPosition) {
      // --- 포지션 보유 중: 익절/손절/트레일링 ---
      const avgPrice = position!.avgPrice;
      const profitRate = (curPrice - avgPrice) / avgPrice;
      const holdQty = position!.quantity;

      // 손절: -3%
      if (profitRate <= -params.stopLossRate) {
        this.logger.log(
          `[${watchStock.stockCode}] STOP LOSS: ${(profitRate * 100).toFixed(1)}%`,
        );
        signals.push({
          market,
          exchangeCode: isOverseas ? exchangeCode : undefined,
          stockCode: watchStock.stockCode,
          side: 'SELL',
          quantity: holdQty,
          price: roundPrice(curPrice),
          reason: `손절: ${(profitRate * 100).toFixed(1)}% <= -${(params.stopLossRate * 100).toFixed(0)}%`,
        });
        return signals;
      }

      // 트레일링 스탑: 고점 대비 -2% (당일 고가 기준)
      if (price.highPrice > 0 && curPrice < price.highPrice * (1 - params.trailingStopRate)) {
        this.logger.log(
          `[${watchStock.stockCode}] TRAILING STOP: high=${price.highPrice}, cur=${curPrice}`,
        );
        signals.push({
          market,
          exchangeCode: isOverseas ? exchangeCode : undefined,
          stockCode: watchStock.stockCode,
          side: 'SELL',
          quantity: holdQty,
          price: roundPrice(curPrice),
          reason: `트레일링스탑: 고점 ${price.highPrice} 대비 -${(params.trailingStopRate * 100).toFixed(0)}%`,
        });
        return signals;
      }

      // 익절(전): +8% 전량 매도
      if (profitRate >= params.takeProfitFull) {
        signals.push({
          market,
          exchangeCode: isOverseas ? exchangeCode : undefined,
          stockCode: watchStock.stockCode,
          side: 'SELL',
          quantity: holdQty,
          price: roundPrice(curPrice),
          reason: `익절(전량): +${(profitRate * 100).toFixed(1)}% >= +${(params.takeProfitFull * 100).toFixed(0)}%`,
        });
        return signals;
      }

      // 익절(반): +5% 50% 매도
      if (profitRate >= params.takeProfitHalf) {
        const sellQty = Math.max(1, Math.floor(holdQty / 2));
        signals.push({
          market,
          exchangeCode: isOverseas ? exchangeCode : undefined,
          stockCode: watchStock.stockCode,
          side: 'SELL',
          quantity: sellQty,
          price: roundPrice(curPrice),
          reason: `익절(반): +${(profitRate * 100).toFixed(1)}% >= +${(params.takeProfitHalf * 100).toFixed(0)}%`,
        });
        return signals;
      }

      // 시간손절: 3거래일 초과 (alreadyExecutedToday 기준으로 간접 판단)
      // strategyExecution에서 첫 매수일 조회하여 판단은 스케줄러에서 처리
      // 여기서는 skip (스케줄러에서 ctx에 추가 정보 전달 필요 시 확장 가능)
    } else {
      // --- 포지션 없음: 진입 조건 ---

      // 리스크 체크: 매수 차단
      if (riskState?.buyBlocked) {
        this.logger.debug(`[${watchStock.stockCode}] Buy blocked by risk: ${riskState.reasons.join(', ')}`);
        return signals;
      }

      // 단일 종목 비중 체크
      if (position && ctx.totalPortfolioValue > 0) {
        if (position.totalInvested / ctx.totalPortfolioValue > 0.15) {
          return signals;
        }
      }

      const { ma20, rsi14, volumeRatio, prevHigh, prevLow, todayOpen } = stockIndicators;

      // 투자유의/시장경고/단기과열 종목 진입 차단
      if (stockIndicators.investCautionYn || stockIndicators.shortOverheatYn) return signals;
      if (stockIndicators.marketWarnCode && stockIndicators.marketWarnCode !== '00') return signals;

      // 진입 조건 체크
      if (ma20 === undefined || rsi14 === undefined || volumeRatio === undefined) {
        return signals;
      }
      if (prevHigh === undefined || prevLow === undefined || todayOpen === undefined) {
        return signals;
      }

      // 가격 > MA20
      if (curPrice <= ma20) return signals;

      // RSI 50-70
      if (rsi14 < 50 || rsi14 > 70) return signals;

      // 거래량 >= 1.5배
      if (volumeRatio < params.volumeThreshold) return signals;

      // 시가 + 전일레인지 × K 돌파
      const prevRange = prevHigh - prevLow;
      const breakoutPrice = todayOpen + prevRange * params.kValue;
      if (curPrice < breakoutPrice) return signals;

      // 모든 조건 충족 → 매수
      const quota = watchStock.quota || 0;
      const buyAmount = Math.min(quota, ctx.buyableAmount);
      const buyQty = Math.floor(buyAmount / curPrice);

      if (buyQty > 0) {
        this.logger.log(
          `[${watchStock.stockCode}] BUY signal: price=${curPrice}, MA20=${ma20.toFixed(2)}, RSI=${rsi14.toFixed(1)}, vol=${volumeRatio.toFixed(1)}x, breakout=${breakoutPrice.toFixed(2)}`,
        );
        signals.push({
          market,
          exchangeCode: isOverseas ? exchangeCode : undefined,
          stockCode: watchStock.stockCode,
          side: 'BUY',
          quantity: buyQty,
          price: roundPrice(curPrice),
          reason: `모멘텀돌파: RSI=${rsi14.toFixed(0)}, vol=${volumeRatio.toFixed(1)}x, K돌파=${breakoutPrice.toFixed(0)}`,
        });
      }
    }

    return signals;
  }
}
