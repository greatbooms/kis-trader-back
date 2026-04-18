import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { DailyPrice, StockPriceResult } from '../kis/types/kis-api.types';
import { EXCHANGE_REFERENCE_INDEX } from '../kis/types/kis-config.types';
import { MarketDataCacheService } from '../market-data/market-data-cache.service';
import {
  MarketCondition,
  StockIndicators,
  TechnicalIndicatorAction,
  TechnicalIndicatorSnapshot,
  TechnicalRatingGroupSnapshot,
  TechnicalRatingsSnapshot,
} from './types';

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const MA_PERIODS = [10, 20, 30, 50, 100, 200] as const;
const TECHNICAL_RATINGS_HISTORY_COUNT = 650;
const INTRADAY_VWAP_CACHE_TTL_MS = 30 * 1000;

@Injectable()
export class MarketAnalysisService {
  private readonly logger = new Logger(MarketAnalysisService.name);
  private readonly cache = new Map<string, CacheEntry<any>>();
  private readonly isPaper: boolean;
  private static readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

  constructor(
    private kisDomestic: KisDomesticService,
    private kisOverseas: KisOverseasService,
    private configService: ConfigService,
    private marketDataCache: MarketDataCacheService,
  ) {
    this.isPaper = this.configService.get<string>('kis.env') === 'paper';
  }

  /** 종목별 기술 지표 (MA200, RSI14 + 하이브리드 전략용 확장 지표) */
  async getStockIndicators(
    market: 'DOMESTIC' | 'OVERSEAS',
    exchangeCode: string,
    stockCode: string,
    currentPrice: number,
  ): Promise<StockIndicators> {
    const cacheKey = `indicators:${market}:${exchangeCode}:${stockCode}`;
    const cached = this.getCache<StockIndicators>(cacheKey);
    if (cached) return cached;

    try {
      const prices = await this.fetchDailyPrices(market, exchangeCode, stockCode, TECHNICAL_RATINGS_HISTORY_COUNT);
      if (prices.length < 14) {
        this.logger.warn(`Insufficient daily prices for ${stockCode}: ${prices.length} days`);
        return { currentAboveMA200: true }; // 데이터 부족시 필터 패스
      }

      const closes = prices.map((p) => p.close);
      const highs = prices.map((p) => p.high);
      const lows = prices.map((p) => p.low);
      const volumes = prices.map((p) => p.volume);

      const ma200 = prices.length >= 200 ? this.calculateMA(closes, 200) : undefined;
      const ma20 = prices.length >= 20 ? this.calculateMA(closes, 20) : undefined;
      const ma60 = prices.length >= 60 ? this.calculateMA(closes, 60) : undefined;
      const rsi14 = this.calculateRSI(closes, 14);

      // Bollinger Bands (20, 2)
      let bollingerUpper: number | undefined;
      let bollingerMiddle: number | undefined;
      let bollingerLower: number | undefined;
      if (prices.length >= 20) {
        const bb = this.calculateBollingerBands(closes, 20, 2);
        bollingerUpper = bb.upper;
        bollingerMiddle = bb.middle;
        bollingerLower = bb.lower;
      }

      // MACD (12, 26, 9)
      let macdLine: number | undefined;
      let macdSignal: number | undefined;
      let macdHistogram: number | undefined;
      let macdPrevHistogram: number | undefined;
      if (prices.length >= 35) {
        const macd = this.calculateMACD(closes);
        macdLine = macd.line;
        macdSignal = macd.signal;
        macdHistogram = macd.histogram;
        macdPrevHistogram = macd.prevHistogram;
      }

      // ADX (14) + ATR (14)
      let adx14: number | undefined;
      let atr14: number | undefined;
      if (prices.length >= 28) {
        const adxResult = this.calculateADXWithATR(highs, lows, closes, 14);
        adx14 = adxResult.adx;
        atr14 = adxResult.atr;
      }

      // 20일 평균 거래량 및 거래량 비율
      const avgVolume20 = prices.length >= 20 ? this.calculateAvgVolume(volumes, 20) : undefined;
      const volumeRatio = avgVolume20 && avgVolume20 > 0 ? volumes[0] / avgVolume20 : undefined;
      const volatility30d = prices.length >= 31 ? this.calculateVolatility(prices.slice(0, 31)) : undefined;
      const atrPercent = atr14 && currentPrice > 0 ? (atr14 / currentPrice) * 100 : undefined;

      // 전일 OHLC / 당일 시가
      const prevHigh = prices.length >= 2 ? prices[1].high : undefined;
      const prevLow = prices.length >= 2 ? prices[1].low : undefined;
      const prevClose = prices.length >= 2 ? prices[1].close : undefined;
      const todayOpen = prices.length >= 1 ? prices[0].open : undefined;

      const result: StockIndicators = {
        ma200,
        rsi14,
        currentAboveMA200: ma200 ? currentPrice > ma200 : true,
        volatility30d,
        ma20,
        ma60,
        bollingerUpper,
        bollingerMiddle,
        bollingerLower,
        macdLine,
        macdSignal,
        macdHistogram,
        macdPrevHistogram,
        adx14,
        atr14,
        atrPercent,
        avgVolume20,
        volumeRatio,
        prevHigh,
        prevLow,
        prevClose,
        todayOpen,
        technicalRatings: this.calculateTechnicalRatings(prices, { currentPrice }),
      };

      this.setCache(cacheKey, result);
      return result;
    } catch (e) {
      this.logger.error(`Failed to get stock indicators for ${stockCode}: ${e.message}`);
      return { currentAboveMA200: true }; // 에러시 필터 패스
    }
  }

