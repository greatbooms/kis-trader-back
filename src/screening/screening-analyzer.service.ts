import { Injectable, Logger } from '@nestjs/common';
import { Broker } from '@prisma/client';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { DailyPrice, StockPriceResult } from '../kis/types/kis-api.types';
import { DeepAnalysisService } from './deep-analysis.service';
import { MarketAnalysisService } from '../trading/market-analysis.service';
import { StrategyRegistryService } from '../trading/strategy/strategy-registry.service';
import { MarketCondition, StockFundamentals, StockIndicators, StockStrategyContext } from '../trading/types';
import { OpenDartDomesticSignals } from '../opendart/types';
import { SecFundamentals } from '../sec/types';
import {
  ScreeningCandidate,
  StockScore,
  StockIndicatorDetail,
  SuggestedStrategy,
  ScreeningMode,
  ForeignInstitutionDetail,
  detectEtf,
} from './types';
import { pickNumeric } from '../common/utils/api-data.util';
import { summarizeEstimatePerform, summarizeInvestOpinion } from '../common/utils/consensus.util';
import { kstTodayStr, kstDateNDaysAgo } from './utils/date.util';
import { summarizeDividendSchedule } from '../common/utils/dividend.util';
import { buildDomesticScore, buildOverseasScore, buildEtfScore } from './multi-factor-scorer';
import { suggestStrategies } from './strategy-matcher';
import { MarketDataCacheService } from '../market-data/market-data-cache.service';

/**
 * 스크리닝 후보를 분석하여 점수/지표/전략 추천을 산출하는 서비스.
 *
 * multi-factor-scorer + strategy-matcher를 호출하여 `StockScore`를 반환한다.
 * DB 저장은 수행하지 않으며 (책임 외), 호출 측이 결과를 저장한다.
 */
@Injectable()
export class ScreeningAnalyzer {
  private readonly logger = new Logger(ScreeningAnalyzer.name);

  constructor(
    private readonly kisDomestic: KisDomesticService,
    private readonly kisOverseas: KisOverseasService,
    private readonly deepAnalysisService: DeepAnalysisService,
    private readonly marketAnalysis: MarketAnalysisService,
    private readonly strategyRegistry: StrategyRegistryService,
    private readonly marketDataCache: MarketDataCacheService,
  ) {}

  async analyzeDomesticStock(
    candidate: ScreeningCandidate,
    foreignInstMap: Map<string, ForeignInstitutionDetail>,
    mode: ScreeningMode,
  ): Promise<StockScore> {
    const isEtf = detectEtf(candidate.stockName, candidate.stockCode);

    const priceGroup = await Promise.allSettled([
      this.kisDomestic.getPrice(candidate.stockCode),
      this.kisDomestic.getDailyPrices(candidate.stockCode, kstDateNDaysAgo(900), kstTodayStr()),
    ]);
    const priceDetail = this.getSettledValue<StockPriceResult>(priceGroup[0]);
    const dailyPrices = this.getSettledValue<DailyPrice[]>(priceGroup[1]) ?? [];

    const financePromises: Promise<any[] | undefined>[] = [
      this.marketDataCache.getKisDomesticFinancialRatio(candidate.stockCode),
      this.marketDataCache.getKisDomesticGrowthRatio(candidate.stockCode),
      this.marketDataCache.getKisDomesticProfitRatio(candidate.stockCode),
      this.marketDataCache.getKisDomesticOtherMajorRatios(candidate.stockCode),
    ];
    if (mode === 'FULL' && !isEtf) {
      financePromises.push(
        this.marketDataCache.getKisDomesticIncomeStatement(candidate.stockCode),
        this.marketDataCache.getKisDomesticStabilityRatio(candidate.stockCode),
      );
    }
    const financeGroup = await Promise.allSettled(financePromises);
    const financialRatio = this.getSettledValue<any[]>(financeGroup[0]) ?? [];
    const growthRatio = this.getSettledValue<any[]>(financeGroup[1]);
    const profitRatio = this.getSettledValue<any[]>(financeGroup[2]);
    const otherMajorRatios = this.getSettledValue<any[]>(financeGroup[3]);
    const incomeStatement = this.getSettledValue<any[]>(financeGroup[4]);
    const stabilityRatio = this.getSettledValue<any[]>(financeGroup[5]);

    const sentimentPromises: Promise<any[] | undefined>[] = [];
    if (mode === 'FULL' && !isEtf) {
      sentimentPromises.push(
        this.marketDataCache.getKisDomesticInvestOpinion(candidate.stockCode),
        this.marketDataCache.getKisDomesticEstimatePerform(candidate.stockCode),
        this.marketDataCache.getKisDomesticDividendSchedule(candidate.stockCode),
        this.marketDataCache.getKisDomesticInvestorTradeDaily(candidate.stockCode),
        this.kisDomestic.getDailyShortSale(candidate.stockCode),
        this.kisDomestic.getDailyCreditBalance(candidate.stockCode),
      );
    }
    const sentimentGroup = await Promise.allSettled(sentimentPromises);

    if (priceDetail?.marketCap) candidate.marketCap = priceDetail.marketCap;
    if (priceDetail?.currentPrice) candidate.currentPrice = priceDetail.currentPrice;
    if (priceDetail?.volume !== undefined) candidate.volume = priceDetail.volume;
    if (priceDetail?.changeRate !== undefined) candidate.changeRate = priceDetail.changeRate;

    const indicators = this.calculateIndicators(dailyPrices, candidate.currentPrice, priceDetail);
    const fiData = foreignInstMap.get(candidate.stockCode);
    this.applyCandidateIndicators(candidate, indicators);
    this.applyPriceIndicators(priceDetail, indicators);
    this.applyForeignInstitutionIndicators(fiData, indicators);
    this.applyFinancialIndicators(
      financialRatio,
      growthRatio,
      profitRatio,
      incomeStatement,
      stabilityRatio,
      otherMajorRatios,
      indicators,
    );
    this.applySentimentIndicators(
      this.getSettledValue<any[]>(sentimentGroup[0]),
      this.getSettledValue<any>(sentimentGroup[1]),
      this.getSettledValue<any[]>(sentimentGroup[2]),
      this.getSettledValue<any[]>(sentimentGroup[3]),
      this.getSettledValue<any[]>(sentimentGroup[4]),
      this.getSettledValue<any[]>(sentimentGroup[5]),
      indicators,
      candidate.currentPrice,
    );
    if (mode === 'FULL' && !isEtf) {
      const openDartSignals = await this.marketDataCache.getOpenDartDomesticSignals(candidate.stockCode);
      this.applyOpenDartIndicators(openDartSignals, indicators);
    }
    if (!isEtf && priceDetail) {
      const dcfValuation = await this.deepAnalysisService.calculateDcfValuation(
        candidate.exchangeCode,
        dailyPrices,
        priceDetail,
        incomeStatement,
        growthRatio,
      );
      if (dcfValuation) {
        indicators.intrinsicValue = dcfValuation.intrinsicValue;
        indicators.marginOfSafety = dcfValuation.marginOfSafety;
      }
    }

    if (!isEtf && (indicators.volatility30d ?? 0) > 300) {
      throw new Error(`Extreme volatility ${indicators.volatility30d?.toFixed(0)}%`);
    }

    const marketCondition = await this.marketAnalysis.getMarketCondition(candidate.exchangeCode);
    const score = isEtf
      ? buildEtfScore(candidate, indicators, false)
      : buildDomesticScore(candidate, indicators);
    const suggestedStrategiesResult = await suggestStrategies(
      this.strategyRegistry.getAllStrategies(),
      this.buildStrategyContext(candidate, indicators, priceDetail, dailyPrices, marketCondition),
    );

    return {
      ...candidate,
      totalScore: score.totalScore,
      trendScore: score.trendScore,
      timingScore: score.timingScore,
      fundamentalScore: score.fundamentalScore,
      riskSupplyScore: score.riskSupplyScore,
      reasons: score.reasons,
      indicators: {
        ...indicators,
        factors: score.factorScores,
        dataAvailability: score.dataAvailability,
      },
      factorScores: score.factorScores,
      dataAvailability: score.dataAvailability,
      suggestedStrategies: suggestedStrategiesResult,
      isEtf,
    };
  }

