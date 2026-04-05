import { TradingSignal } from './trading-signal.type';

export interface StrategyEvaluationResult {
  signals: TradingSignal[];
  /** 시그널이 없을 때 전략 내부 거절 이유 */
  skipReasons: string[];
}
