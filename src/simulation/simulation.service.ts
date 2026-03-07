import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { StrategyRegistryService } from '../trading/strategy/strategy-registry.service';
import { MarketAnalysisService } from '../trading/market-analysis.service';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { WatchStockService } from '../watch-stock/watch-stock.service';
import { Market, Side, SimulationStatus, Prisma } from '@prisma/client';
import { StockStrategyContext, WatchStockConfig } from '../trading/types';
import { SimulationMetrics } from './types';
import { CreateSimulationInput } from './dto';
import { AddSimulationWatchStockInput } from './dto';

@Injectable()
export class SimulationService {
  private readonly logger = new Logger(SimulationService.name);

  constructor(
    private prisma: PrismaService,
    private strategyRegistry: StrategyRegistryService,
    private marketAnalysis: MarketAnalysisService,
    private kisDomestic: KisDomesticService,
    private kisOverseas: KisOverseasService,
    private watchStockService: WatchStockService,
  ) {}

  async createSession(input: CreateSimulationInput) {
    const session = await this.prisma.simulationSession.create({
      data: {
        name: input.name,
        description: input.description,
        market: input.market,
        strategyName: input.strategyName,
        initialCapital: new Prisma.Decimal(input.initialCapital),
        currentCash: new Prisma.Decimal(input.initialCapital),
      },
      include: { watchStocks: true },
    });

    if (input.watchStocks && input.watchStocks.length > 0) {
      for (const ws of input.watchStocks) {
        await this.prisma.simulationWatchStock.create({
          data: {
            sessionId: session.id,
            market: ws.market,
            exchangeCode: ws.exchangeCode,
            stockCode: ws.stockCode,
            stockName: ws.stockName,
            quota: ws.quota ? new Prisma.Decimal(ws.quota) : null,
            stopLossRate: ws.stopLossRate ? new Prisma.Decimal(ws.stopLossRate) : new Prisma.Decimal(0.3),
            maxPortfolioRate: ws.maxPortfolioRate ? new Prisma.Decimal(ws.maxPortfolioRate) : new Prisma.Decimal(0.2),
            strategyParams: ws.strategyParams ? JSON.parse(ws.strategyParams) : undefined,
          },
        });
      }

      return this.prisma.simulationSession.findUnique({
        where: { id: session.id },
        include: { watchStocks: true },
      });
    }

    return session;
  }

  async executeSimulationTick(sessionId: string): Promise<void> {
    const session = await this.prisma.simulationSession.findUnique({
      where: { id: sessionId },
      include: { watchStocks: { where: { isActive: true } } },
    });

    if (!session || session.status !== SimulationStatus.RUNNING) return;

    const strategy = this.strategyRegistry.getStrategy(session.strategyName);
    if (!strategy) {
      this.logger.warn(`Unknown strategy: ${session.strategyName} for session ${sessionId}`);
      return;
    }

    const positions = await this.prisma.simulationPosition.findMany({
      where: { sessionId },
    });

    const totalPortfolioValue = positions.reduce(
      (sum, p) => sum + Number(p.quantity) * Number(p.currentPrice),
      0,
    );

    const today = new Date().toISOString().slice(0, 10);

    for (const ws of session.watchStocks) {
      try {
        const exchangeCode = ws.exchangeCode || (session.market === Market.DOMESTIC ? 'KRX' : 'NASD');

        // Get price
        const price = session.market === Market.DOMESTIC
          ? await this.kisDomestic.getPrice(ws.stockCode)
          : await this.kisOverseas.getPrice(exchangeCode, ws.stockCode);

        // Get indicators
        const stockIndicators = await this.marketAnalysis.getStockIndicators(
          session.market as 'DOMESTIC' | 'OVERSEAS',
          exchangeCode,
          ws.stockCode,
          price.currentPrice,
        );

        // Get market condition
        const marketCondition = await this.marketAnalysis.getMarketCondition(exchangeCode);

        // Check if already executed today
        const todayTrade = await this.prisma.simulationTrade.findFirst({
          where: {
            sessionId,
            stockCode: ws.stockCode,
            createdAt: {
              gte: new Date(today + 'T00:00:00Z'),
              lt: new Date(today + 'T23:59:59Z'),
            },
          },
        });

        const pos = positions.find((p) => p.stockCode === ws.stockCode);

        const watchStockConfig: WatchStockConfig = {
          id: ws.id,
          market: session.market as 'DOMESTIC' | 'OVERSEAS',
          exchangeCode,
          stockCode: ws.stockCode,
          stockName: ws.stockName,
          strategyName: session.strategyName,
          quota: ws.quota ? Number(ws.quota) : undefined,
          cycle: ws.cycle,
          maxCycles: ws.maxCycles,
          stopLossRate: Number(ws.stopLossRate),
          maxPortfolioRate: Number(ws.maxPortfolioRate),
          strategyParams: ws.strategyParams as Record<string, any> | undefined,
        };

        const ctx: StockStrategyContext = {
          watchStock: watchStockConfig,
          price,
          position: pos ? {
            stockCode: pos.stockCode,
            quantity: pos.quantity,
            avgPrice: Number(pos.avgPrice),
            currentPrice: Number(pos.currentPrice),
            totalInvested: Number(pos.totalInvested),
          } : undefined,
          alreadyExecutedToday: !!todayTrade,
          marketCondition,
          stockIndicators,
          buyableAmount: Number(session.currentCash),
          totalPortfolioValue,
        };

        const signals = await strategy.evaluateStock(ctx);

        for (const signal of signals) {
          await this.virtualExecute(sessionId, signal, price.currentPrice);
        }
      } catch (e) {
        this.logger.error(`Simulation tick error for ${ws.stockCode}: ${e.message}`);
      }
    }
  }

