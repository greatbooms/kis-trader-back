import { Injectable, Logger } from '@nestjs/common';
import {
  PerStockTradingStrategy,
  StockStrategyContext,
  TradingSignal,
  ExecutionMode,
  StrategyMeta,
} from '../types';


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
    '- 지수(S&P500/KOSPI)가 200일 이동평균선 위일 때만 신규 진입',
    '- 종목 가격이 200일 이동평균선 위일 때만 신규 진입',
    '- RSI < 30 과매도 구간에서는 매수금액 1.5배 증가',
    '- 금리 급등 시 매수금액 절반으로 축소',
    '',
    '【매수 방식】',
    '- T < 20: Buy1(현재가 지정가) + Buy2(현재가 아래 지정가) 두 건 분할',
    '- T >= 20: Buy2(현재가 아래 지정가)만 실행',
    '- Buy2 지정가: T<10 -1%, T<20 -2%, T>=20 -3% (일중 변동 내 체결 가능)',
    '- Buy1은 즉시 체결, Buy2는 장중 가격 하락 시 체결',
    '- 미체결 시 장 마감 후 자동 취소, 다음 날 새 가격으로 재주문',
    '',
    '【매도 조건】',
    '- Sell1: 평균단가 +3%에 보유량의 1/3 매도 (1차 익절)',
    '- Sell2: 평균단가 +5~10%에 나머지 전량 매도 (T<10: +5%, T<20: +7%, T>=20: +10%)',
    '- 손절: 평균단가 대비 설정 손절률(기본 30%) 하회 시 전량 매도',
    '',
    '【특징】',
    '- 장기 분할매수에 적합, 하락장에서 평균단가를 낮추는 전략',
    '- 시초가 변동 안정 후 주문하여 적정 가격에 진입',
    '- Buy2 지정가는 장 마감까지 체결 기회를 가짐',
    '',
    '【안전장치】',
    '- 투자유의/시장경고 종목은 신규 진입 차단',
    '- 융자잔고 10% 초과 시 매수금액 30% 축소 (레버리지 청산 리스크 방어)',
    '- 지수 MA200 하회 시 매수 중단, 매도만 허용',
    '- 금리 급등 시 매수금액 50% 축소',
  ].join('\n');
  readonly meta: StrategyMeta = {
    riskLevel: 'medium',
    expectedReturn: '사이클당 +3~10%',
    maxLoss: '-30% (손절 기본값)',
    investmentPeriod: '3개월~1년',
    tradingFrequency: '하루 1회 장중 자동 매수 (국내 11시, 해외 02시)',
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

    // 융자잔고 10% 초과 시 quota 30% 감소 (레버리지 청산 위험)
    if (stockIndicators.loanBalanceRate !== undefined && stockIndicators.loanBalanceRate > 10) {
      adjustedQuota *= 0.7;
      details.quotaAdjust_loanBalance = true;
    }

    // 개선 D: 가용자금 한도
    adjustedQuota = Math.min(adjustedQuota, ctx.buyableAmount);

    details.adjustedQuota = adjustedQuota;

    // 지수 200일선 아래면 매수 중단 (매도만 허용)
    const buyAllowed = !indexBelowMA200 && adjustedQuota > 0;

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
          orderDivision: '00',
        });
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
            exchangeCode: isOverseas ? exchangeCode : undefined,
            stockCode: watchStock.stockCode,
            side: 'BUY',
            quantity: buy1Qty,
            price: buy1Price,
            reason: `Buy1: T=${T.toFixed(1)}, ${buy1Qty}주 @ ${buy1Price}`,
            orderDivision: '00',
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
        // Sell1: 평균단가 +3%에 보유량의 1/3 매도 (1차 익절)
        const sell1Qty = Math.max(1, Math.round(holdQty / 3));
        const sell1Price = roundPrice(avgPrice * 1.03);

        if (sell1Price > 0) {
          signals.push({
            market,
            exchangeCode: isOverseas ? exchangeCode : undefined,
            stockCode: watchStock.stockCode,
            side: 'SELL',
            quantity: sell1Qty,
            price: sell1Price,
            reason: `Sell1: T=${T.toFixed(1)}, +3%, ${sell1Qty}주 @ ${sell1Price}`,
            orderDivision: '00',
          });
        }

        // Sell2: 평균단가 +5~10%에 나머지 전량 매도 (2차 익절)
        const sell2Qty = holdQty - sell1Qty;
        if (sell2Qty > 0) {
          // T가 낮을수록 빠르게 익절, T가 높을수록 더 기다림
          let targetRate: number;
          if (T < 10) targetRate = 1.05;
          else if (T < 20) targetRate = 1.07;
          else targetRate = 1.10;

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
