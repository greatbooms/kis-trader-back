import { Module } from '@nestjs/common';
import { TradingService } from './trading.service';
import { TradingScheduler } from './trading.scheduler';
import { TradingResolver } from './trading.resolver';
import { MarketAnalysisService } from './market-analysis.service';
import { MarketRegimeService } from './market-regime.service';
import { RiskManagementService } from './risk-management.service';
import { StrategyRegistryService } from './strategy/strategy-registry.service';
import { NoopStrategy } from './strategy/noop.strategy';
import { InfiniteBuyStrategy } from './strategy/infinite-buy.strategy';
import { MomentumBreakoutStrategy } from './strategy/momentum-breakout.strategy';
import { GridMeanReversionStrategy } from './strategy/grid-mean-reversion.strategy';
import { ConservativeStrategy } from './strategy/conservative.strategy';
import { KisModule } from '../kis/kis.module';
import { PrismaService } from '../prisma.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [KisModule, NotificationModule],
  providers: [
    TradingService,
    TradingScheduler,
    TradingResolver,
    MarketAnalysisService,
    MarketRegimeService,
    RiskManagementService,
    StrategyRegistryService,
    NoopStrategy,
    InfiniteBuyStrategy,
    MomentumBreakoutStrategy,
    GridMeanReversionStrategy,
    ConservativeStrategy,
    PrismaService,
  ],
  exports: [TradingService, MarketAnalysisService, StrategyRegistryService, RiskManagementService],
})
export class TradingModule {}