  private async virtualExecute(
    sessionId: string,
    signal: { market: string; exchangeCode?: string; stockCode: string; side: string; quantity: number; price?: number; reason: string },
    currentMarketPrice: number,
  ): Promise<void> {
    const session = await this.prisma.simulationSession.findUnique({ where: { id: sessionId } });
    if (!session) return;

    const signalPrice = signal.price || 0;

    // 지정가 체결 조건 체크: 현재가가 지정가에 도달했을 때만 체결
    if (signalPrice > 0 && currentMarketPrice > 0) {
      if (signal.side === 'BUY' && currentMarketPrice > signalPrice) {
        // 매수 지정가: 현재가가 지정가보다 높으면 체결 불가
        this.logger.debug(`[SIM] BUY ${signal.stockCode} skip: market ${currentMarketPrice} > limit ${signalPrice}`);
        return;
      }
      if (signal.side === 'SELL' && currentMarketPrice < signalPrice) {
        // 매도 지정가: 현재가가 지정가보다 낮으면 체결 불가
        this.logger.debug(`[SIM] SELL ${signal.stockCode} skip: market ${currentMarketPrice} < limit ${signalPrice}`);
        return;
      }
    }

    // 체결가: 시장가 주문이면 현재가, 지정가면 시그널 가격
    const price = signalPrice > 0 ? signalPrice : currentMarketPrice;
    const totalAmount = price * signal.quantity;

    if (signal.side === 'BUY') {
      // Check cash
      if (totalAmount > Number(session.currentCash)) {
        this.logger.warn(`Insufficient cash for BUY ${signal.stockCode}: need ${totalAmount}, have ${session.currentCash}`);
        return;
      }

      // Create trade
      await this.prisma.simulationTrade.create({
        data: {
          sessionId,
          market: signal.market as Market,
          exchangeCode: signal.exchangeCode,
          stockCode: signal.stockCode,
          stockName: signal.stockCode,
          side: Side.BUY,
          quantity: signal.quantity,
          price: new Prisma.Decimal(price),
          totalAmount: new Prisma.Decimal(totalAmount),
          strategyName: session.strategyName,
          reason: signal.reason,
        },
      });

      // Upsert position (weighted avg price)
      const existingPos = await this.prisma.simulationPosition.findUnique({
        where: { sessionId_stockCode: { sessionId, stockCode: signal.stockCode } },
      });

      if (existingPos) {
        const oldQty = existingPos.quantity;
        const oldAvgPrice = Number(existingPos.avgPrice);
        const newQty = oldQty + signal.quantity;
        const newAvgPrice = (oldAvgPrice * oldQty + price * signal.quantity) / newQty;
        const newTotalInvested = Number(existingPos.totalInvested) + totalAmount;
        const profitLoss = (price - newAvgPrice) * newQty;
        const profitRate = newAvgPrice > 0 ? (price - newAvgPrice) / newAvgPrice : 0;

        await this.prisma.simulationPosition.update({
          where: { id: existingPos.id },
          data: {
            quantity: newQty,
            avgPrice: new Prisma.Decimal(newAvgPrice),
            currentPrice: new Prisma.Decimal(price),
            totalInvested: new Prisma.Decimal(newTotalInvested),
            profitLoss: new Prisma.Decimal(profitLoss),
            profitRate: new Prisma.Decimal(profitRate),
          },
        });
      } else {
        await this.prisma.simulationPosition.create({
          data: {
            sessionId,
            market: signal.market as Market,
            exchangeCode: signal.exchangeCode,
            stockCode: signal.stockCode,
            stockName: signal.stockCode,
            quantity: signal.quantity,
            avgPrice: new Prisma.Decimal(price),
            currentPrice: new Prisma.Decimal(price),
            totalInvested: new Prisma.Decimal(totalAmount),
            profitLoss: new Prisma.Decimal(0),
            profitRate: new Prisma.Decimal(0),
          },
        });
      }

      // Update cash
      await this.prisma.simulationSession.update({
        where: { id: sessionId },
        data: { currentCash: new Prisma.Decimal(Number(session.currentCash) - totalAmount) },
      });

      this.logger.log(`[SIM] BUY ${signal.stockCode} x${signal.quantity} @ ${price} (session: ${sessionId})`);
    } else {
      // SELL
      const existingPos = await this.prisma.simulationPosition.findUnique({
        where: { sessionId_stockCode: { sessionId, stockCode: signal.stockCode } },
      });

      if (!existingPos || existingPos.quantity < signal.quantity) {
        this.logger.warn(`Insufficient position for SELL ${signal.stockCode}`);
        return;
      }

      // Create trade
      await this.prisma.simulationTrade.create({
        data: {
          sessionId,
          market: signal.market as Market,
          exchangeCode: signal.exchangeCode,
          stockCode: signal.stockCode,
          stockName: signal.stockCode,
          side: Side.SELL,
          quantity: signal.quantity,
          price: new Prisma.Decimal(price),
          totalAmount: new Prisma.Decimal(totalAmount),
          strategyName: session.strategyName,
          reason: signal.reason,
        },
      });

      // Update or delete position
      const newQty = existingPos.quantity - signal.quantity;
      if (newQty === 0) {
        await this.prisma.simulationPosition.delete({ where: { id: existingPos.id } });
      } else {
        const profitLoss = (price - Number(existingPos.avgPrice)) * newQty;
        const profitRate = Number(existingPos.avgPrice) > 0
          ? (price - Number(existingPos.avgPrice)) / Number(existingPos.avgPrice)
          : 0;
        const newTotalInvested = Number(existingPos.avgPrice) * newQty;

        await this.prisma.simulationPosition.update({
          where: { id: existingPos.id },
          data: {
            quantity: newQty,
            currentPrice: new Prisma.Decimal(price),
            totalInvested: new Prisma.Decimal(newTotalInvested),
            profitLoss: new Prisma.Decimal(profitLoss),
            profitRate: new Prisma.Decimal(profitRate),
          },
        });
      }

      // Update cash
      await this.prisma.simulationSession.update({
        where: { id: sessionId },
        data: { currentCash: new Prisma.Decimal(Number(session.currentCash) + totalAmount) },
      });

      this.logger.log(`[SIM] SELL ${signal.stockCode} x${signal.quantity} @ ${price} (session: ${sessionId})`);
    }
  }

