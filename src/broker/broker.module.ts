import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KisBrokerAdapter } from '../kis/kis-broker.adapter';
import { KisModule } from '../kis/kis.module';
import { TossBrokerService } from '../toss/toss-broker.service';
import { TossModule } from '../toss/toss.module';
import { BrokerPortRegistry } from './broker-port.registry';

export function createBrokerPortRegistry(
  kis: KisBrokerAdapter,
  toss: TossBrokerService,
  config: ConfigService,
): BrokerPortRegistry {
  return new BrokerPortRegistry(
    kis,
    config.get<string>('toss.clientId')?.trim() ? toss : undefined,
  );
}

@Module({
  imports: [KisModule, TossModule],
  providers: [
    KisBrokerAdapter,
    {
      provide: BrokerPortRegistry,
      useFactory: createBrokerPortRegistry,
      inject: [KisBrokerAdapter, TossBrokerService, ConfigService],
    },
  ],
  exports: [BrokerPortRegistry],
})
export class BrokerModule {}