  async analyzeOverseasStock(
    candidate: ScreeningCandidate,
    mode: ScreeningMode,
  ): Promise<StockScore> {
    const isEtf = detectEtf(candidate.stockName, candidate.stockCode);
    // TODO: 해외 재무 API 확장 시 FAST/FULL 모드별 호출 범위를 분리한다.
    void mode;

    const results = await Promise.allSettled([
      this.kisOverseas.getDailyPrices(candidate.exchangeCode, candidate.stockCode, 650),
      this.kisOverseas.getPrice(candidate.exchangeCode, candidate.stockCode),
    ]);
    const dailyPrices = this.getSettledValue<DailyPrice[]>(results[0]) ?? [];
    const priceDetail = this.getSettledValue<StockPriceResult>(results[1]);

    if (priceDetail?.marketCap) candidate.marketCap = priceDetail.marketCap;
    if (priceDetail?.currentPrice) candidate.currentPrice = priceDetail.currentPrice;

    const indicators = this.calculateIndicators(dailyPrices, candidate.currentPrice, priceDetail);
    if (candidate.per !== undefined) indicators.per = candidate.per;
    this.applyPriceIndicators(priceDetail, indicators);
    indicators.sector = priceDetail?.sector ?? candidate.sector;
    if (priceDetail?.prevDayVolume && priceDetail.prevDayVolume > 0) {
      indicators.prevDayVolumeChangeRate = ((candidate.volume / priceDetail.prevDayVolume) - 1) * 100;
    }
    if (mode === 'FULL' && !isEtf && ['NASD', 'NYSE', 'AMEX'].includes(candidate.exchangeCode)) {
      let secFundamentals = await this.marketDataCache.getSecFundamentals(
        candidate.stockCode,
        candidate.currentPrice,
        candidate.exchangeCode,
      );
      if (!secFundamentals || !secFundamentals.latestRevenue || secFundamentals.latestRevenue <= 0) {
        secFundamentals = await this.marketDataCache.getSecFundamentals(
          candidate.stockCode,
          candidate.currentPrice,
          candidate.exchangeCode,
          true,
        );
      }
      this.applySecFundamentalIndicators(secFundamentals, indicators);
      if (!secFundamentals) {
        this.logger.warn(
          `US screening DCF skipped for ${candidate.stockCode} (${candidate.exchangeCode}): SEC fundamentals unavailable`,
        );
      } else if (!secFundamentals.latestRevenue || secFundamentals.latestRevenue <= 0) {
        this.logger.warn(
          `US screening DCF skipped for ${candidate.stockCode} (${candidate.exchangeCode}): latestRevenue missing (latest=${secFundamentals.latestFilingForm ?? 'N/A'} ${secFundamentals.latestFilingDate ?? 'N/A'}, periodic=${secFundamentals.latestPeriodicFilingForm ?? 'N/A'} ${secFundamentals.latestPeriodicFilingDate ?? 'N/A'})`,
        );
      }
      if (priceDetail) {
        const dcfValuation = await this.deepAnalysisService.calculateSecDcfValuation(
          candidate.exchangeCode,
          dailyPrices,
          priceDetail,
          secFundamentals,
        );
        if (dcfValuation) {
          indicators.intrinsicValue = dcfValuation.intrinsicValue;
          indicators.marginOfSafety = dcfValuation.marginOfSafety;
        } else if (secFundamentals?.latestRevenue && secFundamentals.latestRevenue > 0) {
          this.logger.warn(
            `US screening DCF returned empty for ${candidate.stockCode} (${candidate.exchangeCode}) despite SEC fundamentals (revenue=${secFundamentals.latestRevenue}, margin=${secFundamentals.operatingMargin ?? 'N/A'}, growth=${secFundamentals.revenueGrowthRate ?? 'N/A'})`,
          );
        }
      } else {
        this.logger.warn(`US screening DCF skipped for ${candidate.stockCode} (${candidate.exchangeCode}): price detail unavailable`);
      }
    }

    if (!isEtf && (indicators.volatility30d ?? 0) > 300) {
      throw new Error(`Extreme volatility ${indicators.volatility30d?.toFixed(0)}%`);
    }

    const marketCondition = await this.marketAnalysis.getMarketCondition(candidate.exchangeCode);
    const score = isEtf
      ? buildEtfScore(candidate, indicators, true)
      : buildOverseasScore(candidate, indicators);
    const suggestedStrategiesResult = await suggestStrategies(
      this.strategyRegistry.getAllStrategies(),
      this.buildStrategyContext(candidate, indicators, priceDetail, dailyPrices, marketCondition),
    );

    return {
      ...candidate,
      totalScore: score.totalScore,
      trendScore: score.trendScore,
      timingScore: score.timingScore,
      fundamentalScore: score.fundamentalScore,
      riskSupplyScore: score.riskSupplyScore,
      reasons: score.reasons,
      indicators: {
        ...indicators,
        factors: score.factorScores,
        dataAvailability: score.dataAvailability,
      },
      factorScores: score.factorScores,
      dataAvailability: score.dataAvailability,
      suggestedStrategies: suggestedStrategiesResult,
      isEtf,
    };
  }

