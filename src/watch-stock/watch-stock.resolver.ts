import { Resolver, Query, Mutation, Args, ID, ObjectType, Field, InputType, Float, Int, registerEnumType } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { WatchStockService } from './watch-stock.service';
import { GqlAuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../prisma.service';
import { Market } from '@prisma/client';

registerEnumType(Market, { name: 'Market' });

@ObjectType()
export class WatchStockType {
  @Field(() => ID)
  id: string;

  @Field(() => Market)
  market: Market;

  @Field({ nullable: true })
  exchangeCode?: string;

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

  @Field(() => Int)
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

  @Field({ nullable: true })
  exchangeCode?: string;

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
    private prisma: PrismaService,
  ) {}

  @Query(() => [WatchStockType], { name: 'watchStocks' })
  async findAll(@Args('market', { type: () => Market, nullable: true }) market?: Market) {
    const items = await this.watchStockService.findAll(market);

    // 각 종목의 마지막 실행 상태 조회
    const executions = await this.prisma.strategyExecution.findMany({
      where: {
        stockCode: { in: items.map((i) => i.stockCode) },
      },
      orderBy: { executedDate: 'desc' },
      distinct: ['stockCode', 'strategyName'],
    });

    const execMap = new Map<string, { signalCount: number; executedDate: string; details: string | null }>();
    for (const exec of executions) {
      const key = `${exec.stockCode}:${exec.strategyName}`;
      if (!execMap.has(key)) {
        execMap.set(key, {
          signalCount: exec.signalCount,
          executedDate: exec.executedDate,
          details: exec.details,
        });
      }
    }

    return items.map((item) => {
      const key = `${item.stockCode}:${item.strategyName}`;
      const lastExec = execMap.get(key);

      let lastExecutionStatus: string | undefined;
      let lastExecutionDate: string | undefined;

      if (lastExec) {
        lastExecutionDate = lastExec.executedDate;
        if (lastExec.signalCount > 0) {
          lastExecutionStatus = `${lastExec.signalCount}건 시그널 생성`;
        } else {
          // details에서 skipReason 추출
          try {
            const details = lastExec.details ? JSON.parse(lastExec.details) : {};
            lastExecutionStatus = details.skipReason || '시그널 없음';
          } catch {
            lastExecutionStatus = '시그널 없음';
          }
        }
      }

      return {
        ...item,
        strategyParams: item.strategyParams ? JSON.stringify(item.strategyParams) : undefined,
        lastExecutionStatus,
        lastExecutionDate,
      };
    });
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
}
