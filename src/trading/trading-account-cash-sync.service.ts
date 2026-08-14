import { Injectable, Logger } from '@nestjs/common';
import { Broker, Prisma } from '@prisma/client';
import { BrokerPortRegistry } from '../broker/broker-port.registry';
import { AccountCashBalance, AccountStatusCache } from '../common/types';
import type { BrokerPort } from '../common/types';
import { PrismaService } from '../prisma.service';

const ACCOUNT_STATUS_CACHE_KEY = 'account_status_cache';

@Injectable()
export class TradingAccountCashSyncService {
  private readonly logger = new Logger(TradingAccountCashSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: BrokerPortRegistry,
  ) {}

  async refreshMarketCash(
    broker: Broker,
    market: 'DOMESTIC' | 'OVERSEAS',
  ): Promise<void> {
    const port = this.registry.get(broker);
    const cashBalances = market === 'DOMESTIC'
      ? await this.getDomesticCashBalances(port)
      : await this.getOverseasCashBalances(port);

    await this.writeCache(broker, market, cashBalances);
    this.logger.debug(`[${broker} ${market}] Refreshed cash cache after broker fill`);
  }

  async replaceCache(
    broker: Broker,
    cashBalances: AccountCashBalance[],
    authoritativeMarkets: Array<'DOMESTIC' | 'OVERSEAS'>,
  ): Promise<void> {
    for (const market of authoritativeMarkets) {
      const marketBalances = cashBalances.filter((item) => item.market === market);
      await this.writeCache(broker, market, marketBalances);
    }
  }

  async getCache(): Promise<AccountStatusCache | null> {
    const legacy = await this.prisma.appSetting.findUnique({
      where: { key: ACCOUNT_STATUS_CACHE_KEY },
    });
    const legacyCache = legacy?.value as AccountStatusCache | null;
    const cashBalances: AccountCashBalance[] = [];
    const syncedAt: string[] = [];

    for (const broker of [Broker.KIS, Broker.TOSS]) {
      for (const market of ['DOMESTIC', 'OVERSEAS'] as const) {
        const saved = await this.prisma.appSetting.findUnique({
          where: { key: this.cacheKey(broker, market) },
        });
        const scoped = saved?.value as AccountStatusCache | null;
        const cache = scoped ?? (broker === Broker.KIS ? legacyCache : null);
        const balances = cache?.cashBalances.filter((item) => item.market === market) ?? [];
        cashBalances.push(...balances.map((item) => ({ ...item, broker, market })));
        if (balances.length > 0 && cache?.lastSyncedAt) syncedAt.push(cache.lastSyncedAt);
      }
    }

    if (cashBalances.length === 0) return null;
    syncedAt.sort();
    return {
      cashBalances,
      lastSyncedAt: syncedAt[syncedAt.length - 1],
    };
  }

  private async getDomesticCashBalances(port: BrokerPort): Promise<AccountCashBalance[]> {
    const domesticCash = await port.getDomesticBuyableAmount();
    return [{
      market: 'DOMESTIC',
      currencyCode: 'KRW',
      currencyName: '원화',
      amount: domesticCash.cashAvailable,
      withdrawableAmount: domesticCash.cashAvailable,
      orderableAmount: domesticCash.cashAvailable,
    }];
  }

  private async getOverseasCashBalances(port: BrokerPort): Promise<AccountCashBalance[]> {
    const snapshot = await port.getOverseasAccountSnapshot();
    return snapshot.cashBalances.map((item) => ({
      market: 'OVERSEAS',
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
    }));
  }

  private async writeCache(
    broker: Broker,
    market: 'DOMESTIC' | 'OVERSEAS',
    cashBalances: AccountCashBalance[],
  ): Promise<void> {
    const key = this.cacheKey(broker, market);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text
      `;
      const value = {
        cashBalances: cashBalances.map((item) => this.toJsonCashBalance(broker, item)),
        lastSyncedAt: new Date().toISOString(),
      } as unknown as Prisma.InputJsonValue;

      await tx.appSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });

      if (broker === Broker.KIS) {
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${ACCOUNT_STATUS_CACHE_KEY}, 0))::text
        `;
        const legacy = await tx.appSetting.findUnique({
          where: { key: ACCOUNT_STATUS_CACHE_KEY },
        });
        const legacyCache = legacy?.value as AccountStatusCache | null;
        const legacyValue = {
          cashBalances: [
            ...(legacyCache?.cashBalances ?? []).filter((item) => item.market !== market),
            ...cashBalances.map((item) => this.toLegacyJsonCashBalance(item)),
          ],
          lastSyncedAt: new Date().toISOString(),
        } as unknown as Prisma.InputJsonValue;

        await tx.appSetting.upsert({
          where: { key: ACCOUNT_STATUS_CACHE_KEY },
          create: { key: ACCOUNT_STATUS_CACHE_KEY, value: legacyValue },
          update: { value: legacyValue },
        });
      }
    });
  }

  private cacheKey(broker: Broker, market: 'DOMESTIC' | 'OVERSEAS'): string {
    return `${ACCOUNT_STATUS_CACHE_KEY}:${broker}:${market}`;
  }

  private toJsonCashBalance(broker: Broker, item: AccountCashBalance): Prisma.InputJsonObject {
    return {
      broker,
      market: item.market,
      currencyCode: item.currencyCode,
      currencyName: item.currencyName ?? null,
      amount: item.amount,
      withdrawableAmount: item.withdrawableAmount ?? null,
      orderableAmount: item.orderableAmount ?? null,
      generalOrderableAmount: item.generalOrderableAmount ?? null,
      integratedOrderableAmount: item.integratedOrderableAmount ?? null,
      pendingBuyAmount: item.pendingBuyAmount ?? null,
      pendingSellAmount: item.pendingSellAmount ?? null,
      receivableAmount: item.receivableAmount ?? null,
      marginAmount: item.marginAmount ?? null,
    };
  }

  private toLegacyJsonCashBalance(item: AccountCashBalance): Prisma.InputJsonObject {
    return {
      market: item.market,
      currencyCode: item.currencyCode,
      currencyName: item.currencyName ?? null,
      amount: item.amount,
      withdrawableAmount: item.withdrawableAmount ?? null,
      orderableAmount: item.orderableAmount ?? null,
      generalOrderableAmount: item.generalOrderableAmount ?? null,
      integratedOrderableAmount: item.integratedOrderableAmount ?? null,
      pendingBuyAmount: item.pendingBuyAmount ?? null,
      pendingSellAmount: item.pendingSellAmount ?? null,
      receivableAmount: item.receivableAmount ?? null,
      marginAmount: item.marginAmount ?? null,
    };
  }
}
