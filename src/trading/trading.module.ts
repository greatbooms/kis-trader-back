import { Module } from '@nestjs/common';
import { TradingService } from './trading.service';
import { TradingScheduler } from './trading.scheduler';
import { MarketAnalysisService } from './market-analysis.service';
import { NoopStrategy } from './strategy/noop.strategy';
import { InfiniteBuyStrategy } from './strategy/infinite-buy.strategy';
import { KisModule } from '../kis/kis.module';
import { PrismaService } from '../prisma.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [KisModule, NotificationModule],
  providers: [
    TradingService,
    TradingScheduler,
    MarketAnalysisService,
    NoopStrategy,
    InfiniteBuyStrategy,
    PrismaService,
  ],
  exports: [TradingService, MarketAnalysisService],
})
export class TradingModule {}
