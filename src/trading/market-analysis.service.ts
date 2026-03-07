import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { DailyPrice } from '../kis/types/kis-api.types';
import { EXCHANGE_REFERENCE_INDEX } from '../kis/types/kis-config.types';
import { MarketCondition, StockIndicators } from './types';

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

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
      const prices = await this.fetchDailyPrices(market, exchangeCode, stockCode, 200);
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

      // 전일 OHLC / 당일 시가
      const prevHigh = prices.length >= 2 ? prices[1].high : undefined;
      const prevLow = prices.length >= 2 ? prices[1].low : undefined;
      const prevClose = prices.length >= 2 ? prices[1].close : undefined;
      const todayOpen = prices.length >= 1 ? prices[0].open : undefined;

      const result: StockIndicators = {
        ma200,
        rsi14,
        currentAboveMA200: ma200 ? currentPrice > ma200 : true,
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
        avgVolume20,
        volumeRatio,
        prevHigh,
        prevLow,
        prevClose,
        todayOpen,
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

    // 금리 조회 (실전 모드만)
    if (!this.isPaper) {
      try {
        const rates = await this.kisDomestic.getInterestRates();
        // US Fed Funds Rate 또는 첫 번째 항목
        const fedRate = rates.find((r) => r.name.includes('미국')) || rates[0];
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
