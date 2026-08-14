import { Broker } from '@prisma/client';

export interface TradingSignal {
  broker?: Broker;
  market: 'DOMESTIC' | 'OVERSEAS';
  exchangeCode: string;
  stockCode: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price?: number;
  reason: string;
  orderDivision?: string; // '00'=지정가, '34'=LOC 등
  metadata?: Record<string, any>;
}
