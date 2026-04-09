import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { SecFundamentals } from './types';

interface CachedValue<T> {
  data: T;
  expiresAt: number;
}

interface SecFactEntry {
  val?: number;
  form?: string;
  fy?: number;
  fp?: string;
  filed?: string;
  end?: string;
}

interface NormalizedFactEntry {
  value: number;
  form?: string;
  fp?: string;
  filed?: string;
  end?: string;
}

interface MetricPoint extends NormalizedFactEntry {
  concept: string;
}

interface SecTickerMappingResponse {
  data?: Array<[number | string, string, string, string]>;
}

interface SecSubmissionsResponse {
  filings?: {
    recent?: {
      form?: string[];
      filingDate?: string[];
    };
  };
}

@Injectable()
export class SecService {
  private readonly logger = new Logger(SecService.name);
  private readonly userAgent: string;
  private readonly tickerCache = new Map<string, string>();
  private readonly fundamentalsCache = new Map<string, CachedValue<SecFundamentals | undefined>>();
  private tickerMapExpiresAt = 0;
  private lastRequestAt = 0;
  private static readonly REQUEST_INTERVAL_MS = 120;
  private static readonly MAX_FETCH_ATTEMPTS = 5;
  private static readonly INITIAL_RETRY_DELAY_MS = 500;
  private static readonly TICKER_CACHE_MS = 24 * 60 * 60 * 1000;
  private static readonly FUNDAMENTALS_CACHE_MS = 6 * 60 * 60 * 1000;
  private static readonly ANNUAL_FORMS = new Set(['10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A']);
  private static readonly QUARTERLY_FORMS = new Set(['10-Q', '10-Q/A', '10-QT', '10-QT/A', '6-K', '6-K/A']);

  constructor(private configService: ConfigService) {
    this.userAgent = this.configService.get<string>('sec.userAgent') || '';
  }

  isConfigured(): boolean {
    return !!this.userAgent;
  }

