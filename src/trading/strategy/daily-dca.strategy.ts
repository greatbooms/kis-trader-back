import { Injectable, Logger } from '@nestjs/common';
import {
  PerStockTradingStrategy,
  StockStrategyContext,
  TradingSignal,
  ExecutionMode,
  StrategyMeta,
} from '../types';


@Injectable()
export class DailyDcaStrategy implements PerStockTradingStrategy {
  readonly name = 'daily-dca';
  readonly displayName = '일별 분할매수';
  readonly executionMode: ExecutionMode = {
    type: 'once-daily',
    hours: { domestic: 10, overseas: { basis: 'afterOpen', offsetHours: 1 } },
  };
  readonly description = [
    '매일 정해진 금액으로 꾸준히 매수하는 적립식 전략입니다.',
    '',
    '【매수 방식】',
    '- 하루 1회, 장중 실행 (국내 10시, 해외 장 시작 1시간 후)',
    '- 1회 매수금액 = quota / maxCycles',
    '- 현재가 기준 지정가 매수',
    '- 매수금액이 1주 가격 미만이면 다음 사이클로 이월, 누적 후 매수',
    '',
    '【매도 조건】',
    '- 익절: 평균단가 +10%에 전량 매도',
    '- 손절: 평균단가 대비 설정 손절률(기본 30%) 하회 시 전량 매도',
    '- 익절/손절 후 quota가 남아있으면 다시 매수 사이클 진행',
    '',
    '【특징】',
    '- 시장 상황과 무관하게 매일 매수 (순수 DCA)',
    '- 하락 시 평균단가가 자연스럽게 낮아짐',
    '- 단순하고 감정 개입 없는 기계적 투자',
    '',
    '【안전장치】',
    '- 손절률은 종목별로 설정 가능 (기본 -30%)',
    '- quota 소진 시 매수 중단, 매도만 허용',
    '- 투자유의/시장경고 종목은 신규 진입 차단',
  ].join('\n');
  readonly meta: StrategyMeta = {
    riskLevel: 'low',
    mddBuyBlock: -0.20,
    mddLiquidate: -0.30,
    expectedReturn: '시장 수익률 추종',
    maxLoss: '-30% (손절 기본값)',
    investmentPeriod: '6개월~수년',
    tradingFrequency: '하루 1회 자동 매수',
    suitableFor: ['적립식 투자자', '장기 투자', 'ETF 투자'],
    tags: ['DCA', '적립식', '장기투자', '국내/해외'],
  };
  private readonly logger = new Logger(DailyDcaStrategy.name);

  async evaluateStock(ctx: StockStrategyContext): Promise<TradingSignal[]> {
    const { watchStock, price, position } = ctx;
    const signals: TradingSignal[] = [];

    // quota 미설정 → skip
    if (!watchStock.quota || watchStock.quota <= 0) {
      this.logger.debug(`[${watchStock.stockCode}] No quota set, skip`);
      return signals;
    }

    const curPrice = price.currentPrice;
    if (curPrice <= 0) {
      this.logger.warn(`[${watchStock.stockCode}] Invalid current price: ${curPrice}`);
      return signals;
    }

    const market = watchStock.market;
    const exchangeCode = watchStock.exchangeCode || 'KRX';
    const isOverseas = market === 'OVERSEAS';
    const hasPosition = !!position && position.quantity > 0;

    const quota = watchStock.quota;
    const totalInvested = position?.totalInvested || 0;
    const perCycleQuota = quota / watchStock.maxCycles;
    const avgPrice = position?.avgPrice || curPrice;
    const holdQty = position?.quantity || 0;

    // 가격 반올림 함수
    const roundPrice = isOverseas
      ? (p: number) => Math.round(p * 100) / 100
      : (p: number) => Math.round(p);

    // --- 손절: 포지션 보유 중이면 항상 체크 ---
    if (hasPosition && curPrice < avgPrice * (1 - watchStock.stopLossRate)) {
      this.logger.log(
        `[${watchStock.stockCode}] STOP LOSS: cur=${curPrice}, avg=${avgPrice}, rate=${watchStock.stopLossRate}`,
      );
      signals.push({
        market,
        exchangeCode: isOverseas ? exchangeCode : undefined,
        stockCode: watchStock.stockCode,
        side: 'SELL',
        quantity: holdQty,
        price: roundPrice(curPrice),
        reason: `Stop loss: loss=${((1 - curPrice / avgPrice) * 100).toFixed(1)}%`,
        orderDivision: '00',
      });
      return signals;
    }

    // 오늘 이미 실행 → skip (손절은 위에서 이미 체크)
    if (ctx.alreadyExecutedToday) {
      this.logger.debug(`[${watchStock.stockCode}] Already executed today, skip`);
      return signals;
    }

    // --- 익절: 평균단가 +10% ---
    if (hasPosition && curPrice >= avgPrice * 1.10) {
      this.logger.log(
        `[${watchStock.stockCode}] TAKE PROFIT: cur=${curPrice}, avg=${avgPrice}, +${((curPrice / avgPrice - 1) * 100).toFixed(1)}%`,
      );
      signals.push({
        market,
        exchangeCode: isOverseas ? exchangeCode : undefined,
        stockCode: watchStock.stockCode,
        side: 'SELL',
        quantity: holdQty,
        price: roundPrice(curPrice),
        reason: `Take profit: +${((curPrice / avgPrice - 1) * 100).toFixed(1)}%`,
        orderDivision: '00',
      });
      return signals;
    }

    // --- 매수: quota 소진 전까지 매일 매수 ---
    const maxCyclesReached = totalInvested >= quota;
    if (maxCyclesReached) {
      this.logger.debug(`[${watchStock.stockCode}] Quota exhausted (${totalInvested.toFixed(0)} >= ${quota}), buy stopped`);
      return signals;
    }

    // 누적 이월금 포함
    const accumulatedQuota = (watchStock.strategyParams?.accumulatedQuota as number) || 0;
    const adjustedQuota = Math.min(perCycleQuota + accumulatedQuota, ctx.buyableAmount);

    const buyQty = Math.floor(adjustedQuota / curPrice);
    if (buyQty > 0) {
      signals.push({
        market,
        exchangeCode: isOverseas ? exchangeCode : undefined,
        stockCode: watchStock.stockCode,
        side: 'BUY',
        quantity: buyQty,
        price: roundPrice(curPrice),
        reason: `DCA buy: ${buyQty}주 @ ${roundPrice(curPrice)}`,
        orderDivision: '00',
      });
    }

    this.logger.log(
      `[${watchStock.stockCode}] invested=${totalInvested.toFixed(0)}/${quota}, signals=${signals.length}`,
    );

    return signals;
  }
}
