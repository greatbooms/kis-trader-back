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
    expect(fundamentals.latestPeriodicFilingForm).toBe('10-K');
    expect(fundamentals.recentForm8KCount30d).toBeDefined();
  });

  it('should prefer the most recent annual revenue concept and align margins to the same period', () => {
    const service = new SecService({
      get: jest.fn((key: string) => key === 'sec.userAgent' ? 'kis-trader-test admin@example.com' : undefined),
    } as unknown as ConfigService);

    const companyFacts = {
      facts: {
        'us-gaap': {
          RevenueFromContractWithCustomerExcludingAssessedTax: {
            units: {
              USD: [
                { val: 26914, form: '10-K', filed: '2022-03-18', end: '2022-01-30' },
              ],
            },
          },
          Revenues: {
            units: {
              USD: [
                { val: 215938, form: '10-K', filed: '2026-02-25', end: '2026-01-25' },
                { val: 130497, form: '10-K', filed: '2025-02-26', end: '2025-01-26' },
              ],
            },
          },
          OperatingIncomeLoss: {
            units: {
              USD: [
                { val: 130387, form: '10-K', filed: '2026-02-25', end: '2026-01-25' },
                { val: 81453, form: '10-K', filed: '2025-02-26', end: '2025-01-26' },
              ],
            },
          },
          NetIncomeLoss: {
            units: {
              USD: [
                { val: 120067, form: '10-K', filed: '2026-02-25', end: '2026-01-25' },
              ],
            },
          },
          GrossProfit: {
            units: {
              USD: [
                { val: 153463, form: '10-K', filed: '2026-02-25', end: '2026-01-25' },
              ],
            },
          },
          EarningsPerShareDiluted: {
            units: {
              'USD/shares': [
                { val: 4.9, form: '10-K', filed: '2026-02-25', end: '2026-01-25' },
                { val: 2.94, form: '10-K', filed: '2025-02-26', end: '2025-01-26' },
              ],
            },
          },
          Assets: {
            units: {
              USD: [
                { val: 206803, form: '10-K', filed: '2026-02-25', end: '2026-01-25' },
                { val: 111601, form: '10-K', filed: '2025-02-26', end: '2025-01-26' },
              ],
            },
          },
          Liabilities: {
            units: {
              USD: [
                { val: 49510, form: '10-K', filed: '2026-02-25', end: '2026-01-25' },
              ],
            },
          },
          StockholdersEquity: {
            units: {
              USD: [
                { val: 157293, form: '10-K', filed: '2026-02-25', end: '2026-01-25' },
                { val: 79327, form: '10-K', filed: '2025-02-26', end: '2025-01-26' },
              ],
            },
          },
          AssetsCurrent: {
            units: {
              USD: [
                { val: 125605, form: '10-K', filed: '2026-02-25', end: '2026-01-25' },
              ],
            },
          },
          LiabilitiesCurrent: {
            units: {
              USD: [
                { val: 32163, form: '10-K', filed: '2026-02-25', end: '2026-01-25' },
              ],
            },
          },
          CommonStockDividendsPerShareDeclared: {
            units: {
              'USD/shares': [
                { val: 0.04, form: '10-K', filed: '2026-02-25', end: '2026-01-25' },
              ],
            },
          },
        },
      },
    };

    const fundamentals = (service as any).buildFundamentalsFromFacts(companyFacts, undefined, 177);

    expect(fundamentals.revenueGrowthRate).toBeCloseTo(65.48, 1);
    expect(fundamentals.operatingMargin).toBeCloseTo(60.38, 1);
    expect(fundamentals.netMargin).toBeCloseTo(55.60, 1);
    expect(fundamentals.grossMargin).toBeCloseTo(71.07, 1);
    expect(fundamentals.dividendYield).toBeCloseTo(0.0226, 3);
  });

  it('should keep the latest filing separate from the latest periodic filing', () => {
    const service = new SecService({
      get: jest.fn((key: string) => key === 'sec.userAgent' ? 'kis-trader-test admin@example.com' : undefined),
    } as unknown as ConfigService);

    const submissions = {
      filings: {
        recent: {
          form: ['4', '8-K', '10-Q', '10-K'],
          filingDate: ['2026-04-03', '2026-04-02', '2026-03-19', '2025-10-03'],
        },
      },
    };

    const filingMeta = (service as any).buildFilingMeta(submissions);

    expect(filingMeta.latestFilingForm).toBe('4');
    expect(filingMeta.latestFilingDate).toBe('2026-04-03');
    expect(filingMeta.latestPeriodicFilingForm).toBe('10-Q');
    expect(filingMeta.latestPeriodicFilingDate).toBe('2026-03-19');
    expect(filingMeta.secPeriodicReportAgeDays).toBeDefined();
  });
});
