import { Module } from '@nestjs/common';
import { StockMasterService } from './stock-master.service';
import { StockMasterResolver } from './stock-master.resolver';

@Module({
  providers: [StockMasterService, StockMasterResolver],
  exports: [StockMasterService],
})
export class StockMasterModule {}
