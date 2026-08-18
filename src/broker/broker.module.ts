import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Broker } from '@prisma/client';
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
  const tossEnabled = config.get<boolean>('trading.brokers.toss.enabled') === true;
  const tossCredentialsConfigured = [
    config.get<string>('toss.clientId'),
    config.get<string>('toss.clientSecret'),
    config.get<string>('toss.accountNo'),
  ].every((value) => value?.trim());

  if (tossEnabled && !tossCredentialsConfigured) {
    throw new Error('Toss broker is enabled but credentials are incomplete');
  }

  return new BrokerPortRegistry(
    kis,
    config.get<string>('toss.clientId')?.trim() ? toss : undefined,
    {
      [Broker.KIS]: config.get<boolean>('trading.brokers.kis.enabled') === true,
      [Broker.TOSS]: tossEnabled,
    },
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
