import { Injectable } from '@nestjs/common';
import { TradingStrategy, TradingStrategyContext, TradingSignal } from '../types';

@Injectable()
export class NoopStrategy implements TradingStrategy {
  name = 'noop';

  async evaluate(_context: TradingStrategyContext): Promise<TradingSignal[]> {
    // Placeholder strategy — always returns empty (no trades)
    return [];
  }
}
