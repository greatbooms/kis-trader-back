import { Injectable, Logger } from '@nestjs/common';
import { Broker, Prisma } from '@prisma/client';
import { BrokerPortRegistry } from '../broker/broker-port.registry';
import { AccountCashBalance, AccountStatusCache } from '../common/types';
import { PrismaService } from '../prisma.service';

const ACCOUNT_STATUS_CACHE_KEY = 'account_status_cache';

@Injectable()
export class TradingAccountCashSyncService {
  private readonly logger = new Logger(TradingAccountCashSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: BrokerPortRegistry,
  ) {}

  async refreshMarketCash(market: 'DOMESTIC' | 'OVERSEAS'): Promise<void> {
    const cashBalances = market === 'DOMESTIC'
      ? await this.getDomesticCashBalances()
      : await this.getOverseasCashBalances();

    await this.mergeMarketCache(market, cashBalances);
    this.logger.debug(`Refreshed ${market} cash cache after broker fill`);
  }

  async replaceCache(cashBalances: AccountCashBalance[]): Promise<void> {
    await this.writeCache(async () => cashBalances);
  }

  private async getDomesticCashBalances(): Promise<AccountCashBalance[]> {
    const domesticCash = await this.registry.get(Broker.KIS).getDomesticBuyableAmount();
    return [{
      market: 'DOMESTIC',
      currencyCode: 'KRW',
      currencyName: '원화',
      amount: domesticCash.cashAvailable,
      withdrawableAmount: domesticCash.cashAvailable,
      orderableAmount: domesticCash.cashAvailable,
    }];
  }

  private async getOverseasCashBalances(): Promise<AccountCashBalance[]> {
    const snapshot = await this.registry.get(Broker.KIS).getOverseasAccountSnapshot();
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

  private async mergeMarketCache(
    market: 'DOMESTIC' | 'OVERSEAS',
    cashBalances: AccountCashBalance[],
  ): Promise<void> {
    await this.writeCache((current) => [
      ...current.filter((item) => item.market !== market),
      ...cashBalances,
    ]);
  }

  private async writeCache(
    buildCashBalances: (current: AccountCashBalance[]) => AccountCashBalance[] | Promise<AccountCashBalance[]>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${ACCOUNT_STATUS_CACHE_KEY}, 0))::text
      `;
      const saved = await tx.appSetting.findUnique({
        where: { key: ACCOUNT_STATUS_CACHE_KEY },
      });
      const current = (saved?.value as AccountStatusCache | null)?.cashBalances ?? [];
      const nextCashBalances = await buildCashBalances(current);
      const value = {
        cashBalances: nextCashBalances.map((item) => this.toJsonCashBalance(item)),
        lastSyncedAt: new Date().toISOString(),
      } as unknown as Prisma.InputJsonValue;

      await tx.appSetting.upsert({
        where: { key: ACCOUNT_STATUS_CACHE_KEY },
        create: { key: ACCOUNT_STATUS_CACHE_KEY, value },
        update: { value },
      });
    });
  }

  private toJsonCashBalance(item: AccountCashBalance): Prisma.InputJsonObject {
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