  async getFundamentals(symbol: string, currentPrice: number, forceRefresh = false): Promise<SecFundamentals | undefined> {
    if (!this.isConfigured()) return undefined;

    const cacheKey = symbol.toUpperCase();
    if (forceRefresh) {
      this.fundamentalsCache.delete(cacheKey);
    } else {
      const cached = this.fundamentalsCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.data;
    }

    try {
      const cik = await this.getCikBySymbol(cacheKey);
      if (!cik) {
        this.fundamentalsCache.set(cacheKey, { data: undefined, expiresAt: Date.now() + SecService.FUNDAMENTALS_CACHE_MS });
        return undefined;
      }

      const cikPadded = cik.padStart(10, '0');
      const [companyFacts, submissions] = await this.fetchCompanyDataWithRetry(cacheKey, cikPadded);

      const fundamentals = this.buildFundamentalsFromFacts(companyFacts, submissions, currentPrice);
      if (!fundamentals.latestRevenue || fundamentals.latestRevenue <= 0) {
        this.logger.warn(
          `SEC fundamentals missing latestRevenue for ${symbol} (latest=${fundamentals.latestFilingForm ?? 'N/A'} ${fundamentals.latestFilingDate ?? 'N/A'}, periodic=${fundamentals.latestPeriodicFilingForm ?? 'N/A'} ${fundamentals.latestPeriodicFilingDate ?? 'N/A'})`,
        );
      }
      this.fundamentalsCache.set(cacheKey, { data: fundamentals, expiresAt: Date.now() + SecService.FUNDAMENTALS_CACHE_MS });
      return fundamentals;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`SEC fetch failed for ${symbol}: ${message}`);
      this.fundamentalsCache.set(cacheKey, { data: undefined, expiresAt: Date.now() + 30 * 60 * 1000 });
      return undefined;
    }
  }

  private async fetchCompanyDataWithRetry(
    symbol: string,
    cikPadded: string,
  ): Promise<[any, SecSubmissionsResponse]> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= SecService.MAX_FETCH_ATTEMPTS; attempt++) {
      try {
        return await Promise.all([
          this.request<any>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cikPadded}.json`),
          this.request<SecSubmissionsResponse>(`https://data.sec.gov/submissions/CIK${cikPadded}.json`),
        ]);
      } catch (error) {
        lastError = error;
        if (attempt >= SecService.MAX_FETCH_ATTEMPTS) break;

        const delayMs = SecService.INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `SEC fetch retry ${attempt}/${SecService.MAX_FETCH_ATTEMPTS - 1} for ${symbol} after ${delayMs}ms: ${message}`,
        );
        await this.sleep(delayMs);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async getCikBySymbol(symbol: string): Promise<string | undefined> {
    if (Date.now() > this.tickerMapExpiresAt || this.tickerCache.size === 0) {
      const response = await this.request<SecTickerMappingResponse>('https://www.sec.gov/files/company_tickers_exchange.json');
      this.tickerCache.clear();
      for (const row of response.data ?? []) {
        const cik = String(row[0] ?? '').trim();
        const ticker = String(row[2] ?? '').trim().toUpperCase();
        if (cik && ticker) this.tickerCache.set(ticker, cik);
      }
      this.tickerMapExpiresAt = Date.now() + SecService.TICKER_CACHE_MS;
    }
    return this.tickerCache.get(symbol);
  }

  private async request<T>(url: string): Promise<T> {
    const waitMs = Math.max(0, SecService.REQUEST_INTERVAL_MS - (Date.now() - this.lastRequestAt));
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    this.lastRequestAt = Date.now();
    const response = await axios.get<T>(url, {
      timeout: 15000,
      headers: {
        'User-Agent': this.userAgent,
        'Accept-Encoding': 'gzip, deflate',
      },
    });
    return response.data;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildFundamentalsFromFacts(companyFacts: any, submissions: SecSubmissionsResponse | undefined, currentPrice: number): SecFundamentals {
    const revenuePoints = this.collectMetricPoints(companyFacts, [
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'SalesRevenueNet',
      'Revenues',
    ], 'annual');
    const revenueTtmPoints = this.collectTtmMetricPoints(companyFacts, [
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'SalesRevenueNet',
      'Revenues',
    ]);
    const operatingIncomePoints = this.collectMetricPoints(companyFacts, ['OperatingIncomeLoss'], 'annual');
    const operatingIncomeTtmPoints = this.collectTtmMetricPoints(companyFacts, ['OperatingIncomeLoss']);
    const netIncomePoints = this.collectMetricPoints(companyFacts, ['NetIncomeLoss'], 'annual');
    const netIncomeTtmPoints = this.collectTtmMetricPoints(companyFacts, ['NetIncomeLoss']);
    const grossProfitPoints = this.collectMetricPoints(companyFacts, ['GrossProfit'], 'annual');
    const grossProfitTtmPoints = this.collectTtmMetricPoints(companyFacts, ['GrossProfit']);
    const epsPoints = this.collectMetricPoints(companyFacts, ['EarningsPerShareDiluted', 'EarningsPerShareBasic'], 'annual');
    const assetsPoints = this.collectMetricPoints(companyFacts, ['Assets'], 'instant');
    const equityPoints = this.collectMetricPoints(companyFacts, ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'], 'instant');
    const liabilitiesPoints = this.collectMetricPoints(companyFacts, ['Liabilities'], 'instant');
    const currentAssetsPoints = this.collectMetricPoints(companyFacts, ['AssetsCurrent'], 'instant');
    const currentLiabilitiesPoints = this.collectMetricPoints(companyFacts, ['LiabilitiesCurrent'], 'instant');
    const dividendPoints = this.collectMetricPoints(companyFacts, [
      'CommonStockDividendsPerShareDeclared',
      'CommonStockDividendsPerShareCashPaid',
    ], 'annual');

    const latestRevenuePoint = revenuePoints[0] ?? revenueTtmPoints[0];
    const previousRevenuePoint = revenuePoints[1] ?? revenueTtmPoints[1];
    const latestRevenue = latestRevenuePoint?.value;
    const previousRevenue = previousRevenuePoint?.value;

    const latestOperatingIncome = this.findMatchingPeriodValue(operatingIncomePoints, latestRevenuePoint)
      ?? operatingIncomePoints[0]?.value
      ?? operatingIncomeTtmPoints[0]?.value;
    const previousOperatingIncome = operatingIncomePoints[1]?.value ?? operatingIncomeTtmPoints[1]?.value;
    const latestNetIncome = this.findMatchingPeriodValue(netIncomePoints, latestRevenuePoint)
      ?? netIncomePoints[0]?.value
      ?? netIncomeTtmPoints[0]?.value;
    const latestGrossProfit = this.findMatchingPeriodValue(grossProfitPoints, latestRevenuePoint)
      ?? grossProfitPoints[0]?.value
      ?? grossProfitTtmPoints[0]?.value;
    const latestEps = epsPoints[0]?.value;
    const previousEps = epsPoints[1]?.value;
    const latestAssets = assetsPoints[0]?.value;
    const previousAssets = assetsPoints[1]?.value;
    const latestEquity = equityPoints[0]?.value;
    const previousEquity = equityPoints[1]?.value;
    const latestLiabilities = liabilitiesPoints[0]?.value;
    const latestCurrentAssets = currentAssetsPoints[0]?.value;
    const latestCurrentLiabilities = currentLiabilitiesPoints[0]?.value;
    const latestDividendPerShare = this.findMatchingPeriodValue(dividendPoints, latestRevenuePoint) ?? dividendPoints[0]?.value;

    const filingMeta = this.buildFilingMeta(submissions);

    const dividendYield = latestDividendPerShare && currentPrice > 0
      ? (latestDividendPerShare / currentPrice) * 100
      : undefined;
    const payoutRatio = latestDividendPerShare && latestEps && latestEps > 0
      ? (latestDividendPerShare / latestEps) * 100
      : undefined;

    return {
      latestRevenue,
      latestOperatingIncome,
      latestNetIncome,
      revenueGrowthRate: this.calculateGrowthRate(latestRevenue, previousRevenue),
      operatingProfitGrowthRate: this.calculateGrowthRate(latestOperatingIncome, previousOperatingIncome),
      epsGrowthRate: this.calculateGrowthRate(latestEps, previousEps),
      operatingMargin: latestRevenue && latestOperatingIncome !== undefined && latestRevenue > 0
        ? (latestOperatingIncome / latestRevenue) * 100
        : undefined,
      netMargin: latestRevenue && latestNetIncome !== undefined && latestRevenue > 0
        ? (latestNetIncome / latestRevenue) * 100
        : undefined,
      grossMargin: latestRevenue && latestGrossProfit !== undefined && latestRevenue > 0
        ? (latestGrossProfit / latestRevenue) * 100
        : undefined,
      debtRatio: latestLiabilities !== undefined && latestEquity !== undefined && latestEquity > 0
        ? (latestLiabilities / latestEquity) * 100
        : undefined,
      currentRatio: latestCurrentAssets !== undefined && latestCurrentLiabilities !== undefined && latestCurrentLiabilities > 0
        ? (latestCurrentAssets / latestCurrentLiabilities) * 100
        : undefined,
      totalAssetGrowthRate: this.calculateGrowthRate(latestAssets, previousAssets),
      equityGrowthRate: this.calculateGrowthRate(latestEquity, previousEquity),
      annualDividendPerShare: latestDividendPerShare,
      dividendYield,
      payoutRatio,
      latestFilingDate: filingMeta.latestFilingDate,
      latestFilingForm: filingMeta.latestFilingForm,
      latestPeriodicFilingDate: filingMeta.latestPeriodicFilingDate,
      latestPeriodicFilingForm: filingMeta.latestPeriodicFilingForm,
      recentForm8KCount30d: filingMeta.recentForm8KCount30d,
      secPeriodicReportAgeDays: filingMeta.secPeriodicReportAgeDays,
    };
  }

  private buildFilingMeta(
    submissions: SecSubmissionsResponse | undefined,
  ): Pick<
    SecFundamentals,
    'latestFilingDate' | 'latestFilingForm' |
    'latestPeriodicFilingDate' | 'latestPeriodicFilingForm' |
    'recentForm8KCount30d' | 'secPeriodicReportAgeDays'
  > {
    const recentForms = submissions?.filings?.recent?.form ?? [];
    const recentDates = submissions?.filings?.recent?.filingDate ?? [];
    const today = new Date();
    let latestFilingDate: string | undefined;
    let latestFilingForm: string | undefined;
    let latestPeriodicFilingDate: string | undefined;
    let latestPeriodicFilingForm: string | undefined;
    let secPeriodicReportAgeDays: number | undefined;
    let recentForm8KCount30d = 0;

    for (let index = 0; index < Math.min(recentForms.length, recentDates.length); index += 1) {
      const form = recentForms[index];
      const filingDate = recentDates[index];
      if (!latestFilingDate) {
        latestFilingDate = filingDate;
        latestFilingForm = form;
      }

      const parsedDate = new Date(`${filingDate}T00:00:00Z`);
      if (Number.isNaN(parsedDate.getTime())) continue;
      const ageDays = Math.floor((today.getTime() - parsedDate.getTime()) / (24 * 60 * 60 * 1000));

      if (form === '8-K' && ageDays <= 30) recentForm8KCount30d += 1;
      if (
        latestPeriodicFilingDate === undefined &&
        (SecService.ANNUAL_FORMS.has(form) || SecService.QUARTERLY_FORMS.has(form))
      ) {
        latestPeriodicFilingDate = filingDate;
        latestPeriodicFilingForm = form;
        secPeriodicReportAgeDays = ageDays;
      }
    }

    return {
      latestFilingDate,
      latestFilingForm,
      latestPeriodicFilingDate,
      latestPeriodicFilingForm,
      recentForm8KCount30d: recentForm8KCount30d || undefined,
      secPeriodicReportAgeDays,
    };
  }

  private collectMetricPoints(
    companyFacts: any,
    concepts: string[],
    periodType: 'annual' | 'instant',
  ): MetricPoint[] {
    const points = concepts.flatMap((concept) => this.normalizeEntries(companyFacts?.facts?.['us-gaap']?.[concept]?.units)
      .filter((entry) => this.matchesPeriodType(entry.form, periodType))
      .map((entry) => ({
        ...entry,
        concept,
      })));

    points.sort((a, b) => {
      const bTime = new Date(`${b.end ?? b.filed}T00:00:00Z`).getTime();
      const aTime = new Date(`${a.end ?? a.filed}T00:00:00Z`).getTime();
      if (bTime !== aTime) return bTime - aTime;
      return new Date(`${b.filed ?? b.end}T00:00:00Z`).getTime() - new Date(`${a.filed ?? a.end}T00:00:00Z`).getTime();
    });

    const deduped: MetricPoint[] = [];
    const seen = new Set<string>();
    for (const point of points) {
      const key = point.end ?? point.filed;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push(point);
    }

    return deduped;
  }

  private findMatchingPeriodValue(points: MetricPoint[], target: MetricPoint | undefined): number | undefined {
    if (!target?.end) return undefined;
    return points.find((point) => point.end === target.end)?.value;
  }

  private pickPeriodicMetric(
    companyFacts: any,
    concepts: string[],
    periodType: 'annual' | 'instant',
    index: number,
  ): number | undefined {
    const points = this.collectMetricPoints(companyFacts, concepts, periodType);
    return points[index]?.value;
  }

  private legacyPickPeriodicMetric(
    companyFacts: any,
    concepts: string[],
    periodType: 'annual' | 'instant',
    index: number,
  ): number | undefined {
    for (const concept of concepts) {
      const entries = this.normalizeEntries(companyFacts?.facts?.['us-gaap']?.[concept]?.units);
      const filtered = entries.filter((entry) => this.matchesPeriodType(entry.form, periodType));
      if (filtered.length > index) return filtered[index].value;
    }
    return undefined;
  }

  private normalizeEntries(units: Record<string, SecFactEntry[]> | undefined): NormalizedFactEntry[] {
    if (!units) return [];
    const entries = Object.values(units)
      .flatMap((items) => items)
      .map((item) => ({
        value: Number(item.val),
        form: item.form,
        fp: item.fp,
        filed: item.filed,
        end: item.end,
      }))
      .filter((item) => Number.isFinite(item.value) && (item.end || item.filed));

    entries.sort((a, b) => {
      const bTime = new Date(`${b.end ?? b.filed}T00:00:00Z`).getTime();
      const aTime = new Date(`${a.end ?? a.filed}T00:00:00Z`).getTime();
      return bTime - aTime;
    });

    const deduped: NormalizedFactEntry[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      const key = `${entry.form ?? 'unknown'}:${entry.end ?? entry.filed}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(entry);
    }
    return deduped;
  }

  private collectTtmMetricPoints(companyFacts: any, concepts: string[]): MetricPoint[] {
    const quarterlyPoints = concepts.flatMap((concept) =>
      this.normalizeEntries(companyFacts?.facts?.['us-gaap']?.[concept]?.units)
        .filter((entry) => this.matchesQuarterlyPeriod(entry.form))
        .map((entry) => ({
          ...entry,
          concept,
        })),
    );

    quarterlyPoints.sort((a, b) => {
      const bTime = new Date(`${b.end ?? b.filed}T00:00:00Z`).getTime();
      const aTime = new Date(`${a.end ?? a.filed}T00:00:00Z`).getTime();
      if (bTime !== aTime) return bTime - aTime;
      return new Date(`${b.filed ?? b.end}T00:00:00Z`).getTime() - new Date(`${a.filed ?? a.end}T00:00:00Z`).getTime();
    });

    const uniquePoints = quarterlyPoints.filter((point, index, array) => {
      const end = point.end ?? point.filed;
      if (!end) return false;
      return array.findIndex((candidate) => (candidate.end ?? candidate.filed) === end) === index;
    });

    const result: MetricPoint[] = [];
    for (let offset = 0; offset + 4 <= uniquePoints.length && result.length < 2; offset += 4) {
      const window = uniquePoints.slice(offset, offset + 4);
      if (window.length < 4) break;

      result.push({
        concept: `TTM:${window[0].concept}`,
        form: 'TTM',
        end: window[0].end,
        filed: window[0].filed,
        value: window.reduce((sum, point) => sum + point.value, 0),
      });
    }

    return result;
  }

  private matchesPeriodType(form: string | undefined, periodType: 'annual' | 'instant'): boolean {
    if (!form) return false;
    if (periodType === 'annual') return SecService.ANNUAL_FORMS.has(form);
    return SecService.ANNUAL_FORMS.has(form) || SecService.QUARTERLY_FORMS.has(form);
  }

  private matchesQuarterlyPeriod(form: string | undefined): boolean {
    if (!form) return false;
    return SecService.QUARTERLY_FORMS.has(form);
  }

  private calculateGrowthRate(latest?: number, previous?: number): number | undefined {
    if (latest === undefined || previous === undefined || previous === 0) return undefined;
    return ((latest / previous) - 1) * 100;
  }
}
