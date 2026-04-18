import { Injectable } from '@nestjs/common';
import { Prisma, SimulationStatus, SimulationTradeStatus } from '@prisma/client';
import { CreateSimulationInput } from './dto';
import { SimulationMetrics } from './types';
import { SimulationSessionManager } from './simulation-session-manager.service';
import { SimulationPositionService } from './simulation-position.service';
import { SimulationMetricsService } from './simulation-metrics.service';
import { SimulationTickEngine } from './simulation-tick-engine.service';

/**
 * Simulation 모듈의 public façade.
 *
 * 기존 `SimulationService`의 공개 메서드 시그니처를 보존하기 위해 존재하며,
 * 실제 로직은 아래 4개 전용 서비스에 위임한다:
 * - {@link SimulationSessionManager} — 세션 CRUD / strategyParams 리베이스
 * - {@link SimulationPositionService} — 포지션 가격/사이클 동기화
 * - {@link SimulationMetricsService} — 스냅샷, 메트릭, 리스크 평가
 * - {@link SimulationTickEngine} — 틱 실행, 가상 체결, pending 주문 관리
 *
 * 신규 코드는 가능하면 위 서비스를 직접 주입해 사용할 것을 권장한다.
 * 이 파사드는 resolver / scheduler의 기존 호출을 깨지지 않게 유지하려는 목적.
 */
@Injectable()
export class SimulationService {
  constructor(
    private readonly sessionManager: SimulationSessionManager,
    private readonly positionService: SimulationPositionService,
    private readonly metricsService: SimulationMetricsService,
    private readonly tickEngine: SimulationTickEngine,
  ) {}

  // ──────────────────────────────────────────────────────────
  // 세션 CRUD (resolver에서 호출)
  // ──────────────────────────────────────────────────────────

  createSession(input: CreateSimulationInput) {
    return this.sessionManager.createSession(input);
  }

  getSessions(status?: SimulationStatus) {
    return this.sessionManager.getSessions(status);
  }

  getSession(id: string) {
    return this.sessionManager.getSession(id);
  }

  getPositions(sessionId: string) {
    return this.sessionManager.getPositions(sessionId);
  }

  updateStatus(id: string, status: SimulationStatus) {
    return this.sessionManager.updateStatus(id, status);
  }

  updateSettings(
    id: string,
    data: {
      name?: string;
      quota?: number;
      stopLossRate?: number;
      maxCycles?: number;
    },
  ) {
    return this.sessionManager.updateSettings(id, data);
  }

  resetSession(sessionId: string) {
    return this.sessionManager.resetSession(sessionId, (id) => this.tickEngine.clearPendingOrders(id));
  }

  deleteSession(sessionId: string): Promise<boolean> {
    return this.sessionManager.deleteSession(sessionId, (id) => this.tickEngine.clearPendingOrders(id));
  }

  // ──────────────────────────────────────────────────────────
  // 포지션 / 사이클 (resolver, scheduler에서 호출)
  // ──────────────────────────────────────────────────────────

  calculateSessionCycle(
    session: { quota: Prisma.Decimal | number; maxCycles: number },
    position?: { totalInvested: Prisma.Decimal | number } | null,
  ): number {
    return this.positionService.calculateSessionCycle(session, position);
  }

  updatePositionPrices(sessionId: string): Promise<void> {
    return this.positionService.updatePositionPrices(sessionId);
  }

  // ──────────────────────────────────────────────────────────
  // 메트릭 / 스냅샷 (resolver, scheduler에서 호출)
  // ──────────────────────────────────────────────────────────

  takeSnapshot(sessionId: string): Promise<void> {
    return this.metricsService.takeSnapshot(sessionId);
  }

  getMetrics(sessionId: string): Promise<SimulationMetrics> {
    return this.metricsService.getMetrics(sessionId);
  }

  getTrades(
    sessionId: string,
    limit?: number,
    offset?: number,
    tradeStatus?: SimulationTradeStatus,
  ) {
    return this.metricsService.getTrades(sessionId, limit, offset, tradeStatus);
  }

  getSnapshots(sessionId: string) {
    return this.metricsService.getSnapshots(sessionId);
  }

  // ──────────────────────────────────────────────────────────
  // 틱 실행 / pending order (scheduler, resolver에서 호출)
  // ──────────────────────────────────────────────────────────

  executeSimulationTick(sessionId: string, options?: { forceExecution?: boolean }): Promise<void> {
    return this.tickEngine.executeSimulationTick(sessionId, options);
  }

  triggerSessionNow(sessionId: string): Promise<{ success: boolean; message: string }> {
    return this.tickEngine.triggerSessionNow(sessionId);
  }

  checkPendingOrders(sessionId: string): Promise<void> {
    return this.tickEngine.checkPendingOrders(sessionId);
  }

  cancelPendingOrders(sessionId: string): void {
    this.tickEngine.cancelPendingOrders(sessionId);
  }

  getPendingOrderCount(sessionId: string): number {
    return this.tickEngine.getPendingOrderCount(sessionId);
  }
}
