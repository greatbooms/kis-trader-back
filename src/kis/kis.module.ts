import { Module } from '@nestjs/common';
import { KisAuthService } from './kis-auth.service';
import { KisBaseService } from './kis-base.service';
import { KisDomesticService } from './kis-domestic.service';
import { KisOverseasService } from './kis-overseas.service';

@Module({
  providers: [KisAuthService, KisBaseService, KisDomesticService, KisOverseasService],
  exports: [KisAuthService, KisDomesticService, KisOverseasService],
})
export class KisModule {}
