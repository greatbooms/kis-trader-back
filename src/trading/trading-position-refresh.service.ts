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

  async refresh(market: 'DOMESTIC' | 'OVERSEAS'): Promise<BalanceItem[]> {
    try {
      // Phase 3: active broker 루프로 확장
      const snapshot = await this.registry.get(Broker.KIS).getBalance(market as Market);

      await this.positionSyncService.syncPositions(market, snapshot);
      return snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to refresh ${market} positions: ${message}`);
      throw error;
    }
  }
}
