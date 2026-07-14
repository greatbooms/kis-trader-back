import { Resolver, Query, Mutation, Args, ID, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { TradeRecordService } from './trade-record.service';
import { TradeRecordManualOrderService } from './trade-record-manual-order.service';
import { GqlAuthGuard } from '../auth/auth.guard';
import {
  TradeRecordType,
  PositionType,
  StockPriceType,
  QuoteHistoryPointType,
  DashboardSummaryType,
  AccountSummaryType,
  TradeFilterInput,
  OverseasQuoteInput,
  PositionsFilterInput,
  ManualSellInput,
  ManualSellResult,
  CancelTradeOrderInput,
  CancelTradeOrderResult,
  RefreshAccountStateResult,
} from './dto';

@Resolver()
@UseGuards(GqlAuthGuard)
export class TradeRecordResolver {
  constructor(
    private tradeRecordService: TradeRecordService,
    private tradeRecordManualOrderService: TradeRecordManualOrderService,
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
  async positions(@Args('input', { nullable: true }) input?: PositionsFilterInput) {
    const positions = await this.tradeRecordService.findPositions(input?.market);
    return positions.map((position) => ({
      ...position,
      avgPrice: Number(position.avgPrice),
      currentPrice: Number(position.currentPrice),
      profitLoss: Number(position.profitLoss),
      profitRate: Number(position.profitRate) / 100,
      totalInvested: Number(position.totalInvested),
    }));
  }

  @Query(() => StockPriceType, { name: 'quote', nullable: true })
  async quote(@Args('stockCode') stockCode: string) {
    return this.tradeRecordService.getDomesticQuote(stockCode);
  }

  @Query(() => [QuoteHistoryPointType], { name: 'quoteHistory' })
  async quoteHistory(
    @Args('stockCode') stockCode: string,
    @Args('months', { type: () => Int, nullable: true }) months?: number,
  ) {
    return this.tradeRecordService.getDomesticQuoteHistory(stockCode, months ?? 6);
  }

  @Query(() => StockPriceType, { name: 'overseasQuote', nullable: true })
  async overseasQuote(@Args('input') input: OverseasQuoteInput) {
    return this.tradeRecordService.getOverseasQuote(input.exchangeCode, input.symbol);
  }

  @Query(() => [QuoteHistoryPointType], { name: 'overseasQuoteHistory' })
  async overseasQuoteHistory(
    @Args('input') input: OverseasQuoteInput,
    @Args('months', { type: () => Int, nullable: true }) months?: number,
  ) {
    return this.tradeRecordService.getOverseasQuoteHistory(input.exchangeCode, input.symbol, months ?? 6);
  }

  @Query(() => AccountSummaryType, { name: 'accountSummary' })
  accountSummary() {
    return this.tradeRecordService.getAccountSummary();
  }

  @Query(() => DashboardSummaryType, { name: 'dashboardSummary' })
  dashboardSummary() {
    return this.tradeRecordService.getDashboardSummary();
  }

  @Mutation(() => RefreshAccountStateResult, { name: 'refreshAccountState' })
  refreshAccountState() {
    return this.tradeRecordService.refreshAccountState();
  }

  @Mutation(() => ManualSellResult, { name: 'manualSell' })
  async manualSell(@Args('input') input: ManualSellInput): Promise<ManualSellResult> {
    return this.tradeRecordManualOrderService.manualSell(input);
  }

  @Mutation(() => CancelTradeOrderResult, { name: 'cancelTradeOrder' })
  async cancelTradeOrder(
    @Args('input') input: CancelTradeOrderInput,
  ): Promise<CancelTradeOrderResult> {
    return this.tradeRecordManualOrderService.cancelTradeOrder(input);
  }
}
