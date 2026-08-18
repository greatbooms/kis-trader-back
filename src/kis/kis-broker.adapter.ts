import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Broker, BrokerEnvironment, Market } from '@prisma/client';
import type { BrokerCancelRequest, BrokerPort } from '../common/types';
import { hashBrokerAccount } from '../common/utils/broker-account-hash.util';
import type { TradingSignal } from '../trading/types';
import { KisDomesticService } from './kis-domestic.service';
import { KisOverseasService } from './kis-overseas.service';

@Injectable()
export class KisBrokerAdapter implements BrokerPort {
  readonly broker = Broker.KIS;

  constructor(
    private readonly domestic: KisDomesticService,
    private readonly overseas: KisOverseasService,
    private readonly config: ConfigService,
  ) {}

  submitOrder(signal: TradingSignal) {
    if (signal.market === 'DOMESTIC') {
      return signal.side === 'BUY'
        ? this.domestic.orderBuy(
          signal.stockCode,
          signal.quantity,
          signal.price,
          signal.orderDivision,
        )
        : this.domestic.orderSell(
          signal.stockCode,
          signal.quantity,
          signal.price,
          signal.orderDivision,
        );
    }

    return signal.side === 'BUY'
      ? this.overseas.orderBuy(
        signal.exchangeCode,
        signal.stockCode,
        signal.quantity,
        signal.price || 0,
        signal.orderDivision,
      )
      : this.overseas.orderSell(
        signal.exchangeCode,
        signal.stockCode,
        signal.quantity,
        signal.price || 0,
        signal.orderDivision,
      );
  }

  cancelOrder(request: BrokerCancelRequest) {
    return request.market === Market.DOMESTIC
      ? this.domestic.cancelOrder(request.orderNo, request.stockCode, request.qty)
      : this.overseas.cancelOrder(
        request.exchangeCode,
        request.orderNo,
        request.stockCode,
        request.qty,
        request.price,
      );
  }

  getUnfilledOrders(market: Market) {
    return market === Market.DOMESTIC
      ? this.domestic.getUnfilledOrders()
      : this.overseas.getUnfilledOrders();
  }

  getOrderExecutions(market: Market, startDate: string, endDate: string) {
    return market === Market.DOMESTIC
      ? this.domestic.getOrderExecutions(startDate, endDate)
      : this.overseas.getOrderExecutions(startDate, endDate);
  }

  getBalance(market: Market) {
    return market === Market.DOMESTIC
      ? this.domestic.getBalance()
      : this.overseas.getBalance();
  }

  getDomesticBuyableAmount() {
    return this.domestic.getBuyableAmount();
  }

  getOverseasBuyableAmount(exchangeCode: string, stockCode: string, price: number) {
    return this.overseas.getBuyableAmount(exchangeCode, stockCode, price);
  }

  getOverseasAccountSnapshot(nationCode?: string) {
    return this.overseas.getAccountSnapshot(nationCode);
  }

  getBrokerContext() {
    const configuredAccount = this.config.get<unknown>('kis.accountNo');
    const configuredEnvironment = this.config.get<unknown>('kis.env');
    if (typeof configuredAccount !== 'string' || typeof configuredEnvironment !== 'string') {
      throw new Error('Invalid KIS broker configuration');
    }

    const account = configuredAccount.trim();
    if (!/^\d{8}(?:\d{2})?$/.test(account)) {
      throw new Error('Invalid KIS broker configuration');
    }

    const normalizedEnvironment = configuredEnvironment.trim().toLowerCase();
    if (normalizedEnvironment !== 'paper' && normalizedEnvironment !== 'prod') {
      throw new Error('Invalid KIS broker configuration');
    }

    const productCode = account.length === 10
      ? account.slice(8, 10)
      : this.config.get<unknown>('kis.prodCode');
    if (typeof productCode !== 'string' || !/^\d{2}$/.test(productCode.trim())) {
      throw new Error('Invalid KIS broker configuration');
    }

    return {
      broker: Broker.KIS,
      environment: normalizedEnvironment === 'paper'
        ? BrokerEnvironment.PAPER
        : BrokerEnvironment.PROD,
      accountHash: hashBrokerAccount(`${account.slice(0, 8)}${productCode.trim()}`),
    };
  }
}
