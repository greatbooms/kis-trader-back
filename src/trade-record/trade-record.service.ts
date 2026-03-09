import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Market, Side } from '@prisma/client';

@Injectable()
export class TradeRecordService {
  constructor(private prisma: PrismaService) {}

  findAll(options?: { market?: Market; side?: Side; dateFrom?: string; dateTo?: string; limit?: number; offset?: number }) {
    const createdAt: Record<string, Date> = {};
    if (options?.dateFrom) createdAt.gte = new Date(options.dateFrom + 'T00:00:00');
    if (options?.dateTo) createdAt.lte = new Date(options.dateTo + 'T23:59:59');

    return this.prisma.tradeRecord.findMany({
      where: {
        ...(options?.market && { market: options.market }),
        ...(options?.side && { side: options.side }),
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
    const cashBalance = latestSnapshots.reduce((sum, s) => sum + Number(s.cashBalance), 0);
    const totalAssets = cashBalance + totalInvested + totalProfitLoss;

    return {
      cashBalance,
      totalInvested,
      totalAssets,
      totalProfitLoss,
      profitRate: totalInvested > 0 ? (totalProfitLoss / totalInvested) * 100 : 0,
      positionCount: positions.length,
    };
  }

}
