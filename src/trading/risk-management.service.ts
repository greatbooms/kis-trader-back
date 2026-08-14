import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { RiskState } from './types';
import { Broker, Market, Prisma } from '@prisma/client';

@Injectable()
export class RiskManagementService {
  private readonly logger = new Logger(RiskManagementService.name);

  constructor(private prisma: PrismaService) {}

  /** 리스크 상태 평가 */
  async evaluateRisk(broker: Broker, market: 'DOMESTIC' | 'OVERSEAS'): Promise<RiskState> {
    const reasons: string[] = [];

    // 포지션 조회
    const positions = await this.prisma.position.findMany({
      where: { broker, market: market as Market },
    });

    const positionCount = positions.length;
    const totalInvested = positions.reduce(
      (sum, p) => sum + Number(p.quantity) * Number(p.avgPrice),
      0,
    );
    const totalCurrentValue = positions.reduce(
      (sum, p) => sum + Number(p.quantity) * Number(p.currentPrice),
      0,
    );

    // 최근 RiskSnapshot을 이용해 시장별 상태 지표만 계산
    const latestSnapshot = await this.prisma.riskSnapshot.findFirst({
      where: { broker, market: market as Market },
      orderBy: { createdAt: 'desc' },
    });

    const cashBalance = latestSnapshot ? Number(latestSnapshot.cashBalance) : 0;
    const totalValue = totalCurrentValue + cashBalance;

    const investedRate = totalValue > 0 ? totalCurrentValue / totalValue : 0;

    // 일일 PnL
    const dailyPnl = totalCurrentValue - totalInvested;
    const dailyPnlRate = totalInvested > 0 ? dailyPnl / totalInvested : 0;

    // MDD 계산 (피크 대비 하락률)
    const peakValue = latestSnapshot
      ? Math.max(Number(latestSnapshot.peakValue), totalCurrentValue)
      : totalCurrentValue;
    const drawdown = peakValue > 0 ? (totalCurrentValue - peakValue) / peakValue : 0;

    const riskState: RiskState = {
      buyBlocked: false,
      liquidateAll: false,
      positionCount,
      investedRate,
      dailyPnlRate,
      drawdown,
      reasons,
    };

    if (reasons.length > 0) {
      this.logger.warn(`Risk state [${broker} ${market}]: ${reasons.join(', ')}`);
    }

    return riskState;
  }

  /** 단일 종목 비중 체크 (전체 15% 초과 시 추가매수 차단) */
  checkSingleStockLimit(
    stockInvested: number,
    totalPortfolioValue: number,
  ): boolean {
    if (totalPortfolioValue <= 0) return false;
    return stockInvested / totalPortfolioValue > 0.15;
  }

  /** 일별 리스크 스냅샷 저장 */
  async saveRiskSnapshot(
    broker: Broker,
    market: 'DOMESTIC' | 'OVERSEAS',
    portfolioValue: number,
    cashBalance: number,
  ): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);

    // 이전 피크 값
    const prevSnapshot = await this.prisma.riskSnapshot.findFirst({
      where: { broker, market: market as Market },
      orderBy: { createdAt: 'desc' },
    });

    const prevPortfolioValue = prevSnapshot ? Number(prevSnapshot.portfolioValue) : portfolioValue;
    const peakValue = prevSnapshot
      ? Math.max(Number(prevSnapshot.peakValue), portfolioValue)
      : portfolioValue;

    const dailyPnl = portfolioValue - prevPortfolioValue;
    const dailyPnlRate = prevPortfolioValue > 0 ? dailyPnl / prevPortfolioValue : 0;
    const drawdown = peakValue > 0 ? (portfolioValue - peakValue) / peakValue : 0;

    const positions = await this.prisma.position.findMany({
      where: { broker, market: market as Market },
    });

    const totalValue = portfolioValue + cashBalance;
    const investedRate = totalValue > 0 ? portfolioValue / totalValue : 0;

    try {
      await this.prisma.riskSnapshot.upsert({
        where: {
          broker_market_snapshotDate: {
            broker,
            market: market as Market,
            snapshotDate: today,
          },
        },
        create: {
          broker,
          market: market as Market,
          snapshotDate: today,
          portfolioValue: new Prisma.Decimal(portfolioValue),
          cashBalance: new Prisma.Decimal(cashBalance),
          dailyPnl: new Prisma.Decimal(dailyPnl),
          dailyPnlRate: new Prisma.Decimal(dailyPnlRate),
          drawdown: new Prisma.Decimal(drawdown),
          peakValue: new Prisma.Decimal(peakValue),
          positionCount: positions.length,
          investedRate: new Prisma.Decimal(investedRate),
        },
        update: {
          portfolioValue: new Prisma.Decimal(portfolioValue),
          cashBalance: new Prisma.Decimal(cashBalance),
          dailyPnl: new Prisma.Decimal(dailyPnl),
          dailyPnlRate: new Prisma.Decimal(dailyPnlRate),
          drawdown: new Prisma.Decimal(drawdown),
          peakValue: new Prisma.Decimal(peakValue),
          positionCount: positions.length,
          investedRate: new Prisma.Decimal(investedRate),
        },
      });
    } catch (e) {
      this.logger.error(`[${broker} ${market}] Failed to save risk snapshot: ${e.message}`);
    }
  }
}
