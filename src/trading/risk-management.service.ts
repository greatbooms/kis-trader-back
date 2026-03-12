import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { RiskState } from './types';
import { Market, Prisma } from '@prisma/client';

@Injectable()
export class RiskManagementService {
  private readonly logger = new Logger(RiskManagementService.name);

  constructor(private prisma: PrismaService) {}

  /** 리스크 상태 평가 */
  async evaluateRisk(market: 'DOMESTIC' | 'OVERSEAS'): Promise<RiskState> {
    const reasons: string[] = [];

    // 포지션 조회
    const positions = await this.prisma.position.findMany({
      where: { market: market as Market },
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

    // 포트폴리오 가치 (현재가 기준)
    const portfolioValue = totalCurrentValue;

    // 투자 비중 계산 (현재 투자금 / 총 포트폴리오 가치 추정)
    // 최근 RiskSnapshot에서 전체 가치 참조, 없으면 투자금으로 추정
    const latestSnapshot = await this.prisma.riskSnapshot.findFirst({
      where: { market: market as Market },
      orderBy: { createdAt: 'desc' },
    });

    const totalValue = latestSnapshot
      ? Number(latestSnapshot.portfolioValue) + Number(latestSnapshot.cashBalance)
      : totalCurrentValue * 1.25; // 추정: 현금 20% 가정

    const investedRate = totalValue > 0 ? totalCurrentValue / totalValue : 0;

    // 일일 PnL
    const dailyPnl = totalCurrentValue - totalInvested;
    const dailyPnlRate = totalInvested > 0 ? dailyPnl / totalInvested : 0;

    // MDD 계산 (피크 대비 하락률)
    const peakValue = latestSnapshot
      ? Math.max(Number(latestSnapshot.peakValue), totalCurrentValue)
      : totalCurrentValue;
    const drawdown = peakValue > 0 ? (totalCurrentValue - peakValue) / peakValue : 0;

    let buyBlocked = false;
    let liquidateAll = false;

    // 규칙: 보유 종목 >= 6개 → 신규 매수 차단
    if (positionCount >= 6) {
      buyBlocked = true;
      reasons.push(`보유 종목 ${positionCount}개 >= 6개`);
    }

    // 규칙: 투자비중 >= 80% → 신규 매수 차단
    if (investedRate >= 0.8) {
      buyBlocked = true;
      reasons.push(`투자비중 ${(investedRate * 100).toFixed(1)}% >= 80%`);
    }

    // 규칙: 일일 손실 <= -2% → 당일 신규 매수 차단
    if (dailyPnlRate <= -0.02) {
      buyBlocked = true;
      reasons.push(`일일 손실 ${(dailyPnlRate * 100).toFixed(1)}% <= -2%`);
    }

    // MDD 관련 규칙은 전략별 riskLevel에 따라 다르게 적용됨
    // → evaluateStrategyMdd() 참조 (risk-state.type.ts)
    // 여기서는 drawdown 값만 전달하고, 전략 evaluateStock()에서 판단

    const riskState: RiskState = {
      buyBlocked,
      liquidateAll,
      positionCount,
      investedRate,
      dailyPnlRate,
      drawdown,
      reasons,
    };

    if (reasons.length > 0) {
      this.logger.warn(`Risk state [${market}]: ${reasons.join(', ')}`);
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
    market: 'DOMESTIC' | 'OVERSEAS',
    portfolioValue: number,
    cashBalance: number,
  ): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);

    // 이전 피크 값
    const prevSnapshot = await this.prisma.riskSnapshot.findFirst({
      where: { market: market as Market },
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
      where: { market: market as Market },
    });

    const totalValue = portfolioValue + cashBalance;
    const investedRate = totalValue > 0 ? portfolioValue / totalValue : 0;

    try {
      await this.prisma.riskSnapshot.upsert({
        where: {
          market_snapshotDate: {
            market: market as Market,
            snapshotDate: today,
          },
        },
        create: {
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
      this.logger.error(`Failed to save risk snapshot: ${e.message}`);
    }
  }
}
