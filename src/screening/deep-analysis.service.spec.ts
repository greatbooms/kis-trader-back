import { DeepAnalysisService } from './deep-analysis.service';

describe('DeepAnalysisService SEC DCF', () => {
  function createService() {
    return new DeepAnalysisService(
      {
        getInterestRates: jest.fn().mockResolvedValue([{ rate: 3.0 }]),
      } as any,
      {} as any,
      {} as any,
      {} as any,
    );
  }

  it('calculates DCF from SEC fundamentals for US stocks', async () => {
    const service = createService();

    const result = await service.calculateSecDcfValuation(
      'NASD',
      [],
      {
        currentPrice: 100,
        listedShares: 10_000_000,
      } as any,
      {
        latestRevenue: 1_000_000_000,
        revenueGrowthRate: 12,
        operatingMargin: 18,
      },
      1.1,
    );

    expect(result).toBeDefined();
    expect(result?.intrinsicValue).toBeGreaterThan(0);
    expect(result?.projectedOperatingMargin).toBeCloseTo(18);
    expect(result?.marginOfSafety).toBeGreaterThan(-100);
  });

  it('returns undefined when SEC revenue is unavailable', async () => {
    const service = createService();

    const result = await service.calculateSecDcfValuation(
      'NASD',
      [],
      {
        currentPrice: 100,
        listedShares: 10_000_000,
      } as any,
      {
        revenueGrowthRate: 12,
        operatingMargin: 18,
      },
      1.1,
    );

    expect(result).toBeUndefined();
  });

  it('refreshes SEC fundamentals when cached data is missing revenue', async () => {
    const getSecFundamentals = jest
      .fn()
      .mockResolvedValueOnce({
        revenueGrowthRate: 10,
        operatingMargin: 15,
      })
      .mockResolvedValueOnce({
        latestRevenue: 1_500_000_000,
        revenueGrowthRate: 10,
        operatingMargin: 15,
      });

    const service = new DeepAnalysisService(
      {
        getInterestRates: jest.fn().mockResolvedValue([{ rate: 3.0 }]),
      } as any,
      {
        getPrice: jest.fn().mockResolvedValue({
          currentPrice: 100,
          listedShares: 10_000_000,
          stockName: 'Test',
        }),
        getDailyPrices: jest.fn().mockResolvedValue([]),
      } as any,
      {} as any,
      {
        getSecFundamentals,
      } as any,
    );
    jest.spyOn(service as any, 'delay').mockResolvedValue(undefined);

    const analysis = await service.analyzeStock('TEST', 'NASD', 'OVERSEAS');

    expect(getSecFundamentals).toHaveBeenNthCalledWith(1, 'TEST', 100, 'NASD');
    expect(getSecFundamentals).toHaveBeenNthCalledWith(2, 'TEST', 100, 'NASD', true);
    expect(analysis.dcfValuation).toBeDefined();
    expect(analysis.dcfValuation?.intrinsicValue).toBeGreaterThan(0);
  });
});
