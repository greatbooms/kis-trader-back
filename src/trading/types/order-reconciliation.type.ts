import { Broker } from '@prisma/client';
import { UnfilledOrder } from '../../kis/types/kis-api.types';

export interface PositionQuantitySnapshot {
  broker: Broker;
  market: 'DOMESTIC' | 'OVERSEAS';
  exchangeCode: string;
  stockCode: string;
  quantity: number;
}

export interface BrokerScopedUnfilledOrder extends UnfilledOrder {
  broker: Broker;
}
