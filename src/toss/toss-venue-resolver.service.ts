import { Injectable } from '@nestjs/common';
import { TossBaseService } from './toss-base.service';
import type {
  TossApiResponse,
  TossCanonicalVenue,
  TossStockInfo,
  TossStockMarket,
} from './types';

const MAX_STOCKS_PER_REQUEST = 200;

@Injectable()
export class TossVenueResolverService {
  private readonly venueBySymbol = new Map<string, TossCanonicalVenue>();
  private readonly inFlightBySymbol = new Map<string, Promise<void>>();

  constructor(private readonly base: TossBaseService) {}

  async resolveVenues(symbols: string[]): Promise<Map<string, TossCanonicalVenue>> {
    const normalized = Array.from(new Set(
      symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean),
    ));
    const missing = normalized
      .filter((symbol) => (
        !this.venueBySymbol.has(symbol) && !this.inFlightBySymbol.has(symbol)
      ))
      .sort();

    for (let offset = 0; offset < missing.length; offset += MAX_STOCKS_PER_REQUEST) {
      const batch = missing.slice(offset, offset + MAX_STOCKS_PER_REQUEST);
      const inFlight = this.resolveBatch(batch);
      for (const symbol of batch) this.inFlightBySymbol.set(symbol, inFlight);
    }

    await Promise.all(Array.from(new Set(
      normalized.map((symbol) => this.inFlightBySymbol.get(symbol)).filter(Boolean),
    )));

    const resolved = new Map<string, TossCanonicalVenue>();
    for (const symbol of normalized) {
      const venue = this.venueBySymbol.get(symbol);
      if (venue) resolved.set(symbol, venue);
    }
    return resolved;
  }

  private async resolveBatch(symbols: string[]): Promise<void> {
    try {
      await this.fetchBatch(symbols);
    } finally {
      for (const symbol of symbols) this.inFlightBySymbol.delete(symbol);
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
      return;
    }

    const requested = new Set(symbols);
    for (const stock of Array.isArray(response?.result) ? response.result : []) {
      const symbol = typeof stock?.symbol === 'string'
        ? stock.symbol.trim().toUpperCase()
        : '';
      const venue = this.mapVenue(stock?.market);
      if (requested.has(symbol) && venue && !this.venueBySymbol.has(symbol)) {
        this.venueBySymbol.set(symbol, venue);
      }
    }
  }

  private mapVenue(market?: TossStockMarket): TossCanonicalVenue | undefined {
    if (market === 'NASDAQ') return 'NASD';
    if (market === 'NYSE') return 'NYSE';
    if (market === 'AMEX') return 'AMEX';
    return undefined;
  }
}
