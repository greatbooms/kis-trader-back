import { TossBaseService } from './toss-base.service';
import { TossVenueResolverService } from './toss-venue-resolver.service';
import type { TossStockInfo, TossStockMarket } from './types';

describe('TossVenueResolverService', () => {
  let base: { request: jest.Mock };
  let service: TossVenueResolverService;

  beforeEach(() => {
    jest.resetAllMocks();
    base = { request: jest.fn() };
    service = new TossVenueResolverService(base as unknown as TossBaseService);
  });

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

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
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

  it('does not cache non-canonical venue results', async () => {
    base.request
      .mockResolvedValueOnce({ result: [stock('OTCM', 'US_ETC')] })
      .mockResolvedValueOnce({ result: [stock('OTCM', 'NASDAQ')] });

    await expect(service.resolveVenues(['OTCM'])).resolves.toEqual(new Map());
    await expect(service.resolveVenues(['OTCM'])).resolves.toEqual(new Map([['OTCM', 'NASD']]));
    expect(base.request).toHaveBeenCalledTimes(2);
  });

  it('coalesces overlapping symbols when the smaller batch completes first without downgrading cache', async () => {
    const requests = new Map<string, ReturnType<typeof deferred<unknown>>>();
    base.request.mockImplementation((_group, options) => {
      const request = deferred<unknown>();
      requests.set(options.query.symbols, request);
      return request.promise;
    });

    const smaller = service.resolveVenues(['AAPL']);
    const overlapping = service.resolveVenues(['AAPL', 'IBM']);

    expect(base.request).toHaveBeenCalledTimes(2);
    expect(Array.from(requests.keys())).toEqual(['AAPL', 'IBM']);
    requests.get('AAPL')?.resolve({ result: [stock('AAPL', 'NASDAQ')] });
    await expect(smaller).resolves.toEqual(new Map([['AAPL', 'NASD']]));
    requests.get('IBM')?.resolve({ result: [stock('AAPL', 'US_ETC'), { market: 'NYSE' }] });
    await expect(overlapping).resolves.toEqual(new Map([['AAPL', 'NASD']]));

    await expect(service.resolveVenues(['AAPL'])).resolves.toEqual(new Map([['AAPL', 'NASD']]));
    expect(base.request).toHaveBeenCalledTimes(2);
  });

  it('coalesces overlapping symbols when the larger request completes first without accepting extra symbols', async () => {
    const requests = new Map<string, ReturnType<typeof deferred<unknown>>>();
    base.request.mockImplementation((_group, options) => {
      const request = deferred<unknown>();
      requests.set(options.query.symbols, request);
      return request.promise;
    });

    const smaller = service.resolveVenues(['AAPL']);
    const overlapping = service.resolveVenues(['AAPL', 'IBM']);

    requests.get('IBM')?.resolve({
      result: [stock('IBM', 'NYSE'), stock('AAPL', 'AMEX')],
    });
    requests.get('AAPL')?.resolve({ result: [stock('AAPL', 'NASDAQ')] });

    await expect(smaller).resolves.toEqual(new Map([['AAPL', 'NASD']]));
    await expect(overlapping).resolves.toEqual(new Map([
      ['AAPL', 'NASD'],
      ['IBM', 'NYSE'],
    ]));
    expect(base.request).toHaveBeenCalledTimes(2);
    expect(Array.from(requests.keys())).toEqual(['AAPL', 'IBM']);
  });

  it('retries symbols omitted from a partial 200 response', async () => {
    base.request
      .mockResolvedValueOnce({ result: [stock('AAPL', 'NASDAQ')] })
      .mockResolvedValueOnce({ result: [stock('IBM', 'NYSE')] });

    await expect(service.resolveVenues(['AAPL', 'IBM'])).resolves.toEqual(
      new Map([['AAPL', 'NASD']]),
    );
    await expect(service.resolveVenues(['IBM'])).resolves.toEqual(new Map([['IBM', 'NYSE']]));
    expect(base.request).toHaveBeenNthCalledWith(2, 'STOCK', expect.objectContaining({
      query: { symbols: 'IBM' },
    }));
  });

  it('leaves a failed lookup unresolved so a later call retries it', async () => {
    base.request
      .mockRejectedValueOnce(new Error('stock metadata unavailable'))
      .mockResolvedValueOnce({ result: [stock('AAPL', 'NASDAQ')] });

    await expect(service.resolveVenues(['AAPL'])).resolves.toEqual(new Map());
    await expect(service.resolveVenues(['AAPL'])).resolves.toEqual(new Map([['AAPL', 'NASD']]));
    expect(base.request).toHaveBeenCalledTimes(2);
  });
});
