import { Module } from '@nestjs/common';
import { SimulationService } from './simulation.service';
import { SimulationResolver } from './simulation.resolver';
import { SimulationScheduler } from './simulation.scheduler';
import { KisModule } from '../kis/kis.module';
import { TradingModule } from '../trading/trading.module';
import { WatchStockModule } from '../watch-stock/watch-stock.module';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [KisModule, TradingModule, WatchStockModule],
  providers: [SimulationService, SimulationResolver, SimulationScheduler, PrismaService],
})
export class SimulationModule {}
