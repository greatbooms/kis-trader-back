import { Injectable, Logger } from '@nestjs/common';
import {
  PerStockTradingStrategy,
  StockStrategyContext,
  TradingSignal,
  ExecutionMode,
} from '../types';

const DEFAULT_PARAMS = {
  maxPer: 10,
  maxPbr: 1.0,
  minRoe: 10,
  maxDebtRatio: 150,
  rsiThreshold: 40,
  stopLossRate: 0.10,
  takeProfitRate: 0.15,
  requirePositiveEps: true,
  minSalesGrowthRate: -20, // 매출액 증가율 하한 (%, -20% 이하 역성장 제외)
  minOperatingProfitGrowthRate: -30, // 영업이익 증가율 하한 (%)
  maxEvEbitda: 15, // EV/EBITDA 상한 (배). 높으면 고평가
};

@Injectable()
export class ValueFactorStrategy implements PerStockTradingStrategy {
  readonly name = 'value-factor';
  readonly displayName = '밸류 팩터';
  readonly executionMode: ExecutionMode = {
    type: 'once-daily',
    hours: { domestic: 15, overseas: 5 },
  };
  readonly description = [
    '저평가 종목을 재무 지표로 선별하여 매수하고, 목표 수익률 도달 시 매도하는 가치투자 전략입니다.',
    '',
    '【진입 조건 (모두 충족 시 매수)】',
    '- PER < 10 (저평가)',
    '- PBR < 1.0 (자산 대비 저평가) — 국내/해외',
    '- EPS > 0 (흑자기업만) — 국내/해외',
    '- ROE > 10% (수익성 양호) — 국내 전용',
    '- 부채비율 < 150% (재무 안정성) — 국내 전용',
    '- 매출액증가율 > -20% (심한 역성장 제외) — 국내 전용',
    '- 영업이익증가율 > -30% (수익성 악화 제외) — 국내 전용',
    '- EV/EBITDA < 15 (기업가치 대비 저평가) — 국내 전용',
    '- RSI < 40 (과열되지 않은 구간)',
    '',
    '【매도 조건】',
    '- +15% 수익 시 전량 매도 (익절)',
    '- -10% 손실 시 전량 매도 (손절)',
    '- RSI > 70 시 전량 매도 (과열 청산)',
    '- 리스크 전량청산 시그널 시 즉시 매도',
    '',
    '【해외 종목 제한사항】',
    '- 해외 종목은 현재가상세 API에서 PER, PBR, EPS 제공',
    '- ROE, 부채비율, 매출액/영업이익 증가율, EV/EBITDA는 국내만',
    '- 해외 종목은 PER + PBR + EPS + RSI 조건으로 진입 판단',
    '',
    '【특징】',
    '- 중장기 보유 전략 (수주~수개월)',
    '- 저평가 우량주에 집중 투자',
    '- 재무 건전성을 기반으로 종목 필터링',
    '- 하루 1회 실행 (국내 15시, 해외 05시)',
  ].join('\n');
  private readonly logger = new Logger(ValueFactorStrategy.name);

