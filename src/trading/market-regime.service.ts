import { Injectable, Logger } from '@nestjs/common';
import { MarketAnalysisService } from './market-analysis.service';
import { EXCHANGE_REFERENCE_INDEX } from '../kis/types/kis-config.types';
import { MarketRegimeLabel } from './types';

interface RegimeCacheEntry {
  regime: MarketRegimeLabel;
  expiry: number;
}

@Injectable()
export class MarketRegimeService {
  private readonly logger = new Logger(MarketRegimeService.name);
  private readonly cache = new Map<string, RegimeCacheEntry>();
  private static readonly CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h

  constructor(
    private marketAnalysis: MarketAnalysisService,
  ) {}

  /** 시장 상태 판별 (캐시 우선) */
  async getRegime(
    market: 'DOMESTIC' | 'OVERSEAS',
    exchangeCode: string,
  ): Promise<MarketRegimeLabel> {
    const cacheKey = `regime:${market}:${exchangeCode}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) {
      return cached.regime;
    }

    const regime = await this.detectRegime(market, exchangeCode);

    this.cache.set(cacheKey, {
      regime,
      expiry: Date.now() + MarketRegimeService.CACHE_TTL_MS,
    });

    return regime;
  }

  /** 시장 상태 판별 및 DB 스냅샷 저장 */
  async detectAndSave(
    market: 'DOMESTIC' | 'OVERSEAS',
    exchangeCode: string,
  ): Promise<MarketRegimeLabel> {
    const regime = await this.detectRegime(market, exchangeCode);

    // 캐시 갱신
    const cacheKey = `regime:${market}:${exchangeCode}`;
    this.cache.set(cacheKey, {
      regime,
      expiry: Date.now() + MarketRegimeService.CACHE_TTL_MS,
    });

    return regime;
  }

  private async detectRegime(
    market: 'DOMESTIC' | 'OVERSEAS',
    exchangeCode: string,
  ): Promise<MarketRegimeLabel> {
    const refIndex = EXCHANGE_REFERENCE_INDEX[exchangeCode];
    if (!refIndex) {
      this.logger.warn(`No reference index for ${exchangeCode}, defaulting to SIDEWAYS`);
      return 'SIDEWAYS';
    }

    try {
      const prices = await this.marketAnalysis.fetchIndexDailyPrices(
        refIndex.type,
        refIndex.code,
        200,
      );

      if (prices.length < 60) {
        this.logger.warn(`Insufficient index data for ${refIndex.name}: ${prices.length} days`);
        return 'SIDEWAYS';
      }

      const closes = prices.map((p) => p.close);
      const highs = prices.map((p) => p.high);
      const lows = prices.map((p) => p.low);

      const ma20 = this.marketAnalysis.calculateMA(closes, 20);
      const ma60 = this.marketAnalysis.calculateMA(closes, 60);
      const adx = this.marketAnalysis.calculateADX(highs, lows, closes, 14);
      const indexPrice = closes[0];

      // 판별 규칙
      let regime: MarketRegimeLabel;
      if (adx > 25 && ma20 > ma60 && indexPrice > ma60) {
        regime = 'TRENDING_UP';
      } else if (adx > 25 && ma20 < ma60 && indexPrice < ma60) {
        regime = 'TRENDING_DOWN';
      } else {
        regime = 'SIDEWAYS';
      }

      this.logger.log(
        `Market regime [${refIndex.name}]: ${regime} (ADX=${adx.toFixed(1)}, MA20=${ma20.toFixed(2)}, MA60=${ma60.toFixed(2)}, price=${indexPrice.toFixed(2)})`,
      );

      return regime;
    } catch (e) {
      this.logger.error(`Failed to detect market regime for ${exchangeCode}: ${e.message}`);
      return 'SIDEWAYS';
    }
  }
}
