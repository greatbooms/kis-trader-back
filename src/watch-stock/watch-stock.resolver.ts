import { Resolver, Query, Mutation, Args, ID, ObjectType, Field, InputType, Float, Int, registerEnumType } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { WatchStockService } from './watch-stock.service';
import { GqlAuthGuard } from '../auth/auth.guard';
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
  constructor(private watchStockService: WatchStockService) {}

  @Query(() => [WatchStockType], { name: 'watchStocks' })
  async findAll(@Args('market', { type: () => Market, nullable: true }) market?: Market) {
    const items = await this.watchStockService.findAll(market);
    return items.map((item) => ({
      ...item,
      strategyParams: item.strategyParams ? JSON.stringify(item.strategyParams) : undefined,
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
}
