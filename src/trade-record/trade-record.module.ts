import { Module, forwardRef } from '@nestjs/common';
import { TradeRecordService } from './trade-record.service';
import { TradeRecordResolver } from './trade-record.resolver';
import { PrismaService } from '../prisma.service';
import { KisModule } from '../kis/kis.module';
import { TradingModule } from '../trading/trading.module';

@Module({
  imports: [KisModule, forwardRef(() => TradingModule)],
  providers: [TradeRecordService, TradeRecordResolver, PrismaService],
  exports: [TradeRecordService],
})
export class TradeRecordModule {}
