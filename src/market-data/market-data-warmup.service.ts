import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { MarketDataCacheService } from './market-data-cache.service';

@Injectable()
export class MarketDataWarmupService {
  private readonly logger = new Logger(MarketDataWarmupService.name);

  constructor(
    private prisma: PrismaService,
    private marketDataCache: MarketDataCacheService,
  ) {}

  @Cron('0 10 */6 * * *', { timeZone: 'Asia/Seoul' })
  async warmSnapshots(): Promise<void> {
    const watchStocks = await this.prisma.watchStock.findMany({
      where: { isActive: true, NOT: { strategyName: null } },
      select: {
        market: true,
        exchangeCode: true,
        stockCode: true,
        strategyName: true,
      },
    });

    if (watchStocks.length === 0) return;

    const domestic = new Set<string>();
    const domesticForFlow = new Set<string>();
    const domesticForDividend = new Set<string>();
    const domesticForConsensus = new Set<string>();
    const domesticForOpenDart = new Set<string>();
    const usStocks = new Map<string, string>();

    for (const stock of watchStocks) {
      if (!stock.strategyName) continue;

      if (stock.market === 'DOMESTIC') {
        if (stock.strategyName === 'value-factor') domestic.add(stock.stockCode);
        if (['momentum-breakout', 'trend-following', 'conservative', 'infinite-buy'].includes(stock.strategyName)) {
          domesticForFlow.add(stock.stockCode);
        }
        if (['infinite-buy', 'value-factor'].includes(stock.strategyName)) {
          domesticForDividend.add(stock.stockCode);
        }
        if (['trend-following', 'value-factor', 'infinite-buy'].includes(stock.strategyName)) {
          domesticForConsensus.add(stock.stockCode);
        }
        if (['infinite-buy', 'conservative'].includes(stock.strategyName)) {
          domesticForOpenDart.add(stock.stockCode);
        }
      } else if (['NASD', 'NYSE', 'AMEX'].includes(stock.exchangeCode) && ['value-factor', 'infinite-buy', 'conservative'].includes(stock.strategyName)) {
        usStocks.set(stock.stockCode, stock.exchangeCode);
      }
    }

    await Promise.all([
      ...[...domestic].flatMap((stockCode) => [
        this.marketDataCache.getKisDomesticFinancialRatio(stockCode),
        this.marketDataCache.getKisDomesticGrowthRatio(stockCode),
        this.marketDataCache.getKisDomesticProfitRatio(stockCode),
        this.marketDataCache.getKisDomesticOtherMajorRatios(stockCode),
        this.marketDataCache.getKisDomesticIncomeStatement(stockCode),
        this.marketDataCache.getKisDomesticStabilityRatio(stockCode),
      ]),
      ...[...domesticForFlow].map((stockCode) => this.marketDataCache.getKisDomesticInvestorTradeDaily(stockCode)),
      ...[...domesticForDividend].map((stockCode) => this.marketDataCache.getKisDomesticDividendSchedule(stockCode)),
      ...[...domesticForConsensus].flatMap((stockCode) => [
        this.marketDataCache.getKisDomesticInvestOpinion(stockCode),
        this.marketDataCache.getKisDomesticEstimatePerform(stockCode),
      ]),
      ...[...domesticForOpenDart].map((stockCode) => this.marketDataCache.getOpenDartDomesticSignals(stockCode)),
      ...[...usStocks.entries()].map(([stockCode, exchangeCode]) => this.marketDataCache.getSecFundamentals(stockCode, 0, exchangeCode)),
      this.marketDataCache.getFredRateSnapshot('FEDFUNDS'),
      this.marketDataCache.getKisDomesticInterestRates(),
    ]);

    this.logger.log(`Market data warmup completed for ${watchStocks.length} active watch stocks`);
  }
}
