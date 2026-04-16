import { Resolver, Query, Mutation, Args, ID, ObjectType, Field, InputType, Float, Int, registerEnumType } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { WatchStockService } from './watch-stock.service';
import { GqlAuthGuard } from '../auth/auth.guard';
import { Market } from '@prisma/client';
import { TradingScheduler } from '../trading/trading.scheduler';
import { WatchStocksFilterInput, WatchStockExecutionLogType, ManualTriggerResult } from './dto';

registerEnumType(Market, { name: 'Market' });

@ObjectType()
export class WatchStockType {
  @Field(() => ID)
  id: string;

  @Field(() => Market)
  market: Market;

  @Field()
  exchangeCode: string;

  @Field()
  stockCode: string;

  @Field()
  stockName: string;

  @Field()
  isActive: boolean;

  @Field({ nullable: true })
  strategyName?: string;

  @Field(() => Float, { nullable: true })
  quota?: number;

  @Field(() => Float)
  cycle: number;

  @Field(() => Int)
  maxCycles: number;

  @Field(() => Float)
  stopLossRate: number;

  @Field(() => Float)
  maxPortfolioRate: number;

  @Field({ nullable: true })
  strategyParams?: string;

  @Field({ nullable: true, description: '마지막 전략 실행 상태 (예: "3 시그널 생성", "지수 MA200 아래 — 매수 중단")' })
  lastExecutionStatus?: string;

  @Field({ nullable: true, description: '마지막 전략 실행 날짜' })
  lastExecutionDate?: string;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}

@InputType()
export class CreateWatchStockInput {
  @Field(() => Market)
  market: Market;

  @Field()
  exchangeCode: string;

  @Field()
  stockCode: string;

  @Field()
  stockName: string;

  @Field({ nullable: true })
  strategyName?: string;

  @Field(() => Float, { nullable: true })
  quota?: number;

  @Field(() => Int, { nullable: true })
  maxCycles?: number;

  @Field(() => Float, { nullable: true })
  stopLossRate?: number;

  @Field(() => Float, { nullable: true })
  maxPortfolioRate?: number;

  @Field({ nullable: true })
  strategyParams?: string;
}

@InputType()
export class UpdateWatchStockInput {
  @Field({ nullable: true })
  exchangeCode?: string;

  @Field({ nullable: true })
  stockName?: string;

  @Field({ nullable: true })
  isActive?: boolean;

  @Field({ nullable: true })
  strategyName?: string;

  @Field(() => Float, { nullable: true })
  quota?: number;

  @Field(() => Int, { nullable: true })
  cycle?: number;

  @Field(() => Int, { nullable: true })
  maxCycles?: number;

  @Field(() => Float, { nullable: true })
  stopLossRate?: number;

  @Field(() => Float, { nullable: true })
  maxPortfolioRate?: number;

  @Field({ nullable: true })
  strategyParams?: string;
}

@Resolver(() => WatchStockType)
@UseGuards(GqlAuthGuard)
export class WatchStockResolver {
  constructor(
    private watchStockService: WatchStockService,
    private tradingScheduler: TradingScheduler,
  ) {}

  @Query(() => [WatchStockType], { name: 'watchStocks' })
  async findAll(@Args('input', { nullable: true }) input?: WatchStocksFilterInput) {
    const items = await this.watchStockService.findAll(input?.market);
    const latestLogs = await this.watchStockService.findLatestExecutionLogs(items.map((item) => item.id));
    const currentCycles = await this.watchStockService.findCurrentCycleMap(items);

    return items.map((item) => {
      const lastLog = latestLogs.get(item.id);

      const lastExecutionStatus = lastLog
        ? lastLog.message
        : undefined;
      const lastExecutionDate = lastLog
        ? lastLog.createdAt.toISOString().slice(0, 16).replace('T', ' ')
        : undefined;

      return {
        ...item,
        cycle: currentCycles.get(item.id) ?? item.cycle,
        strategyParams: item.strategyParams ? JSON.stringify(item.strategyParams) : undefined,
        lastExecutionStatus,
        lastExecutionDate,
      };
    });
  }

  @Query(() => WatchStockType, { name: 'watchStock', nullable: true })
  async findOne(@Args('id', { type: () => ID }) id: string) {
    const item = await this.watchStockService.findOne(id);
    if (!item) return null;

    const latestLogs = await this.watchStockService.findLatestExecutionLogs([id]);
    const currentCycles = await this.watchStockService.findCurrentCycleMap([item]);
    const lastLog = latestLogs.get(id);

    return {
      ...item,
      cycle: currentCycles.get(item.id) ?? item.cycle,
      strategyParams: item.strategyParams ? JSON.stringify(item.strategyParams) : undefined,
      lastExecutionStatus: lastLog?.message,
      lastExecutionDate: lastLog?.createdAt?.toISOString().slice(0, 16).replace('T', ' '),
    };
  }

  @Query(() => [WatchStockExecutionLogType], { name: 'watchStockExecutionLogs' })
  async getExecutionLogs(
    @Args('watchStockId') watchStockId: string,
    @Args('limit', { nullable: true }) limit?: number,
  ): Promise<WatchStockExecutionLogType[]> {
    const logs = await this.watchStockService.findExecutionLogs(watchStockId, limit ?? 50);
    return logs.map((log) => ({
      ...log,
      tradeRecordId: log.tradeRecordId || undefined,
      strategyName: log.strategyName || undefined,
      details: log.details ? JSON.stringify(log.details) : undefined,
    }));
  }

  @Mutation(() => WatchStockType)
  async createWatchStock(@Args('input') input: CreateWatchStockInput) {
    const result = await this.watchStockService.create({
      ...input,
      strategyParams: input.strategyParams ? JSON.parse(input.strategyParams) : undefined,
    });
    return {
      ...result,
      strategyParams: result.strategyParams ? JSON.stringify(result.strategyParams) : undefined,
    };
  }

  @Mutation(() => WatchStockType)
  async updateWatchStock(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateWatchStockInput,
  ) {
    const result = await this.watchStockService.update(id, {
      ...input,
      strategyParams: input.strategyParams ? JSON.parse(input.strategyParams) : undefined,
    });
    return {
      ...result,
      strategyParams: result.strategyParams ? JSON.stringify(result.strategyParams) : undefined,
    };
  }

  @Mutation(() => Boolean)
  async deleteWatchStock(@Args('id', { type: () => ID }) id: string) {
    await this.watchStockService.delete(id);
    return true;
  }

  @Mutation(() => ManualTriggerResult)
  async triggerWatchStockNow(@Args('id', { type: () => ID }) id: string): Promise<ManualTriggerResult> {
    return this.tradingScheduler.triggerWatchStockNow(id);
  }

  @Mutation(() => ManualTriggerResult)
  async resetWatchStockCarry(@Args('id', { type: () => ID }) id: string): Promise<ManualTriggerResult> {
    await this.watchStockService.resetAccumulatedQuota(id);
    return {
      success: true,
      message: '이월 금액을 초기화했습니다.',
    };
  }
}
