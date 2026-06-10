import { Module } from '@nestjs/common';
import { KisModule } from '../kis/kis.module';
import { NotificationModule } from '../notification/notification.module';
import { TradingModule } from '../trading/trading.module';
import { PrismaService } from '../prisma.service';
import { SimulationModule } from '../simulation/simulation.module';
import { StockMasterModule } from '../stock-master/stock-master.module';
import { DayTradeScreeningService } from './day-trade-screening.service';
import { DeepAnalysisService } from './deep-analysis.service';
import { ScreeningService } from './screening.service';
import { ScreeningScheduler } from './screening.scheduler';
import { ScreeningResolver } from './screening.resolver';
import { ScreeningCandidateCollector } from './screening-candidate-collector.service';
import { ScreeningAnalyzer } from './screening-analyzer.service';
import { ScreeningRepository } from './screening-repository.service';

@Module({
  imports: [KisModule, NotificationModule, TradingModule, StockMasterModule, SimulationModule],
  providers: [
    PrismaService,
    DeepAnalysisService,
    ScreeningCandidateCollector,
    ScreeningAnalyzer,
    ScreeningRepository,
    ScreeningService,
    DayTradeScreeningService,
    ScreeningScheduler,
    ScreeningResolver,
  ],
  exports: [
    ScreeningService,
    ScreeningCandidateCollector,
    ScreeningAnalyzer,
    ScreeningRepository,
  ],
})
export class ScreeningModule {}
