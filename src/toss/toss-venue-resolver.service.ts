import { Injectable, Logger } from '@nestjs/common';
import { TossBaseService } from './toss-base.service';
import type { TossApiResponse, TossStockInfo, TossStockMarket } from './types';

const MAX_STOCKS_PER_REQUEST = 200;

@Injectable()
export class TossVenueResolverService {
  private readonly logger = new Logger(TossVenueResolverService.name);
  private readonly venueBySymbol = new Map<string, string>();
  private readonly inFlightByBatch = new Map<string, Promise<void>>();

  constructor(private readonly base: TossBaseService) {}

  async resolveVenues(symbols: string[]): Promise<Map<string, string>> {
    const normalized = Array.from(new Set(
      symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean),
    ));
    const missing = normalized
      .filter((symbol) => !this.venueBySymbol.has(symbol))
      .sort();

    for (let offset = 0; offset < missing.length; offset += MAX_STOCKS_PER_REQUEST) {
      const batch = missing.slice(offset, offset + MAX_STOCKS_PER_REQUEST);
      const key = batch.join(',');
      let inFlight = this.inFlightByBatch.get(key);
      if (!inFlight) {
        inFlight = this.resolveBatch(key, batch);
        this.inFlightByBatch.set(key, inFlight);
      }
      await inFlight;
    }

    return new Map(normalized.map((symbol) => [
      symbol,
      this.venueBySymbol.get(symbol) ?? 'US',
    ]));
  }

  private async resolveBatch(key: string, symbols: string[]): Promise<void> {
    try {
      await this.fetchBatch(symbols);
    } finally {
      this.inFlightByBatch.delete(key);
    }
  }

  private async fetchBatch(symbols: string[]): Promise<void> {
    let response: TossApiResponse<TossStockInfo[]>;
    try {
      response = await this.base.request<TossApiResponse<TossStockInfo[]>>('STOCK', {
        method: 'GET',
        path: '/api/v1/stocks',
        query: { symbols: symbols.join(',') },
      });
    } catch {
      for (const symbol of symbols) {
        this.logger.warn(`[TOSS ${symbol}] venue resolution failed; using US fallback`);
      }
      return;
    }

    const stockBySymbol = new Map<string, TossStockInfo>();
    for (const stock of Array.isArray(response?.result) ? response.result : []) {
      const symbol = typeof stock?.symbol === 'string'
        ? stock.symbol.trim().toUpperCase()
        : '';
      if (symbol) stockBySymbol.set(symbol, stock);
    }
    for (const symbol of symbols) {
      const venue = this.mapVenue(stockBySymbol.get(symbol)?.market);
      if (!venue) {
        this.logger.warn(`[TOSS ${symbol}] venue unavailable; using US fallback`);
        this.venueBySymbol.set(symbol, 'US');
        continue;
      }
      this.venueBySymbol.set(symbol, venue);
    }
  }

  private mapVenue(market?: TossStockMarket): string | undefined {
    if (market === 'NASDAQ') return 'NASD';
    if (market === 'NYSE' || market === 'AMEX') return market;
    return undefined;
  }
}
