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
}

@Resolver(() => WatchStockType)
@UseGuards(GqlAuthGuard)
export class WatchStockResolver {
  constructor(private watchStockService: WatchStockService) {}

  @Query(() => [WatchStockType], { name: 'watchStocks' })
  findAll(@Args('market', { type: () => Market, nullable: true }) market?: Market) {
    return this.watchStockService.findAll(market);
  }

  @Mutation(() => WatchStockType)
  createWatchStock(@Args('input') input: CreateWatchStockInput) {
    return this.watchStockService.create(input);
  }

  @Mutation(() => WatchStockType)
  updateWatchStock(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateWatchStockInput,
  ) {
    return this.watchStockService.update(id, input);
  }

  @Mutation(() => Boolean)
  async deleteWatchStock(@Args('id', { type: () => ID }) id: string) {
    await this.watchStockService.delete(id);
    return true;
  }
}
