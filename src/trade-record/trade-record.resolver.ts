import { Resolver, Query, Args, ID, ObjectType, Field, Float, Int, registerEnumType } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { TradeRecordService } from './trade-record.service';
import { GqlAuthGuard } from '../auth/auth.guard';
import { Market, Side, OrderType, OrderStatus } from '@prisma/client';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';

registerEnumType(Side, { name: 'Side' });
registerEnumType(OrderType, { name: 'OrderType' });
registerEnumType(OrderStatus, { name: 'OrderStatus' });

@ObjectType()
export class TradeRecordType {
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

  @Field(() => Side)
  side: Side;

  @Field(() => OrderType)
  orderType: OrderType;

  @Field(() => Int)
  quantity: number;

  @Field(() => Float)
  price: number;

  @Field(() => Float, { nullable: true })
  executedPrice?: number;

  @Field(() => Int, { nullable: true })
  executedQty?: number;

  @Field({ nullable: true })
  orderNo?: string;

  @Field(() => OrderStatus)
  status: OrderStatus;

  @Field({ nullable: true })
  strategyName?: string;

  @Field({ nullable: true })
  reason?: string;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class PositionType {
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

  @Field(() => Int)
  quantity: number;

  @Field(() => Float)
  avgPrice: number;

  @Field(() => Float)
  currentPrice: number;

  @Field(() => Float)
  profitLoss: number;

  @Field(() => Float)
  profitRate: number;

  @Field(() => Float)
  totalInvested: number;
}

@ObjectType()
export class StockPriceType {
  @Field()
  stockCode: string;

  @Field()
  stockName: string;

  @Field(() => Float)
  currentPrice: number;

  @Field(() => Float, { nullable: true })
  openPrice?: number;

  @Field(() => Float, { nullable: true })
  highPrice?: number;

  @Field(() => Float, { nullable: true })
  lowPrice?: number;

  @Field(() => Int, { nullable: true })
  volume?: number;
}

@ObjectType()
export class DashboardSummaryType {
  @Field(() => Float)
  totalProfitLoss: number;

  @Field(() => Int)
  totalTradeCount: number;

  @Field(() => Int)
  todayTradeCount: number;

  @Field(() => Float)
  winRate: number;
}

@ObjectType()
export class StrategyExecutionType {
  @Field(() => ID)
  id: string;

  @Field(() => Market)
  market: Market;

  @Field()
  stockCode: string;

  @Field()
  strategyName: string;

  @Field()
  executedDate: string;

  @Field(() => Float)
  progress: number;

  @Field(() => Int)
  signalCount: number;

  @Field({ nullable: true })
  details?: string;

  @Field()
  createdAt: Date;
}

@Resolver()
@UseGuards(GqlAuthGuard)
export class TradeRecordResolver {
  constructor(
    private tradeRecordService: TradeRecordService,
    private kisDomestic: KisDomesticService,
    private kisOverseas: KisOverseasService,
  ) {}

  @Query(() => [TradeRecordType], { name: 'trades' })
  findAll(
    @Args('market', { type: () => Market, nullable: true }) market?: Market,
    @Args('side', { type: () => Side, nullable: true }) side?: Side,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('offset', { type: () => Int, nullable: true }) offset?: number,
  ) {
    return this.tradeRecordService.findAll({ market, side, limit, offset });
  }

  @Query(() => TradeRecordType, { name: 'trade', nullable: true })
  findOne(@Args('id', { type: () => ID }) id: string) {
    return this.tradeRecordService.findOne(id);
  }

  @Query(() => [PositionType], { name: 'positions' })
  positions(@Args('market', { type: () => Market, nullable: true }) market?: Market) {
    return this.tradeRecordService.findPositions(market);
  }

  @Query(() => StockPriceType, { name: 'quote', nullable: true })
  async quote(@Args('stockCode') stockCode: string) {
    return this.kisDomestic.getPrice(stockCode);
  }

  @Query(() => StockPriceType, { name: 'overseasQuote', nullable: true })
  async overseasQuote(
    @Args('exchangeCode') exchangeCode: string,
    @Args('symbol') symbol: string,
  ) {
    return this.kisOverseas.getPrice(exchangeCode, symbol);
  }

  @Query(() => DashboardSummaryType, { name: 'dashboardSummary' })
  dashboardSummary() {
    return this.tradeRecordService.getDashboardSummary();
  }

  @Query(() => [StrategyExecutionType], { name: 'strategyExecutions' })
  strategyExecutions(
    @Args('stockCode', { nullable: true }) stockCode?: string,
    @Args('strategyName', { nullable: true }) strategyName?: string,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
  ) {
    return this.tradeRecordService.findStrategyExecutions({ stockCode, strategyName, limit });
  }
}
