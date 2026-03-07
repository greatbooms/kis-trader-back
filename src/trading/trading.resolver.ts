import {
  Resolver,
  Query,
  Mutation,
  Args,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { GqlAuthGuard } from '../auth/auth.guard';
import { StrategyRegistryService } from './strategy/strategy-registry.service';
import { MarketRegimeService } from './market-regime.service';
import { RiskManagementService } from './risk-management.service';
import { Market } from '@prisma/client';
import {
  StrategyInfo,
  StrategyAllocationType,
  MarketRegimeType,
  RiskStateType,
  SetStrategyAllocationInput,
} from './dto';

@Resolver()
@UseGuards(GqlAuthGuard)
export class TradingResolver {
  constructor(
    private strategyRegistry: StrategyRegistryService,
    private marketRegimeService: MarketRegimeService,
    private riskManagement: RiskManagementService,
  ) {}

  @Query(() => [StrategyInfo], { name: 'availableStrategies' })
  getAvailableStrategies(): StrategyInfo[] {
    return this.strategyRegistry.getAllStrategies().map((s) => ({
      name: s.name,
      displayName: s.displayName,
      description: s.description,
    }));
  }

  @Query(() => [StrategyAllocationType], { name: 'strategyAllocations' })
  async getStrategyAllocations(
    @Args('market', { type: () => Market }) market: Market,
  ): Promise<StrategyAllocationType[]> {
    const allocations = await this.strategyRegistry.getAllocations(
      market as 'DOMESTIC' | 'OVERSEAS',
    );
    return allocations.map((a) => ({
      id: a.id,
      market: a.market,
      strategyName: a.strategyName,
      allocationRate: Number(a.allocationRate),
      isActive: a.isActive,
    }));
  }

  @Query(() => MarketRegimeType, { name: 'marketRegime' })
  async getMarketRegime(
    @Args('market', { type: () => Market }) market: Market,
    @Args('exchangeCode') exchangeCode: string,
  ): Promise<MarketRegimeType> {
    const regime = await this.marketRegimeService.getRegime(
      market as 'DOMESTIC' | 'OVERSEAS',
      exchangeCode,
    );
    return { regime, market, exchangeCode };
  }

  @Query(() => RiskStateType, { name: 'riskState' })
  async getRiskState(
    @Args('market', { type: () => Market }) market: Market,
  ): Promise<RiskStateType> {
    return this.riskManagement.evaluateRisk(market as 'DOMESTIC' | 'OVERSEAS');
  }

  @Mutation(() => StrategyAllocationType)
  async setStrategyAllocation(
    @Args('input') input: SetStrategyAllocationInput,
  ): Promise<StrategyAllocationType> {
    const result = await this.strategyRegistry.setAllocation(
      input.market as 'DOMESTIC' | 'OVERSEAS',
      input.strategyName,
      input.allocationRate,
      input.isActive ?? true,
    );
    return {
      id: result.id,
      market: result.market,
      strategyName: result.strategyName,
      allocationRate: Number(result.allocationRate),
      isActive: result.isActive,
    };
  }
}
