import { Injectable } from '@nestjs/common';
import { OpenDartService } from '../opendart/opendart.service';
import { OpenDartDomesticSignals } from '../opendart/types';
import { SecService } from '../sec/sec.service';
import { SecFundamentals } from '../sec/types';
import { FredService } from '../fred/fred.service';
import { FredRateSnapshot } from '../fred/types';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { MarketDataSnapshotService } from './market-data-snapshot.service';

@Injectable()
export class MarketDataCacheService {
  private static readonly TTL = {
    KIS_FINANCIAL_RATIO_MS: 24 * 60 * 60 * 1000,
    KIS_GROWTH_RATIO_MS: 24 * 60 * 60 * 1000,
    KIS_PROFIT_RATIO_MS: 24 * 60 * 60 * 1000,
    KIS_OTHER_MAJOR_MS: 24 * 60 * 60 * 1000,
    KIS_INCOME_STATEMENT_MS: 24 * 60 * 60 * 1000,
    KIS_STABILITY_RATIO_MS: 24 * 60 * 60 * 1000,
    KIS_BALANCE_SHEET_MS: 24 * 60 * 60 * 1000,
    KIS_DIVIDEND_SCHEDULE_MS: 24 * 60 * 60 * 1000,
    KIS_INVEST_OPINION_MS: 12 * 60 * 60 * 1000,
    KIS_ESTIMATE_PERFORM_MS: 12 * 60 * 60 * 1000,
    KIS_INVESTOR_TRADE_DAILY_MS: 2 * 60 * 60 * 1000,
    KIS_INTEREST_RATES_MS: 6 * 60 * 60 * 1000,
    OPEN_DART_MS: 6 * 60 * 60 * 1000,
    SEC_MS: 12 * 60 * 60 * 1000,
    FRED_MS: 6 * 60 * 60 * 1000,
  } as const;

  constructor(
    private snapshotService: MarketDataSnapshotService,
    private kisDomestic: KisDomesticService,
    private openDartService: OpenDartService,
    private secService: SecService,
    private fredService: FredService,
  ) {}

  async getKisDomesticFinancialRatio(stockCode: string, forceRefresh = false): Promise<any[]> {
    return (await this.snapshotService.getOrLoad<any[]>(
      {
        source: 'kis',
        category: 'domestic-financial-ratio',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode,
        ttlMs: MarketDataCacheService.TTL.KIS_FINANCIAL_RATIO_MS,
        forceRefresh,
      },
      () => this.kisDomestic.getFinancialRatio(stockCode),
    )) ?? [];
  }

  async getKisDomesticGrowthRatio(stockCode: string, forceRefresh = false): Promise<any[]> {
    return (await this.snapshotService.getOrLoad<any[]>(
      {
        source: 'kis',
        category: 'domestic-growth-ratio',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode,
        ttlMs: MarketDataCacheService.TTL.KIS_GROWTH_RATIO_MS,
        forceRefresh,
      },
      () => this.kisDomestic.getGrowthRatio(stockCode),
    )) ?? [];
  }

  async getKisDomesticProfitRatio(stockCode: string, forceRefresh = false): Promise<any[]> {
    return (await this.snapshotService.getOrLoad<any[]>(
      {
        source: 'kis',
        category: 'domestic-profit-ratio',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode,
        ttlMs: MarketDataCacheService.TTL.KIS_PROFIT_RATIO_MS,
        forceRefresh,
      },
      () => this.kisDomestic.getProfitRatio(stockCode),
    )) ?? [];
  }

  async getKisDomesticOtherMajorRatios(stockCode: string, forceRefresh = false): Promise<any[]> {
    return (await this.snapshotService.getOrLoad<any[]>(
      {
        source: 'kis',
        category: 'domestic-other-major-ratios',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode,
        ttlMs: MarketDataCacheService.TTL.KIS_OTHER_MAJOR_MS,
        forceRefresh,
      },
      () => this.kisDomestic.getOtherMajorRatios(stockCode),
    )) ?? [];
  }

  async getKisDomesticIncomeStatement(stockCode: string, forceRefresh = false): Promise<any[]> {
    return (await this.snapshotService.getOrLoad<any[]>(
      {
        source: 'kis',
        category: 'domestic-income-statement',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode,
        ttlMs: MarketDataCacheService.TTL.KIS_INCOME_STATEMENT_MS,
        forceRefresh,
      },
      () => this.kisDomestic.getIncomeStatement(stockCode),
    )) ?? [];
  }

  async getKisDomesticStabilityRatio(stockCode: string, forceRefresh = false): Promise<any[]> {
    return (await this.snapshotService.getOrLoad<any[]>(
      {
        source: 'kis',
        category: 'domestic-stability-ratio',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode,
        ttlMs: MarketDataCacheService.TTL.KIS_STABILITY_RATIO_MS,
        forceRefresh,
      },
      () => this.kisDomestic.getStabilityRatio(stockCode),
    )) ?? [];
  }

