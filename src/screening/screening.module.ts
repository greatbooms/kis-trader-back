import { Module } from '@nestjs/common';
import { KisModule } from '../kis/kis.module';
import { NotificationModule } from '../notification/notification.module';
import { PrismaService } from '../prisma.service';
import { ScreeningService } from './screening.service';
import { ScreeningScheduler } from './screening.scheduler';
import { ScreeningResolver } from './screening.resolver';

@Module({
  imports: [KisModule, NotificationModule],
  providers: [
    PrismaService,
    ScreeningService,
    ScreeningScheduler,
    ScreeningResolver,
  ],
  exports: [ScreeningService],
})
export class ScreeningModule {}
