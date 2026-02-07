import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { DailyPrice } from '../kis/types/kis-api.types';
import { EXCHANGE_REFERENCE_INDEX } from '../kis/types/kis-config.types';
import { MarketCondition, StockIndicators } from './strategy/strategy.interface';

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

  /** 종목별 기술 지표 (MA200, RSI14) */
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
      const ma200 = prices.length >= 200 ? this.calculateMA(closes, 200) : undefined;
      const rsi14 = this.calculateRSI(closes, 14);

      const result: StockIndicators = {
        ma200,
        rsi14,
        currentAboveMA200: ma200 ? currentPrice > ma200 : true,
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

  /** 일별 시세 조회 (국내/해외 분기) */
  private async fetchDailyPrices(
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

  /** 지수 일별 시세 조회 (국내지수/해외지수 분기) */
  private async fetchIndexDailyPrices(
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

  /** 이동평균 계산 */
  private calculateMA(prices: number[], period: number): number {
    if (prices.length < period) return 0;
    const sum = prices.slice(0, period).reduce((a, b) => a + b, 0);
    return sum / period;
  }

  /** RSI 계산 (Wilder's smoothing) */
  private calculateRSI(prices: number[], period: number): number {
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

  private getCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      expiry: Date.now() + MarketAnalysisService.CACHE_TTL_MS,
    });
  }
}
