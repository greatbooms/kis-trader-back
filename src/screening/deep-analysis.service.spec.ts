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
});
