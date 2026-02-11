import { Resolver, Query, Args, ID, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { TradeRecordService } from './trade-record.service';
import { GqlAuthGuard } from '../auth/auth.guard';
import { Market, Side } from '@prisma/client';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import {
  TradeRecordType,
  PositionType,
  StockPriceType,
  DashboardSummaryType,
  StrategyExecutionType,
} from './dto';

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
