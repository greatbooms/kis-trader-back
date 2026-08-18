import { Module } from '@nestjs/common';
import { TradeRecordService } from './trade-record.service';
import { TradeRecordManualOrderService } from './trade-record-manual-order.service';
import { TradeRecordResolver } from './trade-record.resolver';
import { PrismaService } from '../prisma.service';
import { KisModule } from '../kis/kis.module';
import { TradingModule } from '../trading/trading.module';
import { BrokerModule } from '../broker/broker.module';

@Module({
  imports: [BrokerModule, KisModule, TradingModule],
  providers: [TradeRecordService, TradeRecordManualOrderService, TradeRecordResolver, PrismaService],
  exports: [TradeRecordService, TradeRecordManualOrderService],
})
export class TradeRecordModule {}
