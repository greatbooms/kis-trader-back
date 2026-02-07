import { Module } from '@nestjs/common';
import { WatchStockService } from './watch-stock.service';
import { WatchStockResolver } from './watch-stock.resolver';
import { PrismaService } from '../prisma.service';

@Module({
  providers: [WatchStockService, WatchStockResolver, PrismaService],
  exports: [WatchStockService],
})
export class WatchStockModule {}
