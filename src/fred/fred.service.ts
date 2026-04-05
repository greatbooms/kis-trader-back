import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { FredRateSnapshot } from './types';

interface CachedValue<T> {
  data: T;
  expiresAt: number;
}

interface FredObservationsResponse {
  observations?: Array<{
    date?: string;
    value?: string;
  }>;
}

@Injectable()
export class FredService {
  private readonly logger = new Logger(FredService.name);
  private readonly apiKey: string;
  private readonly rateCache = new Map<string, CachedValue<FredRateSnapshot | undefined>>();
  private lastRequestAt = 0;
  private static readonly REQUEST_INTERVAL_MS = 120;
  private static readonly CACHE_MS = 6 * 60 * 60 * 1000;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('fred.apiKey') || '';
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async getLatestRateSnapshot(seriesId: string): Promise<FredRateSnapshot | undefined> {
    if (!this.isConfigured()) return undefined;

    const cached = this.rateCache.get(seriesId);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    try {
      const waitMs = Math.max(0, FredService.REQUEST_INTERVAL_MS - (Date.now() - this.lastRequestAt));
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      this.lastRequestAt = Date.now();

      const response = await axios.get<FredObservationsResponse>('https://api.stlouisfed.org/fred/series/observations', {
        timeout: 15000,
        params: {
          api_key: this.apiKey,
          file_type: 'json',
          series_id: seriesId,
          sort_order: 'desc',
          limit: 2,
        },
      });

      const values = (response.data.observations ?? [])
        .map((item) => ({
          date: item.date,
          value: item.value === '.' || item.value === undefined ? undefined : Number(item.value),
        }))
        .filter((item) => item.value !== undefined && Number.isFinite(item.value));

      const snapshot: FredRateSnapshot | undefined = values[0]
        ? {
          currentRate: values[0].value,
          previousRate: values[1]?.value,
          change: values[1]?.value !== undefined ? values[0].value! - values[1].value : undefined,
          observedAt: values[0].date,
        }
        : undefined;

      this.rateCache.set(seriesId, { data: snapshot, expiresAt: Date.now() + FredService.CACHE_MS });
      return snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`FRED fetch failed for ${seriesId}: ${message}`);
      this.rateCache.set(seriesId, { data: undefined, expiresAt: Date.now() + 30 * 60 * 1000 });
      return undefined;
    }
  }
}