  /** 시장 상황 판단 (참조 지수 200일선 + 금리) */
  async getMarketCondition(exchangeCode: string): Promise<MarketCondition> {
    const cacheKey = `market-condition:${exchangeCode}`;
    const cached = this.getCache<MarketCondition>(cacheKey);
    if (cached) return cached;

    const refIndex = EXCHANGE_REFERENCE_INDEX[exchangeCode];
    if (!refIndex) {
      return {
        referenceIndexAboveMA200: true,
        referenceIndexName: 'Unknown',
        interestRateRising: false,
      };
    }

    let referenceIndexAboveMA200 = true;
    let interestRate: number | undefined;
    let interestRateRising = false;

    try {
      // 지수 200일 데이터 조회
      const indexPrices = await this.fetchIndexDailyPrices(refIndex.type, refIndex.code, 200);
      if (indexPrices.length >= 200) {
        const closes = indexPrices.map((p) => p.close);
        const ma200 = this.calculateMA(closes, 200);
        const currentIndexPrice = closes[0]; // 가장 최근
        referenceIndexAboveMA200 = currentIndexPrice > ma200;
        this.logger.log(
          `${refIndex.name}: current=${currentIndexPrice.toFixed(2)}, MA200=${ma200.toFixed(2)}, above=${referenceIndexAboveMA200}`,
        );
      }
    } catch (e) {
      this.logger.warn(`Failed to get index data for ${refIndex.name}: ${e.message}`);
    }

    const isUsExchange = ['NASD', 'NYSE', 'AMEX'].includes(exchangeCode);

    if (isUsExchange) {
      try {
        const fedFunds = await this.marketDataCache.getFredRateSnapshot('FEDFUNDS');
        if (fedFunds?.currentRate !== undefined) {
          interestRate = fedFunds.currentRate;
          interestRateRising = (fedFunds.change ?? 0) > 0.1;
        }
      } catch (e) {
        this.logger.warn(`Failed to get FRED policy rate: ${e.message}`);
      }
    } else if (!this.isPaper) {
      try {
        const rates = await this.marketDataCache.getKisDomesticInterestRates();
        // US Fed Funds Rate 또는 첫 번째 항목
        const fedRate = rates?.find((r) => r.name.includes('미국')) || rates?.[0];
        if (fedRate) {
          interestRate = fedRate.rate;
          interestRateRising = fedRate.change > 0.1; // 0.1%p 이상 급등
        }
      } catch (e) {
        this.logger.warn(`Failed to get interest rates: ${e.message}`);
      }
    }

    const result: MarketCondition = {
      referenceIndexAboveMA200,
      referenceIndexName: refIndex.name,
      interestRateRising,
      interestRate,
    };

    this.setCache(cacheKey, result);
    return result;
  }

  async getIntradayVwap(
    market: 'DOMESTIC' | 'OVERSEAS',
    exchangeCode: string,
    stockCode: string,
    quote?: StockPriceResult,
  ): Promise<number | undefined> {
    if (market === 'DOMESTIC') {
      const tradingValue = Number(quote?.tradingValue ?? 0);
      const volume = Number(quote?.volume ?? 0);
      return tradingValue > 0 && volume > 0 ? tradingValue / volume : undefined;
    }

    const cacheKey = `intraday-vwap:${market}:${exchangeCode}:${stockCode}:${this.getKstDate()}`;
    const cached = this.getCache<number>(cacheKey);
    if (cached !== null) return cached;

    try {
      const bars = await this.kisOverseas.getIntradayPrices(exchangeCode, stockCode, 5, 120);
      if (bars.length === 0) return undefined;

      const latestDate = bars[0].date;
      const sameDayBars = bars.filter((bar) => bar.date === latestDate && bar.volume > 0);
      if (sameDayBars.length === 0) return undefined;

      const totalAmount = sameDayBars.reduce(
        (sum, bar) => sum + (bar.amount ?? (((bar.high + bar.low + bar.close) / 3) * bar.volume)),
        0,
      );
      const totalVolume = sameDayBars.reduce((sum, bar) => sum + bar.volume, 0);
      if (totalAmount <= 0 || totalVolume <= 0) return undefined;

      const vwap = totalAmount / totalVolume;
      this.setCache(cacheKey, vwap, INTRADAY_VWAP_CACHE_TTL_MS);
      return vwap;
    } catch (e) {
      this.logger.warn(`Failed to get intraday VWAP for ${stockCode}: ${e.message}`);
      return undefined;
    }
  }

  /** 일별 시세 조회 (국내/해외 분기) - public for MarketRegimeService */
  async fetchDailyPrices(
    market: 'DOMESTIC' | 'OVERSEAS',
    exchangeCode: string,
    stockCode: string,
    count: number,
  ): Promise<DailyPrice[]> {
    if (market === 'DOMESTIC') {
      const { startDate, endDate } = this.getDateRange(count);
      return this.kisDomestic.getDailyPrices(stockCode, startDate, endDate);
    } else {
      return this.kisOverseas.getDailyPrices(exchangeCode, stockCode, count);
    }
  }

