import { Logger } from '@nestjs/common';
import { TossBaseService } from './toss-base.service';
import { TossVenueResolverService } from './toss-venue-resolver.service';
import type { TossStockInfo, TossStockMarket } from './types';

describe('TossVenueResolverService', () => {
  let base: { request: jest.Mock };
  let service: TossVenueResolverService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    base = { request: jest.fn() };
    service = new TossVenueResolverService(base as unknown as TossBaseService);
  });

  afterEach(() => jest.restoreAllMocks());

  function stock(symbol: string, market: TossStockMarket): TossStockInfo {
    return {
      symbol,
      name: symbol,
      englishName: symbol,
      isinCode: `ISIN-${symbol}`,
      market,
      securityType: 'STOCK',
      isCommonShare: true,
      status: 'ACTIVE',
      currency: 'USD',
      sharesOutstanding: '1000000',
    };
  }

  it.each([
    ['NASDAQ', 'NASD'],
    ['NYSE', 'NYSE'],
    ['AMEX', 'AMEX'],
  ] as const)('maps Toss %s stock metadata to the canonical %s venue', async (market, venue) => {
    base.request.mockResolvedValue({ result: [stock('AAPL', market)] });

    await expect(service.resolveVenues(['AAPL'])).resolves.toEqual(new Map([['AAPL', venue]]));
    expect(base.request).toHaveBeenCalledWith('STOCK', {
      method: 'GET',
      path: '/api/v1/stocks',
      query: { symbols: 'AAPL' },
    });
  });

  it('warns and falls back to US for US_ETC', async () => {
    base.request.mockResolvedValue({ result: [stock('OTCM', 'US_ETC')] });

    await expect(service.resolveVenues(['OTCM'])).resolves.toEqual(new Map([['OTCM', 'US']]));
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[TOSS OTCM\]/));
  });

  it('warns and falls back to US when stock metadata resolution fails', async () => {
    base.request.mockRejectedValue(new Error('stock metadata unavailable'));

    await expect(service.resolveVenues(['AAPL'])).resolves.toEqual(new Map([['AAPL', 'US']]));
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[TOSS AAPL\]/));
  });

  it('warns and falls back to US for malformed stock metadata without failing the listing', async () => {
    base.request.mockResolvedValue({ result: [{ market: 'NASDAQ' }] });

    await expect(service.resolveVenues(['AAPL'])).resolves.toEqual(new Map([['AAPL', 'US']]));
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[TOSS AAPL\]/));
  });

  it('batches symbols, shares the in-flight batch, and caches it for later listings', async () => {
    let resolveRequest!: (value: unknown) => void;
    base.request.mockReturnValue(new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    const first = service.resolveVenues(['IBM', 'AAPL']);
    const concurrent = service.resolveVenues(['AAPL', 'IBM']);
    await Promise.resolve();

    expect(base.request).toHaveBeenCalledTimes(1);
    resolveRequest({ result: [stock('AAPL', 'NASDAQ'), stock('IBM', 'NYSE')] });
    await expect(Promise.all([first, concurrent])).resolves.toEqual([
      new Map([['IBM', 'NYSE'], ['AAPL', 'NASD']]),
      new Map([['AAPL', 'NASD'], ['IBM', 'NYSE']]),
    ]);

    await expect(service.resolveVenues(['AAPL', 'IBM'])).resolves.toEqual(
      new Map([['AAPL', 'NASD'], ['IBM', 'NYSE']]),
    );
    expect(base.request).toHaveBeenCalledTimes(1);
    expect(base.request).toHaveBeenCalledWith('STOCK', expect.objectContaining({
      query: { symbols: 'AAPL,IBM' },
    }));
  });
});
