import { Injectable, Logger } from '@nestjs/common';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { DailyPrice, StockPriceResult } from '../kis/types/kis-api.types';
import { EXCHANGE_REFERENCE_INDEX } from '../kis/types/kis-config.types';
import { MarketAnalysisService } from '../trading/market-analysis.service';
import { DeepAnalysisResult, DCFValuation, RiskProfile, TechnicalDetail, DividendAnalysis, ConsensusData } from './types';
import { pickNumeric, pickString } from './utils/api-data.util';
import { kstTodayStr, kstDateNDaysAgo } from './utils/date.util';

@Injectable()
export class DeepAnalysisService {
  private readonly logger = new Logger(DeepAnalysisService.name);
  private static readonly MARKET_PREMIUM = 5.5;
  private static readonly TERMINAL_GROWTH = 2.0;

  constructor(
    private kisDomestic: KisDomesticService,
    private kisOverseas: KisOverseasService,
    private marketAnalysis: MarketAnalysisService,
  ) {}

  async analyzeStock(
    stockCode: string,
    exchangeCode: string,
    market: 'DOMESTIC' | 'OVERSEAS',
  ): Promise<DeepAnalysisResult> {
    const basePriceGroup = await Promise.allSettled([
      market === 'DOMESTIC'
        ? this.kisDomestic.getPrice(stockCode)
        : this.kisOverseas.getPrice(exchangeCode, stockCode),
      market === 'DOMESTIC'
        ? this.kisDomestic.getDailyPrices(stockCode, kstDateNDaysAgo(420), kstTodayStr())
        : this.kisOverseas.getDailyPrices(exchangeCode, stockCode, 320),
    ]);

    const priceDetail = this.getSettledValue<StockPriceResult>(basePriceGroup[0]);
    const dailyPrices = this.getSettledValue<DailyPrice[]>(basePriceGroup[1]) ?? [];

    await this.delay(300);

    const domesticFinanceGroup = market === 'DOMESTIC'
      ? await Promise.allSettled([
        this.kisDomestic.getIncomeStatement(stockCode),
        this.kisDomestic.getGrowthRatio(stockCode),
        this.kisDomestic.getStabilityRatio(stockCode),
        this.kisDomestic.getOtherMajorRatios(stockCode),
        this.kisDomestic.getDividendSchedule(stockCode),
        this.kisDomestic.getInvestOpinion(stockCode),
        this.kisDomestic.getEstimatePerform(stockCode),
        this.kisDomestic.getDailyShortSale(stockCode),
        this.kisDomestic.getDailyCreditBalance(stockCode),
        this.kisDomestic.getBalanceSheet(stockCode),
      ])
      : [];

    const incomeStatement = this.getSettledValue<any[]>(domesticFinanceGroup[0]);
    const growthRatio = this.getSettledValue<any[]>(domesticFinanceGroup[1]);
    const stabilityRatio = this.getSettledValue<any[]>(domesticFinanceGroup[2]);
    const otherMajorRatios = this.getSettledValue<any[]>(domesticFinanceGroup[3]);
    const dividendSchedule = this.getSettledValue<any[]>(domesticFinanceGroup[4]);
    const investOpinion = this.getSettledValue<any[]>(domesticFinanceGroup[5]);
    const estimatePerform = this.getSettledValue<any[]>(domesticFinanceGroup[6]);
    const shortSale = this.getSettledValue<any[]>(domesticFinanceGroup[7]);
    const creditBalance = this.getSettledValue<any[]>(domesticFinanceGroup[8]);
    const balanceSheet = this.getSettledValue<any[]>(domesticFinanceGroup[9]);

    const beta = await this.calculateBeta(exchangeCode, dailyPrices);
    const dcfValuation = incomeStatement && growthRatio && priceDetail
      ? await this.calculateSimpleDCF(incomeStatement, growthRatio, priceDetail, beta)
      : undefined;
    const riskProfile = dailyPrices.length > 0
      ? this.assessRisk(stabilityRatio, shortSale, creditBalance, balanceSheet, dailyPrices, beta)
      : undefined;
    const technicalDetail = priceDetail && dailyPrices.length > 0
      ? this.analyzeTechnical(dailyPrices, priceDetail)
      : undefined;
    const dividendAnalysis = market === 'DOMESTIC' && otherMajorRatios
      ? this.analyzeDividend(dividendSchedule, otherMajorRatios)
      : undefined;
    const consensusData = market === 'DOMESTIC'
      ? this.getConsensusData(investOpinion, estimatePerform)
      : undefined;

    const stockName = priceDetail?.stockName ?? stockCode;
    const analysis: DeepAnalysisResult = {
      stockCode,
      stockName,
      exchangeCode,
      dcfValuation,
      riskProfile,
      technicalDetail,
      dividendAnalysis,
      consensusData,
      reportSummary: '',
    };

    analysis.reportSummary = this.generateReportSummary(analysis);
    return analysis;
  }