  /** 지수 일별 시세 조회 (국내지수/해외지수 분기) - public for MarketRegimeService */
  async fetchIndexDailyPrices(
    type: 'domestic' | 'overseas',
    indexCode: string,
    count: number,
  ): Promise<DailyPrice[]> {
    const { startDate, endDate } = this.getDateRange(count);

    if (type === 'domestic') {
      return this.kisDomestic.getIndexDailyPrices(indexCode, startDate, endDate);
    } else {
      return this.kisOverseas.getOverseasIndexDailyPrices(indexCode, startDate, endDate);
    }
  }

  // --- 기술 지표 계산 메서드 ---

  /** 이동평균 계산 */
  calculateMA(prices: number[], period: number): number {
    if (prices.length < period) return 0;
    const sum = prices.slice(0, period).reduce((a, b) => a + b, 0);
    return sum / period;
  }

  applyCurrentQuoteToPrices(
    prices: DailyPrice[],
    quote?: {
      currentPrice?: number;
      openPrice?: number | null;
      highPrice?: number | null;
      lowPrice?: number | null;
      volume?: number | null;
    },
  ): DailyPrice[] {
    if (prices.length === 0 || !quote) return prices;

    const latest = prices[0];
    const mergedOpen = quote.openPrice ?? latest.open;
    const mergedClose = quote.currentPrice ?? latest.close;
    const mergedHighCandidates = [
      latest.high,
      quote.highPrice ?? Number.NEGATIVE_INFINITY,
      mergedOpen,
      mergedClose,
    ].filter(Number.isFinite);
    const mergedLowCandidates = [
      latest.low,
      quote.lowPrice ?? Number.POSITIVE_INFINITY,
      mergedOpen,
      mergedClose,
    ].filter(Number.isFinite);

    return [
      {
        ...latest,
        close: mergedClose,
        open: mergedOpen,
        // Keep the widest known intraday range instead of blindly overwriting.
        high: Math.max(...mergedHighCandidates),
        low: Math.min(...mergedLowCandidates),
        volume: Math.max(latest.volume, quote.volume ?? 0),
      },
      ...prices.slice(1),
    ];
  }

