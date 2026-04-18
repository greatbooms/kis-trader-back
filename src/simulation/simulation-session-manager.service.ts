import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Market, Prisma, SimulationStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { InfiniteBuyStrategyParams } from '../trading/types';
import { CreateSimulationInput } from './dto';

/**
 * 시뮬레이션 세션의 life-cycle을 담당한다.
 * - 세션 CRUD (create/update/delete/reset/조회)
 * - strategyParams 저장/병합 유틸
 * - infinite-buy 전략 특화 state 리베이스 및 secondary exit plan 관리
 *
 * 설계 원칙:
 * - 세션/포지션 테이블의 상태 변경은 이 서비스를 통해서만 한다.
 * - 포지션 가격 업데이트, 거래 실행 등 시세 의존 로직은 포함하지 않는다.
 */
@Injectable()
export class SimulationSessionManager {
  private readonly logger = new Logger(SimulationSessionManager.name);

  constructor(private prisma: PrismaService) {}

  async createSession(input: CreateSimulationInput) {
    return this.prisma.simulationSession.create({
      data: {
        name: input.name,
        description: input.description,
        market: input.market,
        exchangeCode: input.exchangeCode,
        stockCode: input.stockCode,
        stockName: input.stockName,
        countryCode: input.countryCode,
        strategyName: input.strategyName,
        currentCash: new Prisma.Decimal(input.quota),
        quota: new Prisma.Decimal(input.quota),
        stopLossRate: input.stopLossRate
          ? new Prisma.Decimal(input.stopLossRate)
          : new Prisma.Decimal(input.strategyName === 'infinite-buy' ? 0.5 : 0.3),
        maxPortfolioRate: input.maxPortfolioRate ? new Prisma.Decimal(input.maxPortfolioRate) : new Prisma.Decimal(0.2),
        strategyParams: input.strategyParams ? JSON.parse(input.strategyParams) : undefined,
      },
    });
  }

