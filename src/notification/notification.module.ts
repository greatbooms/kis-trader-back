import { Module, forwardRef } from '@nestjs/common';
import { SlackService } from './slack.service';
import { SlackCommandsService } from './slack-commands.service';
import { PrismaService } from '../prisma.service';
import { TradeRecordModule } from '../trade-record/trade-record.module';
import { TradingModule } from '../trading/trading.module';

@Module({
  imports: [TradeRecordModule, forwardRef(() => TradingModule)],
  providers: [SlackService, SlackCommandsService, PrismaService],
  exports: [SlackService, SlackCommandsService],
})
export class NotificationModule {}
