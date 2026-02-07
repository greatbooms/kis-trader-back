import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Market, Side } from '@prisma/client';

@Injectable()
export class TradeRecordService {
  constructor(private prisma: PrismaService) {}

  findAll(options?: { market?: Market; side?: Side; limit?: number; offset?: number }) {
    return this.prisma.tradeRecord.findMany({
      where: {
        ...(options?.market && { market: options.market }),
        ...(options?.side && { side: options.side }),
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

  /** 전략 실행 이력 조회 */
  findStrategyExecutions(options?: {
    stockCode?: string;
    strategyName?: string;
    limit?: number;
  }) {
    return this.prisma.strategyExecution.findMany({
      where: {
        ...(options?.stockCode && { stockCode: options.stockCode }),
        ...(options?.strategyName && { strategyName: options.strategyName }),
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 50,
    });
  }
}