  /**
   * `StrategyRegistry`에 등록되지 않은 전략 이름은 제거.
   * 저장된 `SuggestedStrategy[]`를 표시하기 직전에 호출한다.
   */
  filterExecutableStrategies(strategies: SuggestedStrategy[]): SuggestedStrategy[] {
    const executableNames = new Set(this.strategyRegistry.getStrategyNames());
    return strategies.filter((strategy) => executableNames.has(strategy.name));
  }

  /**
   * DeepAnalysis 결과를 기존 indicators JSON에 병합하여 프론트 표시에 활용.
   * 저장 시 `StockRecommendation.indicators` 컬럼 갱신 목적.
   */
  mergeIndicatorsWithDeepAnalysis(existingIndicators: unknown, analysis: any): Record<string, unknown> {
    const indicators = existingIndicators && typeof existingIndicators === 'object' && !Array.isArray(existingIndicators)
      ? { ...(existingIndicators as Record<string, unknown>) }
      : {};

    if (analysis.dcfValuation) {
      indicators.intrinsicValue = analysis.dcfValuation.intrinsicValue;
      indicators.marginOfSafety = analysis.dcfValuation.marginOfSafety;
    }

    if (analysis.dividendAnalysis) {
      indicators.dividendYield = analysis.dividendAnalysis.currentYield;
      indicators.payoutRatio = analysis.dividendAnalysis.payoutRatio;
      indicators.consecutiveDividendYears = analysis.dividendAnalysis.consecutiveDividendYears;
      indicators.dividendGrowthRate = analysis.dividendAnalysis.dividendGrowthRate5y;
    }

    if (analysis.consensusData) {
      indicators.targetPrice = analysis.consensusData.targetPrice;
      indicators.consensusRating = analysis.consensusData.rating;
      indicators.analystCount = analysis.consensusData.analystCount;
      indicators.estimatedEps = analysis.consensusData.estimatedEps;
      indicators.earningsSurprise = analysis.consensusData.earningsSurprise?.[0];

      const currentPrice = analysis.dcfValuation?.currentPrice;
      if (currentPrice && analysis.consensusData.targetPrice) {
        indicators.targetPriceUpside = ((analysis.consensusData.targetPrice - currentPrice) / currentPrice) * 100;
      }
    }

    return indicators;
  }

  // ──────────────────────────────────────────────────────────
  // 내부: 지표 계산 / 맵핑 / 전략 컨텍스트 조립
  // ──────────────────────────────────────────────────────────

