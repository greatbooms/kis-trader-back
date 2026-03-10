import { TradingSignal, MarketCondition } from '../../trading/types';
import { OrderResult } from '../../kis/types/kis-api.types';

export interface PositionInfo {
  stockCode: string;
  stockName: string;
  exchangeCode?: string;
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
}

export interface FilterLogContext {
  stockCode: string;
  exchangeCode?: string;
  reason: string;
  details: Record<string, any>;
}

export interface StopLossApprovalRequest {
  approvalId: string;
  tradeRecordId: string;
  stockCode: string;
  stockName: string;
  exchangeCode?: string;
  market: string;
  strategyName?: string;
  quantity: number;
  currentPrice: number;
  avgPrice: number;
  lossRate: number;
  timeoutMinutes: number;
}