  private async calculateSimpleDCF(
    incomeStatement: any[],
    growthRatio: any[],
    priceDetail: StockPriceResult,
    beta = 1,
  ): Promise<DCFValuation | undefined> {
    const latestIncome = incomeStatement[0];
    if (!latestIncome) return undefined;

    const revenue = this.pickNumeric(latestIncome, [
      'sale_account',
      'sale_totl',
      'revenue',
      'sales',
      '매출액',
    ]);
    if (!revenue || revenue <= 0) return undefined;

    const operatingIncome = this.pickNumeric(latestIncome, [
      'bsop_prti',
      'op_prft',
      'operating_profit',
      '영업이익',
    ]);
    const revenueGrowthRate = this.pickNumeric(growthRatio?.[0], [
      'sale_grrt',
      'revenue_growth_rate',
      '매출액증가율',
    ]) ?? 5;

    const riskFreeRate = await this.getRiskFreeRate();
    const wacc = riskFreeRate + beta * DeepAnalysisService.MARKET_PREMIUM;
    const terminalGrowthRate = DeepAnalysisService.TERMINAL_GROWTH;
    const operatingMargin = operatingIncome && revenue > 0
      ? Math.max(operatingIncome / revenue, 0.02)
      : 0.08;

    const projectedRevenue: number[] = [];
    let projected = revenue;
    const normalizedGrowth = Math.max(Math.min(revenueGrowthRate, 25), -10) / 100;
    for (let year = 0; year < 5; year++) {
      projected *= 1 + normalizedGrowth;
      projectedRevenue.push(projected);
    }

    const discountRate = wacc / 100;
    const terminalRate = terminalGrowthRate / 100;
    const freeCashFlows = projectedRevenue.map((value) => value * operatingMargin * 0.7);
    const discounted = freeCashFlows.reduce(
      (sum, value, index) => sum + value / Math.pow(1 + discountRate, index + 1),
      0,
    );
    const terminalValue = freeCashFlows[freeCashFlows.length - 1] * (1 + terminalRate)
      / Math.max(discountRate - terminalRate, 0.01);
    const enterpriseValue = discounted + terminalValue / Math.pow(1 + discountRate, 5);
    const intrinsicValue = priceDetail.listedShares && priceDetail.listedShares > 0
      ? enterpriseValue / priceDetail.listedShares
      : enterpriseValue;
    const currentPrice = priceDetail.currentPrice;
    const marginOfSafety = intrinsicValue > 0
      ? ((intrinsicValue - currentPrice) / intrinsicValue) * 100
      : 0;

    return {
      projectedRevenue,
      projectedOperatingMargin: operatingMargin * 100,
      wacc,
      terminalGrowthRate,
      intrinsicValue,
      currentPrice,
      marginOfSafety,
      sensitivityMatrix: this.buildSensitivityMatrix(freeCashFlows, terminalValue, wacc, terminalGrowthRate),
    };
  }