  private calculateIndicators(
    prices: DailyPrice[],
    currentPrice: number,
    priceDetail?: StockPriceResult,
  ): StockIndicatorDetail {
    if (prices.length < 20) return {};

    const workingPrices = this.marketAnalysis.applyCurrentQuoteToPrices(prices, priceDetail
      ? {
          currentPrice: priceDetail.currentPrice,
          openPrice: priceDetail.openPrice,
          highPrice: priceDetail.highPrice,
          lowPrice: priceDetail.lowPrice,
          volume: priceDetail.volume,
        }
      : undefined);
    const closes = workingPrices.map((item) => item.close);
    const highs = workingPrices.map((item) => item.high);
    const lows = workingPrices.map((item) => item.low);
    const indicators: StockIndicatorDetail = {};

    indicators.rsi14 = this.marketAnalysis.calculateRSI(closes, 14);
    indicators.ma20 = this.marketAnalysis.calculateMA(closes, 20);
    if (closes.length >= 60) indicators.ma60 = this.marketAnalysis.calculateMA(closes, 60);
    if (closes.length >= 200) {
      indicators.ma200 = this.marketAnalysis.calculateMA(closes, 200);
      indicators.priceAboveMa200 = currentPrice > indicators.ma200;
    }
    if (indicators.ma20 && indicators.ma60) {
      const gap = (indicators.ma20 - indicators.ma60) / Math.max(indicators.ma60, 1);
      indicators.goldenCrossNear = gap > -0.03 && gap < 0.03;
    }
    if (workingPrices.length >= 20) {
      const vol5 = workingPrices.slice(0, 5).reduce((sum, item) => sum + item.volume, 0) / 5;
      const vol20 = workingPrices.slice(0, 20).reduce((sum, item) => sum + item.volume, 0) / 20;
      if (vol20 > 0) indicators.volumeSurgeRate = (vol5 / vol20 - 1) * 100;
    }
    if (closes.length >= 35) {
      const macd = this.marketAnalysis.calculateMACD(closes);
      indicators.macd = { line: macd.line, signal: macd.signal, histogram: macd.histogram };
    }
    if (closes.length >= 20) {
      const bb = this.marketAnalysis.calculateBollingerBands(closes, 20, 2);
      indicators.bollingerBands = {
        upper: bb.upper,
        middle: bb.middle,
        lower: bb.lower,
        percentB: (currentPrice - bb.lower) / Math.max(bb.upper - bb.lower, 1),
      };
    }
    if (closes.length >= 28) {
      indicators.adx14 = this.marketAnalysis.calculateADX(highs, lows, closes, 14);
    }

    const recentWindow = workingPrices.slice(0, 60);
    indicators.supportLevels = [...recentWindow].sort((a, b) => a.low - b.low).slice(0, 3).map((item) => item.low);
    indicators.resistanceLevels = [...recentWindow].sort((a, b) => b.high - a.high).slice(0, 3).map((item) => item.high);

    const windowHigh = Math.max(...recentWindow.map((item) => item.high));
    const windowLow = Math.min(...recentWindow.map((item) => item.low));
    const range = Math.max(windowHigh - windowLow, 1);
    indicators.fibonacciLevels = [
      windowHigh - range * 0.236,
      windowHigh - range * 0.382,
      windowHigh - range * 0.5,
      windowHigh - range * 0.618,
    ];
    indicators.volatility30d = this.calculateVolatility(workingPrices.slice(0, 31));
    if (workingPrices.length >= 14) {
      indicators.atr14 = this.calculateATR(workingPrices.slice(0, 15));
      if (currentPrice > 0) indicators.atrPercent = (indicators.atr14 / currentPrice) * 100;
    }
    if (workingPrices.length >= 60) {
      indicators.maxDrawdown60d = this.calculateMaxDrawdown(workingPrices.slice(0, 60));
    }
    indicators.technicalRatings = this.marketAnalysis.calculateTechnicalRatings(workingPrices);
    indicators.chartPattern = this.detectChartPattern(indicators, currentPrice);

    return indicators;
  }

