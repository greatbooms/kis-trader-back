import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { Market, Side, OrderType, OrderStatus, Prisma } from '@prisma/client';
import { ManualSellInput } from './dto';
import { BalanceItem } from '../kis/types/kis-api.types';
import { AccountCashBalance, AccountStatusCache } from './types';

@Injectable()
export class TradeRecordService {
  private readonly logger = new Logger(TradeRecordService.name);
  private readonly accountStatusCacheKey = 'account_status_cache';

  constructor(
    private prisma: PrismaService,
    private kisDomestic: KisDomesticService,
    private kisOverseas: KisOverseasService,
  ) {}

  findAll(options?: {
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
      take: 2, // DOMESTIC + OVERSEAS 각 1개
      distinct: ['market'],
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

    try {
      const domesticBalance = await this.kisDomestic.getBalance();
      await this.syncPositions('DOMESTIC', domesticBalance);
      const domesticCash = await this.kisDomestic.getBuyableAmount();
      cashBalances.push({
        market: Market.DOMESTIC,
        currencyCode: 'KRW',
        currencyName: '원화',
        amount: domesticCash.cashAvailable,
        withdrawableAmount: domesticCash.cashAvailable,
      });
      hasSuccess = true;
    } catch (e) {
      messages.push(`국내 계좌 조회 실패: ${e.message}`);
      this.logger.warn(`Failed to refresh domestic account state: ${e.message}`);
    }

    try {
      const overseasSnapshot = await this.kisOverseas.getAccountSnapshot();
      await this.syncPositions('OVERSEAS', overseasSnapshot.balance);
      const overseasCashBalances = overseasSnapshot.cashBalances;
      cashBalances.push(
        ...overseasCashBalances.map((item) => ({
          market: Market.OVERSEAS,
          currencyCode: item.currencyCode,
          currencyName: item.currencyName,
          amount: item.amount,
          withdrawableAmount: item.withdrawableAmount,
        })),
      );
      hasSuccess = true;
    } catch (e) {
      messages.push(`해외 계좌 조회 실패: ${e.message}`);
      this.logger.warn(`Failed to refresh overseas account state: ${e.message}`);
    }

    if (cashBalances.length > 0) {
      const cacheValue = {
        cashBalances: cashBalances.map((item) => ({
          market: item.market,
          currencyCode: item.currencyCode,
          currencyName: item.currencyName ?? null,
          amount: item.amount,
          withdrawableAmount: item.withdrawableAmount ?? null,
        })),
        lastSyncedAt: new Date().toISOString(),
      } as Prisma.InputJsonValue;

      await this.prisma.appSetting.upsert({
        where: { key: this.accountStatusCacheKey },
        create: {
          key: this.accountStatusCacheKey,
          value: cacheValue,
        },
        update: {
          value: cacheValue,
        },
      });
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
      const buyTrades = trades.filter(
        (t) => t.side === 'BUY' && t.stockCode === sellTrade.stockCode && t.createdAt <= sellTrade.createdAt,
      );
      const sellsBefore = trades.filter(
        (t) => t.side === 'SELL' && t.stockCode === sellTrade.stockCode && t.createdAt < sellTrade.createdAt,
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
    const saved = await this.prisma.appSetting.findUnique({
      where: { key: this.accountStatusCacheKey },
    });
    return (saved?.value as AccountStatusCache | null) ?? null;
  }

  private async syncPositions(market: 'DOMESTIC' | 'OVERSEAS', items: BalanceItem[]): Promise<void> {
    for (const item of items) {
      const totalInvested = item.quantity * item.avgPrice;

      await this.prisma.position.upsert({
        where: {
          market_exchangeCode_stockCode: {
            market: market as Market,
            exchangeCode: item.exchangeCode ?? (market === 'DOMESTIC' ? 'KRX' : ''),
            stockCode: item.stockCode,
          },
        },
        create: {
          market: market as Market,
          exchangeCode: item.exchangeCode ?? (market === 'DOMESTIC' ? 'KRX' : ''),
          stockCode: item.stockCode,
          stockName: item.stockName,
          quantity: item.quantity,
          avgPrice: new Prisma.Decimal(item.avgPrice),
          currentPrice: new Prisma.Decimal(item.currentPrice),
          profitLoss: new Prisma.Decimal(item.profitLoss),
          profitRate: new Prisma.Decimal(item.profitRate),
          totalInvested: new Prisma.Decimal(totalInvested),
        },
        update: {
          quantity: item.quantity,
          avgPrice: new Prisma.Decimal(item.avgPrice),
          currentPrice: new Prisma.Decimal(item.currentPrice),
          profitLoss: new Prisma.Decimal(item.profitLoss),
          profitRate: new Prisma.Decimal(item.profitRate),
          stockName: item.stockName,
          exchangeCode: item.exchangeCode ?? (market === 'DOMESTIC' ? 'KRX' : ''),
          totalInvested: new Prisma.Decimal(totalInvested),
        },
      });
    }

    const stockCodes = items.map((i) => i.stockCode);
    if (stockCodes.length > 0) {
      await this.prisma.position.deleteMany({
        where: {
          market: market as Market,
          stockCode: { notIn: stockCodes },
        },
      });
      return;
    }

    await this.prisma.position.deleteMany({
      where: { market: market as Market },
    });
  }

  /** 수동 매도 */
  async manualSell(input: ManualSellInput): Promise<{ success: boolean; message?: string; orderNo?: string }> {
    const position = await this.prisma.position.findFirst({
      where: { stockCode: input.stockCode, market: input.market as Market },
    });

    if (!position || position.quantity <= 0) {
      return { success: false, message: '보유 포지션이 없습니다.' };
    }

    const sellQty = input.quantity || position.quantity;
    if (sellQty > position.quantity) {
      return { success: false, message: `보유 수량(${position.quantity})보다 많은 수량입니다.` };
    }

    // 현재가 조회
    let currentPrice: number;
    try {
      if (input.market === 'DOMESTIC') {
        const price = await this.kisDomestic.getPrice(input.stockCode);
        currentPrice = price.currentPrice;
      } else {
        const exchangeCode = input.exchangeCode || position.exchangeCode;
        const price = await this.kisOverseas.getPrice(exchangeCode, input.stockCode);
        currentPrice = price.currentPrice;
      }
    } catch (e) {
      return { success: false, message: `현재가 조회 실패: ${e.message}` };
    }

    const isOverseas = input.market === 'OVERSEAS';
    const roundPrice = isOverseas
      ? Math.round(currentPrice * 100) / 100
      : Math.round(currentPrice);

    // TradeRecord 생성
    const record = await this.prisma.tradeRecord.create({
      data: {
        market: input.market as Market,
        exchangeCode: input.exchangeCode || position.exchangeCode,
        stockCode: input.stockCode,
        stockName: position.stockName,
        side: 'SELL',
        orderType: OrderType.LIMIT,
        quantity: sellQty,
        price: new Prisma.Decimal(roundPrice),
        status: OrderStatus.PENDING,
        strategyName: 'manual',
        reason: '수동 매도',
      },
    });

    try {
      let result;
      if (input.market === 'DOMESTIC') {
        result = await this.kisDomestic.orderSell(input.stockCode, sellQty, roundPrice, '00');
      } else {
        const exchangeCode = input.exchangeCode || position.exchangeCode;
        result = await this.kisOverseas.orderSell(exchangeCode, input.stockCode, sellQty, roundPrice, '00');
      }

      await this.prisma.tradeRecord.update({
        where: { id: record.id },
        data: {
          status: result.success ? OrderStatus.PENDING : OrderStatus.FAILED,
          orderNo: result.orderNo,
          reason: result.message,
        },
      });

      if (result.success) {
        this.logger.log(`Manual sell order submitted: ${input.stockCode} x ${sellQty} @ ${roundPrice}`);
        return { success: true, orderNo: result.orderNo, message: `${sellQty}주 매도 주문 접수` };
      } else {
        return { success: false, message: result.message };
      }
    } catch (e) {
      await this.prisma.tradeRecord.update({
        where: { id: record.id },
        data: { status: OrderStatus.FAILED, reason: e.message },
      });
      return { success: false, message: e.message };
    }
  }
}
