import { Injectable, Logger } from '@nestjs/common';
import {
  PerStockTradingStrategy,
  StockStrategyContext,
  TradingSignal,
  ExecutionMode,
  StrategyMeta,
} from '../types';

/** LOC 지원 거래소 (미국만) */
const LOC_EXCHANGES = new Set(['NASD', 'NYSE', 'AMEX']);

@Injectable()
export class InfiniteBuyStrategy implements PerStockTradingStrategy {
  readonly name = 'infinite-buy';
  readonly displayName = '무한매수법';
  readonly executionMode: ExecutionMode = {
    type: 'once-daily',
    hours: { domestic: 15, overseas: 5 }, // KST 15시(국내), 05시(해외)
  };
  readonly description = [
    '설정한 투자금(quota)을 최대 40회(사이클)에 걸쳐 분할 매수하는 전략입니다.',
    '',
    '【매수 조건】',
    '- 하루 1회만 실행 (중복 매수 방지)',
    '- 지수(S&P500/KOSPI)가 200일 이동평균선 위일 때만 신규 진입',
    '- 종목 가격이 200일 이동평균선 위일 때만 신규 진입',
    '- RSI < 30 과매도 구간에서는 매수금액 1.5배 증가',
    '- 금리 급등 시 매수금액 절반으로 축소',
    '',
    '【매수 방식】',
    '- T(사이클) < 20: Buy1(현재가) + Buy2(현재가 아래 지정가) 두 건 분할',
    '- T >= 20: Buy2(현재가 아래 지정가)만 실행',
    '- Buy2 지정가: T<10 -3%, T<20 -5%, T>=20 -7% (T가 높을수록 보수적)',
    '- 종목당 최대 포트폴리오 비중 초과 시 매수 중단',
    '',
    '【매도 조건】',
    '- Sell1: 피봇가격에 보유량의 25% 매도',
    '- Sell2: 목표수익률 도달 시 나머지 매도 (T<10: +5%, T<20: +10%, T>=20: +15%)',
    '- 손절: 평균단가 대비 설정 손절률(기본 30%) 하회 시 전량 매도',
    '',
    '【특징】',
    '- 장기 분할매수에 적합, 하락장에서 평균단가를 낮추는 전략',
    '- 해외 주식은 LOC(장마감지정가) 주문 지원',
  ].join('\n');
  readonly meta: StrategyMeta = {
    riskLevel: 'medium',
    expectedReturn: '연 10~25%',
    maxLoss: '-30% (손절 기본값)',
    investmentPeriod: '3개월~1년',
    tradingFrequency: '하루 1회 자동 매수',
    suitableFor: ['장기 분할매수 선호 투자자', '하락장 대응', '적립식 투자'],
    tags: ['분할매수', 'DCA', '장기투자', '국내/해외'],
  };
  private readonly logger = new Logger(InfiniteBuyStrategy.name);