  private buildStrategyContext(
    candidate: ScreeningCandidate,
    indicators: StockIndicatorDetail,
    priceDetail: StockPriceResult | undefined,
    dailyPrices: DailyPrice[],
    marketCondition: MarketCondition,
  ): StockStrategyContext {
    const latestPrice = dailyPrices[0];
    const previousPrice = dailyPrices[1];
    const currentPrice = priceDetail?.currentPrice ?? candidate.currentPrice;
    const price: StockPriceResult = {
      stockCode: candidate.stockCode,
      stockName: candidate.stockName,
      currentPrice,
      openPrice: priceDetail?.openPrice ?? latestPrice?.open ?? currentPrice,
      highPrice: priceDetail?.highPrice ?? latestPrice?.high ?? currentPrice,
      lowPrice: priceDetail?.lowPrice ?? latestPrice?.low ?? currentPrice,
      volume: priceDetail?.volume ?? candidate.volume,
      marketCap: priceDetail?.marketCap ?? candidate.marketCap,
      per: priceDetail?.per ?? indicators.per,
      pbr: priceDetail?.pbr ?? indicators.pbr,
      eps: priceDetail?.eps ?? indicators.eps,
      bps: priceDetail?.bps ?? indicators.bps,
      loanBalanceRate: priceDetail?.loanBalanceRate ?? indicators.loanBalanceRate,
      shortSellable: priceDetail?.shortSellable ?? indicators.shortSellable,
      d250High: priceDetail?.d250High ?? indicators.d250High,
      d250Low: priceDetail?.d250Low ?? indicators.d250Low,
      d250HighRate: priceDetail?.d250HighRate ?? indicators.d250HighRate,
      d250LowRate: priceDetail?.d250LowRate ?? indicators.d250LowRate,
      yearHigh: priceDetail?.yearHigh ?? indicators.yearHigh,
      yearLow: priceDetail?.yearLow ?? indicators.yearLow,
      yearHighRate: priceDetail?.yearHighRate ?? indicators.yearHighRate,
      yearLowRate: priceDetail?.yearLowRate ?? indicators.yearLowRate,
      investCautionYn: priceDetail?.investCautionYn ?? indicators.investCautionYn,
      marketWarnCode: priceDetail?.marketWarnCode ?? indicators.marketWarnCode,
      shortOverheatYn: priceDetail?.shortOverheatYn ?? indicators.shortOverheatYn,
      prevDayVolume: priceDetail?.prevDayVolume,
      sector: priceDetail?.sector ?? indicators.sector,
    };

    const derivedMacd = dailyPrices.length >= 35
      ? this.marketAnalysis.calculateMACD(dailyPrices.map((item) => item.close))
      : undefined;

    const stockIndicators: StockIndicators = {
      currentAboveMA200: indicators.priceAboveMa200 ?? (indicators.ma200 ? currentPrice > indicators.ma200 : true),
      ma200: indicators.ma200,
      rsi14: indicators.rsi14,
      volatility30d: indicators.volatility30d,
      ma20: indicators.ma20,
      ma60: indicators.ma60,
      bollingerUpper: indicators.bollingerBands?.upper,
      bollingerMiddle: indicators.bollingerBands?.middle,
      bollingerLower: indicators.bollingerBands?.lower,
      macdLine: indicators.macd?.line ?? derivedMacd?.line,
      macdSignal: indicators.macd?.signal ?? derivedMacd?.signal,
      macdHistogram: indicators.macd?.histogram ?? derivedMacd?.histogram,
      macdPrevHistogram: derivedMacd?.prevHistogram,
      adx14: indicators.adx14,
      atr14: indicators.atr14,
      atrPercent: indicators.atrPercent,
      avgVolume20: indicators.avgVolume,
      volumeRatio: indicators.volumeToAvgRatio,
      prevHigh: previousPrice?.high,
      prevLow: previousPrice?.low,
      prevClose: previousPrice?.close,
      todayOpen: price.openPrice ?? latestPrice?.open,
      foreignNetBuy: indicators.foreignNetBuy,
      institutionNetBuy: indicators.institutionNetBuy,
      fundNetBuy: indicators.fundNetBuy,
      trustNetBuy: indicators.trustNetBuy,
      foreignNetBuyAmount: indicators.foreignNetBuyAmount,
      foreignNetBuyStreak: indicators.foreignNetBuyStreak,
      programTradeDirection: indicators.programTradeDirection,
      investCautionYn: price.investCautionYn ?? indicators.investCautionYn,
      marketWarnCode: price.marketWarnCode ?? indicators.marketWarnCode,
      shortOverheatYn: price.shortOverheatYn ?? indicators.shortOverheatYn,
      d250High: indicators.d250High,
      d250Low: indicators.d250Low,
      d250HighRate: indicators.d250HighRate,
      d250LowRate: indicators.d250LowRate,
      yearHigh: indicators.yearHigh,
      yearLow: indicators.yearLow,
      yearHighRate: indicators.yearHighRate,
      yearLowRate: indicators.yearLowRate,
      marketCap: candidate.marketCap,
      loanBalanceRate: indicators.loanBalanceRate,
      shortSellable: indicators.shortSellable,
      dividendYield: indicators.dividendYield,
      payoutRatio: indicators.payoutRatio,
      consecutiveDividendYears: indicators.consecutiveDividendYears,
      dividendGrowthRate: indicators.dividendGrowthRate,
      targetPrice: indicators.targetPrice,
      targetPriceUpside: indicators.targetPriceUpside,
      consensusRating: indicators.consensusRating,
      earningsSurprise: indicators.earningsSurprise,
      estimatedEps: indicators.estimatedEps,
      estimatedPer: indicators.estimatedPer,
      analystCount: indicators.analystCount,
    };

    const fundamentals = this.buildStrategyFundamentals(indicators);
    const quota = Math.max(currentPrice * (candidate.market === 'OVERSEAS' ? 12 : 20), candidate.market === 'OVERSEAS' ? 1000 : 500000);

    return {
      watchStock: {
        id: `screening:${candidate.exchangeCode}:${candidate.stockCode}`,
        broker: Broker.KIS,
        market: candidate.market,
        exchangeCode: candidate.exchangeCode,
        stockCode: candidate.stockCode,
        stockName: candidate.stockName,
        cycle: 1,
        maxCycles: 40,
        quota,
        stopLossRate: 0.5,
        maxPortfolioRate: 0.15,
      },
      price,
      alreadyExecutedToday: false,
      marketCondition,
      stockIndicators,
      fundamentals,
      buyableAmount: quota,
      totalPortfolioValue: quota * 10,
    };
  }

  private buildStrategyFundamentals(indicators: StockIndicatorDetail): StockFundamentals {
    return {
      per: indicators.per,
      pbr: indicators.pbr,
      roe: indicators.roe,
      debtRatio: indicators.debtRatio,
      eps: indicators.eps,
      salesGrowthRate: indicators.revenueGrowthRate,
      operatingProfitGrowthRate: indicators.operatingProfitGrowthRate,
      evEbitda: indicators.evEbitda,
      dividendPayoutRate: indicators.payoutRatio,
    };
  }