  calculateTechnicalRatings(
    prices: DailyPrice[],
    quote?: {
      currentPrice?: number;
      openPrice?: number | null;
      highPrice?: number | null;
      lowPrice?: number | null;
      volume?: number | null;
    },
  ): TechnicalRatingsSnapshot {
    const mergedPrices = this.applyCurrentQuoteToPrices(prices, quote);
    const closes = mergedPrices.map((item) => item.close);
    const highs = mergedPrices.map((item) => item.high);
    const lows = mergedPrices.map((item) => item.low);
    const volumes = mergedPrices.map((item) => item.volume);
    const currentPrice = quote?.currentPrice ?? closes[0] ?? 0;

    const oscillators: TechnicalIndicatorSnapshot[] = [];
    const movingAverages: TechnicalIndicatorSnapshot[] = [];

    const pushIndicator = (
      target: TechnicalIndicatorSnapshot[],
      key: string,
      label: string,
      value: number | undefined,
      action: TechnicalIndicatorAction,
    ) => {
      if (!Number.isFinite(value)) return;
      target.push({
        key,
        label,
        value,
        action,
      });
    };

    for (const period of MA_PERIODS) {
      const sma = this.calculateMA(closes, period);
      pushIndicator(
        movingAverages,
        `sma${period}`,
        `심플 무빙 애버리지 (${period})`,
        sma || undefined,
        this.compareAverageToPrice(sma, currentPrice),
      );

      const ema = this.calculateEMA(closes, period)[0];
      pushIndicator(
        movingAverages,
        `ema${period}`,
        `익스포넨셜 무빙 애버리지 (${period})`,
        ema,
        this.compareAverageToPrice(ema, currentPrice),
      );
    }

    const hma9 = this.calculateHMA(closes, 9);
    pushIndicator(
      movingAverages,
      'hma9',
      '헐 이동 평균 (9)',
      hma9,
      this.compareAverageToPrice(hma9, currentPrice),
    );

    const vwma20 = this.calculateVWMA(closes, volumes, 20);
    pushIndicator(
      movingAverages,
      'vwma20',
      '볼륨 웨이티드 무빙 애버리지 (20)',
      vwma20,
      this.compareAverageToPrice(vwma20, currentPrice),
    );

    const ichimoku = this.calculateIchimokuSnapshot(mergedPrices);
    pushIndicator(
      movingAverages,
      'ichimoku',
      '일목 기준선 (9, 26, 52, 26)',
      ichimoku?.baseLine,
      !ichimoku
        ? 'NEUTRAL'
        : ichimoku.leadA > ichimoku.leadB
            && ichimoku.baseLine > ichimoku.leadA
            && ichimoku.conversionLine > ichimoku.baseLine
            && currentPrice > ichimoku.conversionLine
          ? 'BUY'
          : ichimoku.leadA < ichimoku.leadB
              && ichimoku.baseLine < ichimoku.leadA
              && ichimoku.conversionLine < ichimoku.baseLine
              && currentPrice < ichimoku.conversionLine
            ? 'SELL'
            : 'NEUTRAL',
    );

    const rsi = this.calculateRSI(closes, 14);
    const prevRsi = this.calculateRSI(closes.slice(1), 14);
    pushIndicator(
      oscillators,
      'rsi14',
      '상대 강도 지수 (14)',
      rsi,
      rsi < 30 && rsi > prevRsi ? 'BUY' : rsi > 70 && rsi < prevRsi ? 'SELL' : 'NEUTRAL',
    );

    const stochastic = this.calculateSlowStochastic(mergedPrices, 14, 3, 3);
    pushIndicator(
      oscillators,
      'stochasticK',
      '스토캐스틱 %K (14, 3, 3)',
      stochastic?.k,
      !stochastic
        ? 'NEUTRAL'
        : stochastic.k < 20 && stochastic.d < 20 && stochastic.k > stochastic.d
          ? 'BUY'
          : stochastic.k > 80 && stochastic.d > 80 && stochastic.k < stochastic.d
            ? 'SELL'
            : 'NEUTRAL',
    );

    const cci = this.calculateCCI(closes, 20);
    const prevCci = this.calculateCCI(closes.slice(1), 20);
    pushIndicator(
      oscillators,
      'cci20',
      '커머디티 채널 인덱스 (20)',
      cci,
      cci < -100 && cci > prevCci ? 'BUY' : cci > 100 && cci < prevCci ? 'SELL' : 'NEUTRAL',
    );

    const adx = this.calculateADXSignalSnapshot(highs, lows, closes, 14);
    pushIndicator(
      oscillators,
      'adx14',
      '애버리지 디렉셔널 인덱스 (14)',
      adx?.adx,
      !adx
        ? 'NEUTRAL'
        : adx.plusDi > adx.minusDi && adx.adx > 20 && adx.adx > adx.prevAdx
          ? 'BUY'
          : adx.plusDi < adx.minusDi && adx.adx > 20 && adx.adx < adx.prevAdx
            ? 'SELL'
            : 'NEUTRAL',
    );

    const ao = this.calculateAwesomeOscillator(mergedPrices);
    pushIndicator(
      oscillators,
      'ao',
      '어썸 오실레이터',
      ao?.current,
      !ao
        ? 'NEUTRAL'
        : (ao.prev <= 0 && ao.current > 0)
            || (ao.current > 0 && ao.prev > 0 && ao.current > ao.prev && ao.prev < ao.prev2)
          ? 'BUY'
          : (ao.prev >= 0 && ao.current < 0)
              || (ao.current < 0 && ao.prev < 0 && ao.current < ao.prev && ao.prev > ao.prev2)
            ? 'SELL'
            : 'NEUTRAL',
    );

    const momentum = this.calculateMomentum(closes, 10);
    const prevMomentum = this.calculateMomentum(closes.slice(1), 10);
    pushIndicator(
      oscillators,
      'momentum10',
      '모멘텀 (10)',
      momentum,
      momentum > prevMomentum ? 'BUY' : momentum < prevMomentum ? 'SELL' : 'NEUTRAL',
    );

    const macd = this.calculateMACD(closes);
    pushIndicator(
      oscillators,
      'macd12269',
      'MACD 레벨 (12, 26)',
      macd.line,
      macd.line > macd.signal ? 'BUY' : macd.line < macd.signal ? 'SELL' : 'NEUTRAL',
    );

    const ema13 = this.calculateEMA(closes, 13)[0];
    const uptrend = Number.isFinite(ema13) && currentPrice > (ema13 ?? 0);
    const downtrend = Number.isFinite(ema13) && currentPrice < (ema13 ?? 0);

    const stochRsi = this.calculateStochasticRsi(closes, 14, 14, 3, 3);
    pushIndicator(
      oscillators,
      'stochRsiFast',
      '스토캐스틱 RSI 패스트 (3, 3, 14, 14)',
      stochRsi?.k,
      !stochRsi
        ? 'NEUTRAL'
        : downtrend && stochRsi.k < 20 && stochRsi.d < 20 && stochRsi.k > stochRsi.d
          ? 'BUY'
          : uptrend && stochRsi.k > 80 && stochRsi.d > 80 && stochRsi.k < stochRsi.d
            ? 'SELL'
            : 'NEUTRAL',
    );

    const williams = this.calculateWilliamsR(mergedPrices, 14);
    const prevWilliams = this.calculateWilliamsR(mergedPrices.slice(1), 14);
    pushIndicator(
      oscillators,
      'williamsR14',
      '윌리엄스 퍼센트 레인지 (14)',
      williams,
      williams < -80 && williams > prevWilliams
        ? 'BUY'
        : williams > -20 && williams < prevWilliams
          ? 'SELL'
          : 'NEUTRAL',
    );

    const bullBear = this.calculateBullBearPower(mergedPrices, 13);
    pushIndicator(
      oscillators,
      'bullBearPower13',
      '불 베어 파워',
      bullBear?.combined,
      !bullBear
        ? 'NEUTRAL'
        : uptrend && bullBear.bearPower < 0 && bullBear.bearPower > bullBear.prevBearPower
          ? 'BUY'
          : downtrend && bullBear.bullPower > 0 && bullBear.bullPower < bullBear.prevBullPower
            ? 'SELL'
            : 'NEUTRAL',
    );

    const uo = this.calculateUltimateOscillator(mergedPrices, 7, 14, 28);
    pushIndicator(
      oscillators,
      'uo71428',
      '얼티미트 오실레이터 (7, 14, 28)',
      uo,
      uo > 70 ? 'BUY' : uo < 30 ? 'SELL' : 'NEUTRAL',
    );

    const oscillatorSummary = this.buildTechnicalRatingGroup(oscillators);
    const movingAverageSummary = this.buildTechnicalRatingGroup(movingAverages);
    const overallSummary = this.buildTechnicalRatingGroup([
      ...oscillators,
      ...movingAverages,
    ]);

    return {
      timeframe: '1D',
      oscillators,
      movingAverages,
      oscillatorSummary,
      movingAverageSummary,
      overallSummary,
    };
  }

