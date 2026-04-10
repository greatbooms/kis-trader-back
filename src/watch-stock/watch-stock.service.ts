import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { Market, Prisma, WatchStockExecutionEventType } from '@prisma/client';
import { InfiniteBuyStrategyParams } from '../trading/types';

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
}
