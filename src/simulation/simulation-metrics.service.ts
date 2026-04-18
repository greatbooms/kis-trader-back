import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Side, SimulationTradeStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { RiskState } from '../trading/types';
import { SimulationMetrics } from './types';

/**
 * 시뮬레이션 성과 및 스냅샷 관련 로직.
 * - 일일 스냅샷 생성 (takeSnapshot)
 * - 누적 성과 메트릭 계산 (getMetrics)
 * - 거래/스냅샷 조회 (getTrades, getSnapshots)
 * - 시뮬레이션용 RiskState 평가 (evaluateSimulationRisk)
 *
 * 설계 원칙:
 * - Prisma만 사용하는 read/analytics 계층. 다른 SimulationXXX 서비스를 의존하지 않는다.
 * - 세션 상태 변경은 하지 않는다.
 */
@Injectable()
export class SimulationMetricsService {
  private readonly logger = new Logger(SimulationMetricsService.name);

  constructor(private prisma: PrismaService) {}

  /** 일일 스냅샷(전일 대비 수익, drawdown, 거래 수 등)을 upsert한다. */
  async takeSnapshot(sessionId: string): Promise<void> {
    const session = await this.prisma.simulationSession.findUnique({ where: { id: sessionId } });
    if (!session) return;

    const positions = await this.prisma.simulationPosition.findMany({ where: { sessionId } });
    const today = this.getTodayDate();

    const portfolioValue = positions.reduce(
      (sum, p) => sum + Number(p.quantity) * Number(p.currentPrice),
      0,
    );
    const cashBalance = Number(session.currentCash);
    const totalValue = portfolioValue + cashBalance;

    // Get previous snapshot for daily PnL
    const prevSnapshot = await this.prisma.simulationSnapshot.findFirst({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });

    const startingCapital = Number(session.quota);
    const prevTotalValue = prevSnapshot ? Number(prevSnapshot.totalValue) : startingCapital;
    const dailyPnl = totalValue - prevTotalValue;
    const dailyPnlRate = prevTotalValue > 0 ? dailyPnl / prevTotalValue : 0;

    // Drawdown calculation
    const peakValue = prevSnapshot
      ? Math.max(Number(prevSnapshot.peakValue), totalValue)
      : Math.max(startingCapital, totalValue);
    const drawdown = peakValue > 0 ? (peakValue - totalValue) / peakValue : 0;

    // Trade count today
    const todayTrades = await this.prisma.simulationTrade.count({
      where: {
        sessionId,
        tradeStatus: SimulationTradeStatus.EXECUTED,
        createdAt: this.getDayRange(today),
      },
    });

    await this.prisma.simulationSnapshot.upsert({
      where: { sessionId_snapshotDate: { sessionId, snapshotDate: today } },
      create: {
        sessionId,
        snapshotDate: today,
        portfolioValue: new Prisma.Decimal(portfolioValue),
        cashBalance: new Prisma.Decimal(cashBalance),
        totalValue: new Prisma.Decimal(totalValue),
        dailyPnl: new Prisma.Decimal(dailyPnl),
        dailyPnlRate: new Prisma.Decimal(dailyPnlRate),
        drawdown: new Prisma.Decimal(drawdown),
        peakValue: new Prisma.Decimal(peakValue),
        positionCount: positions.length,
        tradeCount: todayTrades,
      },
      update: {
        portfolioValue: new Prisma.Decimal(portfolioValue),
        cashBalance: new Prisma.Decimal(cashBalance),
        totalValue: new Prisma.Decimal(totalValue),
        dailyPnl: new Prisma.Decimal(dailyPnl),
        dailyPnlRate: new Prisma.Decimal(dailyPnlRate),
        drawdown: new Prisma.Decimal(drawdown),
        peakValue: new Prisma.Decimal(peakValue),
        positionCount: positions.length,
        tradeCount: todayTrades,
      },
    });
  }

