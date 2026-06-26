import { TradingSignal, MarketCondition } from '../../trading/types';
import { OrderResult } from '../../kis/types/kis-api.types';

export interface PositionInfo {
  stockCode: string;
  stockName: string;
  exchangeCode: string;
  market: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  profitLoss: number;
  profitRate: number;
  totalInvested: number;
}

export interface TradeAlertContext {
  signal: TradingSignal;
  result: OrderResult;
  position?: PositionInfo;
  execution?: {
    quantity: number;
    price?: number;
    remainingQuantity?: number;
    status?: 'FILLED' | 'PARTIAL';
  };
  strategyDetails?: {
    tValue?: number;
    maxCycles?: number;
    pivotPrice?: number;
    adjustedQuota?: number;
    originalQuota?: number;
    rsi?: number;
    ma200?: number;
    targetRate?: number;
    realizedPnl?: number;
  };
}

export interface DailySummaryContext {
  summaryTitle?: string;
  positions: PositionInfo[];
  todayBuyCount: number;
  todaySellCount: number;
  skipCount: number;
  skipReasons: string[];
  totalInvested: number;
  totalEvaluation: number;
  totalPnl: number;
  totalPnlRate: number;
  marketCondition?: MarketCondition;
  marketSummaries?: DailySummaryMarketSummary[];
  marketConditions?: DailySummaryMarketConditionSummary[];
}

export interface DailySummaryBuildOptions {
  summaryTitle?: string;
  tradeStart?: Date;
  tradeEnd?: Date;
  market?: 'DOMESTIC' | 'OVERSEAS';
  exchangeCodes?: string[];
}

export interface DailySummaryMarketSummary {
  market: string;
  exchangeCode: string;
  label: string;
  positions: PositionInfo[];
  totalInvested: number;
  totalEvaluation: number;
  totalPnl: number;
  totalPnlRate: number;
}

export interface DailySummaryMarketConditionSummary {
  market: string;
  exchangeCode: string;
  label: string;
  condition: MarketCondition;
}

export interface FilterLogContext {
  stockCode: string;
  exchangeCode: string;
  reason: string;
  details: Record<string, any>;
}

export interface InsufficientFundsAlertContext {
  stockCode: string;
  stockName: string;
  exchangeCode: string;
  market: string;
  strategyName?: string;
  reason: string;
  buyableAmount: number;
  plannedAmount?: number;
  adjustedQuota?: number;
  currentPrice: number;
  minimumExecutablePrice?: number;
  carryAmountToday?: number;
  nextAccumulatedQuota?: number;
}

export interface RiskAlertContext {
  market: string;
  riskType: 'MDD_LIQUIDATE' | 'MDD_BUY_BLOCK' | 'DAILY_PNL' | 'POSITION_LIMIT' | 'INVESTED_RATE';
  reasons: string[];
  details: {
    drawdown?: number;
    peakValue?: number;
    currentValue?: number;
    dailyPnlRate?: number;
    positionCount?: number;
    investedRate?: number;
  };
}

export interface StopLossApprovalRequest {
  approvalId: string;
  tradeRecordId: string;
  stockCode: string;
  stockName: string;
  exchangeCode: string;
  market: string;
  strategyName?: string;
  quantity: number;
  currentPrice: number;
  avgPrice: number;
  lossRate: number;
  timeoutMinutes: number;
}

export interface StopLossAlertContext {
  stockCode: string;
  stockName: string;
  exchangeCode: string;
  market: string;
  strategyName?: string;
  quantity: number;
  currentPrice: number;
  avgPrice: number;
  lossRate: number;
}
