import { ConfigService } from '@nestjs/config';
import { SecService } from './sec.service';

describe('SecService', () => {
  it('should derive annual fundamentals and filing metadata from SEC payloads', () => {
    const service = new SecService({
      get: jest.fn((key: string) => key === 'sec.userAgent' ? 'kis-trader-test admin@example.com' : undefined),
    } as unknown as ConfigService);

    const companyFacts = {
      facts: {
        'us-gaap': {
          Revenues: {
            units: {
              USD: [
                { val: 1200, form: '10-K', filed: '2026-02-20', end: '2025-12-31' },
                { val: 1000, form: '10-K', filed: '2025-02-20', end: '2024-12-31' },
              ],
            },
          },
          OperatingIncomeLoss: {
            units: {
              USD: [
                { val: 180, form: '10-K', filed: '2026-02-20', end: '2025-12-31' },
                { val: 120, form: '10-K', filed: '2025-02-20', end: '2024-12-31' },
              ],
            },
          },
          NetIncomeLoss: {
            units: {
              USD: [
                { val: 96, form: '10-K', filed: '2026-02-20', end: '2025-12-31' },
              ],
            },
          },
          GrossProfit: {
            units: {
              USD: [
                { val: 600, form: '10-K', filed: '2026-02-20', end: '2025-12-31' },
              ],
            },
          },
          EarningsPerShareDiluted: {
            units: {
              'USD/shares': [
                { val: 3.0, form: '10-K', filed: '2026-02-20', end: '2025-12-31' },
                { val: 2.0, form: '10-K', filed: '2025-02-20', end: '2024-12-31' },
              ],
            },
          },
          Assets: {
            units: {
              USD: [
                { val: 2100, form: '10-K', filed: '2026-02-20', end: '2025-12-31' },
                { val: 1800, form: '10-K', filed: '2025-02-20', end: '2024-12-31' },
              ],
            },
          },
          Liabilities: {
            units: {
              USD: [
                { val: 900, form: '10-K', filed: '2026-02-20', end: '2025-12-31' },
              ],
            },
          },
          StockholdersEquity: {
            units: {
              USD: [
                { val: 1200, form: '10-K', filed: '2026-02-20', end: '2025-12-31' },
                { val: 1000, form: '10-K', filed: '2025-02-20', end: '2024-12-31' },
              ],
            },
          },
          AssetsCurrent: {
            units: {
              USD: [
                { val: 800, form: '10-K', filed: '2026-02-20', end: '2025-12-31' },
              ],
            },
          },
          LiabilitiesCurrent: {
            units: {
              USD: [
                { val: 400, form: '10-K', filed: '2026-02-20', end: '2025-12-31' },
              ],
            },
          },
          CommonStockDividendsPerShareDeclared: {
            units: {
              'USD/shares': [
                { val: 1.2, form: '10-K', filed: '2026-02-20', end: '2025-12-31' },
              ],
            },
          },
        },
      },
    };

    const submissions = {
      filings: {
        recent: {
          form: ['10-K', '8-K', '8-K'],
          filingDate: ['2026-02-20', '2026-03-15', '2026-03-20'],
        },
      },
    };

    const fundamentals = (service as any).buildFundamentalsFromFacts(companyFacts, submissions, 60);

    expect(fundamentals.revenueGrowthRate).toBeCloseTo(20);
    expect(fundamentals.operatingProfitGrowthRate).toBeCloseTo(50);
    expect(fundamentals.epsGrowthRate).toBeCloseTo(50);
    expect(fundamentals.operatingMargin).toBeCloseTo(15);
    expect(fundamentals.netMargin).toBeCloseTo(8);
    expect(fundamentals.grossMargin).toBeCloseTo(50);
    expect(fundamentals.debtRatio).toBeCloseTo(75);
    expect(fundamentals.currentRatio).toBeCloseTo(200);
    expect(fundamentals.totalAssetGrowthRate).toBeCloseTo(16.6667, 3);
    expect(fundamentals.equityGrowthRate).toBeCloseTo(20);
    expect(fundamentals.dividendYield).toBeCloseTo(2);
    expect(fundamentals.payoutRatio).toBeCloseTo(40);
    expect(fundamentals.latestFilingForm).toBe('10-K');
    expect(fundamentals.recentForm8KCount30d).toBeDefined();
  });
});
