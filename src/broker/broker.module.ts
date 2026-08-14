import { Module } from '@nestjs/common';
import { KisBrokerAdapter } from '../kis/kis-broker.adapter';
import { KisModule } from '../kis/kis.module';
import { BrokerPortRegistry } from './broker-port.registry';

@Module({
  imports: [KisModule],
  providers: [KisBrokerAdapter, BrokerPortRegistry],
  exports: [BrokerPortRegistry],
})
export class BrokerModule {}
