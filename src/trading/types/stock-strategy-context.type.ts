import { StockPriceResult } from '../../kis/types/kis-api.types';
import { StrategyEvaluationResult } from './strategy-evaluation-result.type';
import { WatchStockConfig } from './watch-stock-config.type';
import { MarketCondition } from './market-condition.type';
import { StockIndicators } from './stock-indicators.type';
import { StockFundamentals } from './stock-fundamentals.type';
import { MarketRegimeLabel, RiskLevel, RiskState } from './risk-state.type';

export interface StockStrategyContext {
  watchStock: WatchStockConfig;
  price: StockPriceResult;
  position?: {
    stockCode: string;
    quantity: number;
    avgPrice: number;
    currentPrice: number;
    totalInvested: number;
  };
  alreadyExecutedToday: boolean;
  marketCondition: MarketCondition;
  stockIndicators: StockIndicators;
  fundamentals?: StockFundamentals;
  buyableAmount: number;
  buyableMeta?: {
    source:
      | 'KIS_DOMESTIC_BUYABLE_AMOUNT'
      | 'KIS_OVERSEAS_INQUIRE_PSAMOUNT'
      | 'TOSS_DOMESTIC_BUYABLE_AMOUNT'
      | 'TOSS_OVERSEAS_BUYABLE_AMOUNT';
    maxQuantity?: number;
    priceUsed?: number;
  };
  totalPortfolioValue: number;
  marketRegime?: MarketRegimeLabel;
  riskState?: RiskState;
  /**
   * 평가 컨텍스트 종류. 미설정 시 'realtime'(실시간 시세 기반)으로 간주.
   * 'daily-bar'는 백테스트의 일봉 단위 평가 — 장중 시세 의존 조건(시간 윈도우,
   * 당일 누적거래량, VWAP 등)을 평가할 수 없으므로 전략이 근사 모드로 동작한다.
   */
  evaluationMode?: 'realtime' | 'daily-bar';
  /** 이 종목의 미체결 매수 주문 존재 여부. undefined = 정보 없음 (차단하지 않음) */
  hasOpenBuyOrder?: boolean;
  /** 이 종목의 미체결 매도 주문 존재 여부. undefined = 정보 없음 (차단하지 않음) */
  hasOpenSellOrder?: boolean;
  /** 평가 기준 시각 — 테스트/리플레이용 주입. 미설정 시 현재 시각 사용 */
  now?: Date;
}

export type ExecutionMode =
  | { type: 'continuous' }
  | {
      type: 'once-daily';
      hours: {
        domestic: number;
        /**
         * 해외 시장 실행 시점 기준.
         * 'afterOpen' + offset: 장 시작 후 N시간 (무한매수법 등 장 초반 주문)
         * 'beforeClose' + offset: 장 마감 N시간 전 (추세/밸류 등 장 마감 전 판단)
         */
        overseas: { basis: 'afterOpen' | 'beforeClose'; offsetHours: number };
      };
    };

export type { RiskLevel };

export interface StrategyMeta {
  riskLevel: RiskLevel;
  /** MDD 매수차단 임계값 (예: -0.10 = -10%) */
  mddBuyBlock: number;
  /** MDD 전량청산 임계값 (예: -0.15 = -15%) */
  mddLiquidate: number;
  expectedReturn: string;
  maxLoss: string;
  investmentPeriod: string;
  tradingFrequency: string;
  suitableFor: string[];
  tags: string[];
}

export interface PerStockTradingStrategy {
  name: string;
  displayName: string;
  description: string;
  executionMode: ExecutionMode;
  meta: StrategyMeta;
  evaluateStock(context: StockStrategyContext): Promise<StrategyEvaluationResult>;
}
