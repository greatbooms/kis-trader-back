import { ConfigService } from '@nestjs/config';
import { SecService } from './sec.service';
import axios from 'axios';

jest.mock('axios');

describe('SecService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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

    // 8-K 공시는 "최근 30일" 윈도우에 들어와야 recentForm8KCount30d 가 카운트됨.
    // 테스트를 시간 독립적으로 만들기 위해 "오늘 기준"으로 상대 날짜를 생성.
    const daysAgoISO = (days: number) =>
      new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const submissions = {
      filings: {
        recent: {
          form: ['10-K', '8-K', '8-K'],
          // 10-K는 최신 연간보고서로 유지, 8-K 두 건은 30일 내에 배치
          filingDate: ['2026-02-20', daysAgoISO(10), daysAgoISO(5)],
        },
      },
    };

    const fundamentals = (service as any).buildFundamentalsFromFacts(companyFacts, submissions, 60);

    expect(fundamentals.latestRevenue).toBe(1200);
    expect(fundamentals.latestOperatingIncome).toBe(180);
    expect(fundamentals.latestNetIncome).toBe(96);
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

    expect(fundamentals.latestRevenue).toBe(215938);
    expect(fundamentals.latestOperatingIncome).toBe(130387);
    expect(fundamentals.latestNetIncome).toBe(120067);
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

  it('should derive TTM revenue when annual revenue facts are unavailable', () => {
    const service = new SecService({
      get: jest.fn((key: string) => key === 'sec.userAgent' ? 'kis-trader-test admin@example.com' : undefined),
    } as unknown as ConfigService);

    const companyFacts = {
      facts: {
        'us-gaap': {
          RevenueFromContractWithCustomerExcludingAssessedTax: {
            units: {
              USD: [
                { val: 150, form: '10-Q', filed: '2026-02-10', end: '2025-12-31' },
                { val: 140, form: '10-Q', filed: '2025-11-10', end: '2025-09-30' },
                { val: 130, form: '10-Q', filed: '2025-08-10', end: '2025-06-30' },
                { val: 120, form: '10-Q', filed: '2025-05-10', end: '2025-03-31' },
                { val: 110, form: '10-Q', filed: '2025-02-10', end: '2024-12-31' },
                { val: 100, form: '10-Q', filed: '2024-11-10', end: '2024-09-30' },
                { val: 90, form: '10-Q', filed: '2024-08-10', end: '2024-06-30' },
                { val: 80, form: '10-Q', filed: '2024-05-10', end: '2024-03-31' },
              ],
            },
          },
          OperatingIncomeLoss: {
            units: {
              USD: [
                { val: 30, form: '10-Q', filed: '2026-02-10', end: '2025-12-31' },
                { val: 28, form: '10-Q', filed: '2025-11-10', end: '2025-09-30' },
                { val: 26, form: '10-Q', filed: '2025-08-10', end: '2025-06-30' },
                { val: 24, form: '10-Q', filed: '2025-05-10', end: '2025-03-31' },
                { val: 22, form: '10-Q', filed: '2025-02-10', end: '2024-12-31' },
                { val: 20, form: '10-Q', filed: '2024-11-10', end: '2024-09-30' },
                { val: 18, form: '10-Q', filed: '2024-08-10', end: '2024-06-30' },
                { val: 16, form: '10-Q', filed: '2024-05-10', end: '2024-03-31' },
              ],
            },
          },
          NetIncomeLoss: {
            units: {
              USD: [
                { val: 20, form: '10-Q', filed: '2026-02-10', end: '2025-12-31' },
                { val: 18, form: '10-Q', filed: '2025-11-10', end: '2025-09-30' },
                { val: 16, form: '10-Q', filed: '2025-08-10', end: '2025-06-30' },
                { val: 14, form: '10-Q', filed: '2025-05-10', end: '2025-03-31' },
              ],
            },
          },
          GrossProfit: {
            units: {
              USD: [
                { val: 70, form: '10-Q', filed: '2026-02-10', end: '2025-12-31' },
                { val: 66, form: '10-Q', filed: '2025-11-10', end: '2025-09-30' },
                { val: 62, form: '10-Q', filed: '2025-08-10', end: '2025-06-30' },
                { val: 58, form: '10-Q', filed: '2025-05-10', end: '2025-03-31' },
              ],
            },
          },
          EarningsPerShareDiluted: {
            units: {
              'USD/shares': [
                { val: 2.0, form: '10-K', filed: '2025-02-20', end: '2024-12-31' },
                { val: 1.5, form: '10-K', filed: '2024-02-20', end: '2023-12-31' },
              ],
            },
          },
          Assets: {
            units: {
              USD: [
                { val: 1000, form: '10-Q', filed: '2026-02-10', end: '2025-12-31' },
                { val: 900, form: '10-Q', filed: '2025-02-10', end: '2024-12-31' },
              ],
            },
          },
          Liabilities: {
            units: {
              USD: [
                { val: 400, form: '10-Q', filed: '2026-02-10', end: '2025-12-31' },
              ],
            },
          },
          StockholdersEquity: {
            units: {
              USD: [
                { val: 600, form: '10-Q', filed: '2026-02-10', end: '2025-12-31' },
                { val: 500, form: '10-Q', filed: '2025-02-10', end: '2024-12-31' },
              ],
            },
          },
          AssetsCurrent: {
            units: {
              USD: [
                { val: 300, form: '10-Q', filed: '2026-02-10', end: '2025-12-31' },
              ],
            },
          },
          LiabilitiesCurrent: {
            units: {
              USD: [
                { val: 150, form: '10-Q', filed: '2026-02-10', end: '2025-12-31' },
              ],
            },
          },
        },
      },
    };

    const fundamentals = (service as any).buildFundamentalsFromFacts(companyFacts, undefined, 50);

    expect(fundamentals.latestRevenue).toBe(540);
    expect(fundamentals.revenueGrowthRate).toBeCloseTo(42.1053, 3);
    expect(fundamentals.latestOperatingIncome).toBe(108);
    expect(fundamentals.operatingMargin).toBeCloseTo(20, 3);
  });

  it('should retry SEC fetches before succeeding', async () => {
    const service = new SecService({
      get: jest.fn((key: string) => key === 'sec.userAgent' ? 'kis-trader-test admin@example.com' : undefined),
    } as unknown as ConfigService);

    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'getCikBySymbol').mockResolvedValue('1234');
    const requestSpy = jest.spyOn(service as any, 'request');
    requestSpy
      .mockRejectedValueOnce(new Error('temporary sec failure'))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ facts: {} })
      .mockResolvedValueOnce({});

    const buildSpy = jest.spyOn(service as any, 'buildFundamentalsFromFacts').mockReturnValue({
      latestRevenue: 100,
    });

    const fundamentals = await service.getFundamentals('TEST', 10, true);

    expect(fundamentals).toEqual({ latestRevenue: 100 });
    expect(requestSpy).toHaveBeenCalledTimes(4);
    expect((service as any).sleep).toHaveBeenCalledTimes(1);
    expect((service as any).sleep).toHaveBeenCalledWith(500);
    expect(buildSpy).toHaveBeenCalledTimes(1);
  });

  it('should return undefined after exhausting SEC fetch retries', async () => {
    const service = new SecService({
      get: jest.fn((key: string) => key === 'sec.userAgent' ? 'kis-trader-test admin@example.com' : undefined),
    } as unknown as ConfigService);

    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'getCikBySymbol').mockResolvedValue('1234');

    const mockedGet = jest.mocked(axios.get);
    mockedGet.mockRejectedValue(new Error('sec down'));

    const fundamentals = await service.getFundamentals('FAIL', 10, true);

    expect(fundamentals).toBeUndefined();
    expect(mockedGet.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect((service as any).sleep).toHaveBeenCalledTimes(4);
    expect((service as any).sleep).toHaveBeenNthCalledWith(1, 500);
    expect((service as any).sleep).toHaveBeenNthCalledWith(2, 1000);
    expect((service as any).sleep).toHaveBeenNthCalledWith(3, 2000);
    expect((service as any).sleep).toHaveBeenNthCalledWith(4, 4000);
  });
});
