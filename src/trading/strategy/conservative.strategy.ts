import { Injectable, Logger } from '@nestjs/common';
import {
  PerStockTradingStrategy,
  StockStrategyContext,
  TradingSignal,
  ExecutionMode,
  StrategyMeta,
  evaluateStrategyMdd,
} from '../types';

const DEFAULT_PARAMS = {
  cashRate: 0.7,
  rsiThreshold: 25,
  volumeThreshold: 2.0,
  stopLossRate: 0.05,
  takeProfitRate: 0.03,
};

@Injectable()
export class ConservativeStrategy implements PerStockTradingStrategy {
  readonly name = 'conservative';
  readonly displayName = '보수적 매매';
  readonly executionMode: ExecutionMode = { type: 'continuous' };
  readonly description = [
    '극단적 과매도 구간에서만 소액 진입하고, 소폭 반등 시 빠르게 청산하는 저위험 전략입니다.',
    '',
    '【진입 조건 (모두 충족 시 매수)】',
    '- RSI < 25 (극단적 과매도)',
    '- 거래량 >= 전일 대비 2배 (이상 거래량 감지)',
    '- 투자금의 30%만 사용 (나머지 70%는 현금 보유)',
    '',
    '【매도 조건】',
    '- +3% 수익 시 전량 매도 (익절)',
    '- -5% 손실 시 전량 매도 (손절)',
    '- 리스크 전량청산 시그널 시 즉시 매도',
    '',
    '【특징】',
    '- 가장 보수적인 전략, 투자금의 30%만 사용',
    '- 진입 조건이 매우 엄격하여 매매 빈도가 낮음',
    '- 작은 수익을 자주 실현하는 스타일',
    '- 큰 손실 위험이 적어 초보자에게 적합',
    '',
    '【안전장치】',
    '- 투자유의/시장경고 종목은 진입 차단',
    '- 공매도 불가 + 융자잔고 3% 미만 종목은 하방 방어력이 높아 투자 비중 40%로 완화',
    '- 리스크 전량청산 시그널 시 즉시 매도',
  ].join('\n');
  readonly meta: StrategyMeta = {
    riskLevel: 'very-low',
    mddBuyBlock: -0.10,
    mddLiquidate: -0.15,
    expectedReturn: '건당 +3%',
    maxLoss: '-5% (손절)',
    investmentPeriod: '수시간~수일',
    tradingFrequency: '실시간 감시, 극단적 과매도 시에만 진입',
    suitableFor: ['초보 투자자', '원금 보전 중시', '소액 투자'],
    tags: ['저위험', '과매도반등', '소액', '국내/해외'],
  };
  private readonly logger = new Logger(ConservativeStrategy.name);

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

    // 리스크 체크: 전략별 MDD 기준 전량 청산
    const mddCheck = riskState ? evaluateStrategyMdd(riskState.drawdown, this.meta.mddBuyBlock, this.meta.mddLiquidate) : undefined;
    if (mddCheck?.liquidateAll && hasPosition) {
      signals.push({
        market,
        exchangeCode: isOverseas ? exchangeCode : undefined,
        stockCode: watchStock.stockCode,
        side: 'SELL',
        quantity: position!.quantity,
        price: roundPrice(curPrice),
        reason: `리스크 전량청산: MDD ${(riskState!.drawdown * 100).toFixed(1)}% (임계값 ${(this.meta.mddLiquidate * 100).toFixed(0)}%)`,
      });
      return signals;
    }

    if (hasPosition) {
      // --- 포지션 보유 중: 익절/손절 ---
      const avgPrice = position!.avgPrice;
      const profitRate = (curPrice - avgPrice) / avgPrice;
      const holdQty = position!.quantity;

      // 손절: -5%
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

      // 익절: +3%
      if (profitRate >= params.takeProfitRate) {
        this.logger.log(
          `[${watchStock.stockCode}] TAKE PROFIT: ${(profitRate * 100).toFixed(1)}%`,
        );
        signals.push({
          market,
          exchangeCode: isOverseas ? exchangeCode : undefined,
          stockCode: watchStock.stockCode,
          side: 'SELL',
          quantity: holdQty,
          price: roundPrice(curPrice),
          reason: `익절: +${(profitRate * 100).toFixed(1)}% >= +${(params.takeProfitRate * 100).toFixed(0)}%`,
        });
        return signals;
      }
    } else {
      // --- 포지션 없음: 진입 조건 ---

      // 리스크 체크
      if (riskState?.buyBlocked || mddCheck?.buyBlocked) {
        this.logger.debug(`[${watchStock.stockCode}] Buy blocked by risk: ${riskState?.reasons?.join(', ') ?? 'MDD'}`);
        return signals;
      }

      const { rsi14, volumeRatio } = stockIndicators;

      // 투자유의/시장경고 종목 진입 차단
      if (stockIndicators.investCautionYn) return signals;
      if (stockIndicators.marketWarnCode && stockIndicators.marketWarnCode !== '00') return signals;

      if (rsi14 === undefined || volumeRatio === undefined) return signals;

      // RSI < 25
      if (rsi14 >= params.rsiThreshold) return signals;

      // 거래량 >= 2배
      if (volumeRatio < params.volumeThreshold) return signals;

      // 보수적 모드: 기본 자금의 30%만 사용
      const quota = watchStock.quota || 0;
      let availableRate = 1 - params.cashRate; // 0.3

      // 공매도 불가 + 융자잔고 낮음 → 하방 방어력 높아 cashRate 완화 (40% 사용)
      const isDefensive = stockIndicators.shortSellable === false
        && (stockIndicators.loanBalanceRate === undefined || stockIndicators.loanBalanceRate < 3);
      if (isDefensive) {
        availableRate = Math.min(availableRate + 0.1, 0.5);
      }

      const buyAmount = Math.min(quota * availableRate, ctx.buyableAmount);
      const buyQty = Math.floor(buyAmount / curPrice);

      if (buyQty > 0) {
        const defensiveNote = isDefensive ? ', 하방방어력+' : '';
        this.logger.log(
          `[${watchStock.stockCode}] CONSERVATIVE BUY: price=${curPrice}, RSI=${rsi14.toFixed(1)}, vol=${volumeRatio.toFixed(1)}x, rate=${(availableRate * 100).toFixed(0)}%${defensiveNote}`,
        );
        signals.push({
          market,
          exchangeCode: isOverseas ? exchangeCode : undefined,
          stockCode: watchStock.stockCode,
          side: 'BUY',
          quantity: buyQty,
          price: roundPrice(curPrice),
          reason: `보수적매수: RSI=${rsi14.toFixed(0)}, vol=${volumeRatio.toFixed(1)}x, 자금 ${(availableRate * 100).toFixed(0)}%${defensiveNote}`,
        });
      }
    }

    return signals;
  }
}
