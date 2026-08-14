import { Injectable, Logger } from '@nestjs/common';
import { BrokerPortRegistry } from '../broker/broker-port.registry';
import { OrderResult } from '../common/types';
import { TradingSignal } from './types';

@Injectable()
export class TradingBrokerOrderSubmissionService {
  private readonly logger = new Logger(TradingBrokerOrderSubmissionService.name);

  constructor(private readonly registry: BrokerPortRegistry) {}

  async submit(signal: TradingSignal): Promise<OrderResult> {
    if (!signal.broker) {
      throw new Error(`[${signal.stockCode}] Broker is required for order submission`);
    }
    try {
      return await this.registry.get(signal.broker).submitOrder(signal);
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