  private assessRisk(
    stabilityRatio: any[] | undefined,
    shortSale: any[] | undefined,
    creditBalance: any[] | undefined,
    balanceSheet: any[] | undefined,
    dailyPrices: DailyPrice[],
    beta?: number,
  ): RiskProfile {
    const latestStability = stabilityRatio?.[0];
    const volatility30d = this.calculateVolatility(dailyPrices.slice(0, 31));
    const maxDrawdown90d = this.calculateMaxDrawdown(dailyPrices.slice(0, 90));
    const shortSaleRatio = this.pickNumeric(shortSale?.[0], [
      'short_sale_ratio',
      'short_selling_vol_rt',
      'short_rt',
      '공매도비중',
    ]);
    const creditBalanceRate = this.pickNumeric(creditBalance?.[0], [
      'crdt_bal_rt',
      'credit_balance_rate',
      '신용잔고비율',
    ]);
    const debtRatio = this.pickNumeric(latestStability, ['lblt_rate', 'debt_ratio', '부채비율']);
    const currentRatio = this.pickNumeric(latestStability, ['crrt', 'current_ratio', '유동비율']);
    const interestCoverageRatio = this.pickNumeric(latestStability, [
      'inrt_cvrg_rt',
      'interest_coverage_ratio',
      '이자보상배율',
    ]);

    const latestBalance = balanceSheet?.[0];
    const totalAssets = this.pickNumeric(latestBalance, ['total_aset', 'total_assets', '자산총계']);
    const totalEquity = this.pickNumeric(latestBalance, ['total_cptl', 'total_equity', '자본총계']);
    const listedShares = this.pickNumeric(latestBalance, ['lstg_stqt', 'listed_shares', '상장주수']);
    const equityRatio = totalAssets && totalEquity && totalAssets > 0
      ? (totalEquity / totalAssets) * 100
      : undefined;
    const netAssetPerShare = totalEquity && listedShares && listedShares > 0
      ? totalEquity / listedShares
      : undefined;

    let riskScore = 0;
    if (volatility30d <= 20) riskScore += 1;
    if (volatility30d <= 30) riskScore += 1;
    if (maxDrawdown90d >= -15) riskScore += 1;
    if ((debtRatio ?? 999) < 150) riskScore += 2;
    if ((currentRatio ?? 0) >= 150) riskScore += 2;
    if ((interestCoverageRatio ?? 0) >= 3) riskScore += 1;
    if ((shortSaleRatio ?? 0) < 2) riskScore += 1;
    if ((creditBalanceRate ?? 0) < 5) riskScore += 1;
    if (equityRatio !== undefined && equityRatio >= 50) riskScore += 1;

    let riskGrade: RiskProfile['riskGrade'] = 'EXTREME';
    if (riskScore >= 9) riskGrade = 'LOW';
    else if (riskScore >= 6) riskGrade = 'MEDIUM';
    else if (riskScore >= 4) riskGrade = 'HIGH';

    return {
      volatility30d,
      beta,
      maxDrawdown90d,
      shortSaleRatio,
      creditBalanceRate,
      equityRatio,
      netAssetPerShare,
      riskGrade,
    };
  }

