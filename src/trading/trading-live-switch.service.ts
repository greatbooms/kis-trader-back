import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TradingLiveSwitchService {
  private readonly logger = new Logger(TradingLiveSwitchService.name);

  constructor(private readonly configService: ConfigService) {}

  isEnabled(): boolean {
    return this.configService.get<boolean>('trading.enabled') === true;
  }

  assertEnabled(action: string): void {
    if (!this.isEnabled()) {
      throw new Error(`${action} blocked: live trading is disabled`);
    }
  }
}
