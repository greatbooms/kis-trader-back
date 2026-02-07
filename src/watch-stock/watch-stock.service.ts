import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Market, Prisma } from '@prisma/client';

@Injectable()
export class WatchStockService {
  constructor(private prisma: PrismaService) {}

  findAll(market?: Market) {
    return this.prisma.watchStock.findMany({
      where: market ? { market } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string) {
    return this.prisma.watchStock.findUnique({ where: { id } });
  }

  create(data: {
    market: Market;
    exchangeCode?: string;
    stockCode: string;
    stockName: string;
    isActive?: boolean;
    strategyName?: string;
    quota?: number;
    maxCycles?: number;
    stopLossRate?: number;
    maxPortfolioRate?: number;
  }) {
    return this.prisma.watchStock.create({
      data: {
        market: data.market,
        exchangeCode: data.exchangeCode,
        stockCode: data.stockCode,
        stockName: data.stockName,
        isActive: data.isActive,
        strategyName: data.strategyName,
        quota: data.quota != null ? new Prisma.Decimal(data.quota) : undefined,
        maxCycles: data.maxCycles,
        stopLossRate: data.stopLossRate != null ? new Prisma.Decimal(data.stopLossRate) : undefined,
        maxPortfolioRate: data.maxPortfolioRate != null ? new Prisma.Decimal(data.maxPortfolioRate) : undefined,
      },
    });
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

    return this.prisma.watchStock.update({ where: { id }, data: updateData });
  }

  delete(id: string) {
    return this.prisma.watchStock.delete({ where: { id } });
  }
}