  private analyzeTechnical(
    dailyPrices: DailyPrice[],
    priceDetail: StockPriceResult,
  ): TechnicalDetail | undefined {
    if (dailyPrices.length < 30) return undefined;

    const closes = dailyPrices.map((item) => item.close);
    const highs = dailyPrices.map((item) => item.high);
    const lows = dailyPrices.map((item) => item.low);

    const ma20 = this.marketAnalysis.calculateMA(closes, 20);
    const ma60 = this.marketAnalysis.calculateMA(closes, 60);
    const macd = this.marketAnalysis.calculateMACD(closes);
    const bb = this.marketAnalysis.calculateBollingerBands(closes, 20, 2);
    const adx = this.marketAnalysis.calculateADX(highs, lows, closes, 14);
    const trendDirection = ma20 > ma60 && priceDetail.currentPrice >= ma20
      ? 'UP'
      : ma20 < ma60 && priceDetail.currentPrice <= ma20
        ? 'DOWN'
        : 'SIDEWAYS';

    const recentWindow = dailyPrices.slice(0, 60);
    const support = [...recentWindow]
      .sort((a, b) => a.low - b.low)
      .slice(0, 3)
      .map((item) => item.low)
      .sort((a, b) => a - b);
    const resistance = [...recentWindow]
      .sort((a, b) => b.high - a.high)
      .slice(0, 3)
      .map((item) => item.high)
      .sort((a, b) => a - b);

    const rangeHigh = Math.max(...recentWindow.map((item) => item.high));
    const rangeLow = Math.min(...recentWindow.map((item) => item.low));
    const range = Math.max(rangeHigh - rangeLow, 1);
    const stochastic = this.calculateStochastic(dailyPrices.slice(0, 16));
    const ichimoku = this.calculateIchimoku(dailyPrices.slice(0, 52));

    return {
      trendDirection,
      support,
      resistance,
      fibonacciRetracement: {
        '23.6%': rangeHigh - range * 0.236,
        '38.2%': rangeHigh - range * 0.382,
        '50.0%': rangeHigh - range * 0.5,
        '61.8%': rangeHigh - range * 0.618,
      },
      macd: {
        line: macd.line,
        signal: macd.signal,
        histogram: macd.histogram,
      },
      bollingerBands: {
        upper: bb.upper,
        middle: bb.middle,
        lower: bb.lower,
        percentB: (priceDetail.currentPrice - bb.lower) / Math.max(bb.upper - bb.lower, 1),
      },
      stochastic,
      adx,
      ichimoku,
    };
  }

  private analyzeDividend(
    dividendSchedule: any[] | undefined,
    otherRatios: any[] | undefined,
  ): DividendAnalysis | undefined {
    const latestRatio = otherRatios?.[0];
    if (!latestRatio && !dividendSchedule?.length) return undefined;

    const currentYield = this.pickNumeric(latestRatio, [
      'divi_rate',
      'dividend_yield',
      '배당수익률',
    ]) ?? 0;
    const payoutRatio = this.pickNumeric(latestRatio, [
      'payout_rate',
      'dvdn_payn_rt',
      '배당성향',
    ]) ?? 0;

    const years = new Set(
      (dividendSchedule ?? [])
        .map((item) => this.pickString(item, ['cash_div_dt', 'ex_dividend_date', '배당기준일']))
        .filter(Boolean)
        .map((value) => String(value).slice(0, 4)),
    );

    const amounts = (dividendSchedule ?? [])
      .map((item) => this.pickNumeric(item, ['cash_divi_rate', 'dividend_amount', '주당배당금']))
      .filter((value): value is number => value !== undefined)
      .slice(0, 5)
      .reverse();

    const dividendGrowthRate5y = amounts.length >= 2 && amounts[0] > 0
      ? ((amounts[amounts.length - 1] / amounts[0]) ** (1 / Math.max(amounts.length - 1, 1)) - 1) * 100
      : undefined;

    const latestSchedule = dividendSchedule?.[0];
    return {
      currentYield,
      payoutRatio,
      consecutiveDividendYears: years.size,
      dividendGrowthRate5y,
      exDividendDate: this.pickString(latestSchedule, ['cash_div_dt', 'ex_dividend_date']),
      nextPaymentDate: this.pickString(latestSchedule, ['pay_dt', 'payment_date']),
    };
  }

  private getConsensusData(
    investOpinion: any[] | undefined,
    estimatePerform: any[] | undefined,
  ): ConsensusData | undefined {
    const latestOpinion = investOpinion?.[0];
    const estimates = estimatePerform ?? [];
    if (!latestOpinion && estimates.length === 0) return undefined;

    const targetPrice = this.pickNumeric(latestOpinion, ['goal_pric', 'target_price', '목표가']) ?? 0;
    const analystCount = this.pickNumeric(latestOpinion, ['analyst_cnt', 'nr_analyst', '애널리스트수']) ?? 0;
    const rating = this.pickString(latestOpinion, ['opinion', 'rating', '투자의견']) ?? 'N/A';
    const earningsSurprise = estimates
      .slice(0, 4)
      .map((item) => this.pickNumeric(item, ['surprise_rt', 'earnings_surprise', '서프라이즈율']) ?? 0);
    const estimatedEps = this.pickNumeric(estimates[0], ['estm_eps', 'estimated_eps', '추정eps']) ?? 0;

    return {
      targetPrice,
      analystCount,
      rating,
      earningsSurprise,
      estimatedEps,
    };
  }

