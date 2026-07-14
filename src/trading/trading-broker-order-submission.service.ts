import { Injectable, Logger } from '@nestjs/common';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { OrderResult } from '../kis/types';
import { TradingSignal } from './types';

@Injectable()
export class TradingBrokerOrderSubmissionService {
  private readonly logger = new Logger(TradingBrokerOrderSubmissionService.name);

  constructor(
    private readonly kisDomestic: KisDomesticService,
    private readonly kisOverseas: KisOverseasService,
  ) {}

  async submit(signal: TradingSignal): Promise<OrderResult> {
    try {
      if (signal.market === 'DOMESTIC') {
        return signal.side === 'BUY'
          ? await this.kisDomestic.orderBuy(
            signal.stockCode,
            signal.quantity,
            signal.price,
            signal.orderDivision,
          )
          : await this.kisDomestic.orderSell(
            signal.stockCode,
            signal.quantity,
            signal.price,
            signal.orderDivision,
          );
      }

      return signal.side === 'BUY'
        ? await this.kisOverseas.orderBuy(
          signal.exchangeCode,
          signal.stockCode,
          signal.quantity,
          signal.price || 0,
          signal.orderDivision,
        )
        : await this.kisOverseas.orderSell(
          signal.exchangeCode,
          signal.stockCode,
          signal.quantity,
          signal.price || 0,
          signal.orderDivision,
        );
    } catch (error) {
      this.logger.warn(
        `[${signal.stockCode}] Broker order submission failed: ${this.errorMessage(error)}`,
      );
      throw error;
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
