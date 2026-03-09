import { Resolver, Query, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { GqlAuthGuard } from '../auth/auth.guard';
import { StockMasterService } from './stock-master.service';
import { StockSearchResult, SearchStocksInput } from './dto';

@Resolver()
@UseGuards(GqlAuthGuard)
export class StockMasterResolver {
  constructor(private stockMasterService: StockMasterService) {}

  @Query(() => [StockSearchResult], { name: 'searchStocks' })
  searchStocks(@Args('input') input: SearchStocksInput): StockSearchResult[] {
    return this.stockMasterService.searchStocks(
      input.keyword,
      input.market as 'DOMESTIC' | 'OVERSEAS' | undefined,
      input.limit || 20,
      input.exchangeCode,
    );
  }
}
