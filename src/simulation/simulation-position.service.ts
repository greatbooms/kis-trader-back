import { Injectable, Logger } from '@nestjs/common';
import { Market, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';

/**
 * 시뮬레이션 포지션 상태를 관리한다.
 * - 현재가 기반 포지션 PnL 업데이트
 * - 세션의 cycle 값 계산 및 동기화
 *
 * 설계 원칙:
 * - 포지션 테이블만 직접 건드린다. 거래 레코드 생성은 TickEngine이 담당한다.
 * - cycle 계산 로직은 여기 한 곳에 둔다 (Resolver, TickEngine에서 재사용).
 */
@Injectable()
export class SimulationPositionService {
  private readonly logger = new Logger(SimulationPositionService.name);

  constructor(
    private prisma: PrismaService,
    private kisDomestic: KisDomesticService,
    private kisOverseas: KisOverseasService,
  ) {}

  /** 세션이 보유한 모든 포지션에 대해 현재가, PnL, profitRate를 업데이트한다. */
  async updatePositionPrices(sessionId: string): Promise<void> {
    const session = await this.prisma.simulationSession.findUnique({
      where: { id: sessionId },
      include: { positions: true },
    });
    if (!session) return;

    for (const pos of session.positions) {
      try {
        const exchangeCode = pos.exchangeCode;
        const price = session.market === Market.DOMESTIC
          ? await this.kisDomestic.getPrice(pos.stockCode)
          : await this.kisOverseas.getPrice(exchangeCode, pos.stockCode);

        const currentPrice = price.currentPrice;
        const avgPrice = Number(pos.avgPrice);
        const profitLoss = (currentPrice - avgPrice) * pos.quantity;
        const profitRate = avgPrice > 0 ? (currentPrice - avgPrice) / avgPrice : 0;

        await this.prisma.simulationPosition.update({
          where: { id: pos.id },
          data: {
            currentPrice: new Prisma.Decimal(currentPrice),
            profitLoss: new Prisma.Decimal(profitLoss),
            profitRate: new Prisma.Decimal(profitRate),
          },
        });
      } catch (e) {
        this.logger.error(`Failed to update price for ${pos.stockCode}: ${e.message}`);
      }
    }
  }

  /**
   * 누적 투자금 / per-cycle quota 비율을 0.1 단위로 반올림한 cycle 값을 반환한다.
   * UI 표시 용도로도 사용된다.
   */
  calculateSessionCycle(
    session: { quota: Prisma.Decimal | number; maxCycles: number },
    position?: { totalInvested: Prisma.Decimal | number } | null,
  ): number {
    const quota = Number(session.quota);
    if (!quota || quota <= 0 || session.maxCycles <= 0) {
      return 0;
    }

    const perCycleQuota = quota / session.maxCycles;
    if (perCycleQuota <= 0) {
      return 0;
    }

    const totalInvested = position?.totalInvested ? Number(position.totalInvested) : 0;
    if (totalInvested <= 0) {
      return 0;
    }

    return Math.round((totalInvested / perCycleQuota) * 10) / 10;
  }

  /** DB에 저장할 cycle 값은 정수. */
  getPersistedSessionCycle(cycle: number): number {
    return Math.max(0, Math.floor(cycle));
  }

  /** 체결 후 포지션 변화에 맞춰 세션의 cycle 값을 갱신한다. */
  async syncSessionCycle(sessionId: string, exchangeCode: string, stockCode: string): Promise<void> {
    const [session, position] = await Promise.all([
      this.prisma.simulationSession.findUnique({
        where: { id: sessionId },
        select: { id: true, quota: true, maxCycles: true, cycle: true },
      }),
      this.prisma.simulationPosition.findUnique({
        where: {
          sessionId_exchangeCode_stockCode: {
            sessionId,
            exchangeCode,
            stockCode,
          },
        },
        select: { totalInvested: true },
      }),
    ]);

    if (!session) return;

    const currentCycle = this.calculateSessionCycle(session, position);
    const persistedCycle = this.getPersistedSessionCycle(currentCycle);
    if (persistedCycle === session.cycle) return;

    await this.prisma.simulationSession.update({
      where: { id: sessionId },
      data: { cycle: persistedCycle },
    });
  }
}