  private applyCandidateIndicators(candidate: ScreeningCandidate, indicators: StockIndicatorDetail): void {
    indicators.volumeIncreaseRate = candidate.volumeIncreaseRate;
    indicators.avgVolume = candidate.avgVolume;
    indicators.volumeToAvgRatio = candidate.avgVolume && candidate.avgVolume > 0
      ? candidate.volume / candidate.avgVolume
      : undefined;
    indicators.sector = candidate.sector;
  }

  private applyPriceIndicators(priceDetail: StockPriceResult | undefined, indicators: StockIndicatorDetail): void {
    if (!priceDetail) return;
    indicators.per = priceDetail.per ?? indicators.per;
    indicators.pbr = priceDetail.pbr ?? indicators.pbr;
    indicators.eps = priceDetail.eps ?? indicators.eps;
    indicators.bps = priceDetail.bps ?? indicators.bps;
    indicators.loanBalanceRate = priceDetail.loanBalanceRate;
    indicators.shortSellable = priceDetail.shortSellable;
    indicators.d250High = priceDetail.d250High;
    indicators.d250Low = priceDetail.d250Low;
    indicators.d250HighRate = priceDetail.d250HighRate;
    indicators.d250LowRate = priceDetail.d250LowRate;
    indicators.yearHigh = priceDetail.yearHigh;
    indicators.yearLow = priceDetail.yearLow;
    indicators.yearHighRate = priceDetail.yearHighRate;
    indicators.yearLowRate = priceDetail.yearLowRate;
    indicators.investCautionYn = priceDetail.investCautionYn;
    indicators.marketWarnCode = priceDetail.marketWarnCode;
    indicators.shortOverheatYn = priceDetail.shortOverheatYn;
  }

  private applyOpenDartIndicators(
    openDartSignals: OpenDartDomesticSignals | undefined,
    indicators: StockIndicatorDetail,
  ): void {
    if (!openDartSignals) return;
    indicators.recentDisclosureCount30d = openDartSignals.recentDisclosureCount30d;
    indicators.recentPeriodicDisclosureCount30d = openDartSignals.recentPeriodicDisclosureCount30d;
    indicators.recentMaterialDisclosureCount30d = openDartSignals.recentMaterialDisclosureCount30d;
    indicators.lastDisclosureDate = openDartSignals.lastDisclosureDate;
    indicators.lastDisclosureTitle = openDartSignals.lastDisclosureTitle;
    indicators.insiderOwnershipRate = openDartSignals.insiderOwnershipRate;
    indicators.insiderOwnershipChangeRate = openDartSignals.insiderOwnershipChangeRate;
    indicators.latestOwnershipReportDate = openDartSignals.latestOwnershipReportDate;
  }

  private applySecFundamentalIndicators(
    secFundamentals: SecFundamentals | undefined,
    indicators: StockIndicatorDetail,
  ): void {
    if (!secFundamentals) return;
    indicators.revenueGrowthRate = secFundamentals.revenueGrowthRate ?? indicators.revenueGrowthRate;
    indicators.operatingProfitGrowthRate = secFundamentals.operatingProfitGrowthRate ?? indicators.operatingProfitGrowthRate;
    indicators.epsGrowthRate = secFundamentals.epsGrowthRate ?? indicators.epsGrowthRate;
    indicators.operatingMargin = secFundamentals.operatingMargin ?? indicators.operatingMargin;
    indicators.netMargin = secFundamentals.netMargin ?? indicators.netMargin;
    indicators.grossMargin = secFundamentals.grossMargin ?? indicators.grossMargin;
    indicators.debtRatio = secFundamentals.debtRatio ?? indicators.debtRatio;
    indicators.currentRatio = secFundamentals.currentRatio ?? indicators.currentRatio;
    indicators.totalAssetGrowthRate = secFundamentals.totalAssetGrowthRate ?? indicators.totalAssetGrowthRate;
    indicators.equityGrowthRate = secFundamentals.equityGrowthRate ?? indicators.equityGrowthRate;
    indicators.dividendYield = secFundamentals.dividendYield ?? indicators.dividendYield;
    indicators.payoutRatio = secFundamentals.payoutRatio ?? indicators.payoutRatio;
    indicators.latestSecFilingDate = secFundamentals.latestFilingDate;
    indicators.latestSecFilingForm = secFundamentals.latestFilingForm;
    indicators.latestSecPeriodicFilingDate = secFundamentals.latestPeriodicFilingDate;
    indicators.latestSecPeriodicFilingForm = secFundamentals.latestPeriodicFilingForm;
    indicators.recentSecForm8KCount30d = secFundamentals.recentForm8KCount30d;
    indicators.secPeriodicReportAgeDays = secFundamentals.secPeriodicReportAgeDays;
  }

  private applyForeignInstitutionIndicators(
    fiData: ForeignInstitutionDetail | undefined,
    indicators: StockIndicatorDetail,
  ): void {
    if (!fiData) return;
    indicators.foreignNetBuy = fiData.foreignNet > 0;
    indicators.institutionNetBuy = fiData.instNet > 0;
    indicators.fundNetBuy = fiData.fundNet > 0;
    indicators.trustNetBuy = fiData.trustNet > 0;
    indicators.foreignNetBuyAmount = fiData.foreignNetAmount;
  }