  async takeSnapshot(sessionId: string): Promise<void> {
    const session = await this.prisma.simulationSession.findUnique({ where: { id: sessionId } });
    if (!session) return;

    const positions = await this.prisma.simulationPosition.findMany({ where: { sessionId } });
    const today = new Date().toISOString().slice(0, 10);

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

    const prevTotalValue = prevSnapshot ? Number(prevSnapshot.totalValue) : Number(session.initialCapital);
    const dailyPnl = totalValue - prevTotalValue;
    const dailyPnlRate = prevTotalValue > 0 ? dailyPnl / prevTotalValue : 0;

    // Drawdown calculation
    const peakValue = prevSnapshot
      ? Math.max(Number(prevSnapshot.peakValue), totalValue)
      : Math.max(Number(session.initialCapital), totalValue);
    const drawdown = peakValue > 0 ? (peakValue - totalValue) / peakValue : 0;

    // Trade count today
    const todayTrades = await this.prisma.simulationTrade.count({
      where: {
        sessionId,
        createdAt: {
          gte: new Date(today + 'T00:00:00Z'),
          lt: new Date(today + 'T23:59:59Z'),
        },
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
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });

    const currentPortfolioValue = positions.reduce(
      (sum, p) => sum + Number(p.quantity) * Number(p.currentPrice),
      0,
    );
    const currentCash = Number(session.currentCash);
    const totalValue = currentPortfolioValue + currentCash;
    const initialCapital = Number(session.initialCapital);

    const totalReturnAmount = totalValue - initialCapital;
    const totalReturn = initialCapital > 0 ? totalReturnAmount / initialCapital : 0;

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

    return {
      totalReturn,
      totalReturnAmount,
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

  async resetSession(sessionId: string) {
    const session = await this.prisma.simulationSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    await this.prisma.simulationTrade.deleteMany({ where: { sessionId } });
    await this.prisma.simulationPosition.deleteMany({ where: { sessionId } });
    await this.prisma.simulationSnapshot.deleteMany({ where: { sessionId } });

    return this.prisma.simulationSession.update({
      where: { id: sessionId },
      data: {
        currentCash: session.initialCapital,
        status: SimulationStatus.RUNNING,
        stoppedAt: null,
      },
      include: { watchStocks: true },
    });
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    await this.prisma.simulationSession.delete({ where: { id: sessionId } });
    return true;
  }

  async updatePositionPrices(sessionId: string): Promise<void> {
    const session = await this.prisma.simulationSession.findUnique({
      where: { id: sessionId },
      include: { positions: true },
    });
    if (!session) return;

    for (const pos of session.positions) {
      try {
        const exchangeCode = pos.exchangeCode || (session.market === Market.DOMESTIC ? 'KRX' : 'NASD');
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

  async addWatchStock(input: AddSimulationWatchStockInput) {
    await this.watchStockService.checkGlobalLimit();

    if (input.quota) {
      const session = await this.prisma.simulationSession.findUnique({
        where: { id: input.sessionId },
        include: { watchStocks: true },
      });
      if (!session) {
        throw new BadRequestException('세션을 찾을 수 없습니다');
      }
      const currentTotal = session.watchStocks.reduce(
        (sum, ws) => sum + (ws.quota ? Number(ws.quota) : 0),
        0,
      );
      if (currentTotal + input.quota > Number(session.initialCapital)) {
        throw new BadRequestException(
          `배정 금액이 초기자본을 초과합니다. 초기자본: ${Number(session.initialCapital)}, 현재 배정: ${currentTotal}, 추가 요청: ${input.quota}`,
        );
      }
    }

    return this.prisma.simulationWatchStock.create({
      data: {
        sessionId: input.sessionId,
        market: input.market,
        exchangeCode: input.exchangeCode,
        stockCode: input.stockCode,
        stockName: input.stockName,
        quota: input.quota ? new Prisma.Decimal(input.quota) : null,
        stopLossRate: input.stopLossRate ? new Prisma.Decimal(input.stopLossRate) : new Prisma.Decimal(0.3),
        maxPortfolioRate: input.maxPortfolioRate ? new Prisma.Decimal(input.maxPortfolioRate) : new Prisma.Decimal(0.2),
        strategyParams: input.strategyParams ? JSON.parse(input.strategyParams) : undefined,
      },
    });
  }

  async removeWatchStock(id: string): Promise<boolean> {
    await this.prisma.simulationWatchStock.delete({ where: { id } });
    return true;
  }

  async updateStatus(id: string, status: SimulationStatus) {
    const data: any = { status };
    if (status === SimulationStatus.COMPLETED) {
      data.stoppedAt = new Date();
    }
    return this.prisma.simulationSession.update({
      where: { id },
      data,
      include: { watchStocks: true },
    });
  }

  async getSessions(status?: SimulationStatus) {
    const where = status ? { status } : {};
    return this.prisma.simulationSession.findMany({
      where,
      include: { watchStocks: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSession(id: string) {
    return this.prisma.simulationSession.findUnique({
      where: { id },
      include: { watchStocks: true },
    });
  }

  async getPositions(sessionId: string) {
    return this.prisma.simulationPosition.findMany({
      where: { sessionId },
      orderBy: { stockCode: 'asc' },
    });
  }

  async getTrades(sessionId: string, limit?: number, offset?: number) {
    return this.prisma.simulationTrade.findMany({
      where: { sessionId },
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
}
