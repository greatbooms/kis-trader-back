import { Injectable, Logger } from '@nestjs/common';
import { Broker, Market } from '@prisma/client';
import { BrokerPortRegistry } from '../broker/broker-port.registry';
import { BalanceItem } from '../common/types';
import { TradingPositionSyncService } from './trading-position-sync.service';

@Injectable()
export class TradingPositionRefreshService {
  private readonly logger = new Logger(TradingPositionRefreshService.name);

  constructor(
    private readonly registry: BrokerPortRegistry,
    private readonly positionSyncService: TradingPositionSyncService,
  ) {}

  async refresh(broker: Broker, market: 'DOMESTIC' | 'OVERSEAS'): Promise<BalanceItem[]> {
    try {
      const snapshot = await this.registry.get(broker).getBalance(market as Market);

      await this.positionSyncService.syncPositions(broker, market, snapshot);
      return snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[${broker} ${market}] Failed to refresh positions: ${message}`);
      throw error;
    }
  }
}