  private applyFinancialIndicators(
    financialRatio: any[],
    growthRatio: any[] | undefined,
    profitRatio: any[] | undefined,
    incomeStatement: any[] | undefined,
    stabilityRatio: any[] | undefined,
    otherMajorRatios: any[] | undefined,
    indicators: StockIndicatorDetail,
  ): void {
    const growth = growthRatio?.[0];
    const profit = profitRatio?.[0];
    const financial = financialRatio[0];
    if (financial) {
      indicators.roe = this.pickNumeric(financial, ['roe_val', 'roe', 'ROE']);
      indicators.eps = this.pickNumeric(financial, ['eps', 'EPS']) ?? indicators.eps;
      indicators.bps = this.pickNumeric(financial, ['bps', 'BPS']) ?? indicators.bps;
      indicators.debtRatio = this.pickNumeric(financial, ['lblt_rate', 'debt_ratio', '부채비율']);
    }

    indicators.revenueGrowthRate = this.pickNumeric(growth, ['grs', 'sale_grrt', 'revenue_growth_rate', '매출액증가율']);
    indicators.operatingProfitGrowthRate = this.pickNumeric(growth, ['bsop_prfi_inrt', 'bsop_prfi_grrt', 'operating_profit_growth_rate', '영업이익증가율']);
    indicators.epsGrowthRate = this.pickNumeric(growth, ['eps_grrt', 'eps_growth_rate', 'EPS증가율']);
    indicators.operatingMargin = this.pickNumeric(profit, ['op_prft_rate', 'operating_margin', '영업이익률']);
    indicators.netMargin = this.pickNumeric(profit, ['sale_ntin_rate', 'ntin_inrt', 'net_margin', '순이익률']);

    indicators.equityGrowthRate = this.pickNumeric(growth, ['equt_inrt', 'equity_growth_rate', '자기자본증가율']);
    indicators.totalAssetGrowthRate = this.pickNumeric(growth, ['totl_aset_inrt', 'total_asset_growth_rate', '총자산증가율']);
    indicators.grossMargin = this.pickNumeric(profit, ['sale_totl_rate', 'gross_margin', '매출액총이익률']);

    const stability = stabilityRatio?.[0];
    indicators.currentRatio = this.pickNumeric(stability, ['crrt', 'crnt_rate', 'current_ratio', '유동비율']);
    indicators.interestCoverageRatio = this.pickNumeric(stability, ['inrt_cvrg_rt', 'interest_coverage_ratio', '이자보상배율']);
    indicators.debtRatio = indicators.debtRatio ?? this.pickNumeric(stability, ['lblt_rate', 'debt_ratio']);
    indicators.quickRatio = this.pickNumeric(stability, ['quck_rate', 'quick_ratio', '당좌비율']);
    indicators.borrowingDependency = this.pickNumeric(stability, ['bram_depn', 'borrowing_dependency', '차입금의존도']);

    const other = otherMajorRatios?.[0];
    indicators.evEbitda = this.pickNumeric(other, ['ev_ebitda', 'evEbitda', 'EV/EBITDA']);
    indicators.dividendYield = this.pickNumeric(other, ['divi_rate', 'dividend_yield', '배당수익률']);
    indicators.payoutRatio = this.pickNumeric(other, ['payout_rate', 'dvdn_payn_rt', '배당성향']);

    const income = incomeStatement?.[0];
    const revenue = this.pickNumeric(income, ['sale_account', 'sale_totl', 'revenue', 'sales']);
    const operatingIncome = this.pickNumeric(income, ['bsop_prti', 'op_prft', 'operating_profit']);
    if (revenue && revenue > 0 && operatingIncome) {
      indicators.operatingMargin = indicators.operatingMargin ?? (operatingIncome / revenue) * 100;
    }
  }

