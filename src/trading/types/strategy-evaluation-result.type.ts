import { TradingSignal } from './trading-signal.type';

export interface StrategyEvaluationResult {
  signals: TradingSignal[];
  /** 시그널이 없을 때 전략 내부 거절 이유 */
  skipReasons: string[];
  /** 전략 내부 계산 상세 정보 (quota 조정, 필터 근거 등) */
  details?: Record<string, any>;
}
