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
  cashRate: 0.7,
  rsiThreshold: 25,
  volumeThreshold: 2.0,
  stopLossRate: 0.05,
  takeProfitRate: 0.03,
};

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
  return (stockIndicators.recentMaterialDisclosureCount30d ?? 0) >= 1
    || (stockIndicators.recentSecForm8KCount30d ?? 0) >= 2;
}

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
    '- 변동성 과다 또는 외인/기관/프로그램 동반 매도 종목은 진입 차단',
    '- 최근 주요 공시/8-K 이벤트가 많으면 진입 차단',
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
          exchangeCode,
          stockCode: watchStock.stockCode,
          side: 'SELL',
          quantity: holdQty,
          price: roundPrice(curPrice),
          reason: `손절: ${(profitRate * 100).toFixed(1)}% <= -${(params.stopLossRate * 100).toFixed(0)}%`,
        });
        return { signals, skipReasons };
      }

      // 익절: +3%
      if (profitRate >= params.takeProfitRate) {
        this.logger.log(
          `[${watchStock.stockCode}] TAKE PROFIT: ${(profitRate * 100).toFixed(1)}%`,
        );
        signals.push({
          market,
          exchangeCode,
          stockCode: watchStock.stockCode,
          side: 'SELL',
          quantity: holdQty,
          price: roundPrice(curPrice),
          reason: `익절: +${(profitRate * 100).toFixed(1)}% >= +${(params.takeProfitRate * 100).toFixed(0)}%`,
        });
        return { signals, skipReasons };
      }
    } else {
      // --- 포지션 없음: 진입 조건 ---

      // 리스크 체크
      if (riskState?.buyBlocked || mddCheck?.buyBlocked) {
        const reason = riskState?.reasons?.join(', ') ?? 'MDD';
        this.logger.debug(`[${watchStock.stockCode}] Buy blocked by risk: ${reason}`);
        skipReasons.push(`리스크 매수 차단: ${reason}`);
        return { signals, skipReasons };
      }

      const { rsi14, volumeRatio } = stockIndicators;

      // 투자유의/시장경고 종목 진입 차단
      if (stockIndicators.investCautionYn) {
        skipReasons.push('투자유의 종목');
        return { signals, skipReasons };
      }
      if (stockIndicators.marketWarnCode && stockIndicators.marketWarnCode !== '00') {
        skipReasons.push(`시장경고 종목 (코드: ${stockIndicators.marketWarnCode})`);
        return { signals, skipReasons };
      }

      if (rsi14 === undefined || volumeRatio === undefined) {
        skipReasons.push('필수 지표 부재 (RSI14, 거래량비율)');
        return { signals, skipReasons };
      }

      // RSI < 25
      if (rsi14 >= params.rsiThreshold) {
        skipReasons.push(`RSI=${rsi14.toFixed(1)} ≥ 임계값 ${params.rsiThreshold} (과매도 아님)`);
        return { signals, skipReasons };
      }

      // 거래량 >= 2배
      if (volumeRatio < params.volumeThreshold) {
        skipReasons.push(`거래량비율=${volumeRatio.toFixed(1)} < 최소 ${params.volumeThreshold}배`);
        return { signals, skipReasons };
      }

      if ((stockIndicators.volatility30d ?? 0) >= 60) {
        skipReasons.push(`변동성 과다: ${(stockIndicators.volatility30d ?? 0).toFixed(1)}% ≥ 60%`);
        return { signals, skipReasons };
      }
      if (hasStrongSellFlow(stockIndicators)) {
        skipReasons.push('외인/기관/프로그램 동반 매도 수급');
        return { signals, skipReasons };
      }
      if (hasEventDrivenRisk(stockIndicators)) {
        skipReasons.push('최근 공시/SEC 이벤트 과다');
        return { signals, skipReasons };
      }

      // 보수적 모드: 기본 자금의 30%만 사용
      const quota = watchStock.quota || 0;
      let availableRate = 1 - params.cashRate; // 0.3

      // 공매도 불가 + 융자잔고 낮음 → 하방 방어력 높아 cashRate 완화 (40% 사용)
      const isDefensive = stockIndicators.shortSellable === false
        && (stockIndicators.loanBalanceRate === undefined || stockIndicators.loanBalanceRate < 3);
      if (isDefensive) {
        availableRate = Math.min(availableRate + 0.1, 0.5);
      }

      if ((stockIndicators.d250LowRate ?? Number.POSITIVE_INFINITY) <= 10 || (stockIndicators.yearLowRate ?? Number.POSITIVE_INFINITY) <= 5) {
        availableRate = Math.min(availableRate + 0.1, 0.5);
      }

      if ((stockIndicators.volatility30d ?? 0) >= 35) {
        availableRate *= 0.8;
      }

      const buyAmount = Math.min(quota * availableRate, ctx.buyableAmount);
      const buyQty = Math.floor(buyAmount / curPrice);

      if (buyQty > 0) {
        const defensiveNote = isDefensive ? ', 하방방어력+' : '';
        const reboundNote = (stockIndicators.d250LowRate ?? Number.POSITIVE_INFINITY) <= 10 || (stockIndicators.yearLowRate ?? Number.POSITIVE_INFINITY) <= 5
          ? ', 바닥권근접'
          : '';
        this.logger.log(
          `[${watchStock.stockCode}] CONSERVATIVE BUY: price=${curPrice}, RSI=${rsi14.toFixed(1)}, vol=${volumeRatio.toFixed(1)}x, rate=${(availableRate * 100).toFixed(0)}%${defensiveNote}${reboundNote}`,
        );
        signals.push({
          market,
          exchangeCode,
          stockCode: watchStock.stockCode,
          side: 'BUY',
          quantity: buyQty,
          price: roundPrice(curPrice),
          reason: `보수적매수: RSI=${rsi14.toFixed(0)}, vol=${volumeRatio.toFixed(1)}x, 자금 ${(availableRate * 100).toFixed(0)}%${defensiveNote}${reboundNote}`,
        });
      }
    }

    return { signals, skipReasons };
  }
}