  private applySentimentIndicators(
    investOpinion: any[] | undefined,
    estimatePerform: any,
    dividendSchedule: any[] | undefined,
    investorTradeDaily: any[] | undefined,
    shortSale: any[] | undefined,
    creditBalance: any[] | undefined,
    indicators: StockIndicatorDetail,
    currentPrice: number,
  ): void {
    const opinionSummary = summarizeInvestOpinion(investOpinion);
    const estimateSummary = summarizeEstimatePerform(estimatePerform);
    indicators.targetPrice = opinionSummary.targetPrice;
    indicators.consensusRating = opinionSummary.rating ?? estimateSummary.rating;
    indicators.analystCount = opinionSummary.analystCount;
    indicators.targetPriceUpside = indicators.targetPrice && currentPrice > 0
      ? ((indicators.targetPrice - currentPrice) / currentPrice) * 100
      : undefined;

    indicators.earningsSurprise = estimateSummary.earningsSurprise;
    indicators.estimatedEps = estimateSummary.estimatedEps;
    indicators.estimatedPer = estimateSummary.estimatedPer;

    const dividendSummary = summarizeDividendSchedule(dividendSchedule);
    indicators.consecutiveDividendYears = dividendSummary.consecutiveDividendYears;
    indicators.dividendGrowthRate = dividendSummary.dividendGrowthRate5y;
    if ((indicators.dividendYield === undefined || indicators.dividendYield <= 0)
      && dividendSummary.latestAnnualDividendAmount
      && currentPrice > 0) {
      indicators.dividendYield = (dividendSummary.latestAnnualDividendAmount / currentPrice) * 100;
    }
    if ((indicators.payoutRatio === undefined || indicators.payoutRatio <= 0)
      && dividendSummary.latestAnnualDividendAmount
      && indicators.eps
      && indicators.eps > 0) {
      indicators.payoutRatio = (dividendSummary.latestAnnualDividendAmount / indicators.eps) * 100;
    }

    const latestInvestor = investorTradeDaily?.[0];
    const foreignNetQty = this.pickNumeric(latestInvestor, ['frgn_ntby_qty', 'foreign_net_buy_qty']);
    const institutionNetQty = this.pickNumeric(latestInvestor, ['orgn_ntby_qty', 'institution_net_buy_qty']);
    const trustNetQty = this.pickNumeric(latestInvestor, ['ivtr_ntby_qty', 'trust_net_buy_qty']);
    const fundNetQty = this.pickNumeric(latestInvestor, ['fund_ntby_qty', 'fund_net_buy_qty']);
    if (indicators.foreignNetBuy === undefined && foreignNetQty !== undefined) {
      indicators.foreignNetBuy = foreignNetQty > 0;
    }
    if (indicators.institutionNetBuy === undefined && institutionNetQty !== undefined) {
      indicators.institutionNetBuy = institutionNetQty > 0;
    }
    if (indicators.trustNetBuy === undefined && trustNetQty !== undefined) {
      indicators.trustNetBuy = trustNetQty > 0;
    }
    if (indicators.fundNetBuy === undefined && fundNetQty !== undefined) {
      indicators.fundNetBuy = fundNetQty > 0;
    }
    if (indicators.foreignNetBuyAmount === undefined) {
      indicators.foreignNetBuyAmount = this.pickNumeric(latestInvestor, ['frgn_ntby_tr_pbmn', 'foreign_net_buy_amount']);
    }

    indicators.foreignNetBuyStreak = this.estimateNetBuyStreak(investorTradeDaily, ['frgn_ntby_qty', 'foreign_net_buy_qty']);
    indicators.programTradeDirection = this.estimateProgramTradeDirection(investorTradeDaily);
    indicators.shortSaleRatio = this.pickNumeric(shortSale?.[0], ['short_sale_ratio', 'short_selling_vol_rt', 'short_rt']);
    indicators.creditBalanceRate = this.pickNumeric(creditBalance?.[0], ['crdt_bal_rt', 'credit_balance_rate', '신용잔고비율']);
  }

  private detectChartPattern(indicators: StockIndicatorDetail, currentPrice: number): string | undefined {
    if (indicators.supportLevels?.[0] && currentPrice <= indicators.supportLevels[0] * 1.03 && (indicators.rsi14 ?? 100) < 40) {
      return 'DOUBLE_BOTTOM';
    }
    if ((indicators.ma20 ?? 0) > (indicators.ma60 ?? Number.MAX_SAFE_INTEGER) && (indicators.adx14 ?? 0) >= 25) {
      return 'TREND_CONTINUATION';
    }
    if ((indicators.bollingerBands?.percentB ?? 0) > 0.9 && (indicators.volumeSurgeRate ?? 0) > 50) {
      return 'BREAKOUT';
    }
    return undefined;
  }

  private estimateNetBuyStreak(rows: any[] | undefined, keys: string[]): number | undefined {
    if (!rows?.length) return undefined;
    let streak = 0;
    for (const row of rows) {
      const value = this.pickNumeric(row, keys) ?? 0;
      if (value > 0) streak += 1;
      else break;
    }
    return streak || undefined;
  }

  private estimateProgramTradeDirection(rows: any[] | undefined): 'BUY' | 'SELL' | undefined {
    const value = this.pickNumeric(rows?.[0], ['pgtr_ntby_qty', 'program_net_buy_qty', '프로그램순매수']);
    if (value === undefined) return undefined;
    return value >= 0 ? 'BUY' : 'SELL';
  }

  private calculateVolatility(prices: DailyPrice[]): number {
    const returns: number[] = [];
    for (let index = 0; index < prices.length - 1; index++) {
      if (prices[index].close > 0 && prices[index + 1].close > 0) {
        returns.push(prices[index].close / prices[index + 1].close - 1);
      }
    }
    if (returns.length === 0) return 0;
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance) * Math.sqrt(252) * 100;
  }

  private calculateATR(prices: DailyPrice[]): number {
    if (prices.length < 2) return 0;
    let sum = 0;
    for (let i = 0; i < prices.length - 1; i++) {
      const high = prices[i].high;
      const low = prices[i].low;
      const prevClose = prices[i + 1].close;
      sum += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    }
    return sum / (prices.length - 1);
  }

  private calculateMaxDrawdown(prices: DailyPrice[]): number {
    if (prices.length < 2) return 0;
    let peak = prices[prices.length - 1].close;
    let maxDD = 0;
    for (let i = prices.length - 2; i >= 0; i--) {
      const close = prices[i].close;
      if (close > peak) peak = close;
      const dd = (close - peak) / peak;
      if (dd < maxDD) maxDD = dd;
    }
    return maxDD * 100;
  }

  private getSettledValue<T>(result?: PromiseSettledResult<T | undefined>): T | undefined {
    return result?.status === 'fulfilled' ? result.value : undefined;
  }

  private pickNumeric(source: any, keys: string[]): number | undefined {
    return pickNumeric(source, keys);
  }
}
