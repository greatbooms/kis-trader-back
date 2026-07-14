import { BrokerOrderStatus, UnfilledOrder } from '../../kis/types/kis-api.types';

export interface BrokerCancellationRead {
  executions: BrokerOrderStatus[];
  unfilledOrders: UnfilledOrder[];
}