  async getKisDomesticBalanceSheet(stockCode: string, forceRefresh = false): Promise<any[]> {
    return (await this.snapshotService.getOrLoad<any[]>(
      {
        source: 'kis',
        category: 'domestic-balance-sheet',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode,
        ttlMs: MarketDataCacheService.TTL.KIS_BALANCE_SHEET_MS,
        forceRefresh,
      },
      () => this.kisDomestic.getBalanceSheet(stockCode),
    )) ?? [];
  }

  async getKisDomesticDividendSchedule(stockCode: string, forceRefresh = false): Promise<any[] | undefined> {
    return this.snapshotService.getOrLoad<any[]>(
      {
        source: 'kis',
        category: 'domestic-dividend-schedule',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode,
        ttlMs: MarketDataCacheService.TTL.KIS_DIVIDEND_SCHEDULE_MS,
        forceRefresh,
      },
      () => this.kisDomestic.getDividendSchedule(stockCode),
    );
  }

  async getKisDomesticInvestOpinion(stockCode: string, forceRefresh = false): Promise<any[] | undefined> {
    return this.snapshotService.getOrLoad<any[]>(
      {
        source: 'kis',
        category: 'domestic-invest-opinion',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode,
        ttlMs: MarketDataCacheService.TTL.KIS_INVEST_OPINION_MS,
        forceRefresh,
      },
      () => this.kisDomestic.getInvestOpinion(stockCode),
    );
  }

  async getKisDomesticEstimatePerform(stockCode: string, forceRefresh = false): Promise<any | undefined> {
    return this.snapshotService.getOrLoad<any>(
      {
        source: 'kis',
        category: 'domestic-estimate-perform',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode,
        ttlMs: MarketDataCacheService.TTL.KIS_ESTIMATE_PERFORM_MS,
        forceRefresh,
      },
      () => this.kisDomestic.getEstimatePerform(stockCode),
    );
  }

  async getKisDomesticInvestorTradeDaily(stockCode: string, forceRefresh = false): Promise<any[] | undefined> {
    return this.snapshotService.getOrLoad<any[]>(
      {
        source: 'kis',
        category: 'domestic-investor-trade-daily',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode,
        ttlMs: MarketDataCacheService.TTL.KIS_INVESTOR_TRADE_DAILY_MS,
        forceRefresh,
      },
      () => this.kisDomestic.getInvestorTradeDaily(stockCode),
    );
  }

  async getKisDomesticInterestRates(forceRefresh = false): Promise<any[] | undefined> {
    return this.snapshotService.getOrLoad<any[]>(
      {
        source: 'kis',
        category: 'domestic-interest-rates',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        ttlMs: MarketDataCacheService.TTL.KIS_INTEREST_RATES_MS,
        forceRefresh,
      },
      () => this.kisDomestic.getInterestRates(),
    );
  }

  async getOpenDartDomesticSignals(stockCode: string, forceRefresh = false): Promise<OpenDartDomesticSignals | undefined> {
    if (!this.openDartService.isConfigured()) return undefined;
    return this.snapshotService.getOrLoad<OpenDartDomesticSignals>(
      {
        source: 'opendart',
        category: 'domestic-signals',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode,
        ttlMs: MarketDataCacheService.TTL.OPEN_DART_MS,
        forceRefresh,
      },
      () => this.openDartService.getDomesticSignals(stockCode),
    );
  }

  async getSecFundamentals(stockCode: string, currentPrice = 0, exchangeCode = 'NASD', forceRefresh = false): Promise<SecFundamentals | undefined> {
    if (!this.secService.isConfigured()) return undefined;
    const raw = await this.snapshotService.getOrLoad<SecFundamentals>(
      {
        source: 'sec',
        category: 'us-fundamentals',
        market: 'OVERSEAS',
        exchangeCode,
        stockCode,
        ttlMs: MarketDataCacheService.TTL.SEC_MS,
        forceRefresh,
      },
      () => this.secService.getFundamentals(stockCode, 0, forceRefresh),
    );
    if (!raw) return undefined;
    return {
      ...raw,
      dividendYield: raw.annualDividendPerShare && currentPrice > 0
        ? (raw.annualDividendPerShare / currentPrice) * 100
        : undefined,
    };
  }

  async getFredRateSnapshot(seriesId: string, forceRefresh = false): Promise<FredRateSnapshot | undefined> {
    if (!this.fredService.isConfigured()) return undefined;
    return this.snapshotService.getOrLoad<FredRateSnapshot>(
      {
        source: 'fred',
        category: 'series-observation',
        exchangeCode: seriesId,
        ttlMs: MarketDataCacheService.TTL.FRED_MS,
        forceRefresh,
      },
      () => this.fredService.getLatestRateSnapshot(seriesId),
    );
  }
}
