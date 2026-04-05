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
    hours: { domestic: 15, overseas: { basis: 'beforeClose', offsetHours: 1 } }, // 장 마감 1시간 전
  };
  readonly description = [
    '저평가 종목을 재무 지표로 선별하여 매수하고, 목표 수익률 도달 시 매도하는 가치투자 전략입니다.',
    '',
    '【진입 조건 (모두 충족 시 매수)】',
    '- PER < 10 (저평가)',
    '- PBR < 1.0 (자산 대비 저평가) — 국내/해외',
    '- EPS > 0 (흑자기업만) — 국내/해외',
    '- ROE > 10% (수익성 양호) — 국내 전용',
    '- 부채비율 < 150% (재무 안정성) — 국내/미국',
    '- 매출액증가율 > -20% (심한 역성장 제외) — 국내/미국',
    '- 영업이익증가율 > -30% (수익성 악화 제외) — 국내/미국',
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
    '- 미국 종목은 SEC 공시 기반 부채비율/매출·영업이익 성장률/배당성향을 추가 반영',
    '- EV/EBITDA와 ROE는 현재 국내 데이터가 더 풍부합니다',
    '',
    '【특징】',
    '- 중장기 보유 전략 (수주~수개월)',
    '- 저평가 우량주에 집중 투자',
    '- 재무 건전성을 기반으로 종목 필터링',
    '- 하루 1회 실행 (국내 15시, 해외 05시)',
    '',
    '【안전장치】',
    '- 투자유의/시장경고 종목은 진입 차단',
    '- 배당성향 120% 초과 종목은 진입 차단',
    '- 큰 폭의 어닝 쇼크 또는 부정적 컨센서스면 진입 차단',
    '- 리스크 전량청산 시그널 시 즉시 매도',
  ].join('\n');
  readonly meta: StrategyMeta = {
    riskLevel: 'low',
    mddBuyBlock: -0.15,
    mddLiquidate: -0.25,
    expectedReturn: '연 10~20%',
    maxLoss: '-10% (손절)',
    investmentPeriod: '수주~수개월',
    tradingFrequency: '하루 1회 재무지표 확인',
    suitableFor: ['가치투자 선호', '저평가 우량주', '중장기 투자자'],
    tags: ['가치투자', 'PER', 'PBR', 'ROE', '국내/해외'],
  };
  private readonly logger = new Logger(ValueFactorStrategy.name);

  async evaluateStock(ctx: StockStrategyContext): Promise<StrategyEvaluationResult> {
    const { watchStock, price, position, stockIndicators, fundamentals, riskState } = ctx;
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
          exchangeCode,
          stockCode: watchStock.stockCode,
          side: 'SELL',
          quantity: holdQty,
          price: roundPrice(curPrice),
          reason: `손절: ${(profitRate * 100).toFixed(1)}% <= -${(params.stopLossRate * 100).toFixed(0)}%`,
        });
        return { signals, skipReasons };
      }

      // 익절: +15%
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

      // RSI > 70 과열 청산
      const { rsi14 } = stockIndicators;
      if (rsi14 !== undefined && rsi14 > 70) {
        this.logger.log(
          `[${watchStock.stockCode}] RSI OVERBOUGHT EXIT: RSI=${rsi14.toFixed(1)}`,
        );
        signals.push({
          market,
          exchangeCode,
          stockCode: watchStock.stockCode,
          side: 'SELL',
          quantity: holdQty,
          price: roundPrice(curPrice),
          reason: `과열청산: RSI=${rsi14.toFixed(0)} > 70`,
        });
        return { signals, skipReasons };
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

      // 재무 데이터 필수 (없으면 skip)
      if (!fundamentals) {
        this.logger.debug(`[${watchStock.stockCode}] No fundamentals data, skip`);
        skipReasons.push('재무 데이터 없음');
        return { signals, skipReasons };
      }

      if (fundamentals.dividendPayoutRate !== undefined && fundamentals.dividendPayoutRate > 120) {
        this.logger.debug(`[${watchStock.stockCode}] Payout filter failed: ${fundamentals.dividendPayoutRate}% > 120%`);
        skipReasons.push(`배당성향 초과: ${fundamentals.dividendPayoutRate.toFixed(0)}% > 120%`);
        return { signals, skipReasons };
      }

      // PER 체크 (국내/해외 공통)
      if (fundamentals.per === undefined || fundamentals.per <= 0 || fundamentals.per >= params.maxPer) {
        this.logger.debug(
          `[${watchStock.stockCode}] PER filter failed: ${fundamentals.per} (max: ${params.maxPer})`,
        );
        skipReasons.push(`PER 조건 미충족: ${fundamentals.per ?? 'N/A'} (최대 ${params.maxPer})`);
        return { signals, skipReasons };
      }

      // PBR 체크 (국내/해외 공통 — 해외도 현재가상세 API에서 제공)
      if (fundamentals.pbr !== undefined && fundamentals.pbr >= params.maxPbr) {
        this.logger.debug(`[${watchStock.stockCode}] PBR filter failed: ${fundamentals.pbr}`);
        skipReasons.push(`PBR 조건 미충족: ${fundamentals.pbr.toFixed(2)} ≥ ${params.maxPbr}`);
        return { signals, skipReasons };
      }

      // EPS 양수 체크 (국내/해외 공통 — 해외도 현재가상세 API에서 EPS 제공)
      if (params.requirePositiveEps && fundamentals.eps !== undefined && fundamentals.eps <= 0) {
        this.logger.debug(`[${watchStock.stockCode}] EPS filter failed: ${fundamentals.eps} (적자기업)`);
        skipReasons.push(`적자기업: EPS=${fundamentals.eps.toFixed(0)} ≤ 0`);
        return { signals, skipReasons };
      }

      // ROE / EV/EBITDA는 현재 국내 데이터에서만 안정적으로 사용
      if (!isOverseas && fundamentals.roe !== undefined && fundamentals.roe < params.minRoe) {
        this.logger.debug(`[${watchStock.stockCode}] ROE filter failed: ${fundamentals.roe}`);
        skipReasons.push(`ROE 미달: ${fundamentals.roe.toFixed(1)}% < ${params.minRoe}%`);
        return { signals, skipReasons };
      }
      if (fundamentals.debtRatio !== undefined && fundamentals.debtRatio >= params.maxDebtRatio) {
        this.logger.debug(`[${watchStock.stockCode}] DebtRatio filter failed: ${fundamentals.debtRatio}`);
        skipReasons.push(`부채비율 초과: ${fundamentals.debtRatio.toFixed(0)}% ≥ ${params.maxDebtRatio}%`);
        return { signals, skipReasons };
      }
      if (fundamentals.salesGrowthRate !== undefined && fundamentals.salesGrowthRate < params.minSalesGrowthRate) {
        this.logger.debug(`[${watchStock.stockCode}] SalesGrowth filter failed: ${fundamentals.salesGrowthRate}% < ${params.minSalesGrowthRate}%`);
        skipReasons.push(`매출액증가율 미달: ${fundamentals.salesGrowthRate.toFixed(1)}% < ${params.minSalesGrowthRate}%`);
        return { signals, skipReasons };
      }
      if (fundamentals.operatingProfitGrowthRate !== undefined && fundamentals.operatingProfitGrowthRate < params.minOperatingProfitGrowthRate) {
        this.logger.debug(`[${watchStock.stockCode}] OpProfitGrowth filter failed: ${fundamentals.operatingProfitGrowthRate}% < ${params.minOperatingProfitGrowthRate}%`);
        skipReasons.push(`영업이익증가율 미달: ${fundamentals.operatingProfitGrowthRate.toFixed(1)}% < ${params.minOperatingProfitGrowthRate}%`);
        return { signals, skipReasons };
      }
      if (!isOverseas && fundamentals.evEbitda !== undefined && fundamentals.evEbitda > params.maxEvEbitda) {
        this.logger.debug(`[${watchStock.stockCode}] EV/EBITDA filter failed: ${fundamentals.evEbitda} > ${params.maxEvEbitda}`);
        skipReasons.push(`EV/EBITDA 초과: ${fundamentals.evEbitda.toFixed(1)} > ${params.maxEvEbitda}`);
        return { signals, skipReasons };
      }

      // RSI 체크
      const { rsi14 } = stockIndicators;
      if (rsi14 !== undefined && rsi14 >= params.rsiThreshold) {
        this.logger.debug(`[${watchStock.stockCode}] RSI filter failed: ${rsi14} >= ${params.rsiThreshold}`);
        skipReasons.push(`RSI=${rsi14.toFixed(1)} ≥ ${params.rsiThreshold} (과열)`);
        return { signals, skipReasons };
      }

      if (stockIndicators.earningsSurprise !== undefined && stockIndicators.earningsSurprise < -20) {
        this.logger.debug(`[${watchStock.stockCode}] Earnings surprise filter failed: ${stockIndicators.earningsSurprise}%`);
        skipReasons.push(`어닝 쇼크: ${stockIndicators.earningsSurprise.toFixed(1)}% < -20%`);
        return { signals, skipReasons };
      }

      if (stockIndicators.targetPriceUpside !== undefined && stockIndicators.targetPriceUpside < -10) {
        this.logger.debug(`[${watchStock.stockCode}] Target upside filter failed: ${stockIndicators.targetPriceUpside}%`);
        skipReasons.push(`목표가 괴리 과대: ${stockIndicators.targetPriceUpside.toFixed(1)}% < -10%`);
        return { signals, skipReasons };
      }

      if (stockIndicators.consensusRating && /(SELL|REDUCE|비중축소|매도)/i.test(stockIndicators.consensusRating)) {
        this.logger.debug(`[${watchStock.stockCode}] Consensus filter failed: ${stockIndicators.consensusRating}`);
        skipReasons.push(`부정적 컨센서스: ${stockIndicators.consensusRating}`);
        return { signals, skipReasons };
      }

      // 모든 조건 충족 → 매수
      const quota = watchStock.quota || 0;
      const buyAmount = Math.min(quota, ctx.buyableAmount);
      const buyQty = Math.floor(buyAmount / curPrice);

      if (buyQty > 0) {
        const perInfo = `PER=${fundamentals.per.toFixed(1)}`;
        const pbrInfo = fundamentals.pbr !== undefined ? `, PBR=${fundamentals.pbr.toFixed(1)}` : '';
        const dividendInfo = stockIndicators.dividendYield !== undefined
          ? `, DivY=${stockIndicators.dividendYield.toFixed(1)}%`
          : '';
        const payoutInfo = fundamentals.dividendPayoutRate !== undefined
          ? `, Payout=${fundamentals.dividendPayoutRate.toFixed(0)}%`
          : '';
        const extraInfo = !isOverseas
          ? `${pbrInfo}, ROE=${fundamentals.roe?.toFixed(0) ?? 'N/A'}%, EPS=${fundamentals.eps?.toFixed(0) ?? 'N/A'}${dividendInfo}${payoutInfo}`
          : `${pbrInfo}${dividendInfo} (해외)`;

        this.logger.log(
          `[${watchStock.stockCode}] VALUE ENTRY: ${perInfo}${extraInfo}, RSI=${rsi14?.toFixed(0) ?? 'N/A'}`,
        );
        signals.push({
          market,
          exchangeCode,
          stockCode: watchStock.stockCode,
          side: 'BUY',
          quantity: buyQty,
          price: roundPrice(curPrice),
          reason: `밸류진입: ${perInfo}${extraInfo}`,
        });
      }
    }

    return { signals, skipReasons };
  }
}