  private generateReportSummary(analysis: DeepAnalysisResult): string {
    const lines: string[] = [];
    if (analysis.dcfValuation) {
      lines.push(
        `DCF 내재가치 ${analysis.dcfValuation.intrinsicValue.toFixed(0)}, 안전마진 ${analysis.dcfValuation.marginOfSafety.toFixed(1)}%`,
      );
    }
    if (analysis.riskProfile) {
      lines.push(
        `리스크 ${analysis.riskProfile.riskGrade}, 30일 변동성 ${analysis.riskProfile.volatility30d.toFixed(1)}%, 90일 MDD ${analysis.riskProfile.maxDrawdown90d.toFixed(1)}%`,
      );
    }
    if (analysis.technicalDetail) {
      lines.push(
        `기술적 흐름 ${analysis.technicalDetail.trendDirection}, ADX ${analysis.technicalDetail.adx.toFixed(1)}, MACD ${analysis.technicalDetail.macd.histogram >= 0 ? '매수 우위' : '약세'}`,
      );
    }
    if (analysis.dividendAnalysis) {
      lines.push(
        `배당수익률 ${analysis.dividendAnalysis.currentYield.toFixed(1)}%, 연속 배당 ${analysis.dividendAnalysis.consecutiveDividendYears}년`,
      );
    }
    if (analysis.consensusData) {
      const latestSurprise = analysis.consensusData.earningsSurprise[0] ?? 0;
      lines.push(
        `컨센서스 ${analysis.consensusData.rating}, 목표가 ${analysis.consensusData.targetPrice.toFixed(0)}, 최근 서프라이즈 ${latestSurprise.toFixed(1)}%`,
      );
    }
    return lines.join(' | ') || '분석 가능한 데이터가 부족합니다.';
  }

  private async calculateBeta(exchangeCode: string, dailyPrices: DailyPrice[]): Promise<number | undefined> {
    if (dailyPrices.length < 60) return undefined;

    const referenceIndex = EXCHANGE_REFERENCE_INDEX[exchangeCode];
    if (!referenceIndex) return undefined;

    try {
      const benchmarkPrices = await this.marketAnalysis.fetchIndexDailyPrices(
        referenceIndex.type,
        referenceIndex.code,
        120,
      );
      if (benchmarkPrices.length < 60) return undefined;

      const stockReturns = this.buildReturns(dailyPrices);
      const benchmarkReturns = this.buildReturns(benchmarkPrices);
      const minLength = Math.min(stockReturns.length, benchmarkReturns.length);
      if (minLength < 30) return undefined;

      const stock = stockReturns.slice(0, minLength);
      const benchmark = benchmarkReturns.slice(0, minLength);
      const cov = this.covariance(stock, benchmark);
      const variance = this.variance(benchmark);
      if (variance <= 0) return undefined;

      return cov / variance;
    } catch (e) {
      this.logger.warn(`Beta calculation failed for ${exchangeCode}: ${e.message}`);
      return undefined;
    }
  }

  private buildSensitivityMatrix(
    freeCashFlows: number[],
    terminalValue: number,
    wacc: number,
    terminalGrowthRate: number,
  ): number[][] {
    const waccs = [wacc - 1, wacc, wacc + 1];
    const growthRates = [terminalGrowthRate - 1, terminalGrowthRate, terminalGrowthRate + 1];

    return waccs.map((waccValue) => growthRates.map((growthValue) => {
      const discountRate = Math.max(waccValue / 100, 0.03);
      const terminalRate = Math.max(growthValue / 100, 0.005);
      const discounted = freeCashFlows.reduce(
        (sum, value, index) => sum + value / Math.pow(1 + discountRate, index + 1),
        0,
      );
      const adjustedTerminalValue = freeCashFlows[freeCashFlows.length - 1] * (1 + terminalRate)
        / Math.max(discountRate - terminalRate, 0.01);
      return discounted + adjustedTerminalValue / Math.pow(1 + discountRate, 5);
    }));
  }

