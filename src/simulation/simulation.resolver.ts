import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { GqlAuthGuard } from '../auth/auth.guard';
import { SimulationService } from './simulation.service';
import { SimulationStatus } from '@prisma/client';
import {
  SimulationSessionType,
  SimulationTradeType,
  SimulationPositionType,
  SimulationSnapshotType,
  SimulationMetricsType,
  SimulationWatchStockType,
  CreateSimulationInput,
  AddSimulationWatchStockInput,
} from './dto';

@Resolver()
@UseGuards(GqlAuthGuard)
export class SimulationResolver {
  constructor(private simulationService: SimulationService) {}

  @Query(() => [SimulationSessionType], { name: 'simulationSessions' })
  async getSessions(
    @Args('status', { type: () => SimulationStatus, nullable: true }) status?: SimulationStatus,
  ): Promise<SimulationSessionType[]> {
    const sessions = await this.simulationService.getSessions(status);
    return sessions.map((s) => this.mapSession(s));
  }

  @Query(() => SimulationSessionType, { name: 'simulationSession', nullable: true })
  async getSession(
    @Args('id') id: string,
  ): Promise<SimulationSessionType | null> {
    const session = await this.simulationService.getSession(id);
    return session ? this.mapSession(session) : null;
  }

  @Query(() => [SimulationPositionType], { name: 'simulationPositions' })
  async getPositions(
    @Args('sessionId') sessionId: string,
  ): Promise<SimulationPositionType[]> {
    const positions = await this.simulationService.getPositions(sessionId);
    return positions.map((p) => ({
      id: p.id,
      sessionId: p.sessionId,
      market: p.market,
      exchangeCode: p.exchangeCode || undefined,
      stockCode: p.stockCode,
      stockName: p.stockName,
      quantity: p.quantity,
      avgPrice: Number(p.avgPrice),
      currentPrice: Number(p.currentPrice),
      totalInvested: Number(p.totalInvested),
      profitLoss: Number(p.profitLoss),
      profitRate: Number(p.profitRate),
    }));
  }

  @Query(() => [SimulationTradeType], { name: 'simulationTrades' })
  async getTrades(
    @Args('sessionId') sessionId: string,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('offset', { type: () => Int, nullable: true }) offset?: number,
  ): Promise<SimulationTradeType[]> {
    const trades = await this.simulationService.getTrades(sessionId, limit, offset);
    return trades.map((t) => ({
      id: t.id,
      sessionId: t.sessionId,
      market: t.market,
      exchangeCode: t.exchangeCode || undefined,
      stockCode: t.stockCode,
      stockName: t.stockName,
      side: t.side,
      quantity: t.quantity,
      price: Number(t.price),
      totalAmount: Number(t.totalAmount),
      strategyName: t.strategyName || undefined,
      reason: t.reason || undefined,
      createdAt: t.createdAt,
    }));
  }

  @Query(() => [SimulationSnapshotType], { name: 'simulationSnapshots' })
  async getSnapshots(
    @Args('sessionId') sessionId: string,
  ): Promise<SimulationSnapshotType[]> {
    const snapshots = await this.simulationService.getSnapshots(sessionId);
    return snapshots.map((s) => ({
      id: s.id,
      sessionId: s.sessionId,
      snapshotDate: s.snapshotDate,
      portfolioValue: Number(s.portfolioValue),
      cashBalance: Number(s.cashBalance),
      totalValue: Number(s.totalValue),
      dailyPnl: Number(s.dailyPnl),
      dailyPnlRate: Number(s.dailyPnlRate),
      drawdown: Number(s.drawdown),
      peakValue: Number(s.peakValue),
      positionCount: s.positionCount,
      tradeCount: s.tradeCount,
      createdAt: s.createdAt,
    }));
  }

  @Query(() => SimulationMetricsType, { name: 'simulationMetrics' })
  async getMetrics(
    @Args('sessionId') sessionId: string,
  ): Promise<SimulationMetricsType> {
    return this.simulationService.getMetrics(sessionId);
  }

  @Mutation(() => SimulationSessionType)
  async createSimulation(
    @Args('input') input: CreateSimulationInput,
  ): Promise<SimulationSessionType> {
    const session = await this.simulationService.createSession(input);
    return this.mapSession(session);
  }

  @Mutation(() => SimulationWatchStockType)
  async addSimulationWatchStock(
    @Args('input') input: AddSimulationWatchStockInput,
  ): Promise<SimulationWatchStockType> {
    const ws = await this.simulationService.addWatchStock(input);
    return this.mapWatchStock(ws);
  }

  @Mutation(() => Boolean)
  async removeSimulationWatchStock(
    @Args('id') id: string,
  ): Promise<boolean> {
    return this.simulationService.removeWatchStock(id);
  }

  @Mutation(() => SimulationSessionType)
  async updateSimulationStatus(
    @Args('id') id: string,
    @Args('status', { type: () => SimulationStatus }) status: SimulationStatus,
  ): Promise<SimulationSessionType> {
    const session = await this.simulationService.updateStatus(id, status);
    return this.mapSession(session);
  }

  @Mutation(() => SimulationSessionType)
  async resetSimulation(
    @Args('id') id: string,
  ): Promise<SimulationSessionType> {
    const session = await this.simulationService.resetSession(id);
    return this.mapSession(session);
  }

  @Mutation(() => Boolean)
  async deleteSimulation(
    @Args('id') id: string,
  ): Promise<boolean> {
    return this.simulationService.deleteSession(id);
  }

  private mapSession(session: any): SimulationSessionType {
    return {
      id: session.id,
      name: session.name,
      description: session.description || undefined,
      market: session.market,
      strategyName: session.strategyName,
      status: session.status,
      initialCapital: Number(session.initialCapital),
      currentCash: Number(session.currentCash),
      startedAt: session.startedAt,
      stoppedAt: session.stoppedAt || undefined,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      watchStocks: session.watchStocks?.map((ws: any) => this.mapWatchStock(ws)),
    };
  }

  private mapWatchStock(ws: any): SimulationWatchStockType {
    return {
      id: ws.id,
      sessionId: ws.sessionId,
      market: ws.market,
      exchangeCode: ws.exchangeCode || undefined,
      stockCode: ws.stockCode,
      stockName: ws.stockName,
      quota: ws.quota ? Number(ws.quota) : undefined,
      cycle: ws.cycle,
      maxCycles: ws.maxCycles,
      stopLossRate: Number(ws.stopLossRate),
      maxPortfolioRate: Number(ws.maxPortfolioRate),
      strategyParams: ws.strategyParams ? JSON.stringify(ws.strategyParams) : undefined,
      isActive: ws.isActive,
    };
  }
}