  async getMetrics(sessionId: string): Promise<SimulationMetrics> {
    const session = await this.prisma.simulationSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const positions = await this.prisma.simulationPosition.findMany({ where: { sessionId } });
    const snapshots = await this.prisma.simulationSnapshot.findMany({
      where: { sessionId },
      orderBy: { snapshotDate: 'asc' },
    });
    const trades = await this.prisma.simulationTrade.findMany({
      where: { sessionId, tradeStatus: SimulationTradeStatus.EXECUTED },
      orderBy: { createdAt: 'asc' },
    });

    const currentPortfolioValue = positions.reduce(
      (sum, p) => sum + Number(p.quantity) * Number(p.currentPrice),
      0,
    );
    const currentCash = Number(session.currentCash);
    const totalValue = currentPortfolioValue + currentCash;
    const startingCapital = Number(session.quota);

    const totalReturnAmount = totalValue - startingCapital;
    const totalReturn = startingCapital > 0 ? totalReturnAmount / startingCapital : 0;

    // Max drawdown from snapshots
    const maxDrawdown = snapshots.length > 0
      ? Math.max(...snapshots.map((s) => Number(s.drawdown)))
      : 0;

    // Win rate: for each SELL trade, check if sell price > avg buy price at that time
    const sellTrades = trades.filter((t) => t.side === Side.SELL);
    let winTrades = 0;
    let lossTrades = 0;
    let totalProfit = 0;
    let totalLoss = 0;

    for (const sellTrade of sellTrades) {
      // Calculate avg buy price from all preceding buy trades for this stock
      const buyTrades = trades.filter(
        (t) => t.side === Side.BUY && t.stockCode === sellTrade.stockCode && t.createdAt <= sellTrade.createdAt,
      );
      const sellsBefore = trades.filter(
        (t) => t.side === Side.SELL && t.stockCode === sellTrade.stockCode && t.createdAt < sellTrade.createdAt,
      );

      // Replay to get avg buy price
      let totalBuyQty = 0;
      let totalBuyCost = 0;
      for (const bt of buyTrades) {
        totalBuyQty += bt.quantity;
        totalBuyCost += bt.quantity * Number(bt.price);
      }
      let totalSoldQty = 0;
      for (const st of sellsBefore) {
        totalSoldQty += st.quantity;
      }

      const remainingQty = totalBuyQty - totalSoldQty;
      const avgBuyPrice = remainingQty > 0 ? totalBuyCost / totalBuyQty : 0;

      const sellPrice = Number(sellTrade.price);
      const pnl = (sellPrice - avgBuyPrice) * sellTrade.quantity;

      if (pnl >= 0) {
        winTrades++;
        totalProfit += pnl;
      } else {
        lossTrades++;
        totalLoss += Math.abs(pnl);
      }
    }

    const totalTrades = sellTrades.length;
    const winRate = totalTrades > 0 ? winTrades / totalTrades : 0;

    // Sharpe ratio from daily returns
    let sharpeRatio = 0;
    if (snapshots.length > 1) {
      const dailyReturns = snapshots.map((s) => Number(s.dailyPnlRate));
      const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
      const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / dailyReturns.length;
      const stdDev = Math.sqrt(variance);
      sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
    }

    // Profit factor
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;

    // Realized PnL: net profit from all completed sell trades
    const realizedPnL = totalProfit - totalLoss;

    // Unrealized PnL: sum of open position profit/loss
    const unrealizedPnL = positions.reduce((sum, p) => sum + Number(p.profitLoss), 0);

    return {
      totalReturn,
      totalReturnAmount,
      realizedPnL,
      unrealizedPnL,
      maxDrawdown,
      winRate,
      totalTrades,
      winTrades,
      lossTrades,
      sharpeRatio,
      profitFactor: profitFactor === Infinity ? 999 : profitFactor,
      currentCash,
      currentPortfolioValue,
    };
  }

  async getTrades(
    sessionId: string,
    limit?: number,
    offset?: number,
    tradeStatus?: SimulationTradeStatus,
  ) {
    return this.prisma.simulationTrade.findMany({
      where: {
        sessionId,
        ...(tradeStatus ? { tradeStatus } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit || 50,
      skip: offset || 0,
    });
  }

  async getSnapshots(sessionId: string) {
    return this.prisma.simulationSnapshot.findMany({
      where: { sessionId },
      orderBy: { snapshotDate: 'asc' },
    });
  }

  /**
   * 시뮬레이션용 리스크 상태 평가 (실거래 `RiskManagementService.evaluateRisk`와 동일 로직).
   * TickEngine이 전략 컨텍스트에 넘길 RiskState를 만들기 위해 사용한다.
   */
  async evaluateSimulationRisk(
    sessionId: string,
    positions: { stockCode: string; quantity: number; avgPrice: any; currentPrice: any }[],
    currentCash: number,
  ): Promise<RiskState> {
    const reasons: string[] = [];

    const positionCount = positions.length;
    const totalCurrentValue = positions.reduce(
      (sum, p) => sum + Number(p.quantity) * Number(p.currentPrice),
      0,
    );
    const totalInvested = positions.reduce(
      (sum, p) => sum + Number(p.quantity) * Number(p.avgPrice),
      0,
    );

    const totalValue = totalCurrentValue + currentCash;
    const investedRate = totalValue > 0 ? totalCurrentValue / totalValue : 0;

    // 일일 PnL
    const dailyPnl = totalCurrentValue - totalInvested;
    const dailyPnlRate = totalInvested > 0 ? dailyPnl / totalInvested : 0;

    // MDD 계산: 시뮬레이션 스냅샷에서 peakValue 참조
    const latestSnapshot = await this.prisma.simulationSnapshot.findFirst({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });

    // MDD는 총 자산(포지션 + 현금) 기준으로 계산해야 정확
    const peakValue = latestSnapshot
      ? Math.max(Number(latestSnapshot.peakValue), totalValue)
      : totalValue;
    const drawdown = peakValue > 0 ? (totalValue - peakValue) / peakValue : 0;

    return {
      buyBlocked: false,
      liquidateAll: false,
      positionCount,
      investedRate,
      dailyPnlRate,
      drawdown,
      reasons,
    };
  }

  private getTodayDate(): string {
    return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  private getDayRange(date: string): { gte: Date; lt: Date } {
    return {
      gte: new Date(`${date}T00:00:00+09:00`),
      lt: new Date(`${date}T23:59:59.999+09:00`),
    };
  }
}