  async getSessions(status?: SimulationStatus) {
    const where = status ? { status } : {};
    return this.prisma.simulationSession.findMany({
      where,
      include: { positions: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSession(id: string) {
    return this.prisma.simulationSession.findUnique({
      where: { id },
      include: { positions: true },
    });
  }

  async getPositions(sessionId: string) {
    return this.prisma.simulationPosition.findMany({
      where: { sessionId },
      orderBy: { stockCode: 'asc' },
    });
  }

  async updateStatus(id: string, status: SimulationStatus) {
    const data: any = { status };
    if (status === SimulationStatus.COMPLETED) {
      data.stoppedAt = new Date();
    }
    return this.prisma.simulationSession.update({
      where: { id },
      data,
    });
  }

  async updateSettings(
    id: string,
    data: {
      name?: string;
      quota?: number;
      stopLossRate?: number;
      maxCycles?: number;
    },
  ) {
    const current = await this.prisma.simulationSession.findUnique({
      where: { id },
      select: {
        id: true,
        market: true,
        exchangeCode: true,
        stockCode: true,
        strategyName: true,
        quota: true,
        currentCash: true,
        maxCycles: true,
        strategyParams: true,
      },
    });

    if (!current) {
      throw new BadRequestException('시뮬레이션 세션을 찾을 수 없습니다.');
    }

    const updateData: Prisma.SimulationSessionUpdateInput = {};

    if (data.name !== undefined) {
      const name = data.name.trim();
      if (!name) {
        throw new BadRequestException('시뮬레이션 이름은 비워둘 수 없습니다.');
      }
      updateData.name = name;
    }

    if (data.quota !== undefined) {
      if (data.quota <= 0) {
        throw new BadRequestException('투자금은 0보다 커야 합니다.');
      }
      updateData.quota = new Prisma.Decimal(data.quota);
    }

    if (data.stopLossRate !== undefined) {
      if (data.stopLossRate < 0 || data.stopLossRate >= 1) {
        throw new BadRequestException('손절률은 0% 이상 100% 미만이어야 합니다.');
      }
      updateData.stopLossRate = new Prisma.Decimal(data.stopLossRate);
    }

    if (data.maxCycles !== undefined) {
      if (!Number.isInteger(data.maxCycles) || data.maxCycles <= 0) {
        throw new BadRequestException('사이클 수는 1 이상의 정수여야 합니다.');
      }
      updateData.maxCycles = data.maxCycles;
    }

    const rebasedUpdate = await this.buildInfiniteBuyRebasedUpdate(current, data);
    if (rebasedUpdate.cycle !== undefined) updateData.cycle = rebasedUpdate.cycle;
    if (rebasedUpdate.strategyParams !== undefined) updateData.strategyParams = rebasedUpdate.strategyParams;
    if (rebasedUpdate.currentCash !== undefined) updateData.currentCash = new Prisma.Decimal(rebasedUpdate.currentCash);

    return this.prisma.simulationSession.update({
      where: { id },
      data: updateData,
      include: { positions: true },
    });
  }

  /**
   * 세션의 상태를 초기 자본으로 되돌리고 모든 거래/포지션/스냅샷을 삭제한다.
   * `onReset` 콜백을 제공하면 pending-order 같은 메모리 상태를 함께 비울 수 있다.
   */
  async resetSession(sessionId: string, onReset?: (sessionId: string) => void) {
    const session = await this.prisma.simulationSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    const strategyParams = ((session.strategyParams as Record<string, any> | undefined) ?? {});
    const {
      accumulatedQuota: _accumulatedQuota,
      lastAccumulatedDate: _lastAccumulatedDate,
      secondaryExitPlan: _secondaryExitPlan,
      lastExecutionStatus: _lastExecutionStatus,
      lastExecutionDate: _lastExecutionDate,
      lastExecutionDetails: _lastExecutionDetails,
      ...resettableStrategyParams
    } = strategyParams;

    if (onReset) onReset(sessionId);
    await this.prisma.simulationTrade.deleteMany({ where: { sessionId } });
    await this.prisma.simulationPosition.deleteMany({ where: { sessionId } });
    await this.prisma.simulationSnapshot.deleteMany({ where: { sessionId } });

    return this.prisma.simulationSession.update({
      where: { id: sessionId },
      data: {
        currentCash: session.quota,
        cycle: 0,
        status: SimulationStatus.RUNNING,
        stoppedAt: null,
        strategyParams: Object.keys(resettableStrategyParams).length > 0 ? resettableStrategyParams : Prisma.JsonNull,
      },
    });
  }

  async deleteSession(sessionId: string, onDelete?: (sessionId: string) => void): Promise<boolean> {
    if (onDelete) onDelete(sessionId);
    await this.prisma.simulationSession.delete({ where: { id: sessionId } });
    return true;
  }

  /** strategyParams에 patch와 실행 상태를 병합한 JSON을 반환한다. */
  mergeSimulationStrategyParams(
    params: Record<string, any>,
    patch: Record<string, any>,
    lastExecutionStatus?: string,
    today?: string,
    lastExecutionDetails?: Record<string, any>,
  ): Record<string, any> {
    return {
      ...params,
      ...patch,
      ...(lastExecutionStatus
        ? {
            lastExecutionStatus,
            lastExecutionDate: today,
            lastExecutionDetails,
          }
        : {}),
    };
  }

  /** 세션의 strategyParams를 updater 함수의 결과로 덮어쓴다. */
  async updateSessionStrategyParams(
    sessionId: string,
    updater: (params: Record<string, any>) => Record<string, any>,
  ): Promise<void> {
    const session = await this.prisma.simulationSession.findUnique({
      where: { id: sessionId },
      select: { strategyParams: true },
    });
    if (!session) return;

    const currentParams = (session.strategyParams as Record<string, any>) || {};
    await this.prisma.simulationSession.update({
      where: { id: sessionId },
      data: { strategyParams: updater(currentParams) },
    });
  }

  async updateInfiniteBuyStrategyParams(
    sessionId: string,
    updater: (params: InfiniteBuyStrategyParams) => InfiniteBuyStrategyParams,
  ): Promise<void> {
    await this.updateSessionStrategyParams(
      sessionId,
      (params) => updater(params as InfiniteBuyStrategyParams),
    );
  }

  async markInfiniteBuySecondTargetAttempted(sessionId: string, today: string): Promise<void> {
    await this.updateInfiniteBuyStrategyParams(sessionId, (params) => {
      if (!params.secondaryExitPlan) return params;
      return {
        ...params,
        secondaryExitPlan: {
          ...params.secondaryExitPlan,
          secondTargetAttemptedDate: today,
        },
      };
    });
  }

  async clearInfiniteBuySecondaryExitPlan(sessionId: string): Promise<void> {
    await this.updateInfiniteBuyStrategyParams(sessionId, (params) => {
      const { secondaryExitPlan: _secondaryExitPlan, ...rest } = params;
      return rest;
    });
  }

  async persistInfiniteBuySecondaryExitPlan(
    sessionId: string,
    today: string,
    signal: { metadata?: Record<string, any> },
  ): Promise<void> {
    const secondTargetPrice = Number(signal.metadata?.secondaryTargetPrice);
    const secondTargetRate = Number(signal.metadata?.secondaryTargetRate);
    const secondTargetQuantity = Number(signal.metadata?.secondaryTargetQuantity);
    if (!secondTargetPrice || !secondTargetRate || !secondTargetQuantity) return;

    await this.updateInfiniteBuyStrategyParams(sessionId, (params) => ({
      ...params,
      secondaryExitPlan: {
        firstTargetDate: today,
        secondTargetPrice,
        secondTargetRate,
        secondTargetQuantity,
      },
    }));
  }

  /**
   * infinite-buy 전략에서 quota 또는 maxCycles가 변경됐을 때
   * cycle 및 accumulatedQuota를 새 설정 기준으로 다시 계산한다.
   * 다른 전략이거나 변경이 없으면 cash 업데이트만 반환한다.
   */
  private async buildInfiniteBuyRebasedUpdate(
    current: {
      id: string;
      market: Market;
      exchangeCode: string | null;
      stockCode: string;
      strategyName: string;
      quota: Prisma.Decimal;
      currentCash: Prisma.Decimal;
      maxCycles: number;
      strategyParams: Prisma.JsonValue | null;
    },
    data: {
      quota?: number;
      maxCycles?: number;
    },
  ): Promise<{ cycle?: number; strategyParams?: Record<string, any>; currentCash?: number }> {
    if (current.strategyName !== 'infinite-buy') {
      return this.buildSimulationCashUpdate(current, data);
    }

    const currentQuota = Number(current.quota ?? 0);
    const nextQuota = data.quota !== undefined ? Number(data.quota) : currentQuota;
    const nextMaxCycles = data.maxCycles !== undefined ? data.maxCycles : current.maxCycles;
    const quotaChanged = data.quota !== undefined && nextQuota !== currentQuota;
    const maxCyclesChanged = data.maxCycles !== undefined && nextMaxCycles !== current.maxCycles;

    const cashUpdate = await this.buildSimulationCashUpdate(current, data);
    if (!quotaChanged && !maxCyclesChanged) {
      return cashUpdate;
    }

    const mergedParams = {
      ...(current.strategyParams as Record<string, any> | null ?? {}),
    } as InfiniteBuyStrategyParams;

    const nextPerCycleQuota = nextQuota > 0 && nextMaxCycles > 0 ? nextQuota / nextMaxCycles : 0;
    const currentPerCycleQuota = currentQuota > 0 && current.maxCycles > 0 ? currentQuota / current.maxCycles : 0;

    const position = await this.prisma.simulationPosition.findFirst({
      where: {
        sessionId: current.id,
        stockCode: current.stockCode,
      },
      select: { totalInvested: true },
    });

    const totalInvested = Number(position?.totalInvested ?? 0);
    const cycle =
      nextPerCycleQuota > 0 && totalInvested > 0
        ? Math.max(0, Math.floor(totalInvested / nextPerCycleQuota))
        : 0;

    const update: { cycle?: number; strategyParams?: Record<string, any>; currentCash?: number } = {
      ...cashUpdate,
      cycle,
    };

    const currentAccumulatedQuota = Number(mergedParams.accumulatedQuota || 0);
    if (currentAccumulatedQuota > 0 && currentPerCycleQuota > 0 && nextPerCycleQuota > 0) {
      const carriedCycles = currentAccumulatedQuota / currentPerCycleQuota;
      const rebasedAccumulatedQuota = this.roundQuota(carriedCycles * nextPerCycleQuota);
      if (rebasedAccumulatedQuota > 0) {
        mergedParams.accumulatedQuota = rebasedAccumulatedQuota;
      } else {
        delete mergedParams.accumulatedQuota;
      }
      update.strategyParams = mergedParams;
    }

    this.logger.log(
      `[SIM ${current.stockCode}] Rebased infinite-buy state after quota update: ` +
      `quota ${currentQuota} -> ${nextQuota}, maxCycles ${current.maxCycles} -> ${nextMaxCycles}, ` +
      `cycle=${cycle}, accumulatedQuota=${update.strategyParams?.accumulatedQuota ?? mergedParams.accumulatedQuota ?? 0}`,
    );

    return update;
  }

  private async buildSimulationCashUpdate(
    current: {
      id: string;
      stockCode: string;
      quota: Prisma.Decimal;
      currentCash: Prisma.Decimal;
    },
    data: { quota?: number },
  ): Promise<{ currentCash?: number }> {
    if (data.quota === undefined) return {};

    const currentQuota = Number(current.quota ?? 0);
    const nextQuota = Number(data.quota);
    const nextCash = Number(current.currentCash ?? 0) + (nextQuota - currentQuota);

    if (nextCash < 0) {
      throw new BadRequestException('현재 보유 상태보다 작은 투자금으로는 변경할 수 없습니다.');
    }

    return { currentCash: this.roundQuota(nextCash) };
  }

  private roundQuota(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
