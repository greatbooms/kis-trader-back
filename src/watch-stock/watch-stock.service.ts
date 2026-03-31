import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Market, Prisma, WatchStockExecutionEventType } from '@prisma/client';

const MAX_TOTAL_ACTIVE_WATCH_STOCKS = 30;
const DUPLICATE_WATCH_STOCK_MESSAGE = '이미 등록된 관심종목입니다.';

@Injectable()
export class WatchStockService {
  constructor(private prisma: PrismaService) {}

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

  update(
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

    return this.prisma.watchStock.update({ where: { id }, data: updateData });
  }

  delete(id: string) {
    return this.prisma.watchStock.delete({ where: { id } });
  }
}
