import { Module } from '@nestjs/common';
import { TradeRecordService } from './trade-record.service';
import { TradeRecordResolver } from './trade-record.resolver';
import { PrismaService } from '../prisma.service';
import { KisModule } from '../kis/kis.module';

@Module({
  imports: [KisModule],
  providers: [TradeRecordService, TradeRecordResolver, PrismaService],
  exports: [TradeRecordService],
})
export class TradeRecordModule {}
