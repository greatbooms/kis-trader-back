import { Module } from '@nestjs/common';
import { SimulationService } from './simulation.service';
import { SimulationSessionManager } from './simulation-session-manager.service';
import { SimulationPositionService } from './simulation-position.service';
import { SimulationMetricsService } from './simulation-metrics.service';
import { SimulationTickEngine } from './simulation-tick-engine.service';
import { SimulationResolver } from './simulation.resolver';
import { SimulationScheduler } from './simulation.scheduler';
import { KisModule } from '../kis/kis.module';
import { TradingModule } from '../trading/trading.module';
import { WatchStockModule } from '../watch-stock/watch-stock.module';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [KisModule, TradingModule, WatchStockModule],
  providers: [
    SimulationService,
    SimulationSessionManager,
    SimulationPositionService,
    SimulationMetricsService,
    SimulationTickEngine,
    SimulationResolver,
    SimulationScheduler,
    PrismaService,
  ],
  exports: [
    SimulationService,
    SimulationSessionManager,
    SimulationPositionService,
    SimulationMetricsService,
    SimulationTickEngine,
  ],
})
export class SimulationModule {}
