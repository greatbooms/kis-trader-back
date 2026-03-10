import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { TradeRecordService } from './trade-record.service';
import { GqlAuthGuard } from '../auth/auth.guard';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import {
  TradeRecordType,
  PositionType,
  StockPriceType,
  DashboardSummaryType,
  AccountSummaryType,
  TradeFilterInput,
  OverseasQuoteInput,
  PositionsFilterInput,
  ManualSellInput,
  ManualSellResult,
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
  findAll(@Args('input', { nullable: true }) input?: TradeFilterInput) {
    return this.tradeRecordService.findAll(input ?? {});
  }

  @Query(() => TradeRecordType, { name: 'trade', nullable: true })
  findOne(@Args('id', { type: () => ID }) id: string) {
    return this.tradeRecordService.findOne(id);
  }

  @Query(() => [PositionType], { name: 'positions' })
  positions(@Args('input', { nullable: true }) input?: PositionsFilterInput) {
    return this.tradeRecordService.findPositions(input?.market);
  }

  @Query(() => StockPriceType, { name: 'quote', nullable: true })
  async quote(@Args('stockCode') stockCode: string) {
    return this.kisDomestic.getPrice(stockCode);
  }

  @Query(() => StockPriceType, { name: 'overseasQuote', nullable: true })
  async overseasQuote(@Args('input') input: OverseasQuoteInput) {
    return this.kisOverseas.getPrice(input.exchangeCode, input.symbol);
  }

  @Query(() => AccountSummaryType, { name: 'accountSummary' })
  accountSummary() {
    return this.tradeRecordService.getAccountSummary();
  }

  @Query(() => DashboardSummaryType, { name: 'dashboardSummary' })
  dashboardSummary() {
    return this.tradeRecordService.getDashboardSummary();
  }

  @Mutation(() => ManualSellResult, { name: 'manualSell' })
  async manualSell(@Args('input') input: ManualSellInput): Promise<ManualSellResult> {
    return this.tradeRecordService.manualSell(input);
  }
}
