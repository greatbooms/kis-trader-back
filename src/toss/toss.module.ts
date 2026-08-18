import { Module } from '@nestjs/common';
import { TossAuthService } from './toss-auth.service';
import { TossBaseService } from './toss-base.service';
import { TossBrokerService } from './toss-broker.service';
import { TossVenueResolverService } from './toss-venue-resolver.service';

@Module({
  providers: [TossAuthService, TossBaseService, TossVenueResolverService, TossBrokerService],
  exports: [TossBrokerService],
})
export class TossModule {}
