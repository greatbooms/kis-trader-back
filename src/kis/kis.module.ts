import { Module } from '@nestjs/common';
import { KisAuthService } from './kis-auth.service';
import { KisBaseService } from './kis-base.service';
import { KisDomesticService } from './kis-domestic.service';
import { KisOverseasService } from './kis-overseas.service';
import { KisOrderHistoryPaginationService } from './kis-order-history-pagination.service';
import { KisOrderHistoryService } from './kis-order-history.service';
import { KisOverseasBalanceService } from './kis-overseas-balance.service';
import { KisOverseasCashBalanceService } from './kis-overseas-cash-balance.service';
import { PrismaService } from '../prisma.service';

@Module({
  providers: [
    PrismaService,
    KisAuthService,
    KisBaseService,
    KisOrderHistoryPaginationService,
    KisOrderHistoryService,
    KisOverseasCashBalanceService,
    KisOverseasBalanceService,
    KisDomesticService,
    KisOverseasService,
  ],
  exports: [KisAuthService, KisDomesticService, KisOverseasService],
})
export class KisModule {}
