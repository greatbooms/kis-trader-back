import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { PerStockTradingStrategy } from '../types';
import { InfiniteBuyStrategy } from './infinite-buy.strategy';
import { MomentumBreakoutStrategy } from './momentum-breakout.strategy';
import { GridMeanReversionStrategy } from './grid-mean-reversion.strategy';
import { ConservativeStrategy } from './conservative.strategy';
import { TrendFollowingStrategy } from './trend-following.strategy';
import { ValueFactorStrategy } from './value-factor.strategy';
import { Market, Prisma } from '@prisma/client';

@Injectable()
export class StrategyRegistryService {
  private readonly logger = new Logger(StrategyRegistryService.name);
  private readonly strategies = new Map<string, PerStockTradingStrategy>();

  constructor(
    private prisma: PrismaService,
    infiniteBuy: InfiniteBuyStrategy,
    momentumBreakout: MomentumBreakoutStrategy,
    gridMeanReversion: GridMeanReversionStrategy,
    conservative: ConservativeStrategy,
    trendFollowing: TrendFollowingStrategy,
    valueFactor: ValueFactorStrategy,
  ) {
    this.register(infiniteBuy);
    this.register(momentumBreakout);
    this.register(gridMeanReversion);
    this.register(conservative);
    this.register(trendFollowing);
    this.register(valueFactor);

    this.logger.log(`Registered strategies: ${this.getStrategyNames().join(', ')}`);
  }

  private register(strategy: PerStockTradingStrategy): void {
    this.strategies.set(strategy.name, strategy);
  }

  getStrategy(name: string): PerStockTradingStrategy | undefined {
    return this.strategies.get(name);
  }

  getStrategyNames(): string[] {
    return Array.from(this.strategies.keys());
  }

  getAllStrategies(): PerStockTradingStrategy[] {
    return Array.from(this.strategies.values());
  }

  // --- StrategyAllocation CRUD ---

  async getAllocations(market: 'DOMESTIC' | 'OVERSEAS') {
    return this.prisma.strategyAllocation.findMany({
      where: { market: market as Market },
      orderBy: { strategyName: 'asc' },
    });
  }

  async setAllocation(
    market: 'DOMESTIC' | 'OVERSEAS',
    strategyName: string,
    allocationRate: number,
    isActive: boolean = true,
  ) {
    if (!this.strategies.has(strategyName)) {
      throw new Error(`Unknown strategy: ${strategyName}`);
    }

    return this.prisma.strategyAllocation.upsert({
      where: {
        market_strategyName: {
          market: market as Market,
          strategyName,
        },
      },
      create: {
        market: market as Market,
        strategyName,
        allocationRate: new Prisma.Decimal(allocationRate),
        isActive,
      },
      update: {
        allocationRate: new Prisma.Decimal(allocationRate),
        isActive,
      },
    });
  }
}
