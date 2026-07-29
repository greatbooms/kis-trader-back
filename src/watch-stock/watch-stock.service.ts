import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { Market, Prisma, WatchStockExecutionEventType } from '@prisma/client';
import { InfiniteBuyStrategyParams, InfiniteBuyV4Params } from '../trading/types';
import { DEFAULT_STAR_BASE_PCT_BY_STOCK } from '../trading/strategy/infinite-buy-v4.strategy';
import { ConvertWatchStockToV4Seed } from './types';

const MAX_TOTAL_ACTIVE_WATCH_STOCKS = 30;
const DUPLICATE_WATCH_STOCK_MESSAGE = '이미 등록된 관심종목입니다.';

@Injectable()
export class WatchStockService {
  private readonly logger = new Logger(WatchStockService.name);

  constructor(private prisma: PrismaService) {}

  @Cron('0 3 * * *', { timeZone: 'Asia/Seoul' })
  async cleanupOldSkippedLogs(): Promise<void> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.watchStockExecutionLog.deleteMany({
      where: {
        eventType: WatchStockExecutionEventType.SKIPPED,
        createdAt: { lt: cutoff },
      },
    });
    if (count > 0) {
      this.logger.log(`Cleaned up ${count} SKIPPED logs older than 7 days`);
    }
  }

  async getTotalActiveCount(): Promise<number> {
    return this.prisma.watchStock.count({ where: { isActive: true } });
  }

  async checkGlobalLimit(): Promise<void> {
    const total = await this.getTotalActiveCount();
    if (total >= MAX_TOTAL_ACTIVE_WATCH_STOCKS) {
      throw new BadRequestException(
        `전체 활성 관심종목이 최대 ${MAX_TOTAL_ACTIVE_WATCH_STOCKS}개를 초과할 수 없습니다. (현재: ${total}개)`,
      );
    }
  }

  findAll(market?: Market) {
    return this.prisma.watchStock.findMany({
      where: market ? { market } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string) {
    return this.prisma.watchStock.findUnique({ where: { id } });
  }

  async findCurrentCycleMap(items: Array<{
    id: string;
    market: Market;
    exchangeCode: string;
    stockCode: string;
    strategyName?: string | null;
    quota?: Prisma.Decimal | number | null;
    cycle: number;
    maxCycles: number;
  }>): Promise<Map<string, number>> {
    const cycleBasedItems = items.filter((item) => this.isCycleBasedStrategy(item.strategyName));
    const cycleById = new Map<string, number>();

    if (cycleBasedItems.length === 0) {
      for (const item of items) {
        cycleById.set(item.id, item.cycle);
      }
      return cycleById;
    }

    const positions = await this.prisma.position.findMany({
      where: {
        OR: cycleBasedItems.map((item) => ({
          market: item.market,
          exchangeCode: item.exchangeCode,
          stockCode: item.stockCode,
        })),
      },
      select: {
        market: true,
        exchangeCode: true,
        stockCode: true,
        totalInvested: true,
      },
    });

    const investedByKey = new Map<string, number>();
    for (const position of positions) {
      investedByKey.set(
        `${position.market}:${position.exchangeCode}:${position.stockCode}`,
        Number(position.totalInvested ?? 0),
      );
    }

    for (const item of items) {
      if (!this.isCycleBasedStrategy(item.strategyName)) {
        cycleById.set(item.id, item.cycle);
        continue;
      }

      const key = `${item.market}:${item.exchangeCode}:${item.stockCode}`;
      const totalInvested = investedByKey.get(key) ?? 0;
      cycleById.set(item.id, this.calculateCurrentCycle(item, totalInvested));
    }

    return cycleById;
  }

  findExecutionLogs(watchStockId: string, limit = 50) {
    return this.prisma.watchStockExecutionLog.findMany({
      where: { watchStockId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async findLatestExecutionLogs(watchStockIds: string[]) {
    if (watchStockIds.length === 0) return new Map<string, any>();

    const logs = await this.prisma.watchStockExecutionLog.findMany({
      where: { watchStockId: { in: watchStockIds } },
      orderBy: [{ watchStockId: 'asc' }, { createdAt: 'desc' }],
    });

    const latestByWatchStockId = new Map<string, any>();
    for (const log of logs) {
      if (!latestByWatchStockId.has(log.watchStockId)) {
        latestByWatchStockId.set(log.watchStockId, log);
      }
    }

    return latestByWatchStockId;
  }

  async logExecution(data: {
    watchStockId: string;
    tradeRecordId?: string;
    market: Market;
    exchangeCode: string;
    stockCode: string;
    stockName: string;
    strategyName?: string;
    eventType: WatchStockExecutionEventType;
    message: string;
    details?: Record<string, any>;
    dedupeWindowMinutes?: number;
  }) {
    const dedupeWindowMinutes = data.dedupeWindowMinutes ?? 0;
    if (dedupeWindowMinutes > 0) {
      const since = new Date(Date.now() - dedupeWindowMinutes * 60 * 1000);
      const existing = await this.prisma.watchStockExecutionLog.findFirst({
        where: {
          watchStockId: data.watchStockId,
          eventType: data.eventType,
          message: data.message,
          createdAt: { gte: since },
        },
        select: { id: true },
      });

      if (existing) {
        return null;
      }
    }

    return this.prisma.watchStockExecutionLog.create({
      data: {
        watchStockId: data.watchStockId,
        tradeRecordId: data.tradeRecordId,
        market: data.market,
        exchangeCode: data.exchangeCode,
        stockCode: data.stockCode,
        stockName: data.stockName,
        strategyName: data.strategyName,
        eventType: data.eventType,
        message: data.message,
        details: data.details,
      },
    });
  }

  private async ensureNotExists(market: Market, exchangeCode: string, stockCode: string): Promise<void> {
    const existing = await this.prisma.watchStock.findFirst({
      where: {
        market,
        exchangeCode,
        stockCode,
      },
      select: { id: true },
    });

    if (existing) {
      throw new BadRequestException(DUPLICATE_WATCH_STOCK_MESSAGE);
    }
  }

  private isUniqueConstraintError(error: unknown): error is { code: string } {
    return !!error && typeof error === 'object' && 'code' in error && error.code === 'P2002';
  }

  private isCycleBasedStrategy(strategyName?: string | null): boolean {
    return ['infinite-buy', 'daily-dca'].includes(strategyName || '');
  }

  private calculateCurrentCycle(
    item: {
      quota?: Prisma.Decimal | number | null;
      cycle: number;
      maxCycles: number;
    },
    totalInvested: number,
  ): number {
    const quota = Number(item.quota ?? 0);
    if (quota <= 0 || item.maxCycles <= 0) {
      return item.cycle;
    }

    const perCycleQuota = quota / item.maxCycles;
    if (perCycleQuota <= 0) {
      return item.cycle;
    }

    return Math.round((totalInvested / perCycleQuota) * 10) / 10;
  }

  private toStrategyParams(value: Prisma.JsonValue | Record<string, any> | null | undefined): Record<string, any> {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      return {};
    }
    return { ...(value as Record<string, any>) };
  }

  private roundQuota(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private async buildInfiniteBuyRebasedUpdate(
    current: {
      market: Market;
      exchangeCode: string;
      stockCode: string;
      strategyName: string | null;
      quota: Prisma.Decimal | null;
      maxCycles: number;
      strategyParams: Prisma.JsonValue | null;
    },
    data: {
      strategyName?: string;
      quota?: number;
      cycle?: number;
      maxCycles?: number;
      strategyParams?: Record<string, any>;
    },
  ): Promise<{ cycle?: number; strategyParams?: Record<string, any> }> {
    const effectiveStrategyName = data.strategyName ?? current.strategyName;
    if (effectiveStrategyName !== 'infinite-buy') {
      return {};
    }

    const currentQuota = Number(current.quota ?? 0);
    const nextQuota = data.quota !== undefined ? Number(data.quota) : currentQuota;
    const nextMaxCycles = data.maxCycles !== undefined ? data.maxCycles : current.maxCycles;
    const quotaChanged = data.quota !== undefined && nextQuota !== currentQuota;
    const maxCyclesChanged = data.maxCycles !== undefined && nextMaxCycles !== current.maxCycles;

    if (!quotaChanged && !maxCyclesChanged) {
      return {};
    }

    const mergedParams = {
      ...this.toStrategyParams(current.strategyParams),
      ...(data.strategyParams ?? {}),
    } as InfiniteBuyStrategyParams;

    const update: { cycle?: number; strategyParams?: Record<string, any> } = {};
    const nextPerCycleQuota = nextQuota > 0 && nextMaxCycles > 0 ? nextQuota / nextMaxCycles : 0;
    const currentPerCycleQuota =
      currentQuota > 0 && current.maxCycles > 0 ? currentQuota / current.maxCycles : 0;

    const position = await this.prisma.position.findUnique({
      where: {
        market_exchangeCode_stockCode: {
          market: current.market,
          exchangeCode: current.exchangeCode,
          stockCode: current.stockCode,
        },
      },
      select: { totalInvested: true },
    });

    const totalInvested = Number(position?.totalInvested ?? 0);
    update.cycle =
      nextPerCycleQuota > 0 && totalInvested > 0
        ? Math.max(0, Math.floor(totalInvested / nextPerCycleQuota))
        : 0;

    let strategyParamsChanged = data.strategyParams !== undefined;
    const currentAccumulatedQuota = Number(mergedParams.accumulatedQuota || 0);
    if (currentAccumulatedQuota > 0 && currentPerCycleQuota > 0 && nextPerCycleQuota > 0) {
      const carriedCycles = currentAccumulatedQuota / currentPerCycleQuota;
      const rebasedAccumulatedQuota = this.roundQuota(carriedCycles * nextPerCycleQuota);
      if (rebasedAccumulatedQuota > 0) {
        mergedParams.accumulatedQuota = rebasedAccumulatedQuota;
      } else {
        delete mergedParams.accumulatedQuota;
      }
      strategyParamsChanged = true;
    }

    if (strategyParamsChanged) {
      update.strategyParams = mergedParams;
    }

    this.logger.log(
      `[${current.stockCode}] Rebased infinite-buy state after quota update: ` +
      `quota ${currentQuota} -> ${nextQuota}, maxCycles ${current.maxCycles} -> ${nextMaxCycles}, ` +
      `cycle=${update.cycle}, accumulatedQuota=${update.strategyParams?.accumulatedQuota ?? mergedParams.accumulatedQuota ?? 0}`,
    );

    return update;
  }

  async create(data: {
    market: Market;
    exchangeCode: string;
    stockCode: string;
    stockName: string;
    isActive?: boolean;
    strategyName?: string;
    quota?: number;
    maxCycles?: number;
    stopLossRate?: number;
    maxPortfolioRate?: number;
    strategyParams?: Record<string, any>;
  }) {
    await this.ensureNotExists(data.market, data.exchangeCode, data.stockCode);
    await this.checkGlobalLimit();
    try {
      return await this.prisma.watchStock.create({
        data: {
          market: data.market,
          exchangeCode: data.exchangeCode,
          stockCode: data.stockCode,
          stockName: data.stockName,
          isActive: data.isActive ?? false,
          strategyName: data.strategyName,
          quota: data.quota != null ? new Prisma.Decimal(data.quota) : undefined,
          maxCycles: data.maxCycles,
          stopLossRate: data.stopLossRate != null ? new Prisma.Decimal(data.stopLossRate) : undefined,
          maxPortfolioRate: data.maxPortfolioRate != null ? new Prisma.Decimal(data.maxPortfolioRate) : undefined,
          strategyParams: data.strategyParams ?? undefined,
        },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new BadRequestException(DUPLICATE_WATCH_STOCK_MESSAGE);
      }
      throw error;
    }
  }

  async update(
    id: string,
    data: {
      exchangeCode?: string;
      stockName?: string;
      isActive?: boolean;
      strategyName?: string;
      quota?: number;
      cycle?: number;
      maxCycles?: number;
      stopLossRate?: number;
      maxPortfolioRate?: number;
      strategyParams?: Record<string, any>;
    },
  ) {
    const current = await this.prisma.watchStock.findUnique({
      where: { id },
      select: {
        market: true,
        exchangeCode: true,
        stockCode: true,
        strategyName: true,
        quota: true,
        maxCycles: true,
        strategyParams: true,
      },
    });

    if (!current) {
      throw new BadRequestException('관심종목을 찾을 수 없습니다.');
    }

    const updateData: any = {};
    if (data.exchangeCode !== undefined) updateData.exchangeCode = data.exchangeCode;
    if (data.stockName !== undefined) updateData.stockName = data.stockName;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.strategyName !== undefined) updateData.strategyName = data.strategyName;
    if (data.quota !== undefined) updateData.quota = new Prisma.Decimal(data.quota);
    if (data.cycle !== undefined) updateData.cycle = data.cycle;
    if (data.maxCycles !== undefined) updateData.maxCycles = data.maxCycles;
    if (data.stopLossRate !== undefined) updateData.stopLossRate = new Prisma.Decimal(data.stopLossRate);
    if (data.maxPortfolioRate !== undefined) updateData.maxPortfolioRate = new Prisma.Decimal(data.maxPortfolioRate);
    if (data.strategyParams !== undefined) updateData.strategyParams = data.strategyParams;

    const rebasedUpdate = await this.buildInfiniteBuyRebasedUpdate(current, data);
    if (rebasedUpdate.cycle !== undefined) updateData.cycle = rebasedUpdate.cycle;
    if (rebasedUpdate.strategyParams !== undefined) updateData.strategyParams = rebasedUpdate.strategyParams;

    return this.prisma.watchStock.update({ where: { id }, data: updateData });
  }

  async resetAccumulatedQuota(id: string) {
    const current = await this.prisma.watchStock.findUnique({
      where: { id },
      select: {
        strategyName: true,
        strategyParams: true,
      },
    });

    if (!current) {
      throw new BadRequestException('관심종목을 찾을 수 없습니다.');
    }

    if (!['infinite-buy', 'daily-dca'].includes(current.strategyName || '')) {
      throw new BadRequestException('이월금 리셋은 분할매수 전략에서만 지원됩니다.');
    }

    const params = this.toStrategyParams(current.strategyParams);
    const { accumulatedQuota: _accumulatedQuota, lastAccumulatedDate: _lastAccumulatedDate, ...rest } = params;

    await this.prisma.watchStock.update({
      where: { id },
      data: {
        strategyParams: rest,
      },
    });
  }

  delete(id: string) {
    return this.prisma.watchStock.delete({ where: { id } });
  }

  private resolveV4StarBasePct(stockCode: string, strategyParams: Record<string, any>): number | undefined {
    const existingV4 = (strategyParams.v4 ?? {}) as InfiniteBuyV4Params;
    return existingV4.starBasePct ?? DEFAULT_STAR_BASE_PCT_BY_STOCK[stockCode.toUpperCase()];
  }

  /**
   * 기존 `infinite-buy` 종목을 `infinite-buy-v4`로 전환한다 (docs/infinite-buy-v4-spec.md §2/§9).
   * dryRun=true(기본)면 시딩 값만 계산해 반환하고 DB는 건드리지 않는다. dryRun=false여야 실제 전환한다.
   */
  async convertToInfiniteBuyV4(watchStockId: string, dryRun = true): Promise<ConvertWatchStockToV4Seed> {
    const watchStock = await this.prisma.watchStock.findUnique({ where: { id: watchStockId } });
    if (!watchStock) {
      throw new BadRequestException('관심종목을 찾을 수 없습니다.');
    }
    if (watchStock.market !== Market.OVERSEAS) {
      throw new BadRequestException('V4 전환은 해외(OVERSEAS) 종목만 지원합니다.');
    }
    if (watchStock.strategyName === 'infinite-buy-v4') {
      throw new BadRequestException('이미 infinite-buy-v4 전략입니다.');
    }
    // 시딩 역산(T=투입액/회차금)은 infinite-buy 계열 사이클 의미를 전제 — 다른 전략은 UI 우회 호출도 거부
    if (watchStock.strategyName !== 'infinite-buy') {
      throw new BadRequestException('V4 전환은 infinite-buy 전략 종목만 지원합니다.');
    }

    const quota = Number(watchStock.quota ?? 0);
    if (quota <= 0 || watchStock.maxCycles <= 0) {
      throw new BadRequestException('투자금(quota)과 최대 사이클(maxCycles)이 설정되어야 V4로 전환할 수 있습니다.');
    }

    const currentParams = this.toStrategyParams(watchStock.strategyParams);
    const starBasePct = this.resolveV4StarBasePct(watchStock.stockCode, currentParams);
    if (starBasePct === undefined) {
      throw new BadRequestException(
        `${watchStock.stockCode} 종목은 별% 기본값이 없습니다. strategyParams.v4.starBasePct를 지정한 뒤 다시 시도하세요.`,
      );
    }

    const position = await this.prisma.position.findUnique({
      where: {
        market_exchangeCode_stockCode: {
          market: watchStock.market,
          exchangeCode: watchStock.exchangeCode,
          stockCode: watchStock.stockCode,
        },
      },
      select: { totalInvested: true, quantity: true },
    });

    const totalInvested = Number(position?.totalInvested ?? 0);
    const perCycleQuota = quota / watchStock.maxCycles;
    const turn = perCycleQuota > 0 ? totalInvested / perCycleQuota : 0;
    const cashRemaining = this.roundQuota(Math.max(0, quota - totalInvested));
    const lastKnownHoldQty = position?.quantity ?? 0;

    const warnings: string[] = [];
    if (turn >= watchStock.maxCycles / 2) {
      warnings.push('후반전 이어받기 — 별지점이 평단 아래라 쿼터매도가 손절성으로 즉시 나갈 수 있습니다.');
    }
    if (turn > watchStock.maxCycles - 1) {
      warnings.push('소진 상태 — 첫 평가에서 REVERSE 모드로 진입합니다.');
    }

    const seed: ConvertWatchStockToV4Seed = {
      watchStockId,
      dryRun,
      applied: false,
      isActive: watchStock.isActive,
      starBasePct,
      turn,
      cashRemaining,
      lastKnownHoldQty,
      mode: 'NORMAL',
      cycleSeq: 0,
      warnings,
    };

    if (dryRun) {
      return seed;
    }

    await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.watchStock.findUnique({ where: { id: watchStockId } });
      if (!fresh) {
        throw new BadRequestException('관심종목을 찾을 수 없습니다.');
      }
      if (fresh.strategyName !== 'infinite-buy') {
        throw new BadRequestException('전환 도중 전략이 변경되어 중단합니다. 다시 확인 후 시도하세요.');
      }

      const mergedParams = this.toStrategyParams(fresh.strategyParams);
      const v4Params: InfiniteBuyV4Params = {
        ...(mergedParams.v4 ?? {}),
        mode: 'NORMAL',
        turn,
        cashRemaining,
        cycleSeq: 0,
        recentCloses: [],
        lastKnownHoldQty,
      };
      mergedParams.v4 = v4Params;

      await tx.watchStock.update({
        where: { id: watchStockId },
        data: {
          strategyName: 'infinite-buy-v4',
          strategyParams: mergedParams,
        },
      });

      this.logger.log(
        `[${watchStock.stockCode}] Converted infinite-buy -> infinite-buy-v4: turn=${turn}, cashRemaining=${cashRemaining}, lastKnownHoldQty=${lastKnownHoldQty}`,
      );
    });

    return { ...seed, applied: true };
  }
}