  /** RSI 계산 (Wilder's smoothing) */
  calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50; // 데이터 부족시 중립

    // prices[0]이 최신, 역순으로 변동 계산
    const changes: number[] = [];
    for (let i = 0; i < prices.length - 1; i++) {
      changes.push(prices[i] - prices[i + 1]); // 최신→과거 방향
    }

    // 초기 평균 (첫 period개)
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = changes.length - period; i < changes.length; i++) {
      if (changes[i] > 0) avgGain += changes[i];
      else avgLoss += Math.abs(changes[i]);
    }
    avgGain /= period;
    avgLoss /= period;

    // Wilder's smoothing으로 나머지 계산
    for (let i = changes.length - period - 1; i >= 0; i--) {
      if (changes[i] > 0) {
        avgGain = (avgGain * (period - 1) + changes[i]) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.abs(changes[i])) / period;
      }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  /** 지수이동평균(EMA) 계산 - prices[0]이 최신 */
  calculateEMA(prices: number[], period: number): number[] {
    if (prices.length < period) return [];

    // 역순으로 변환 (과거→최신)
    const reversed = [...prices].reverse();
    const multiplier = 2 / (period + 1);
    const ema: number[] = [];

    // 첫 EMA = 초기 SMA
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += reversed[i];
    }
    ema.push(sum / period);

    // 이후 EMA
    for (let i = period; i < reversed.length; i++) {
      const val = (reversed[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1];
      ema.push(val);
    }

    // 다시 역순 (최신이 [0])
    return ema.reverse();
  }

  calculateVWMA(prices: number[], volumes: number[], period: number): number {
    if (prices.length < period || volumes.length < period) return 0;
    let volumeSum = 0;
    let weightedSum = 0;
    for (let index = 0; index < period; index++) {
      const volume = volumes[index] ?? 0;
      volumeSum += volume;
      weightedSum += (prices[index] ?? 0) * volume;
    }
    return volumeSum > 0 ? weightedSum / volumeSum : 0;
  }

  calculateHMA(prices: number[], period: number): number {
    if (prices.length < period) return 0;
    const half = Math.max(1, Math.floor(period / 2));
    const sqrt = Math.max(1, Math.floor(Math.sqrt(period)));
    const halfWma = this.calculateWmaSeries(prices, half);
    const fullWma = this.calculateWmaSeries(prices, period);
    const length = Math.min(halfWma.length, fullWma.length);
    if (length === 0) return 0;

    const rawSeries = Array.from({ length }, (_, index) => 2 * halfWma[index] - fullWma[index]);
    return this.calculateWmaSeries(rawSeries, sqrt)[0] ?? 0;
  }

  /** 볼린저밴드 계산 (period=20, multiplier=2) */
  calculateBollingerBands(
    closes: number[],
    period: number,
    multiplier: number,
  ): { upper: number; middle: number; lower: number } {
    const middle = this.calculateMA(closes, period);
    const slice = closes.slice(0, period);
    const variance = slice.reduce((sum, p) => sum + Math.pow(p - middle, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    return {
      upper: middle + multiplier * stdDev,
      middle,
      lower: middle - multiplier * stdDev,
    };
  }

  /** MACD 계산 (fast=12, slow=26, signal=9) - prices[0]이 최신 */
  calculateMACD(closes: number[]): {
    line: number;
    signal: number;
    histogram: number;
    prevHistogram: number;
  } {
    const ema12 = this.calculateEMA(closes, 12);
    const ema26 = this.calculateEMA(closes, 26);

    if (ema12.length === 0 || ema26.length === 0) {
      return { line: 0, signal: 0, histogram: 0, prevHistogram: 0 };
    }

    // MACD Line = EMA12 - EMA26
    const minLen = Math.min(ema12.length, ema26.length);
    const macdLine: number[] = [];
    for (let i = 0; i < minLen; i++) {
      macdLine.push(ema12[i] - ema26[i]);
    }

    // Signal Line = EMA9 of MACD Line
    const signalLine = this.calculateEMA(macdLine, 9);

    if (signalLine.length < 2) {
      return {
        line: macdLine[0] || 0,
        signal: signalLine[0] || 0,
        histogram: (macdLine[0] || 0) - (signalLine[0] || 0),
        prevHistogram: 0,
      };
    }

    const histogram = macdLine[0] - signalLine[0];
    const prevHistogram = macdLine[1] - signalLine[1];

    return {
      line: macdLine[0],
      signal: signalLine[0],
      histogram,
      prevHistogram,
    };
  }

  /** ADX 계산 (Wilder 방식, period=14) - prices[0]이 최신 */
  calculateADX(highs: number[], lows: number[], closes: number[], period: number): number {
    return this.calculateADXWithATR(highs, lows, closes, period).adx;
  }

  /** 연율화 변동성 계산 (%) */
  calculateVolatility(prices: DailyPrice[]): number {
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

  /** ADX + ATR 동시 계산 (TR 재사용) */
  calculateADXWithATR(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number,
  ): { adx: number; atr: number } {
    if (highs.length < period * 2) return { adx: 0, atr: 0 };

    // 역순으로 (과거→최신)
    const h = [...highs].reverse();
    const l = [...lows].reverse();
    const c = [...closes].reverse();

    const trueRanges: number[] = [];
    const plusDMs: number[] = [];
    const minusDMs: number[] = [];

    for (let i = 1; i < h.length; i++) {
      // True Range
      const tr = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
      trueRanges.push(tr);

      // +DM / -DM
      const upMove = h[i] - h[i - 1];
      const downMove = l[i - 1] - l[i];
      plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }

    if (trueRanges.length < period) return { adx: 0, atr: 0 };

    // 초기 합
    let atrSum = trueRanges.slice(0, period).reduce((a, b) => a + b, 0);
    let plusDMSum = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
    let minusDMSum = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);

    const dxValues: number[] = [];

    // 첫 번째 DX
    const plusDI0 = atrSum > 0 ? (plusDMSum / atrSum) * 100 : 0;
    const minusDI0 = atrSum > 0 ? (minusDMSum / atrSum) * 100 : 0;
    const diSum0 = plusDI0 + minusDI0;
    dxValues.push(diSum0 > 0 ? (Math.abs(plusDI0 - minusDI0) / diSum0) * 100 : 0);

    // Wilder's smoothing
    for (let i = period; i < trueRanges.length; i++) {
      atrSum = atrSum - atrSum / period + trueRanges[i];
      plusDMSum = plusDMSum - plusDMSum / period + plusDMs[i];
      minusDMSum = minusDMSum - minusDMSum / period + minusDMs[i];

      const plusDI = atrSum > 0 ? (plusDMSum / atrSum) * 100 : 0;
      const minusDI = atrSum > 0 ? (minusDMSum / atrSum) * 100 : 0;
      const diSum = plusDI + minusDI;
      dxValues.push(diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0);
    }

    // ATR = Wilder's smoothed ATR (최종 값을 period로 나눔)
    const atr = atrSum / period;

    if (dxValues.length < period) {
      return { adx: dxValues[dxValues.length - 1] || 0, atr };
    }

    // ADX = Wilder's smoothing of DX
    let adx = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < dxValues.length; i++) {
      adx = (adx * (period - 1) + dxValues[i]) / period;
    }

    return { adx, atr };
  }

  /** 평균 거래량 계산 */
  calculateAvgVolume(volumes: number[], period: number): number {
    if (volumes.length < period) return 0;
    const sum = volumes.slice(0, period).reduce((a, b) => a + b, 0);
    return sum / period;
  }

  private compareAverageToPrice(value: number | undefined, price: number): TechnicalIndicatorAction {
    if (!Number.isFinite(value) || !Number.isFinite(price)) return 'NEUTRAL';
    if ((value ?? 0) < price) return 'BUY';
    if ((value ?? 0) > price) return 'SELL';
    return 'NEUTRAL';
  }

  private buildTechnicalRatingGroup(indicators: TechnicalIndicatorSnapshot[]): TechnicalRatingGroupSnapshot {
    const buyCount = indicators.filter((indicator) => indicator.action === 'BUY').length;
    const sellCount = indicators.filter((indicator) => indicator.action === 'SELL').length;
    const neutralCount = indicators.filter((indicator) => indicator.action === 'NEUTRAL').length;
    const score = indicators.length > 0
      ? indicators.reduce((sum, indicator) => sum + (indicator.action === 'BUY' ? 1 : indicator.action === 'SELL' ? -1 : 0), 0) / indicators.length
      : 0;

    return {
      score,
      recommendation: this.scoreToRecommendation(score),
      buyCount,
      neutralCount,
      sellCount,
    };
  }

  private scoreToRecommendation(score: number) {
    if (score > 0.5) return 'STRONG_BUY' as const;
    if (score > 0.1) return 'BUY' as const;
    if (score < -0.5) return 'STRONG_SELL' as const;
    if (score < -0.1) return 'SELL' as const;
    return 'NEUTRAL' as const;
  }

  private calculateWmaSeries(prices: number[], period: number): number[] {
    if (prices.length < period) return [];
    const denominator = (period * (period + 1)) / 2;
    const values: number[] = [];

    for (let start = 0; start <= prices.length - period; start++) {
      let weighted = 0;
      for (let offset = 0; offset < period; offset++) {
        weighted += prices[start + offset] * (period - offset);
      }
      values.push(weighted / denominator);
    }

    return values;
  }

  private calculateCCI(source: number[], period: number): number {
    if (source.length < period) return NaN;
    const values = source.slice(0, period);
    const current = values[0];
    const sma = values.reduce((sum, value) => sum + value, 0) / period;
    const meanDeviation = values.reduce((sum, value) => sum + Math.abs(value - sma), 0) / period;
    if (meanDeviation === 0) return 0;
    return (current - sma) / (0.015 * meanDeviation);
  }

  private calculateSlowStochastic(
    prices: DailyPrice[],
    kPeriod: number,
    smoothK: number,
    dPeriod: number,
  ): { k: number; d: number } | undefined {
    if (prices.length < kPeriod + smoothK + dPeriod - 2) return undefined;

    const fastKs: number[] = [];
    for (let start = 0; start <= prices.length - kPeriod; start++) {
      const window = prices.slice(start, start + kPeriod);
      const highest = Math.max(...window.map((item) => item.high));
      const lowest = Math.min(...window.map((item) => item.low));
      const close = prices[start].close;
      fastKs.push(highest === lowest ? 50 : ((close - lowest) / (highest - lowest)) * 100);
    }

    const slowKs = this.calculateSmaSeries(fastKs, smoothK);
    const ds = this.calculateSmaSeries(slowKs, dPeriod);
    if (slowKs.length === 0 || ds.length === 0) return undefined;
    return { k: slowKs[0], d: ds[0] };
  }

  private calculateSmaSeries(values: number[], period: number): number[] {
    if (values.length < period) return [];
    const result: number[] = [];
    for (let start = 0; start <= values.length - period; start++) {
      const window = values.slice(start, start + period);
      result.push(window.reduce((sum, value) => sum + value, 0) / period);
    }
    return result;
  }

  private calculateADXSignalSnapshot(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number,
  ): { adx: number; prevAdx: number; plusDi: number; minusDi: number } | undefined {
    if (highs.length < period * 2 + 1) return undefined;

    const h = [...highs].reverse();
    const l = [...lows].reverse();
    const c = [...closes].reverse();

    const trueRanges: number[] = [];
    const plusDMs: number[] = [];
    const minusDMs: number[] = [];

    for (let index = 1; index < h.length; index++) {
      const tr = Math.max(h[index] - l[index], Math.abs(h[index] - c[index - 1]), Math.abs(l[index] - c[index - 1]));
      trueRanges.push(tr);

      const upMove = h[index] - h[index - 1];
      const downMove = l[index - 1] - l[index];
      plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }

    if (trueRanges.length < period + 1) return undefined;

    let atrSum = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0);
    let plusDMSum = plusDMs.slice(0, period).reduce((sum, value) => sum + value, 0);
    let minusDMSum = minusDMs.slice(0, period).reduce((sum, value) => sum + value, 0);

    const dxValues: number[] = [];
    const plusDis: number[] = [];
    const minusDis: number[] = [];

    const initialPlusDi = atrSum > 0 ? (plusDMSum / atrSum) * 100 : 0;
    const initialMinusDi = atrSum > 0 ? (minusDMSum / atrSum) * 100 : 0;
    plusDis.push(initialPlusDi);
    minusDis.push(initialMinusDi);
    const initialDiSum = initialPlusDi + initialMinusDi;
    dxValues.push(initialDiSum > 0 ? (Math.abs(initialPlusDi - initialMinusDi) / initialDiSum) * 100 : 0);

    for (let index = period; index < trueRanges.length; index++) {
      atrSum = atrSum - atrSum / period + trueRanges[index];
      plusDMSum = plusDMSum - plusDMSum / period + plusDMs[index];
      minusDMSum = minusDMSum - minusDMSum / period + minusDMs[index];

      const plusDi = atrSum > 0 ? (plusDMSum / atrSum) * 100 : 0;
      const minusDi = atrSum > 0 ? (minusDMSum / atrSum) * 100 : 0;
      plusDis.push(plusDi);
      minusDis.push(minusDi);
      const diSum = plusDi + minusDi;
      dxValues.push(diSum > 0 ? (Math.abs(plusDi - minusDi) / diSum) * 100 : 0);
    }

    if (dxValues.length < period + 1) return undefined;

    const adxSeries: number[] = [];
    let adx = dxValues.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    adxSeries.push(adx);
    for (let index = period; index < dxValues.length; index++) {
      adx = (adx * (period - 1) + dxValues[index]) / period;
      adxSeries.push(adx);
    }

    if (adxSeries.length < 2) return undefined;

    return {
      adx: adxSeries[adxSeries.length - 1],
      prevAdx: adxSeries[adxSeries.length - 2],
      plusDi: plusDis[plusDis.length - 1],
      minusDi: minusDis[minusDis.length - 1],
    };
  }

  private calculateAwesomeOscillator(
    prices: DailyPrice[],
  ): { current: number; prev: number; prev2: number } | undefined {
    if (prices.length < 36) return undefined;
    const medians = prices.map((item) => (item.high + item.low) / 2);
    const aoAt = (offset: number) => this.calculateMA(medians.slice(offset), 5) - this.calculateMA(medians.slice(offset), 34);
    return {
      current: aoAt(0),
      prev: aoAt(1),
      prev2: aoAt(2),
    };
  }

  private calculateMomentum(prices: number[], period: number): number {
    if (prices.length <= period) return NaN;
    return prices[0] - prices[period];
  }

  private calculateStochasticRsi(
    closes: number[],
    rsiPeriod: number,
    stochPeriod: number,
    smoothK: number,
    smoothD: number,
  ): { k: number; d: number } | undefined {
    if (closes.length < rsiPeriod + stochPeriod + smoothK + smoothD) return undefined;

    const rsiSeries: number[] = [];
    for (let start = 0; start <= closes.length - (rsiPeriod + 1); start++) {
      rsiSeries.push(this.calculateRSI(closes.slice(start), rsiPeriod));
    }

    const stochValues: number[] = [];
    for (let start = 0; start <= rsiSeries.length - stochPeriod; start++) {
      const window = rsiSeries.slice(start, start + stochPeriod);
      const highest = Math.max(...window);
      const lowest = Math.min(...window);
      const current = rsiSeries[start];
      stochValues.push(highest === lowest ? 50 : ((current - lowest) / (highest - lowest)) * 100);
    }

    const ks = this.calculateSmaSeries(stochValues, smoothK);
    const ds = this.calculateSmaSeries(ks, smoothD);
    if (ks.length === 0 || ds.length === 0) return undefined;
    return { k: ks[0], d: ds[0] };
  }

  private calculateWilliamsR(prices: DailyPrice[], period: number): number {
    if (prices.length < period) return NaN;
    const window = prices.slice(0, period);
    const highest = Math.max(...window.map((item) => item.high));
    const lowest = Math.min(...window.map((item) => item.low));
    if (highest === lowest) return -50;
    return ((highest - window[0].close) / (highest - lowest)) * -100;
  }

  private calculateBullBearPower(
    prices: DailyPrice[],
    emaPeriod: number,
  ): { bullPower: number; bearPower: number; prevBullPower: number; prevBearPower: number; combined: number } | undefined {
    if (prices.length < emaPeriod + 1) return undefined;
    const closes = prices.map((item) => item.close);
    const emaSeries = this.calculateEMA(closes, emaPeriod);
    if (emaSeries.length < 2) return undefined;

    const bullPower = prices[0].high - emaSeries[0];
    const bearPower = prices[0].low - emaSeries[0];
    const prevBullPower = prices[1].high - emaSeries[1];
    const prevBearPower = prices[1].low - emaSeries[1];

    return {
      bullPower,
      bearPower,
      prevBullPower,
      prevBearPower,
      combined: bullPower + bearPower,
    };
  }

  private calculateUltimateOscillator(prices: DailyPrice[], shortPeriod: number, midPeriod: number, longPeriod: number): number {
    if (prices.length < longPeriod + 1) return NaN;

    const buyingPressure: number[] = [];
    const trueRange: number[] = [];
    for (let index = 0; index < prices.length - 1; index++) {
      const current = prices[index];
      const previousClose = prices[index + 1].close;
      const minLow = Math.min(current.low, previousClose);
      const maxHigh = Math.max(current.high, previousClose);
      buyingPressure.push(current.close - minLow);
      trueRange.push(maxHigh - minLow);
    }

    const avg = (period: number) => {
      const bp = buyingPressure.slice(0, period).reduce((sum, value) => sum + value, 0);
      const tr = trueRange.slice(0, period).reduce((sum, value) => sum + value, 0);
      return tr > 0 ? bp / tr : 0;
    };

    return 100 * ((4 * avg(shortPeriod)) + (2 * avg(midPeriod)) + avg(longPeriod)) / 7;
  }

  private calculateIchimokuSnapshot(
    prices: DailyPrice[],
  ): { conversionLine: number; baseLine: number; leadA: number; leadB: number } | undefined {
    if (prices.length < 52) return undefined;
    const conversionSlice = prices.slice(0, 9);
    const baseSlice = prices.slice(0, 26);
    const spanBSlice = prices.slice(0, 52);

    const conversionLine = (Math.max(...conversionSlice.map((item) => item.high)) + Math.min(...conversionSlice.map((item) => item.low))) / 2;
    const baseLine = (Math.max(...baseSlice.map((item) => item.high)) + Math.min(...baseSlice.map((item) => item.low))) / 2;
    const leadA = (conversionLine + baseLine) / 2;
    const leadB = (Math.max(...spanBSlice.map((item) => item.high)) + Math.min(...spanBSlice.map((item) => item.low))) / 2;

    return {
      conversionLine,
      baseLine,
      leadA,
      leadB,
    };
  }

  /** count 거래일에 대응하는 캘린더 날짜 범위 (여유 포함) */
  private getDateRange(tradingDays: number): { startDate: string; endDate: string } {
    const end = new Date();
    const endDate = end.toISOString().slice(0, 10).replace(/-/g, '');

    // 거래일 × 1.5 (주말/공휴일 감안)
    const calendarDays = Math.ceil(tradingDays * 1.5);
    const start = new Date(end.getTime() - calendarDays * 24 * 60 * 60 * 1000);
    const startDate = start.toISOString().slice(0, 10).replace(/-/g, '');

    return { startDate, endDate };
  }

  private getKstDate(): string {
    return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  getCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  setCache<T>(key: string, data: T, ttlMs?: number): void {
    this.cache.set(key, {
      data,
      expiry: Date.now() + (ttlMs ?? MarketAnalysisService.CACHE_TTL_MS),
    });
  }
}
