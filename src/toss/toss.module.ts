import { Module } from '@nestjs/common';
import { TossAuthService } from './toss-auth.service';
import { TossBaseService } from './toss-base.service';
import { TossBrokerService } from './toss-broker.service';

@Module({
  providers: [TossAuthService, TossBaseService, TossBrokerService],
  exports: [TossBrokerService],
})
export class TossModule {}
