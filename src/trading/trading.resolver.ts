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
import {
  StrategyInfo,
  StrategyAllocationType,
  MarketRegimeType,
  RiskStateType,
  SetStrategyAllocationInput,
  StrategyAllocationsFilterInput,
  MarketRegimeFilterInput,
  RiskStateFilterInput,
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
      meta: s.meta,
    }));
  }

  @Query(() => [StrategyAllocationType], { name: 'strategyAllocations' })
  async getStrategyAllocations(
    @Args('input') input: StrategyAllocationsFilterInput,
  ): Promise<StrategyAllocationType[]> {
    const allocations = await this.strategyRegistry.getAllocations(
      input.market as 'DOMESTIC' | 'OVERSEAS',
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
    @Args('input') input: MarketRegimeFilterInput,
  ): Promise<MarketRegimeType> {
    const regime = await this.marketRegimeService.getRegime(
      input.market as 'DOMESTIC' | 'OVERSEAS',
      input.exchangeCode,
    );
    return { regime, market: input.market, exchangeCode: input.exchangeCode };
  }

  @Query(() => RiskStateType, { name: 'riskState' })
  async getRiskState(
    @Args('input') input: RiskStateFilterInput,
  ): Promise<RiskStateType> {
    return this.riskManagement.evaluateRisk(input.market as 'DOMESTIC' | 'OVERSEAS');
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
