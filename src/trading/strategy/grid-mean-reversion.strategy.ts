import { Injectable, Logger } from '@nestjs/common';
import {
  PerStockTradingStrategy,
  StockStrategyContext,
  TradingSignal,
  ExecutionMode,
} from '../types';

const DEFAULT_PARAMS = {
  gridLevels: [-0.02, -0.04, -0.06],
  gridRatios: [0.3, 0.3, 0.4],
  stopLossRate: 0.08,
};

@Injectable()
export class GridMeanReversionStrategy implements PerStockTradingStrategy {
  readonly name = 'grid-mean-reversion';
  readonly displayName = '그리드 평균회귀';
  readonly executionMode: ExecutionMode = { type: 'continuous' };
  readonly description = [
    '볼린저 밴드와 RSI를 활용하여 과매도 구간에서 분할 매수하고, 평균으로 회귀할 때 매도하는 전략입니다.',
    '',
    '【진입 조건 (모두 충족 시 매수)】',
    '- 현재가 <= 볼린저 밴드 하단 (과매도 영역 진입)',
    '- RSI < 30 (과매도 확인)',
    '- MACD 히스토그램 상승 전환 (반등 시그널)',
    '',
    '【그리드 매수 (3단계 분할)】',
    '- 1단계: 평균단가 -2% → 투자금의 30%',
    '- 2단계: 평균단가 -4% → 투자금의 30%',
    '- 3단계: 평균단가 -6% → 투자금의 40%',
    '- 하락할수록 더 많이 매수하여 평균단가를 낮춤',
    '',
    '【매도 조건】',
    '- 볼린저 밴드 중심선 도달: 보유량의 50% 매도 (1차 익절)',
    '- 볼린저 밴드 상단 도달: 전량 매도 (2차 익절)',
    '- -8% 하락 시 전량 매도 (손절)',
    '',
    '【특징】',
    '- 횡보장/박스권 종목에 적합',
    '- 급락 시 분할 매수로 평균단가를 효과적으로 낮춤',
    '- 추세가 강한 하락장에서는 손절 주의',
  ].join('\n');
  private readonly logger = new Logger(GridMeanReversionStrategy.name);

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
      // --- 포지션 보유 중: 익절/손절 ---
      const avgPrice = position!.avgPrice;
      const profitRate = (curPrice - avgPrice) / avgPrice;
      const holdQty = position!.quantity;
      const { bollingerMiddle, bollingerUpper } = stockIndicators;

      // 손절: -8%
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

      // 익절(2차): BB 상단 도달 → 나머지 매도
      if (bollingerUpper && curPrice >= bollingerUpper) {
        this.logger.log(
          `[${watchStock.stockCode}] BB Upper reached: cur=${curPrice}, upper=${bollingerUpper.toFixed(2)}`,
        );
        signals.push({
          market,
          exchangeCode: isOverseas ? exchangeCode : undefined,
          stockCode: watchStock.stockCode,
          side: 'SELL',
          quantity: holdQty,
          price: roundPrice(curPrice),
          reason: `BB상단 익절: ${curPrice} >= BB상단 ${bollingerUpper.toFixed(0)}`,
        });
        return signals;
      }

      // 익절(1차): BB 중심선 도달 → 50% 매도
      if (bollingerMiddle && curPrice >= bollingerMiddle && profitRate > 0) {
        const sellQty = Math.max(1, Math.floor(holdQty / 2));
        this.logger.log(
          `[${watchStock.stockCode}] BB Middle reached: cur=${curPrice}, middle=${bollingerMiddle.toFixed(2)}`,
        );
        signals.push({
          market,
          exchangeCode: isOverseas ? exchangeCode : undefined,
          stockCode: watchStock.stockCode,
          side: 'SELL',
          quantity: sellQty,
          price: roundPrice(curPrice),
          reason: `BB중심선 익절: ${curPrice} >= BB중심 ${bollingerMiddle.toFixed(0)}, 50%매도`,
        });
        return signals;
      }

      // 그리드 추가 매수: 보유 중이더라도 추가 그리드 레벨에 도달하면 추가 매수
      if (!riskState?.buyBlocked) {
        const gridLevels: number[] = params.gridLevels;
        const gridRatios: number[] = params.gridRatios;
        const basePrice = position!.avgPrice; // 기준가 = 평균단가
        const quota = watchStock.quota || 0;
        const buyAmount = Math.min(quota, ctx.buyableAmount);

        for (let i = 0; i < gridLevels.length; i++) {
          const gridPrice = basePrice * (1 + gridLevels[i]);
          if (curPrice <= gridPrice) {
            const gridAmount = buyAmount * gridRatios[i];
            const gridQty = Math.floor(gridAmount / curPrice);
            if (gridQty > 0) {
              signals.push({
                market,
                exchangeCode: isOverseas ? exchangeCode : undefined,
                stockCode: watchStock.stockCode,
                side: 'BUY',
                quantity: gridQty,
                price: roundPrice(curPrice),
                reason: `그리드매수 ${i + 1}단계: ${(gridLevels[i] * 100).toFixed(0)}% (${gridPrice.toFixed(0)})`,
              });
              break; // 한 번에 하나의 그리드만
            }
          }
        }
      }
    } else {
      // --- 포지션 없음: 진입 조건 ---

      // 리스크 체크
      if (riskState?.buyBlocked) {
        this.logger.debug(`[${watchStock.stockCode}] Buy blocked by risk: ${riskState.reasons.join(', ')}`);
        return signals;
      }

      const { bollingerLower, rsi14, macdHistogram, macdPrevHistogram } = stockIndicators;

      // 진입 조건: BB 하단 터치
      if (bollingerLower === undefined || rsi14 === undefined) return signals;
      if (macdHistogram === undefined || macdPrevHistogram === undefined) return signals;

      // BB 하단 터치
      if (curPrice > bollingerLower) return signals;

      // RSI < 30
      if (rsi14 >= 30) return signals;

      // MACD 히스토그램 상승 전환 (이전 < 0, 현재 > 이전)
      if (macdHistogram <= macdPrevHistogram) return signals;

      // 모든 조건 충족 → 그리드 1단계 매수
      const quota = watchStock.quota || 0;
      const buyAmount = Math.min(quota, ctx.buyableAmount);
      const gridRatios: number[] = params.gridRatios;
      const firstGridAmount = buyAmount * gridRatios[0];
      const buyQty = Math.floor(firstGridAmount / curPrice);

      if (buyQty > 0) {
        this.logger.log(
          `[${watchStock.stockCode}] GRID ENTRY: price=${curPrice}, BB하단=${bollingerLower.toFixed(2)}, RSI=${rsi14.toFixed(1)}, MACD hist=${macdHistogram.toFixed(4)}`,
        );
        signals.push({
          market,
          exchangeCode: isOverseas ? exchangeCode : undefined,
          stockCode: watchStock.stockCode,
          side: 'BUY',
          quantity: buyQty,
          price: roundPrice(curPrice),
          reason: `그리드진입: BB하단=${bollingerLower.toFixed(0)}, RSI=${rsi14.toFixed(0)}, MACD상승전환`,
        });
      }
    }

    return signals;
  }
}