  async evaluateStock(ctx: StockStrategyContext): Promise<TradingSignal[]> {
    const { watchStock, price, position, marketCondition, stockIndicators } = ctx;
    const signals: TradingSignal[] = [];
    const details: Record<string, any> = {};

    // 2. quota 미설정 → skip
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

    // --- 기본 무한매수법 계산 ---
    const quota = watchStock.quota;
    const totalInvested = position?.totalInvested || 0;
    const perCycleQuota = quota / watchStock.maxCycles;
    const T = totalInvested > 0 ? totalInvested / perCycleQuota : 0; // T = 완료 사이클 수
    const avgPrice = position?.avgPrice || curPrice;
    const holdQty = position?.quantity || 0;

    details.T = T;
    details.avgPrice = avgPrice;
    details.holdQty = holdQty;

    // 가격 반올림 함수
    const roundPrice = isOverseas
      ? (p: number) => Math.round(p * 100) / 100  // 소수점 2자리
      : (p: number) => Math.round(p);              // 정수

    // --- 손절: 포지션 보유 중이면 항상 체크 (alreadyExecutedToday, maxCycles 무관) ---
    if (hasPosition && curPrice < avgPrice * (1 - watchStock.stopLossRate)) {
      this.logger.log(
        `[${watchStock.stockCode}] STOP LOSS triggered: cur=${curPrice}, avg=${avgPrice}, rate=${watchStock.stopLossRate}`,
      );
      signals.push({
        market,
        exchangeCode: isOverseas ? exchangeCode : undefined,
        stockCode: watchStock.stockCode,
        side: 'SELL',
        quantity: holdQty,
        price: roundPrice(curPrice),
        reason: `Stop loss: T=${T.toFixed(1)}, loss=${((1 - curPrice / avgPrice) * 100).toFixed(1)}%`,
        orderDivision: '00', // 손절은 지정가
      });
      return signals;
    }

    // 1. 오늘 이미 실행 → skip (손절은 위에서 이미 체크)
    if (ctx.alreadyExecutedToday) {
      this.logger.debug(`[${watchStock.stockCode}] Already executed today, skip`);
      return signals;
    }

    // --- 개선 E: 시장 상황 필터 ---
    details.marketCondition = marketCondition;
    const indexBelowMA200 = !marketCondition.referenceIndexAboveMA200;

    if (indexBelowMA200 && !hasPosition) {
      // 지수가 200일선 아래 + 포지션 없음 → 신규 진입 차단
      this.logger.log(
        `[${watchStock.stockCode}] ${marketCondition.referenceIndexName} below MA200, no new entry`,
      );
      details.skippedReason = 'index_below_ma200_no_position';
      return signals;
    }

    // --- 개선 C: 종목 선별 필터 ---
    details.stockIndicators = stockIndicators;

    if (!hasPosition && !stockIndicators.currentAboveMA200) {
      // 신규 진입 + 현재가 < MA200 → 하락 추세, 매수 거부
      this.logger.log(`[${watchStock.stockCode}] Price below MA200, no new entry`);
      details.skippedReason = 'price_below_ma200';
      return signals;
    }

    // T >= maxCycles → 매수 중단 (매도 시그널은 계속 생성)
    const maxCyclesReached = T >= watchStock.maxCycles;
    if (maxCyclesReached) {
      this.logger.log(`[${watchStock.stockCode}] Max cycles reached (T=${T.toFixed(1)}), buy stopped`);
    }

    // --- 1회 매수금액 ---
    let adjustedQuota = maxCyclesReached ? 0 : perCycleQuota;

    // 개선 E: 금리 급등시 절반
    if (marketCondition.interestRateRising) {
      adjustedQuota *= 0.5;
      details.quotaAdjust_interestRate = true;
    }

    // 개선 C: RSI < 30 과매도시 1.5배
    if (stockIndicators.rsi14 !== undefined && stockIndicators.rsi14 < 30) {
      adjustedQuota *= 1.5;
      details.quotaAdjust_rsi = true;
    }

    // 개선 D: 가용자금 한도
    adjustedQuota = Math.min(adjustedQuota, ctx.buyableAmount);

    // 개선 D: 종목당 최대 투자비율 체크
    if (ctx.totalPortfolioValue > 0 && totalInvested > 0) {
      const currentRate = totalInvested / ctx.totalPortfolioValue;
      if (currentRate >= watchStock.maxPortfolioRate) {
        this.logger.log(
          `[${watchStock.stockCode}] Portfolio rate exceeded: ${(currentRate * 100).toFixed(1)}% >= ${(watchStock.maxPortfolioRate * 100).toFixed(0)}%`,
        );
        details.skippedReason = 'max_portfolio_rate';
        // 매수 중단하지만 매도는 허용 → adjustedQuota = 0
        adjustedQuota = 0;
      }
    }

    details.adjustedQuota = adjustedQuota;

    // --- 무한매수법 매수/매도 가격 계산 ---
    const baseRate = (10 - T / 2 + 100) / 100;
    const pivotPrice = baseRate * avgPrice;

    // 지수 200일선 아래면 매수 중단 (매도만 허용)
    const buyAllowed = !indexBelowMA200 && adjustedQuota > 0;

    // LOC 주문 구분
    const locDivision = isOverseas && LOC_EXCHANGES.has(exchangeCode) ? '34' : '00';

    if (!hasPosition && buyAllowed) {
      // --- 첫 매수 (포지션 없음) ---
      const buyQty = Math.floor(adjustedQuota / curPrice);
      if (buyQty > 0) {
        signals.push({
          market,
          exchangeCode: isOverseas ? exchangeCode : undefined,
          stockCode: watchStock.stockCode,
          side: 'BUY',
          quantity: buyQty,
          price: roundPrice(curPrice),
          reason: `Initial buy: ${buyQty}주 @ ${roundPrice(curPrice)}`,
          orderDivision: locDivision,
        });
      }
    } else if (hasPosition) {
      // --- 매수 시그널 ---
      // Buy2 dipRate: T가 높을수록 더 낮은 가격에 지정가 (보수적)
      const dipRate = T < 10 ? 0.03 : T < 20 ? 0.05 : 0.07;

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
            exchangeCode: isOverseas ? exchangeCode : undefined,
            stockCode: watchStock.stockCode,
            side: 'BUY',
            quantity: buy1Qty,
            price: buy1Price,
            reason: `Buy1: T=${T.toFixed(1)}, ${buy1Qty}주 @ ${buy1Price}`,
            orderDivision: locDivision,
          });
        }

        if (buy2Qty > 0 && buy2Price > 0) {
          signals.push({
            market,
            exchangeCode: isOverseas ? exchangeCode : undefined,
            stockCode: watchStock.stockCode,
            side: 'BUY',
            quantity: buy2Qty,
            price: buy2Price,
            reason: `Buy2: T=${T.toFixed(1)}, dip=${(dipRate * 100).toFixed(0)}%, ${buy2Qty}주 @ ${buy2Price}`,
            orderDivision: '00', // buy2는 지정가
          });
        }
      } else if (T >= 20 && buyAllowed) {
        // T>=20: Buy2만 (현재가 아래 지정가)
        const buy2Price = roundPrice(curPrice * (1 - dipRate));
        const buy2Qty = Math.floor(adjustedQuota / buy2Price);

        if (buy2Qty > 0 && buy2Price > 0) {
          signals.push({
            market,
            exchangeCode: isOverseas ? exchangeCode : undefined,
            stockCode: watchStock.stockCode,
            side: 'BUY',
            quantity: buy2Qty,
            price: buy2Price,
            reason: `Buy2(T≥20): T=${T.toFixed(1)}, dip=${(dipRate * 100).toFixed(0)}%, ${buy2Qty}주 @ ${buy2Price}`,
            orderDivision: '00',
          });
        }
      }

      // --- 매도 시그널 (항상 생성, 지수 상태 무관) ---
      if (holdQty > 0) {
        // Sell1: pivotPrice, 보유량의 1/4
        const sell1Qty = Math.max(1, Math.round(holdQty / 4));
        const sell1Price = roundPrice(pivotPrice);

        if (sell1Price > 0) {
          signals.push({
            market,
            exchangeCode: isOverseas ? exchangeCode : undefined,
            stockCode: watchStock.stockCode,
            side: 'SELL',
            quantity: sell1Qty,
            price: sell1Price,
            reason: `Sell1: T=${T.toFixed(1)}, ${sell1Qty}주 @ ${sell1Price}`,
            orderDivision: locDivision,
          });
        }

        // Sell2: 개선 B 동적 목표
        const sell2Qty = holdQty - sell1Qty;
        if (sell2Qty > 0) {
          let targetRate: number;
          if (T < 10) targetRate = 1.05;
          else if (T < 20) targetRate = 1.10;
          else targetRate = 1.15;

          const sell2Price = roundPrice(avgPrice * targetRate);

          if (sell2Price > 0) {
            signals.push({
              market,
              exchangeCode: isOverseas ? exchangeCode : undefined,
              stockCode: watchStock.stockCode,
              side: 'SELL',
              quantity: sell2Qty,
              price: sell2Price,
              reason: `Sell2: T=${T.toFixed(1)}, target=${((targetRate - 1) * 100).toFixed(0)}%, ${sell2Qty}주 @ ${sell2Price}`,
              orderDivision: '00', // sell2는 지정가
            });
          }
        }
      }
    }

    this.logger.log(
      `[${watchStock.stockCode}] T=${T.toFixed(1)}, signals=${signals.length}, quota=${adjustedQuota.toFixed(0)}`,
    );

    return signals;
  }
}
