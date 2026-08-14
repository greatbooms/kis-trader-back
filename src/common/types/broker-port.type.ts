import { Broker, BrokerEnvironment, Market } from '@prisma/client';
import type { TradingSignal } from '../../trading/types/trading-signal.type';
import type {
  BalanceItem,
  BrokerOrderStatus,
  OrderResult,
  OverseasAccountSnapshot,
  UnfilledOrder,
} from './broker-io.type';

export interface DomesticBuyableAmount {
  cashAvailable: number;
}

export interface BrokerCancelRequest {
  market: Market;
  exchangeCode: string;
  orderNo: string;
  stockCode: string;
  qty: number;
  price: number;
}

export interface BrokerPort {
  readonly broker: Broker;
  submitOrder(signal: TradingSignal): Promise<OrderResult>;
  cancelOrder(request: BrokerCancelRequest): Promise<OrderResult>;
  getUnfilledOrders(market: Market): Promise<UnfilledOrder[]>;
  getOrderExecutions(
    market: Market,
    startDate: string,
    endDate: string,
  ): Promise<BrokerOrderStatus[]>;
  getBalance(market: Market): Promise<BalanceItem[]>;
  getDomesticBuyableAmount(): Promise<DomesticBuyableAmount>;
  getOverseasBuyableAmount(
    exchangeCode: string,
    stockCode: string,
    price: number,
  ): Promise<{ foreignCurrencyAvailable: number; maxQuantity: number }>;
  getOverseasAccountSnapshot(nationCode?: string): Promise<OverseasAccountSnapshot>;
  getBrokerContext(): {
    broker: Broker;
    environment: BrokerEnvironment;
    accountHash: string;
  };
}
