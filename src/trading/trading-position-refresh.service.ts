import { Injectable, Logger } from '@nestjs/common';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { BalanceItem } from '../kis/types/kis-api.types';
import { TradingPositionSyncService } from './trading-position-sync.service';

@Injectable()
export class TradingPositionRefreshService {
  private readonly logger = new Logger(TradingPositionRefreshService.name);

  constructor(
    private readonly kisDomestic: KisDomesticService,
    private readonly kisOverseas: KisOverseasService,
    private readonly positionSyncService: TradingPositionSyncService,
  ) {}

  async refresh(market: 'DOMESTIC' | 'OVERSEAS'): Promise<BalanceItem[]> {
    try {
      const snapshot = market === 'DOMESTIC'
        ? await this.kisDomestic.getBalance()
        : await this.kisOverseas.getBalance();

      await this.positionSyncService.syncPositions(market, snapshot);
      return snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to refresh ${market} positions: ${message}`);
      throw error;
    }
  }
}
