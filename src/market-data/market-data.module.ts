import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { KisModule } from '../kis/kis.module';
import { OpenDartModule } from '../opendart/opendart.module';
import { SecModule } from '../sec/sec.module';
import { FredModule } from '../fred/fred.module';
import { MarketDataSnapshotService } from './market-data-snapshot.service';
import { MarketDataCacheService } from './market-data-cache.service';
import { MarketDataWarmupService } from './market-data-warmup.service';

@Global()
@Module({
  imports: [KisModule, OpenDartModule, SecModule, FredModule],
  providers: [
    PrismaService,
    MarketDataSnapshotService,
    MarketDataCacheService,
    MarketDataWarmupService,
  ],
  exports: [MarketDataSnapshotService, MarketDataCacheService],
})
export class MarketDataModule {}
