import { Resolver, Query, Mutation, Args, ID, ObjectType, Field, InputType, Float, Int, registerEnumType } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { WatchStockService } from './watch-stock.service';
import { GqlAuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../prisma.service';
import { Market } from '@prisma/client';
import { WatchStocksFilterInput } from './dto/watch-stocks-filter.input';

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
  async findAll(@Args('input', { nullable: true }) input?: WatchStocksFilterInput) {
    const items = await this.watchStockService.findAll(input?.market);

    // 각 종목의 마지막 매매 기록 조회
    const trades = await this.prisma.tradeRecord.findMany({
      where: {
        stockCode: { in: items.map((i) => i.stockCode) },
        status: 'FILLED',
      },
      orderBy: { createdAt: 'desc' },
      distinct: ['stockCode'],
    });

    const tradeMap = new Map<string, { side: string; createdAt: Date }>();
    for (const trade of trades) {
      if (!tradeMap.has(trade.stockCode)) {
        tradeMap.set(trade.stockCode, { side: trade.side, createdAt: trade.createdAt });
      }
    }

    return items.map((item) => {
      const lastTrade = tradeMap.get(item.stockCode);

      const lastExecutionStatus = lastTrade
        ? `${lastTrade.side === 'BUY' ? '매수' : '매도'} 체결`
        : undefined;
      const lastExecutionDate = lastTrade
        ? lastTrade.createdAt.toISOString().slice(0, 10)
        : undefined;

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