  async evaluateStock(ctx: StockStrategyContext): Promise<TradingSignal[]> {
    const { watchStock, price, position, stockIndicators, fundamentals, riskState } = ctx;
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

    // 리스크 체크: 전량 청산 시그널 (alreadyExecutedToday 무관)
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
      const avgPrice = position!.avgPrice;
      const profitRate = (curPrice - avgPrice) / avgPrice;
      const holdQty = position!.quantity;

      // 손절: -10%
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

      // 익절: +15%
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

      // RSI > 70 과열 청산
      const { rsi14 } = stockIndicators;
      if (rsi14 !== undefined && rsi14 > 70) {
        this.logger.log(
          `[${watchStock.stockCode}] RSI OVERBOUGHT EXIT: RSI=${rsi14.toFixed(1)}`,
        );
        signals.push({
          market,
          exchangeCode: isOverseas ? exchangeCode : undefined,
          stockCode: watchStock.stockCode,
          side: 'SELL',
          quantity: holdQty,
          price: roundPrice(curPrice),
          reason: `과열청산: RSI=${rsi14.toFixed(0)} > 70`,
        });
        return signals;
      }
    } else {
      // --- 포지션 없음: 진입 조건 ---

      // 오늘 이미 실행 → 신규 진입 skip
      if (ctx.alreadyExecutedToday) return signals;

      // 리스크 체크
      if (riskState?.buyBlocked) {
        this.logger.debug(
          `[${watchStock.stockCode}] Buy blocked by risk: ${riskState.reasons.join(', ')}`,
        );
        return signals;
      }

      // 투자유의/시장경고 종목 진입 차단
      if (stockIndicators.investCautionYn) return signals;
      if (stockIndicators.marketWarnCode && stockIndicators.marketWarnCode !== '00') return signals;

      // 재무 데이터 필수 (없으면 skip)
      if (!fundamentals) {
        this.logger.debug(`[${watchStock.stockCode}] No fundamentals data, skip`);
        return signals;
      }

      // PER 체크 (국내/해외 공통)
      if (fundamentals.per === undefined || fundamentals.per <= 0 || fundamentals.per >= params.maxPer) {
        this.logger.debug(
          `[${watchStock.stockCode}] PER filter failed: ${fundamentals.per} (max: ${params.maxPer})`,
        );
        return signals;
      }

      // PBR 체크 (국내/해외 공통 — 해외도 현재가상세 API에서 제공)
      if (fundamentals.pbr !== undefined && fundamentals.pbr >= params.maxPbr) {
        this.logger.debug(`[${watchStock.stockCode}] PBR filter failed: ${fundamentals.pbr}`);
        return signals;
      }

      // EPS 양수 체크 (국내/해외 공통 — 해외도 현재가상세 API에서 EPS 제공)
      if (params.requirePositiveEps && fundamentals.eps !== undefined && fundamentals.eps <= 0) {
        this.logger.debug(`[${watchStock.stockCode}] EPS filter failed: ${fundamentals.eps} (적자기업)`);
        return signals;
      }

      // 국내 전용 필터: ROE, 부채비율, 매출액증가율, 영업이익증가율, EV/EBITDA
      if (!isOverseas) {
        if (fundamentals.roe !== undefined && fundamentals.roe < params.minRoe) {
          this.logger.debug(`[${watchStock.stockCode}] ROE filter failed: ${fundamentals.roe}`);
          return signals;
        }
        if (fundamentals.debtRatio !== undefined && fundamentals.debtRatio >= params.maxDebtRatio) {
          this.logger.debug(`[${watchStock.stockCode}] DebtRatio filter failed: ${fundamentals.debtRatio}`);
          return signals;
        }
        if (fundamentals.salesGrowthRate !== undefined && fundamentals.salesGrowthRate < params.minSalesGrowthRate) {
          this.logger.debug(`[${watchStock.stockCode}] SalesGrowth filter failed: ${fundamentals.salesGrowthRate}% < ${params.minSalesGrowthRate}%`);
          return signals;
        }
        if (fundamentals.operatingProfitGrowthRate !== undefined && fundamentals.operatingProfitGrowthRate < params.minOperatingProfitGrowthRate) {
          this.logger.debug(`[${watchStock.stockCode}] OpProfitGrowth filter failed: ${fundamentals.operatingProfitGrowthRate}% < ${params.minOperatingProfitGrowthRate}%`);
          return signals;
        }
        if (fundamentals.evEbitda !== undefined && fundamentals.evEbitda > params.maxEvEbitda) {
          this.logger.debug(`[${watchStock.stockCode}] EV/EBITDA filter failed: ${fundamentals.evEbitda} > ${params.maxEvEbitda}`);
          return signals;
        }
      }

      // RSI 체크
      const { rsi14 } = stockIndicators;
      if (rsi14 !== undefined && rsi14 >= params.rsiThreshold) {
        this.logger.debug(`[${watchStock.stockCode}] RSI filter failed: ${rsi14} >= ${params.rsiThreshold}`);
        return signals;
      }

      // 모든 조건 충족 → 매수
      const quota = watchStock.quota || 0;
      const buyAmount = Math.min(quota, ctx.buyableAmount);
      const buyQty = Math.floor(buyAmount / curPrice);

      if (buyQty > 0) {
        const perInfo = `PER=${fundamentals.per.toFixed(1)}`;
        const pbrInfo = fundamentals.pbr !== undefined ? `, PBR=${fundamentals.pbr.toFixed(1)}` : '';
        const extraInfo = !isOverseas
          ? `${pbrInfo}, ROE=${fundamentals.roe?.toFixed(0) ?? 'N/A'}%, EPS=${fundamentals.eps?.toFixed(0) ?? 'N/A'}`
          : `${pbrInfo} (해외)`;

        this.logger.log(
          `[${watchStock.stockCode}] VALUE ENTRY: ${perInfo}${extraInfo}, RSI=${rsi14?.toFixed(0) ?? 'N/A'}`,
        );
        signals.push({
          market,
          exchangeCode: isOverseas ? exchangeCode : undefined,
          stockCode: watchStock.stockCode,
          side: 'BUY',
          quantity: buyQty,
          price: roundPrice(curPrice),
          reason: `밸류진입: ${perInfo}${extraInfo}`,
        });
      }
    }

    return signals;
  }
}
