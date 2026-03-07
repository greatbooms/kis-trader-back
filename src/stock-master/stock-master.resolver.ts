import { Resolver, Query, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { GqlAuthGuard } from '../auth/auth.guard';
import { StockMasterService } from './stock-master.service';
import { StockSearchResult } from './dto';
import { Market } from '@prisma/client';

@Resolver()
@UseGuards(GqlAuthGuard)
export class StockMasterResolver {
  constructor(private stockMasterService: StockMasterService) {}

  @Query(() => [StockSearchResult], { name: 'searchStocks' })
  searchStocks(
    @Args('keyword') keyword: string,
    @Args('market', { type: () => Market, nullable: true }) market?: Market,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('exchangeCode', { nullable: true }) exchangeCode?: string,
  ): StockSearchResult[] {
    return this.stockMasterService.searchStocks(
      keyword,
      market as 'DOMESTIC' | 'OVERSEAS' | undefined,
      limit || 20,
      exchangeCode,
    );
  }
}
