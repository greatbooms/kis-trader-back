import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KisModule } from '../kis/kis.module';
import { PrismaService } from '../prisma.service';
import { InfiniteBuyStrategy } from '../trading/strategy/infinite-buy.strategy';
import { MomentumBreakoutStrategy } from '../trading/strategy/momentum-breakout.strategy';
import { HistoricalCollectorService } from './data/historical-collector.service';
import configuration from '../config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    KisModule,
  ],
  providers: [PrismaService, HistoricalCollectorService, InfiniteBuyStrategy, MomentumBreakoutStrategy],
  exports: [HistoricalCollectorService, InfiniteBuyStrategy, MomentumBreakoutStrategy],
})
export class BacktestModule {}
