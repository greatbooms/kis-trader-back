import { Module } from '@nestjs/common';
import { KisAuthService } from './kis-auth.service';
import { KisBaseService } from './kis-base.service';
import { KisDomesticService } from './kis-domestic.service';
import { KisOverseasService } from './kis-overseas.service';
import { PrismaService } from '../prisma.service';

@Module({
  providers: [PrismaService, KisAuthService, KisBaseService, KisDomesticService, KisOverseasService],
  exports: [KisAuthService, KisDomesticService, KisOverseasService],
})
export class KisModule {}
