import { Injectable, Logger } from '@nestjs/common';
import { BrokerPortRegistry } from '../broker/broker-port.registry';
import { PrismaService } from '../prisma.service';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { Broker, Market, Side } from '@prisma/client';
import { StockPriceResult } from '../kis/types/kis-api.types';
import { AccountCashBalance, AccountStatusCache } from './types';
import { DailyPrice } from '../kis/types/kis-api.types';
import { MarketAnalysisService } from '../trading/market-analysis.service';
import { TradingAccountCashSyncService } from '../trading/trading-account-cash-sync.service';
import { TradingPositionSyncService } from '../trading/trading-position-sync.service';

@Injectable()
export class TradeRecordService {
  private readonly logger = new Logger(TradeRecordService.name);
  constructor(
    private prisma: PrismaService,
    private kisDomestic: KisDomesticService,
    private kisOverseas: KisOverseasService,
    private readonly registry: BrokerPortRegistry,
    private marketAnalysis: MarketAnalysisService,
    private readonly accountCashSync: TradingAccountCashSyncService,
    private readonly positionSync: TradingPositionSyncService,
  ) {}

  findAll(options?: {
    broker?: Broker;
    market?: Market;
    side?: Side;
    stockCode?: string;
    exchangeCode?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    offset?: number;
  }) {
    const createdAt: Record<string, Date> = {};
    if (options?.dateFrom) createdAt.gte = new Date(options.dateFrom + 'T00:00:00');
    if (options?.dateTo) createdAt.lte = new Date(options.dateTo + 'T23:59:59');

    return this.prisma.tradeRecord.findMany({
      where: {
        ...(options?.broker && { broker: options.broker }),
        ...(options?.market && { market: options.market }),
        ...(options?.side && { side: options.side }),
        ...(options?.stockCode && { stockCode: options.stockCode }),
        ...(options?.exchangeCode && { exchangeCode: options.exchangeCode }),
        ...(Object.keys(createdAt).length > 0 && { createdAt }),
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 50,
      skip: options?.offset || 0,
    });
  }

  findOne(id: string) {
    return this.prisma.tradeRecord.findUnique({ where: { id } });
  }

  async getDomesticQuoteHistory(stockCode: string, months = 6): Promise<DailyPrice[]> {
    const today = new Date();
    const endDate = today.toISOString().slice(0, 10).replace(/-/g, '');
    const start = new Date(today);
    start.setMonth(start.getMonth() - Math.max(1, months));
    const startDate = start.toISOString().slice(0, 10).replace(/-/g, '');
    const prices = await this.kisDomestic.getDailyPrices(stockCode, startDate, endDate);
    return prices.reverse();
  }

  async getDomesticQuote(stockCode: string): Promise<StockPriceResult & { technicalRatings: ReturnType<MarketAnalysisService['calculateTechnicalRatings']> }> {
    const [quote, prices] = await Promise.all([
      this.kisDomestic.getPrice(stockCode),
      this.marketAnalysis.fetchDailyPrices('DOMESTIC', 'KRX', stockCode, 650),
    ]);

    return {
      ...quote,
      technicalRatings: this.marketAnalysis.calculateTechnicalRatings(prices, quote),
    };
  }

  async getOverseasQuoteHistory(exchangeCode: string, stockCode: string, months = 6): Promise<DailyPrice[]> {
    const estimatedTradingDays = Math.max(22, Math.ceil(months * 22));
    const prices = await this.kisOverseas.getDailyPrices(exchangeCode, stockCode, estimatedTradingDays);
    return prices.reverse();
  }

  async getOverseasQuote(
    exchangeCode: string,
    stockCode: string,
  ): Promise<StockPriceResult & { technicalRatings: ReturnType<MarketAnalysisService['calculateTechnicalRatings']> }> {
    const [quote, prices] = await Promise.all([
      this.kisOverseas.getPrice(exchangeCode, stockCode),
      this.marketAnalysis.fetchDailyPrices('OVERSEAS', exchangeCode, stockCode, 650),
    ]);

    return {
      ...quote,
      technicalRatings: this.marketAnalysis.calculateTechnicalRatings(prices, quote),
    };
  }

  /** 대시보드 요약 */
  async getDashboardSummary() {
    const allTrades = await this.prisma.tradeRecord.findMany({
      where: { status: 'FILLED' },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayTrades = allTrades.filter((t) => t.createdAt >= today);

    const totalProfitLoss = allTrades.reduce((sum, t) => {
      if (t.executedPrice && t.side === 'SELL') {
        return sum + (Number(t.executedPrice) - Number(t.price)) * (t.executedQty || t.quantity);
      }
      return sum;
    }, 0);

    const sellTrades = allTrades.filter((t) => t.side === 'SELL');
    const winTrades = sellTrades.filter(
      (t) => t.executedPrice && Number(t.executedPrice) > Number(t.price),
    );
    const winRate = sellTrades.length > 0 ? (winTrades.length / sellTrades.length) * 100 : 0;

    return {
      totalProfitLoss,
      totalTradeCount: allTrades.length,
      todayTradeCount: todayTrades.length,
      winRate,
    };
  }

  /** 포지션 목록 */
  findPositions(market?: Market) {
    return this.prisma.position.findMany({
      where: market ? { market } : undefined,
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** 계좌 요약 (예수금 + 포지션 합산) */
  async getAccountSummary() {
    const positions = await this.prisma.position.findMany();
    const totalInvested = positions.reduce((sum, p) => sum + Number(p.totalInvested), 0);
    const totalProfitLoss = positions.reduce((sum, p) => sum + Number(p.profitLoss), 0);

    // 최신 RiskSnapshot에서 cashBalance 조회
    const latestSnapshots = await this.prisma.riskSnapshot.findMany({
      orderBy: { createdAt: 'desc' },
      distinct: ['broker', 'market'],
    });
    const statusCache = await this.getAccountStatusCache();
    const cachedKrwCash = statusCache?.cashBalances
      ?.filter((item) => item.currencyCode === 'KRW')
      .reduce((sum, item) => sum + item.amount, 0);
    const cashBalance = cachedKrwCash ?? latestSnapshots.reduce((sum, s) => sum + Number(s.cashBalance), 0);
    const totalAssets = cashBalance + totalInvested + totalProfitLoss;

    // 실현 손익: 매도 거래의 (매도가 - 평균매수가) × 수량
    const realizedPnL = await this.calculateRealizedPnL();

    return {
      cashBalance,
      totalInvested,
      totalAssets,
      totalProfitLoss,
      realizedPnL,
      profitRate: totalInvested > 0 ? (totalProfitLoss / totalInvested) * 100 : 0,
      positionCount: positions.length,
      cashBalances: statusCache?.cashBalances ?? [],
      lastSyncedAt: statusCache?.lastSyncedAt,
    };
  }

  async refreshAccountState() {
    const messages: string[] = [];
    const cashBalances: AccountCashBalance[] = [];
    let hasSuccess = false;

    this.logger.debug('Refreshing account state');
    for (const port of this.registry.getActive()) {
      const brokerCashBalances: AccountCashBalance[] = [];
      const authoritativeCashMarkets: Array<'DOMESTIC' | 'OVERSEAS'> = [];
      try {
        const domesticBalance = await port.getBalance(Market.DOMESTIC);
        await this.positionSync.syncPositions(port.broker, 'DOMESTIC', domesticBalance);
        const domesticCash = await port.getDomesticBuyableAmount();
        brokerCashBalances.push({
          broker: port.broker,
          market: Market.DOMESTIC,
          currencyCode: 'KRW',
          currencyName: '원화',
          amount: domesticCash.cashAvailable,
          withdrawableAmount: domesticCash.cashAvailable,
          orderableAmount: domesticCash.cashAvailable,
        });
        authoritativeCashMarkets.push('DOMESTIC');
        hasSuccess = true;
      } catch (e) {
        messages.push(`${port.broker} 국내 계좌 조회 실패: ${e.message}`);
        this.logger.warn(`Failed to refresh ${port.broker} domestic account state: ${e.message}`);
      }

      try {
        const overseasSnapshot = await port.getOverseasAccountSnapshot();
        await this.positionSync.syncPositions(port.broker, 'OVERSEAS', overseasSnapshot.balance);
        brokerCashBalances.push(
          ...overseasSnapshot.cashBalances.map((item) => ({
            broker: port.broker,
            market: Market.OVERSEAS,
            currencyCode: item.currencyCode,
            currencyName: item.currencyName,
            amount: item.amount,
            withdrawableAmount: item.withdrawableAmount,
            orderableAmount: item.orderableAmount,
            generalOrderableAmount: item.generalOrderableAmount,
            integratedOrderableAmount: item.integratedOrderableAmount,
            pendingBuyAmount: item.pendingBuyAmount,
            pendingSellAmount: item.pendingSellAmount,
            receivableAmount: item.receivableAmount,
            marginAmount: item.marginAmount,
          })),
        );
        authoritativeCashMarkets.push('OVERSEAS');
        hasSuccess = true;
      } catch (e) {
        messages.push(`${port.broker} 해외 계좌 조회 실패: ${e.message}`);
        this.logger.warn(`Failed to refresh ${port.broker} overseas account state: ${e.message}`);
      }

      if (authoritativeCashMarkets.length > 0) {
        try {
          await this.accountCashSync.replaceCache(
            port.broker,
            brokerCashBalances,
            authoritativeCashMarkets,
          );
          cashBalances.push(...brokerCashBalances);
        } catch (e) {
          messages.push(`${port.broker} 현금 캐시 저장 실패: ${e.message}`);
          this.logger.warn(`Failed to cache ${port.broker} account cash: ${e.message}`);
        }
      }
    }

    this.logger.debug(
      `Finished refreshing account state: success=${hasSuccess}, cashBalances=${cashBalances.length}, messages=${messages.length}`,
    );

    return {
      success: hasSuccess,
      message: messages.length > 0 ? messages.join(' | ') : '계좌 상태를 새로고침했습니다.',
      accountSummary: await this.getAccountSummary(),
    };
  }

  /** 실현 손익 계산: 매도 거래별 (매도가 - 가중평균매수가) × 수량 */
  private async calculateRealizedPnL(): Promise<number> {
    const trades = await this.prisma.tradeRecord.findMany({
      where: { status: 'FILLED' },
      orderBy: { createdAt: 'asc' },
    });

    const sellTrades = trades.filter((t) => t.side === 'SELL');
    let realizedPnL = 0;

    for (const sellTrade of sellTrades) {
      const isSameInstrument = (trade: typeof sellTrade) =>
        trade.broker === sellTrade.broker &&
        trade.market === sellTrade.market &&
        trade.exchangeCode === sellTrade.exchangeCode &&
        trade.stockCode === sellTrade.stockCode;
      const buyTrades = trades.filter(
        (t) => t.side === 'BUY' && isSameInstrument(t) && t.createdAt <= sellTrade.createdAt,
      );
      const sellsBefore = trades.filter(
        (t) => t.side === 'SELL' && isSameInstrument(t) && t.createdAt < sellTrade.createdAt,
      );

      let totalBuyQty = 0;
      let totalBuyCost = 0;
      for (const bt of buyTrades) {
        const qty = bt.executedQty || bt.quantity;
        const price = Number(bt.executedPrice ?? bt.price);
        totalBuyQty += qty;
        totalBuyCost += qty * price;
      }
      let totalSoldQty = 0;
      for (const st of sellsBefore) {
        totalSoldQty += st.executedQty || st.quantity;
      }

      const remainingQty = totalBuyQty - totalSoldQty;
      const avgBuyPrice = remainingQty > 0 ? totalBuyCost / totalBuyQty : 0;

      const sellPrice = Number(sellTrade.executedPrice ?? sellTrade.price);
      const sellQty = sellTrade.executedQty || sellTrade.quantity;
      realizedPnL += (sellPrice - avgBuyPrice) * sellQty;
    }

    return realizedPnL;
  }

  private async getAccountStatusCache(): Promise<AccountStatusCache | null> {
    return this.accountCashSync.getCache();
  }

}