  private calculateVolatility(prices: DailyPrice[]): number {
    const returns = this.buildReturns(prices);
    if (returns.length === 0) return 0;
    return Math.sqrt(this.variance(returns)) * Math.sqrt(252) * 100;
  }

  private calculateMaxDrawdown(prices: DailyPrice[]): number {
    const ordered = [...prices].reverse();
    let peak = ordered[0]?.close ?? 0;
    let maxDrawdown = 0;

    for (const item of ordered) {
      peak = Math.max(peak, item.close);
      if (peak <= 0) continue;
      const drawdown = ((item.close - peak) / peak) * 100;
      maxDrawdown = Math.min(maxDrawdown, drawdown);
    }

    return maxDrawdown;
  }

  private calculateStochastic(prices: DailyPrice[]): { k: number; d: number } | undefined {
    if (prices.length < 14) return undefined;
    const calculateK = (window: DailyPrice[]) => {
      const highest = Math.max(...window.map((item) => item.high));
      const lowest = Math.min(...window.map((item) => item.low));
      const close = window[0].close;
      return highest === lowest ? 50 : ((close - lowest) / (highest - lowest)) * 100;
    };

    const k = calculateK(prices.slice(0, 14));
    const recentKs = Array.from({ length: Math.min(3, prices.length - 13) }, (_, index) =>
      calculateK(prices.slice(index, index + 14)),
    );
    const d = recentKs.length > 0
      ? recentKs.reduce((sum, value) => sum + value, 0) / recentKs.length
      : k;
    return { k, d };
  }

  private calculateIchimoku(prices: DailyPrice[]): { conversionLine: number; baseLine: number; cloud: string } | undefined {
    if (prices.length < 26) return undefined;
    const conversionSlice = prices.slice(0, 9);
    const baseSlice = prices.slice(0, 26);
    const conversionLine = (Math.max(...conversionSlice.map((item) => item.high)) + Math.min(...conversionSlice.map((item) => item.low))) / 2;
    const baseLine = (Math.max(...baseSlice.map((item) => item.high)) + Math.min(...baseSlice.map((item) => item.low))) / 2;
    return {
      conversionLine,
      baseLine,
      cloud: conversionLine >= baseLine ? 'BULLISH' : 'BEARISH',
    };
  }

  private buildReturns(prices: DailyPrice[]): number[] {
    const ordered = [...prices];
    const returns: number[] = [];
    for (let i = 0; i < ordered.length - 1; i++) {
      const current = ordered[i].close;
      const previous = ordered[i + 1].close;
      if (current > 0 && previous > 0) {
        returns.push(current / previous - 1);
      }
    }
    return returns;
  }

  private variance(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  }

  private covariance(left: number[], right: number[]): number {
    if (left.length === 0 || right.length === 0) return 0;
    const length = Math.min(left.length, right.length);
    const leftMean = left.slice(0, length).reduce((sum, value) => sum + value, 0) / length;
    const rightMean = right.slice(0, length).reduce((sum, value) => sum + value, 0) / length;

    let total = 0;
    for (let index = 0; index < length; index++) {
      total += (left[index] - leftMean) * (right[index] - rightMean);
    }
    return total / length;
  }

  private async getRiskFreeRate(): Promise<number> {
    try {
      const rates = await this.kisDomestic.getInterestRates();
      return rates[0]?.rate ?? 3.0;
    } catch {
      return 3.0;
    }
  }

  private getSettledValue<T>(result: PromiseSettledResult<T | undefined> | undefined): T | undefined {
    return result?.status === 'fulfilled' ? result.value : undefined;
  }

  private pickNumeric(source: any, keys: string[]): number | undefined {
    return pickNumeric(source, keys);
  }

  private pickString(source: any, keys: string[]): string | undefined {
    return pickString(source, keys);
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

}
