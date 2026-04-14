// @ts-nocheck
import { gql } from '@apollo/client';
import * as ApolloReactCommon from '@apollo/client/react';
import * as ApolloReactHooks from '@apollo/client/react';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
const defaultOptions = {} as const;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** A date-time string at UTC, such as 2019-12-03T09:54:33Z, compliant with the date-time format. */
  DateTime: { input: any; output: any; }
};

export type AccountSummaryType = {
  __typename?: 'AccountSummaryType';
  cashBalance: Scalars['Float']['output'];
  cashBalances: Array<CashBalanceType>;
  lastSyncedAt?: Maybe<Scalars['String']['output']>;
  positionCount: Scalars['Int']['output'];
  profitRate: Scalars['Float']['output'];
  /** 실현 손익 (매도 완료된 거래의 손익 합계) */
  realizedPnL: Scalars['Float']['output'];
  totalAssets: Scalars['Float']['output'];
  totalInvested: Scalars['Float']['output'];
  /** 미실현 손익 (보유 포지션 평가 손익) */
  totalProfitLoss: Scalars['Float']['output'];
};

export type AuthPayload = {
  __typename?: 'AuthPayload';
  success: Scalars['Boolean']['output'];
};

export type CancelTradeOrderInput = {
  tradeRecordId: Scalars['ID']['input'];
};

export type CancelTradeOrderResult = {
  __typename?: 'CancelTradeOrderResult';
  message?: Maybe<Scalars['String']['output']>;
  orderNo?: Maybe<Scalars['String']['output']>;
  success: Scalars['Boolean']['output'];
};

export type CashBalanceType = {
  __typename?: 'CashBalanceType';
  amount: Scalars['Float']['output'];
  currencyCode: Scalars['String']['output'];
  currencyName?: Maybe<Scalars['String']['output']>;
  market: Market;
  withdrawableAmount?: Maybe<Scalars['Float']['output']>;
};

export type CreateSimulationInput = {
  countryCode?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  exchangeCode: Scalars['String']['input'];
  market: Market;
  maxPortfolioRate?: InputMaybe<Scalars['Float']['input']>;
  name: Scalars['String']['input'];
  quota: Scalars['Float']['input'];
  stockCode: Scalars['String']['input'];
  stockName: Scalars['String']['input'];
  stopLossRate?: InputMaybe<Scalars['Float']['input']>;
  strategyName: Scalars['String']['input'];
  strategyParams?: InputMaybe<Scalars['String']['input']>;
};

export type CreateWatchStockInput = {
  exchangeCode: Scalars['String']['input'];
  market: Market;
  maxCycles?: InputMaybe<Scalars['Int']['input']>;
  maxPortfolioRate?: InputMaybe<Scalars['Float']['input']>;
  quota?: InputMaybe<Scalars['Float']['input']>;
  stockCode: Scalars['String']['input'];
  stockName: Scalars['String']['input'];
  stopLossRate?: InputMaybe<Scalars['Float']['input']>;
  strategyName?: InputMaybe<Scalars['String']['input']>;
  strategyParams?: InputMaybe<Scalars['String']['input']>;
};

export type DashboardSummaryType = {
  __typename?: 'DashboardSummaryType';
  todayTradeCount: Scalars['Int']['output'];
  totalProfitLoss: Scalars['Float']['output'];
  totalTradeCount: Scalars['Int']['output'];
  winRate: Scalars['Float']['output'];
};

export type FactorScoreType = {
  __typename?: 'FactorScoreType';
  consensus?: Maybe<Scalars['Float']['output']>;
  dividend?: Maybe<Scalars['Float']['output']>;
  fundamental?: Maybe<Scalars['Float']['output']>;
  growth?: Maybe<Scalars['Float']['output']>;
  momentum?: Maybe<Scalars['Float']['output']>;
  pattern?: Maybe<Scalars['Float']['output']>;
  profitability?: Maybe<Scalars['Float']['output']>;
  risk?: Maybe<Scalars['Float']['output']>;
  supplyDemand?: Maybe<Scalars['Float']['output']>;
  technical?: Maybe<Scalars['Float']['output']>;
  valuation?: Maybe<Scalars['Float']['output']>;
};

export type LoginInput = {
  password: Scalars['String']['input'];
  username: Scalars['String']['input'];
};

export type ManualSellInput = {
  exchangeCode: Scalars['String']['input'];
  market: Scalars['String']['input'];
  /** 매도 수량 (미지정 시 전량) */
  quantity?: InputMaybe<Scalars['Float']['input']>;
  stockCode: Scalars['String']['input'];
};

export type ManualSellResult = {
  __typename?: 'ManualSellResult';
  message?: Maybe<Scalars['String']['output']>;
  orderNo?: Maybe<Scalars['String']['output']>;
  success: Scalars['Boolean']['output'];
};

export type ManualTriggerResult = {
  __typename?: 'ManualTriggerResult';
  message: Scalars['String']['output'];
  success: Scalars['Boolean']['output'];
};

export type Market =
  | 'DOMESTIC'
  | 'OVERSEAS';

export type MarketRegimeFilterInput = {
  exchangeCode: Scalars['String']['input'];
  market: Market;
};

export type MarketRegimeType = {
  __typename?: 'MarketRegimeType';
  exchangeCode: Scalars['String']['output'];
  market: Scalars['String']['output'];
  regime: Scalars['String']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  cancelTradeOrder: CancelTradeOrderResult;
  createSimulation: SimulationSessionType;
  createWatchStock: WatchStockType;
  deleteSimulation: Scalars['Boolean']['output'];
  deleteWatchStock: Scalars['Boolean']['output'];
  login: AuthPayload;
  logout: AuthPayload;
  manualSell: ManualSellResult;
  refreshAccountState: RefreshAccountStateResult;
  resetSimulation: SimulationSessionType;
  resetWatchStockCarry: ManualTriggerResult;
  runDeepAnalysisNow: Scalars['Boolean']['output'];
  runScreeningNow: Scalars['Boolean']['output'];
  setStrategyAllocation: StrategyAllocationType;
  triggerSimulationNow: ManualTriggerResult;
  triggerWatchStockNow: ManualTriggerResult;
  updateScreeningSettings: ScreeningSettingsType;
  updateSimulationSettings: SimulationSessionType;
  updateSimulationStatus: SimulationSessionType;
  updateWatchStock: WatchStockType;
};


export type MutationCancelTradeOrderArgs = {
  input: CancelTradeOrderInput;
};


export type MutationCreateSimulationArgs = {
  input: CreateSimulationInput;
};


export type MutationCreateWatchStockArgs = {
  input: CreateWatchStockInput;
};


export type MutationDeleteSimulationArgs = {
  id: Scalars['String']['input'];
};


export type MutationDeleteWatchStockArgs = {
  id: Scalars['ID']['input'];
};


export type MutationLoginArgs = {
  input: LoginInput;
};


export type MutationManualSellArgs = {
  input: ManualSellInput;
};


export type MutationResetSimulationArgs = {
  id: Scalars['String']['input'];
};


export type MutationResetWatchStockCarryArgs = {
  id: Scalars['ID']['input'];
};


export type MutationRunDeepAnalysisNowArgs = {
  input: RunScreeningInput;
};


export type MutationRunScreeningNowArgs = {
  input: RunScreeningInput;
};


export type MutationSetStrategyAllocationArgs = {
  input: SetStrategyAllocationInput;
};


export type MutationTriggerSimulationNowArgs = {
  id: Scalars['String']['input'];
};


export type MutationTriggerWatchStockNowArgs = {
  id: Scalars['ID']['input'];
};


export type MutationUpdateScreeningSettingsArgs = {
  input: UpdateScreeningSettingsInput;
};


export type MutationUpdateSimulationSettingsArgs = {
  input: UpdateSimulationSettingsInput;
};


export type MutationUpdateSimulationStatusArgs = {
  input: UpdateSimulationStatusInput;
};


export type MutationUpdateWatchStockArgs = {
  id: Scalars['ID']['input'];
  input: UpdateWatchStockInput;
};

export type OrderStatus =
  | 'AWAITING_APPROVAL'
  | 'CANCELLED'
  | 'FAILED'
  | 'FILLED'
  | 'PARTIAL'
  | 'PENDING';

export type OrderType =
  | 'LIMIT'
  | 'LOC'
  | 'MARKET';

export type OverseasQuoteInput = {
  exchangeCode: Scalars['String']['input'];
  symbol: Scalars['String']['input'];
};

export type PositionType = {
  __typename?: 'PositionType';
  avgPrice: Scalars['Float']['output'];
  currentPrice: Scalars['Float']['output'];
  exchangeCode: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  market: Market;
  profitLoss: Scalars['Float']['output'];
  profitRate: Scalars['Float']['output'];
  quantity: Scalars['Int']['output'];
  stockCode: Scalars['String']['output'];
  stockName: Scalars['String']['output'];
  totalInvested: Scalars['Float']['output'];
};

export type PositionsFilterInput = {
  market?: InputMaybe<Market>;
};

export type Query = {
  __typename?: 'Query';
  accountSummary: AccountSummaryType;
  availableStrategies: Array<StrategyInfo>;
  dashboardSummary: DashboardSummaryType;
  marketRegime: MarketRegimeType;
  overseasQuote?: Maybe<StockPriceType>;
  overseasQuoteHistory: Array<QuoteHistoryPointType>;
  positions: Array<PositionType>;
  quote?: Maybe<StockPriceType>;
  quoteHistory: Array<QuoteHistoryPointType>;
  screeningDateSummaries: Array<ScreeningDateSummary>;
  screeningDates: Array<Scalars['String']['output']>;
  screeningSettings: ScreeningSettingsType;
  searchStocks: Array<StockSearchResult>;
  simulationMetrics: SimulationMetricsType;
  simulationPositions: Array<SimulationPositionType>;
  simulationSession?: Maybe<SimulationSessionType>;
  simulationSessions: Array<SimulationSessionType>;
  simulationSnapshots: Array<SimulationSnapshotType>;
  simulationTrades: Array<SimulationTradeType>;
  stockDeepAnalysis?: Maybe<StockDeepAnalysisType>;
  stockRecommendations: Array<StockRecommendationType>;
  strategyAllocations: Array<StrategyAllocationType>;
  trade?: Maybe<TradeRecordType>;
  trades: Array<TradeRecordType>;
  watchStock?: Maybe<WatchStockType>;
  watchStockExecutionLogs: Array<WatchStockExecutionLogType>;
  watchStocks: Array<WatchStockType>;
};


export type QueryMarketRegimeArgs = {
  input: MarketRegimeFilterInput;
};


export type QueryOverseasQuoteArgs = {
  input: OverseasQuoteInput;
};


export type QueryOverseasQuoteHistoryArgs = {
  input: OverseasQuoteInput;
  months?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryPositionsArgs = {
  input?: InputMaybe<PositionsFilterInput>;
};


export type QueryQuoteArgs = {
  stockCode: Scalars['String']['input'];
};


export type QueryQuoteHistoryArgs = {
  months?: InputMaybe<Scalars['Int']['input']>;
  stockCode: Scalars['String']['input'];
};


export type QueryScreeningDateSummariesArgs = {
  input?: InputMaybe<ScreeningListFilterInput>;
};


export type QueryScreeningDatesArgs = {
  input?: InputMaybe<ScreeningListFilterInput>;
};


export type QuerySearchStocksArgs = {
  input: SearchStocksInput;
};


export type QuerySimulationMetricsArgs = {
  sessionId: Scalars['String']['input'];
};


export type QuerySimulationPositionsArgs = {
  sessionId: Scalars['String']['input'];
};


export type QuerySimulationSessionArgs = {
  id: Scalars['String']['input'];
};


export type QuerySimulationSessionsArgs = {
  input?: InputMaybe<SimulationSessionsFilterInput>;
};


export type QuerySimulationSnapshotsArgs = {
  sessionId: Scalars['String']['input'];
};


export type QuerySimulationTradesArgs = {
  input: SimulationTradesFilterInput;
};


export type QueryStockDeepAnalysisArgs = {
  date?: InputMaybe<Scalars['String']['input']>;
  exchangeCode?: InputMaybe<Scalars['String']['input']>;
  stockCode: Scalars['String']['input'];
};


export type QueryStockRecommendationsArgs = {
  input?: InputMaybe<StockRecommendationsFilterInput>;
};


export type QueryStrategyAllocationsArgs = {
  input: StrategyAllocationsFilterInput;
};


export type QueryTradeArgs = {
  id: Scalars['ID']['input'];
};


export type QueryTradesArgs = {
  input?: InputMaybe<TradeFilterInput>;
};


export type QueryWatchStockArgs = {
  id: Scalars['ID']['input'];
};


export type QueryWatchStockExecutionLogsArgs = {
  limit?: InputMaybe<Scalars['Float']['input']>;
  watchStockId: Scalars['String']['input'];
};


export type QueryWatchStocksArgs = {
  input?: InputMaybe<WatchStocksFilterInput>;
};

export type QuoteHistoryPointType = {
  __typename?: 'QuoteHistoryPointType';
  close: Scalars['Float']['output'];
  date: Scalars['String']['output'];
  high: Scalars['Float']['output'];
  low: Scalars['Float']['output'];
  open: Scalars['Float']['output'];
  volume: Scalars['Int']['output'];
};

export type RefreshAccountStateResult = {
  __typename?: 'RefreshAccountStateResult';
  accountSummary: AccountSummaryType;
  message: Scalars['String']['output'];
  success: Scalars['Boolean']['output'];
};

export type RunScreeningInput = {
  exchangeCode?: InputMaybe<Scalars['String']['input']>;
  market: Scalars['String']['input'];
};

export type ScreeningCountrySetting = {
  __typename?: 'ScreeningCountrySetting';
  country: Scalars['String']['output'];
  enabled: Scalars['Boolean']['output'];
  label: Scalars['String']['output'];
};

export type ScreeningCountrySummary = {
  __typename?: 'ScreeningCountrySummary';
  avgScore: Scalars['Float']['output'];
  count: Scalars['Int']['output'];
  country: Scalars['String']['output'];
  label: Scalars['String']['output'];
};

export type ScreeningDateSummary = {
  __typename?: 'ScreeningDateSummary';
  countries: Array<ScreeningCountrySummary>;
  date: Scalars['String']['output'];
  totalCount: Scalars['Int']['output'];
};

export type ScreeningListFilterInput = {
  limit?: InputMaybe<Scalars['Float']['input']>;
};

export type ScreeningSettingsType = {
  __typename?: 'ScreeningSettingsType';
  countries: Array<ScreeningCountrySetting>;
};

export type SearchStocksInput = {
  exchangeCode?: InputMaybe<Scalars['String']['input']>;
  keyword: Scalars['String']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
  market?: InputMaybe<Market>;
};

export type SetStrategyAllocationInput = {
  allocationRate: Scalars['Float']['input'];
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  market: Market;
  strategyName: Scalars['String']['input'];
};

export type Side =
  | 'BUY'
  | 'SELL';

export type SimulationMetricsType = {
  __typename?: 'SimulationMetricsType';
  currentCash: Scalars['Float']['output'];
  currentPortfolioValue: Scalars['Float']['output'];
  lossTrades: Scalars['Int']['output'];
  maxDrawdown: Scalars['Float']['output'];
  profitFactor: Scalars['Float']['output'];
  /** 실현 손익 (매도 완료된 거래의 손익 합계) */
  realizedPnL: Scalars['Float']['output'];
  sharpeRatio: Scalars['Float']['output'];
  totalReturn: Scalars['Float']['output'];
  totalReturnAmount: Scalars['Float']['output'];
  totalTrades: Scalars['Int']['output'];
  /** 미실현 손익 (보유 포지션의 평가 손익 합계) */
  unrealizedPnL: Scalars['Float']['output'];
  winRate: Scalars['Float']['output'];
  winTrades: Scalars['Int']['output'];
};

export type SimulationPositionType = {
  __typename?: 'SimulationPositionType';
  avgPrice: Scalars['Float']['output'];
  currentPrice: Scalars['Float']['output'];
  exchangeCode: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  market: Market;
  profitLoss: Scalars['Float']['output'];
  profitRate: Scalars['Float']['output'];
  quantity: Scalars['Int']['output'];
  sessionId: Scalars['String']['output'];
  stockCode: Scalars['String']['output'];
  stockName: Scalars['String']['output'];
  totalInvested: Scalars['Float']['output'];
};

export type SimulationSessionType = {
  __typename?: 'SimulationSessionType';
  countryCode?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  currentCash: Scalars['Float']['output'];
  cycle: Scalars['Float']['output'];
  description?: Maybe<Scalars['String']['output']>;
  exchangeCode: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  lastExecutionDate?: Maybe<Scalars['String']['output']>;
  lastExecutionDetails?: Maybe<Scalars['String']['output']>;
  lastExecutionStatus?: Maybe<Scalars['String']['output']>;
  market: Market;
  maxCycles: Scalars['Float']['output'];
  maxPortfolioRate: Scalars['Float']['output'];
  name: Scalars['String']['output'];
  /** 포지션 평가금 합계 */
  portfolioValue?: Maybe<Scalars['Float']['output']>;
  quota: Scalars['Float']['output'];
  startedAt: Scalars['DateTime']['output'];
  status: SimulationStatus;
  stockCode: Scalars['String']['output'];
  stockName: Scalars['String']['output'];
  stopLossRate: Scalars['Float']['output'];
  stoppedAt?: Maybe<Scalars['DateTime']['output']>;
  strategyName: Scalars['String']['output'];
  strategyParams?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type SimulationSessionsFilterInput = {
  status?: InputMaybe<SimulationStatus>;
};

export type SimulationSnapshotType = {
  __typename?: 'SimulationSnapshotType';
  cashBalance: Scalars['Float']['output'];
  createdAt: Scalars['DateTime']['output'];
  dailyPnl: Scalars['Float']['output'];
  dailyPnlRate: Scalars['Float']['output'];
  drawdown: Scalars['Float']['output'];
  id: Scalars['ID']['output'];
  peakValue: Scalars['Float']['output'];
  portfolioValue: Scalars['Float']['output'];
  positionCount: Scalars['Int']['output'];
  sessionId: Scalars['String']['output'];
  snapshotDate: Scalars['String']['output'];
  totalValue: Scalars['Float']['output'];
  tradeCount: Scalars['Int']['output'];
};

export type SimulationStatus =
  | 'COMPLETED'
  | 'PAUSED'
  | 'RUNNING';

export type SimulationTradeStatus =
  | 'EXECUTED'
  | 'FAILED';

export type SimulationTradeType = {
  __typename?: 'SimulationTradeType';
  createdAt: Scalars['DateTime']['output'];
  exchangeCode: Scalars['String']['output'];
  failReason?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  market: Market;
  price: Scalars['Float']['output'];
  quantity: Scalars['Int']['output'];
  reason?: Maybe<Scalars['String']['output']>;
  sessionId: Scalars['String']['output'];
  side: Side;
  stockCode: Scalars['String']['output'];
  stockName: Scalars['String']['output'];
  strategyName?: Maybe<Scalars['String']['output']>;
  totalAmount: Scalars['Float']['output'];
  tradeStatus: SimulationTradeStatus;
};

export type SimulationTradesFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  sessionId: Scalars['String']['input'];
  tradeStatus?: InputMaybe<SimulationTradeStatus>;
};

export type StockDeepAnalysisType = {
  __typename?: 'StockDeepAnalysisType';
  consensusDetail?: Maybe<Scalars['String']['output']>;
  consensusRating?: Maybe<Scalars['String']['output']>;
  dcfDetail?: Maybe<Scalars['String']['output']>;
  dividendDetail?: Maybe<Scalars['String']['output']>;
  dividendYield?: Maybe<Scalars['Float']['output']>;
  exchangeCode: Scalars['String']['output'];
  id: Scalars['String']['output'];
  intrinsicValue?: Maybe<Scalars['Float']['output']>;
  marginOfSafety?: Maybe<Scalars['Float']['output']>;
  maxDrawdown90d?: Maybe<Scalars['Float']['output']>;
  reportSummary?: Maybe<Scalars['String']['output']>;
  riskDetail?: Maybe<Scalars['String']['output']>;
  riskGrade?: Maybe<Scalars['String']['output']>;
  screeningDate: Scalars['String']['output'];
  stockCode: Scalars['String']['output'];
  stockName: Scalars['String']['output'];
  targetPrice?: Maybe<Scalars['Float']['output']>;
  targetUpside?: Maybe<Scalars['Float']['output']>;
  technicalDetail?: Maybe<Scalars['String']['output']>;
  trendDirection?: Maybe<Scalars['String']['output']>;
  volatility30d?: Maybe<Scalars['Float']['output']>;
};

export type StockPriceType = {
  __typename?: 'StockPriceType';
  changeRate?: Maybe<Scalars['Float']['output']>;
  currentPrice: Scalars['Float']['output'];
  highPrice?: Maybe<Scalars['Float']['output']>;
  lowPrice?: Maybe<Scalars['Float']['output']>;
  openPrice?: Maybe<Scalars['Float']['output']>;
  stockCode: Scalars['String']['output'];
  stockName: Scalars['String']['output'];
  technicalRatings?: Maybe<TechnicalRatingsType>;
  volume?: Maybe<Scalars['Int']['output']>;
};

export type StockRecommendationType = {
  __typename?: 'StockRecommendationType';
  changeRate: Scalars['Float']['output'];
  createdAt: Scalars['DateTime']['output'];
  currentPrice: Scalars['Float']['output'];
  deepAnalysisMessage?: Maybe<Scalars['String']['output']>;
  deepAnalysisStatus?: Maybe<Scalars['String']['output']>;
  deepAnalysisUpdatedAt?: Maybe<Scalars['DateTime']['output']>;
  exchangeCode: Scalars['String']['output'];
  factorScores?: Maybe<FactorScoreType>;
  fundamentalScore: Scalars['Float']['output'];
  id: Scalars['String']['output'];
  indicators: Scalars['String']['output'];
  isEtf: Scalars['Boolean']['output'];
  market: Scalars['String']['output'];
  marketCap: Scalars['Float']['output'];
  momentumScore: Scalars['Float']['output'];
  rank: Scalars['Int']['output'];
  reasons: Scalars['String']['output'];
  screeningDate: Scalars['String']['output'];
  stockCode: Scalars['String']['output'];
  stockName: Scalars['String']['output'];
  suggestedStrategies: Array<SuggestedStrategyType>;
  technicalScore: Scalars['Float']['output'];
  totalScore: Scalars['Float']['output'];
  volume: Scalars['Float']['output'];
};

export type StockRecommendationsFilterInput = {
  country?: InputMaybe<Scalars['String']['input']>;
  date?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Float']['input']>;
  market?: InputMaybe<Scalars['String']['input']>;
};

export type StockSearchResult = {
  __typename?: 'StockSearchResult';
  englishName?: Maybe<Scalars['String']['output']>;
  exchangeCode: Scalars['String']['output'];
  market: Scalars['String']['output'];
  stockCode: Scalars['String']['output'];
  stockName: Scalars['String']['output'];
};

export type StrategyAllocationType = {
  __typename?: 'StrategyAllocationType';
  allocationRate: Scalars['Float']['output'];
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  market: Market;
  strategyName: Scalars['String']['output'];
};

export type StrategyAllocationsFilterInput = {
  market: Market;
};

export type StrategyInfo = {
  __typename?: 'StrategyInfo';
  description: Scalars['String']['output'];
  displayName: Scalars['String']['output'];
  meta: StrategyMetaType;
  name: Scalars['String']['output'];
};

export type StrategyMetaType = {
  __typename?: 'StrategyMetaType';
  expectedReturn: Scalars['String']['output'];
  investmentPeriod: Scalars['String']['output'];
  maxLoss: Scalars['String']['output'];
  /** MDD 매수차단 임계값 (예: -0.10 = -10%) */
  mddBuyBlock: Scalars['Float']['output'];
  /** MDD 전량청산 임계값 (예: -0.15 = -15%) */
  mddLiquidate: Scalars['Float']['output'];
  riskLevel: Scalars['String']['output'];
  suitableFor: Array<Scalars['String']['output']>;
  tags: Array<Scalars['String']['output']>;
  tradingFrequency: Scalars['String']['output'];
};

export type SuggestedStrategyType = {
  __typename?: 'SuggestedStrategyType';
  displayName: Scalars['String']['output'];
  matchScore: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  reason: Scalars['String']['output'];
};

export type TechnicalIndicatorType = {
  __typename?: 'TechnicalIndicatorType';
  action: Scalars['String']['output'];
  key: Scalars['String']['output'];
  label: Scalars['String']['output'];
  value?: Maybe<Scalars['Float']['output']>;
};

export type TechnicalRatingSummaryType = {
  __typename?: 'TechnicalRatingSummaryType';
  buyCount: Scalars['Int']['output'];
  neutralCount: Scalars['Int']['output'];
  recommendation: Scalars['String']['output'];
  score: Scalars['Float']['output'];
  sellCount: Scalars['Int']['output'];
};

export type TechnicalRatingsType = {
  __typename?: 'TechnicalRatingsType';
  movingAverageSummary: TechnicalRatingSummaryType;
  movingAverages: Array<TechnicalIndicatorType>;
  oscillatorSummary: TechnicalRatingSummaryType;
  oscillators: Array<TechnicalIndicatorType>;
  overallSummary: TechnicalRatingSummaryType;
  timeframe: Scalars['String']['output'];
};

export type TradeFilterInput = {
  dateFrom?: InputMaybe<Scalars['String']['input']>;
  dateTo?: InputMaybe<Scalars['String']['input']>;
  exchangeCode?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  market?: InputMaybe<Market>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  side?: InputMaybe<Side>;
  stockCode?: InputMaybe<Scalars['String']['input']>;
};

export type TradeRecordType = {
  __typename?: 'TradeRecordType';
  createdAt: Scalars['DateTime']['output'];
  exchangeCode: Scalars['String']['output'];
  executedPrice?: Maybe<Scalars['Float']['output']>;
  executedQty?: Maybe<Scalars['Int']['output']>;
  id: Scalars['ID']['output'];
  market: Market;
  orderNo?: Maybe<Scalars['String']['output']>;
  orderType: OrderType;
  price: Scalars['Float']['output'];
  quantity: Scalars['Int']['output'];
  reason?: Maybe<Scalars['String']['output']>;
  side: Side;
  status: OrderStatus;
  stockCode: Scalars['String']['output'];
  stockName: Scalars['String']['output'];
  strategyName?: Maybe<Scalars['String']['output']>;
};

export type UpdateScreeningSettingsInput = {
  country: Scalars['String']['input'];
  enabled: Scalars['Boolean']['input'];
};

export type UpdateSimulationSettingsInput = {
  id: Scalars['String']['input'];
  maxCycles?: InputMaybe<Scalars['Int']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  quota?: InputMaybe<Scalars['Float']['input']>;
  stopLossRate?: InputMaybe<Scalars['Float']['input']>;
};

export type UpdateSimulationStatusInput = {
  id: Scalars['String']['input'];
  status: SimulationStatus;
};

export type UpdateWatchStockInput = {
  cycle?: InputMaybe<Scalars['Int']['input']>;
  exchangeCode?: InputMaybe<Scalars['String']['input']>;
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  maxCycles?: InputMaybe<Scalars['Int']['input']>;
  maxPortfolioRate?: InputMaybe<Scalars['Float']['input']>;
  quota?: InputMaybe<Scalars['Float']['input']>;
  stockName?: InputMaybe<Scalars['String']['input']>;
  stopLossRate?: InputMaybe<Scalars['Float']['input']>;
  strategyName?: InputMaybe<Scalars['String']['input']>;
  strategyParams?: InputMaybe<Scalars['String']['input']>;
};

export type WatchStockExecutionEventType =
  | 'ERROR'
  | 'ORDER_AWAITING_APPROVAL'
  | 'ORDER_CANCELLED'
  | 'ORDER_FAILED'
  | 'ORDER_FILLED'
  | 'ORDER_SUBMITTED'
  | 'SIGNAL_CREATED'
  | 'SKIPPED';

export type WatchStockExecutionLogType = {
  __typename?: 'WatchStockExecutionLogType';
  createdAt: Scalars['DateTime']['output'];
  details?: Maybe<Scalars['String']['output']>;
  eventType: WatchStockExecutionEventType;
  exchangeCode: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  market: Market;
  message: Scalars['String']['output'];
  stockCode: Scalars['String']['output'];
  stockName: Scalars['String']['output'];
  strategyName?: Maybe<Scalars['String']['output']>;
  tradeRecordId?: Maybe<Scalars['String']['output']>;
  watchStockId: Scalars['String']['output'];
};

export type WatchStockType = {
  __typename?: 'WatchStockType';
  createdAt: Scalars['DateTime']['output'];
  cycle: Scalars['Int']['output'];
  exchangeCode: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  /** 마지막 전략 실행 날짜 */
  lastExecutionDate?: Maybe<Scalars['String']['output']>;
  /** 마지막 전략 실행 상태 (예: "3 시그널 생성", "지수 MA200 아래 — 매수 중단") */
  lastExecutionStatus?: Maybe<Scalars['String']['output']>;
  market: Market;
  maxCycles: Scalars['Int']['output'];
  maxPortfolioRate: Scalars['Float']['output'];
  quota?: Maybe<Scalars['Float']['output']>;
  stockCode: Scalars['String']['output'];
  stockName: Scalars['String']['output'];
  stopLossRate: Scalars['Float']['output'];
  strategyName?: Maybe<Scalars['String']['output']>;
  strategyParams?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type WatchStocksFilterInput = {
  market?: InputMaybe<Market>;
};

export type LoginMutationVariables = Exact<{
  input: LoginInput;
}>;


export type LoginMutation = { __typename?: 'Mutation', login: { __typename?: 'AuthPayload', success: boolean } };

export type LogoutMutationVariables = Exact<{ [key: string]: never; }>;


export type LogoutMutation = { __typename?: 'Mutation', logout: { __typename?: 'AuthPayload', success: boolean } };

export type GetStockRecommendationsQueryVariables = Exact<{
  input?: InputMaybe<StockRecommendationsFilterInput>;
}>;


export type GetStockRecommendationsQuery = { __typename?: 'Query', stockRecommendations: Array<{ __typename?: 'StockRecommendationType', id: string, screeningDate: string, market: string, exchangeCode: string, stockCode: string, stockName: string, totalScore: number, technicalScore: number, fundamentalScore: number, momentumScore: number, rank: number, reasons: string, indicators: string, currentPrice: number, changeRate: number, volume: number, marketCap: number, isEtf: boolean, deepAnalysisStatus?: string | null, deepAnalysisMessage?: string | null, deepAnalysisUpdatedAt?: any | null, createdAt: any, suggestedStrategies: Array<{ __typename?: 'SuggestedStrategyType', name: string, displayName: string, matchScore: number, reason: string }>, factorScores?: { __typename?: 'FactorScoreType', technical?: number | null, valuation?: number | null, growth?: number | null, profitability?: number | null, risk?: number | null, momentum?: number | null, supplyDemand?: number | null, dividend?: number | null, consensus?: number | null, pattern?: number | null, fundamental?: number | null } | null }> };

export type GetScreeningDatesQueryVariables = Exact<{
  input?: InputMaybe<ScreeningListFilterInput>;
}>;


export type GetScreeningDatesQuery = { __typename?: 'Query', screeningDates: Array<string> };

export type GetScreeningDateSummariesQueryVariables = Exact<{
  input?: InputMaybe<ScreeningListFilterInput>;
}>;


export type GetScreeningDateSummariesQuery = { __typename?: 'Query', screeningDateSummaries: Array<{ __typename?: 'ScreeningDateSummary', date: string, totalCount: number, countries: Array<{ __typename?: 'ScreeningCountrySummary', country: string, label: string, count: number, avgScore: number }> }> };

export type GetScreeningSettingsQueryVariables = Exact<{ [key: string]: never; }>;


export type GetScreeningSettingsQuery = { __typename?: 'Query', screeningSettings: { __typename?: 'ScreeningSettingsType', countries: Array<{ __typename?: 'ScreeningCountrySetting', country: string, label: string, enabled: boolean }> } };

export type UpdateScreeningSettingsMutationVariables = Exact<{
  input: UpdateScreeningSettingsInput;
}>;


export type UpdateScreeningSettingsMutation = { __typename?: 'Mutation', updateScreeningSettings: { __typename?: 'ScreeningSettingsType', countries: Array<{ __typename?: 'ScreeningCountrySetting', country: string, label: string, enabled: boolean }> } };

export type GetStockDeepAnalysisQueryVariables = Exact<{
  stockCode: Scalars['String']['input'];
  date?: InputMaybe<Scalars['String']['input']>;
  exchangeCode?: InputMaybe<Scalars['String']['input']>;
}>;


export type GetStockDeepAnalysisQuery = { __typename?: 'Query', stockDeepAnalysis?: { __typename?: 'StockDeepAnalysisType', id: string, screeningDate: string, stockCode: string, stockName: string, exchangeCode: string, intrinsicValue?: number | null, marginOfSafety?: number | null, riskGrade?: string | null, volatility30d?: number | null, maxDrawdown90d?: number | null, trendDirection?: string | null, dividendYield?: number | null, targetPrice?: number | null, targetUpside?: number | null, consensusRating?: string | null, reportSummary?: string | null, dcfDetail?: string | null, riskDetail?: string | null, technicalDetail?: string | null, dividendDetail?: string | null, consensusDetail?: string | null } | null };

export type GetSimulationSessionsQueryVariables = Exact<{
  input?: InputMaybe<SimulationSessionsFilterInput>;
}>;


export type GetSimulationSessionsQuery = { __typename?: 'Query', simulationSessions: Array<{ __typename?: 'SimulationSessionType', id: string, name: string, description?: string | null, market: Market, exchangeCode: string, stockCode: string, stockName: string, countryCode?: string | null, strategyName: string, status: SimulationStatus, currentCash: number, quota: number, cycle: number, maxCycles: number, stopLossRate: number, strategyParams?: string | null, lastExecutionStatus?: string | null, lastExecutionDate?: string | null, lastExecutionDetails?: string | null, portfolioValue?: number | null, startedAt: any, stoppedAt?: any | null, createdAt: any }> };

export type GetSimulationSessionQueryVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export type GetSimulationSessionQuery = { __typename?: 'Query', simulationSession?: { __typename?: 'SimulationSessionType', id: string, name: string, description?: string | null, market: Market, exchangeCode: string, stockCode: string, stockName: string, countryCode?: string | null, strategyName: string, status: SimulationStatus, currentCash: number, quota: number, cycle: number, maxCycles: number, stopLossRate: number, strategyParams?: string | null, lastExecutionStatus?: string | null, lastExecutionDate?: string | null, lastExecutionDetails?: string | null, portfolioValue?: number | null, startedAt: any, stoppedAt?: any | null, createdAt: any } | null };

export type GetSimulationPositionsQueryVariables = Exact<{
  sessionId: Scalars['String']['input'];
}>;


export type GetSimulationPositionsQuery = { __typename?: 'Query', simulationPositions: Array<{ __typename?: 'SimulationPositionType', id: string, market: Market, exchangeCode: string, stockCode: string, stockName: string, quantity: number, avgPrice: number, currentPrice: number, totalInvested: number, profitLoss: number, profitRate: number }> };

export type GetSimulationTradesQueryVariables = Exact<{
  input: SimulationTradesFilterInput;
}>;


export type GetSimulationTradesQuery = { __typename?: 'Query', simulationTrades: Array<{ __typename?: 'SimulationTradeType', id: string, market: Market, exchangeCode: string, stockCode: string, stockName: string, side: Side, quantity: number, price: number, totalAmount: number, tradeStatus: SimulationTradeStatus, failReason?: string | null, strategyName?: string | null, reason?: string | null, createdAt: any }> };

export type GetSimulationSnapshotsQueryVariables = Exact<{
  sessionId: Scalars['String']['input'];
}>;


export type GetSimulationSnapshotsQuery = { __typename?: 'Query', simulationSnapshots: Array<{ __typename?: 'SimulationSnapshotType', id: string, snapshotDate: string, portfolioValue: number, cashBalance: number, totalValue: number, dailyPnl: number, dailyPnlRate: number, drawdown: number, peakValue: number, positionCount: number, tradeCount: number }> };

export type GetSimulationMetricsQueryVariables = Exact<{
  sessionId: Scalars['String']['input'];
}>;


export type GetSimulationMetricsQuery = { __typename?: 'Query', simulationMetrics: { __typename?: 'SimulationMetricsType', totalReturn: number, totalReturnAmount: number, realizedPnL: number, unrealizedPnL: number, maxDrawdown: number, winRate: number, totalTrades: number, winTrades: number, lossTrades: number, sharpeRatio: number, profitFactor: number, currentCash: number, currentPortfolioValue: number } };

export type CreateSimulationMutationVariables = Exact<{
  input: CreateSimulationInput;
}>;


export type CreateSimulationMutation = { __typename?: 'Mutation', createSimulation: { __typename?: 'SimulationSessionType', id: string, name: string, market: Market, exchangeCode: string, stockCode: string, stockName: string, countryCode?: string | null, strategyName: string, status: SimulationStatus, currentCash: number, quota: number, cycle: number, maxCycles: number, stopLossRate: number, strategyParams?: string | null } };

export type UpdateSimulationSettingsMutationVariables = Exact<{
  input: UpdateSimulationSettingsInput;
}>;


export type UpdateSimulationSettingsMutation = { __typename?: 'Mutation', updateSimulationSettings: { __typename?: 'SimulationSessionType', id: string, name: string, currentCash: number, quota: number, stopLossRate: number, maxCycles: number, cycle: number, strategyParams?: string | null } };

export type UpdateSimulationStatusMutationVariables = Exact<{
  input: UpdateSimulationStatusInput;
}>;


export type UpdateSimulationStatusMutation = { __typename?: 'Mutation', updateSimulationStatus: { __typename?: 'SimulationSessionType', id: string, status: SimulationStatus, stoppedAt?: any | null } };

export type ResetSimulationMutationVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export type ResetSimulationMutation = { __typename?: 'Mutation', resetSimulation: { __typename?: 'SimulationSessionType', id: string, status: SimulationStatus, currentCash: number, quota: number } };

export type DeleteSimulationMutationVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export type DeleteSimulationMutation = { __typename?: 'Mutation', deleteSimulation: boolean };

export type TriggerSimulationNowMutationVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export type TriggerSimulationNowMutation = { __typename?: 'Mutation', triggerSimulationNow: { __typename?: 'ManualTriggerResult', success: boolean, message: string } };

export type SearchStocksQueryVariables = Exact<{
  input: SearchStocksInput;
}>;


export type SearchStocksQuery = { __typename?: 'Query', searchStocks: Array<{ __typename?: 'StockSearchResult', stockCode: string, stockName: string, englishName?: string | null, market: string, exchangeCode: string }> };

export type GetTradesQueryVariables = Exact<{
  input?: InputMaybe<TradeFilterInput>;
}>;


export type GetTradesQuery = { __typename?: 'Query', trades: Array<{ __typename?: 'TradeRecordType', id: string, market: Market, exchangeCode: string, stockCode: string, stockName: string, side: Side, orderType: OrderType, quantity: number, price: number, executedPrice?: number | null, executedQty?: number | null, orderNo?: string | null, status: OrderStatus, strategyName?: string | null, reason?: string | null, createdAt: any }> };

export type GetTradeQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type GetTradeQuery = { __typename?: 'Query', trade?: { __typename?: 'TradeRecordType', id: string, market: Market, exchangeCode: string, stockCode: string, stockName: string, side: Side, orderType: OrderType, quantity: number, price: number, executedPrice?: number | null, executedQty?: number | null, orderNo?: string | null, status: OrderStatus, strategyName?: string | null, reason?: string | null, createdAt: any } | null };

export type GetPositionsQueryVariables = Exact<{
  input?: InputMaybe<PositionsFilterInput>;
}>;


export type GetPositionsQuery = { __typename?: 'Query', positions: Array<{ __typename?: 'PositionType', id: string, market: Market, exchangeCode: string, stockCode: string, stockName: string, quantity: number, avgPrice: number, currentPrice: number, profitLoss: number, profitRate: number, totalInvested: number }> };

export type GetQuoteQueryVariables = Exact<{
  stockCode: Scalars['String']['input'];
}>;


export type GetQuoteQuery = { __typename?: 'Query', quote?: { __typename?: 'StockPriceType', stockCode: string, stockName: string, currentPrice: number, changeRate?: number | null, openPrice?: number | null, highPrice?: number | null, lowPrice?: number | null, volume?: number | null, technicalRatings?: { __typename?: 'TechnicalRatingsType', timeframe: string, oscillatorSummary: { __typename?: 'TechnicalRatingSummaryType', score: number, recommendation: string, buyCount: number, neutralCount: number, sellCount: number }, movingAverageSummary: { __typename?: 'TechnicalRatingSummaryType', score: number, recommendation: string, buyCount: number, neutralCount: number, sellCount: number }, overallSummary: { __typename?: 'TechnicalRatingSummaryType', score: number, recommendation: string, buyCount: number, neutralCount: number, sellCount: number }, oscillators: Array<{ __typename?: 'TechnicalIndicatorType', key: string, label: string, value?: number | null, action: string }>, movingAverages: Array<{ __typename?: 'TechnicalIndicatorType', key: string, label: string, value?: number | null, action: string }> } | null } | null };

export type GetQuoteHistoryQueryVariables = Exact<{
  stockCode: Scalars['String']['input'];
  months?: InputMaybe<Scalars['Int']['input']>;
}>;


export type GetQuoteHistoryQuery = { __typename?: 'Query', quoteHistory: Array<{ __typename?: 'QuoteHistoryPointType', date: string, close: number, open: number, high: number, low: number, volume: number }> };

export type GetOverseasQuoteQueryVariables = Exact<{
  input: OverseasQuoteInput;
}>;


export type GetOverseasQuoteQuery = { __typename?: 'Query', overseasQuote?: { __typename?: 'StockPriceType', stockCode: string, stockName: string, currentPrice: number, changeRate?: number | null, openPrice?: number | null, highPrice?: number | null, lowPrice?: number | null, volume?: number | null, technicalRatings?: { __typename?: 'TechnicalRatingsType', timeframe: string, oscillatorSummary: { __typename?: 'TechnicalRatingSummaryType', score: number, recommendation: string, buyCount: number, neutralCount: number, sellCount: number }, movingAverageSummary: { __typename?: 'TechnicalRatingSummaryType', score: number, recommendation: string, buyCount: number, neutralCount: number, sellCount: number }, overallSummary: { __typename?: 'TechnicalRatingSummaryType', score: number, recommendation: string, buyCount: number, neutralCount: number, sellCount: number }, oscillators: Array<{ __typename?: 'TechnicalIndicatorType', key: string, label: string, value?: number | null, action: string }>, movingAverages: Array<{ __typename?: 'TechnicalIndicatorType', key: string, label: string, value?: number | null, action: string }> } | null } | null };

export type GetOverseasQuoteHistoryQueryVariables = Exact<{
  input: OverseasQuoteInput;
  months?: InputMaybe<Scalars['Int']['input']>;
}>;


export type GetOverseasQuoteHistoryQuery = { __typename?: 'Query', overseasQuoteHistory: Array<{ __typename?: 'QuoteHistoryPointType', date: string, close: number, open: number, high: number, low: number, volume: number }> };

export type GetAccountSummaryQueryVariables = Exact<{ [key: string]: never; }>;


export type GetAccountSummaryQuery = { __typename?: 'Query', accountSummary: { __typename?: 'AccountSummaryType', cashBalance: number, totalInvested: number, totalAssets: number, totalProfitLoss: number, realizedPnL: number, profitRate: number, positionCount: number, lastSyncedAt?: string | null, cashBalances: Array<{ __typename?: 'CashBalanceType', market: Market, currencyCode: string, currencyName?: string | null, amount: number, withdrawableAmount?: number | null }> } };

export type GetDashboardSummaryQueryVariables = Exact<{ [key: string]: never; }>;


export type GetDashboardSummaryQuery = { __typename?: 'Query', dashboardSummary: { __typename?: 'DashboardSummaryType', totalProfitLoss: number, totalTradeCount: number, todayTradeCount: number, winRate: number } };

export type ManualSellMutationVariables = Exact<{
  input: ManualSellInput;
}>;


export type ManualSellMutation = { __typename?: 'Mutation', manualSell: { __typename?: 'ManualSellResult', success: boolean, message?: string | null, orderNo?: string | null } };

export type CancelTradeOrderMutationVariables = Exact<{
  input: CancelTradeOrderInput;
}>;


export type CancelTradeOrderMutation = { __typename?: 'Mutation', cancelTradeOrder: { __typename?: 'CancelTradeOrderResult', success: boolean, message?: string | null, orderNo?: string | null } };

export type RefreshAccountStateMutationVariables = Exact<{ [key: string]: never; }>;


export type RefreshAccountStateMutation = { __typename?: 'Mutation', refreshAccountState: { __typename?: 'RefreshAccountStateResult', success: boolean, message: string, accountSummary: { __typename?: 'AccountSummaryType', cashBalance: number, totalInvested: number, totalAssets: number, totalProfitLoss: number, realizedPnL: number, profitRate: number, positionCount: number, lastSyncedAt?: string | null, cashBalances: Array<{ __typename?: 'CashBalanceType', market: Market, currencyCode: string, currencyName?: string | null, amount: number, withdrawableAmount?: number | null }> } } };

export type GetAvailableStrategiesQueryVariables = Exact<{ [key: string]: never; }>;


export type GetAvailableStrategiesQuery = { __typename?: 'Query', availableStrategies: Array<{ __typename?: 'StrategyInfo', name: string, displayName: string, description: string, meta: { __typename?: 'StrategyMetaType', riskLevel: string, mddBuyBlock: number, mddLiquidate: number, expectedReturn: string, maxLoss: string, investmentPeriod: string, tradingFrequency: string, suitableFor: Array<string>, tags: Array<string> } }> };

export type GetMarketRegimeQueryVariables = Exact<{
  input: MarketRegimeFilterInput;
}>;


export type GetMarketRegimeQuery = { __typename?: 'Query', marketRegime: { __typename?: 'MarketRegimeType', regime: string, market: string, exchangeCode: string } };

export type GetWatchStocksQueryVariables = Exact<{
  input?: InputMaybe<WatchStocksFilterInput>;
}>;


export type GetWatchStocksQuery = { __typename?: 'Query', watchStocks: Array<{ __typename?: 'WatchStockType', id: string, market: Market, exchangeCode: string, stockCode: string, stockName: string, isActive: boolean, strategyName?: string | null, quota?: number | null, cycle: number, maxCycles: number, stopLossRate: number, maxPortfolioRate: number, strategyParams?: string | null, lastExecutionStatus?: string | null, lastExecutionDate?: string | null, createdAt: any, updatedAt: any }> };

export type GetWatchStockQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type GetWatchStockQuery = { __typename?: 'Query', watchStock?: { __typename?: 'WatchStockType', id: string, market: Market, exchangeCode: string, stockCode: string, stockName: string, isActive: boolean, strategyName?: string | null, quota?: number | null, cycle: number, maxCycles: number, stopLossRate: number, maxPortfolioRate: number, strategyParams?: string | null, lastExecutionStatus?: string | null, lastExecutionDate?: string | null, createdAt: any, updatedAt: any } | null };

export type GetWatchStockExecutionLogsQueryVariables = Exact<{
  watchStockId: Scalars['String']['input'];
  limit?: InputMaybe<Scalars['Float']['input']>;
}>;


export type GetWatchStockExecutionLogsQuery = { __typename?: 'Query', watchStockExecutionLogs: Array<{ __typename?: 'WatchStockExecutionLogType', id: string, watchStockId: string, tradeRecordId?: string | null, market: Market, exchangeCode: string, stockCode: string, stockName: string, strategyName?: string | null, eventType: WatchStockExecutionEventType, message: string, details?: string | null, createdAt: any }> };

export type CreateWatchStockMutationVariables = Exact<{
  input: CreateWatchStockInput;
}>;


export type CreateWatchStockMutation = { __typename?: 'Mutation', createWatchStock: { __typename?: 'WatchStockType', id: string, market: Market, exchangeCode: string, stockCode: string, stockName: string, isActive: boolean, strategyName?: string | null, quota?: number | null, cycle: number, maxCycles: number, stopLossRate: number, maxPortfolioRate: number, strategyParams?: string | null, createdAt: any, updatedAt: any } };

export type UpdateWatchStockMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateWatchStockInput;
}>;


export type UpdateWatchStockMutation = { __typename?: 'Mutation', updateWatchStock: { __typename?: 'WatchStockType', id: string, market: Market, exchangeCode: string, stockCode: string, stockName: string, isActive: boolean, strategyName?: string | null, quota?: number | null, cycle: number, maxCycles: number, stopLossRate: number, maxPortfolioRate: number, strategyParams?: string | null, createdAt: any, updatedAt: any } };

export type DeleteWatchStockMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteWatchStockMutation = { __typename?: 'Mutation', deleteWatchStock: boolean };

export type TriggerWatchStockNowMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type TriggerWatchStockNowMutation = { __typename?: 'Mutation', triggerWatchStockNow: { __typename?: 'ManualTriggerResult', success: boolean, message: string } };

export type ResetWatchStockCarryMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type ResetWatchStockCarryMutation = { __typename?: 'Mutation', resetWatchStockCarry: { __typename?: 'ManualTriggerResult', success: boolean, message: string } };


export const LoginDocument = gql`
    mutation Login($input: LoginInput!) {
  login(input: $input) {
    success
  }
}
    `;

/**
 * __useLoginMutation__
 *
 * To run a mutation, you first call `useLoginMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useLoginMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [loginMutation, { data, loading, error }] = useLoginMutation({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useLoginMutation(baseOptions?: ApolloReactHooks.MutationHookOptions<LoginMutation, LoginMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useMutation<LoginMutation, LoginMutationVariables>(LoginDocument, options);
      }
export type LoginMutationHookResult = ReturnType<typeof useLoginMutation>;
export const LogoutDocument = gql`
    mutation Logout {
  logout {
    success
  }
}
    `;

/**
 * __useLogoutMutation__
 *
 * To run a mutation, you first call `useLogoutMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useLogoutMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [logoutMutation, { data, loading, error }] = useLogoutMutation({
 *   variables: {
 *   },
 * });
 */
export function useLogoutMutation(baseOptions?: ApolloReactHooks.MutationHookOptions<LogoutMutation, LogoutMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useMutation<LogoutMutation, LogoutMutationVariables>(LogoutDocument, options);
      }
export type LogoutMutationHookResult = ReturnType<typeof useLogoutMutation>;
export const GetStockRecommendationsDocument = gql`
    query GetStockRecommendations($input: StockRecommendationsFilterInput) {
  stockRecommendations(input: $input) {
    id
    screeningDate
    market
    exchangeCode
    stockCode
    stockName
    totalScore
    technicalScore
    fundamentalScore
    momentumScore
    rank
    reasons
    indicators
    suggestedStrategies {
      name
      displayName
      matchScore
      reason
    }
    currentPrice
    changeRate
    volume
    marketCap
    isEtf
    deepAnalysisStatus
    deepAnalysisMessage
    deepAnalysisUpdatedAt
    factorScores {
      technical
      valuation
      growth
      profitability
      risk
      momentum
      supplyDemand
      dividend
      consensus
      pattern
      fundamental
    }
    createdAt
  }
}
    `;

/**
 * __useGetStockRecommendationsQuery__
 *
 * To run a query within a React component, call `useGetStockRecommendationsQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetStockRecommendationsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetStockRecommendationsQuery({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useGetStockRecommendationsQuery(baseOptions?: ApolloReactHooks.QueryHookOptions<GetStockRecommendationsQuery, GetStockRecommendationsQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetStockRecommendationsQuery, GetStockRecommendationsQueryVariables>(GetStockRecommendationsDocument, options);
      }
export function useGetStockRecommendationsLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetStockRecommendationsQuery, GetStockRecommendationsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetStockRecommendationsQuery, GetStockRecommendationsQueryVariables>(GetStockRecommendationsDocument, options);
        }
// @ts-ignore
export function useGetStockRecommendationsSuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetStockRecommendationsQuery, GetStockRecommendationsQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetStockRecommendationsQuery, GetStockRecommendationsQueryVariables>;
export function useGetStockRecommendationsSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetStockRecommendationsQuery, GetStockRecommendationsQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetStockRecommendationsQuery | undefined, GetStockRecommendationsQueryVariables>;
export function useGetStockRecommendationsSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetStockRecommendationsQuery, GetStockRecommendationsQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetStockRecommendationsQuery, GetStockRecommendationsQueryVariables>(GetStockRecommendationsDocument, options);
        }
export type GetStockRecommendationsQueryHookResult = ReturnType<typeof useGetStockRecommendationsQuery>;
export type GetStockRecommendationsLazyQueryHookResult = ReturnType<typeof useGetStockRecommendationsLazyQuery>;
export type GetStockRecommendationsSuspenseQueryHookResult = ReturnType<typeof useGetStockRecommendationsSuspenseQuery>;
export const GetScreeningDatesDocument = gql`
    query GetScreeningDates($input: ScreeningListFilterInput) {
  screeningDates(input: $input)
}
    `;

/**
 * __useGetScreeningDatesQuery__
 *
 * To run a query within a React component, call `useGetScreeningDatesQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetScreeningDatesQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetScreeningDatesQuery({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useGetScreeningDatesQuery(baseOptions?: ApolloReactHooks.QueryHookOptions<GetScreeningDatesQuery, GetScreeningDatesQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetScreeningDatesQuery, GetScreeningDatesQueryVariables>(GetScreeningDatesDocument, options);
      }
export function useGetScreeningDatesLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetScreeningDatesQuery, GetScreeningDatesQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetScreeningDatesQuery, GetScreeningDatesQueryVariables>(GetScreeningDatesDocument, options);
        }
// @ts-ignore
export function useGetScreeningDatesSuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetScreeningDatesQuery, GetScreeningDatesQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetScreeningDatesQuery, GetScreeningDatesQueryVariables>;
export function useGetScreeningDatesSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetScreeningDatesQuery, GetScreeningDatesQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetScreeningDatesQuery | undefined, GetScreeningDatesQueryVariables>;
export function useGetScreeningDatesSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetScreeningDatesQuery, GetScreeningDatesQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetScreeningDatesQuery, GetScreeningDatesQueryVariables>(GetScreeningDatesDocument, options);
        }
export type GetScreeningDatesQueryHookResult = ReturnType<typeof useGetScreeningDatesQuery>;
export type GetScreeningDatesLazyQueryHookResult = ReturnType<typeof useGetScreeningDatesLazyQuery>;
export type GetScreeningDatesSuspenseQueryHookResult = ReturnType<typeof useGetScreeningDatesSuspenseQuery>;
export const GetScreeningDateSummariesDocument = gql`
    query GetScreeningDateSummaries($input: ScreeningListFilterInput) {
  screeningDateSummaries(input: $input) {
    date
    totalCount
    countries {
      country
      label
      count
      avgScore
    }
  }
}
    `;

/**
 * __useGetScreeningDateSummariesQuery__
 *
 * To run a query within a React component, call `useGetScreeningDateSummariesQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetScreeningDateSummariesQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetScreeningDateSummariesQuery({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useGetScreeningDateSummariesQuery(baseOptions?: ApolloReactHooks.QueryHookOptions<GetScreeningDateSummariesQuery, GetScreeningDateSummariesQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetScreeningDateSummariesQuery, GetScreeningDateSummariesQueryVariables>(GetScreeningDateSummariesDocument, options);
      }
export function useGetScreeningDateSummariesLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetScreeningDateSummariesQuery, GetScreeningDateSummariesQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetScreeningDateSummariesQuery, GetScreeningDateSummariesQueryVariables>(GetScreeningDateSummariesDocument, options);
        }
// @ts-ignore
export function useGetScreeningDateSummariesSuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetScreeningDateSummariesQuery, GetScreeningDateSummariesQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetScreeningDateSummariesQuery, GetScreeningDateSummariesQueryVariables>;
export function useGetScreeningDateSummariesSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetScreeningDateSummariesQuery, GetScreeningDateSummariesQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetScreeningDateSummariesQuery | undefined, GetScreeningDateSummariesQueryVariables>;
export function useGetScreeningDateSummariesSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetScreeningDateSummariesQuery, GetScreeningDateSummariesQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetScreeningDateSummariesQuery, GetScreeningDateSummariesQueryVariables>(GetScreeningDateSummariesDocument, options);
        }
export type GetScreeningDateSummariesQueryHookResult = ReturnType<typeof useGetScreeningDateSummariesQuery>;
export type GetScreeningDateSummariesLazyQueryHookResult = ReturnType<typeof useGetScreeningDateSummariesLazyQuery>;
export type GetScreeningDateSummariesSuspenseQueryHookResult = ReturnType<typeof useGetScreeningDateSummariesSuspenseQuery>;
export const GetScreeningSettingsDocument = gql`
    query GetScreeningSettings {
  screeningSettings {
    countries {
      country
      label
      enabled
    }
  }
}
    `;

/**
 * __useGetScreeningSettingsQuery__
 *
 * To run a query within a React component, call `useGetScreeningSettingsQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetScreeningSettingsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetScreeningSettingsQuery({
 *   variables: {
 *   },
 * });
 */
export function useGetScreeningSettingsQuery(baseOptions?: ApolloReactHooks.QueryHookOptions<GetScreeningSettingsQuery, GetScreeningSettingsQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetScreeningSettingsQuery, GetScreeningSettingsQueryVariables>(GetScreeningSettingsDocument, options);
      }
export function useGetScreeningSettingsLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetScreeningSettingsQuery, GetScreeningSettingsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetScreeningSettingsQuery, GetScreeningSettingsQueryVariables>(GetScreeningSettingsDocument, options);
        }
// @ts-ignore
export function useGetScreeningSettingsSuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetScreeningSettingsQuery, GetScreeningSettingsQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetScreeningSettingsQuery, GetScreeningSettingsQueryVariables>;
export function useGetScreeningSettingsSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetScreeningSettingsQuery, GetScreeningSettingsQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetScreeningSettingsQuery | undefined, GetScreeningSettingsQueryVariables>;
export function useGetScreeningSettingsSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetScreeningSettingsQuery, GetScreeningSettingsQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetScreeningSettingsQuery, GetScreeningSettingsQueryVariables>(GetScreeningSettingsDocument, options);
        }
export type GetScreeningSettingsQueryHookResult = ReturnType<typeof useGetScreeningSettingsQuery>;
export type GetScreeningSettingsLazyQueryHookResult = ReturnType<typeof useGetScreeningSettingsLazyQuery>;
export type GetScreeningSettingsSuspenseQueryHookResult = ReturnType<typeof useGetScreeningSettingsSuspenseQuery>;
export const UpdateScreeningSettingsDocument = gql`
    mutation UpdateScreeningSettings($input: UpdateScreeningSettingsInput!) {
  updateScreeningSettings(input: $input) {
    countries {
      country
      label
      enabled
    }
  }
}
    `;

/**
 * __useUpdateScreeningSettingsMutation__
 *
 * To run a mutation, you first call `useUpdateScreeningSettingsMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useUpdateScreeningSettingsMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [updateScreeningSettingsMutation, { data, loading, error }] = useUpdateScreeningSettingsMutation({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useUpdateScreeningSettingsMutation(baseOptions?: ApolloReactHooks.MutationHookOptions<UpdateScreeningSettingsMutation, UpdateScreeningSettingsMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useMutation<UpdateScreeningSettingsMutation, UpdateScreeningSettingsMutationVariables>(UpdateScreeningSettingsDocument, options);
      }
export type UpdateScreeningSettingsMutationHookResult = ReturnType<typeof useUpdateScreeningSettingsMutation>;
export const GetStockDeepAnalysisDocument = gql`
    query GetStockDeepAnalysis($stockCode: String!, $date: String, $exchangeCode: String) {
  stockDeepAnalysis(
    stockCode: $stockCode
    date: $date
    exchangeCode: $exchangeCode
  ) {
    id
    screeningDate
    stockCode
    stockName
    exchangeCode
    intrinsicValue
    marginOfSafety
    riskGrade
    volatility30d
    maxDrawdown90d
    trendDirection
    dividendYield
    targetPrice
    targetUpside
    consensusRating
    reportSummary
    dcfDetail
    riskDetail
    technicalDetail
    dividendDetail
    consensusDetail
  }
}
    `;

/**
 * __useGetStockDeepAnalysisQuery__
 *
 * To run a query within a React component, call `useGetStockDeepAnalysisQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetStockDeepAnalysisQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetStockDeepAnalysisQuery({
 *   variables: {
 *      stockCode: // value for 'stockCode'
 *      date: // value for 'date'
 *      exchangeCode: // value for 'exchangeCode'
 *   },
 * });
 */
export function useGetStockDeepAnalysisQuery(baseOptions: ApolloReactHooks.QueryHookOptions<GetStockDeepAnalysisQuery, GetStockDeepAnalysisQueryVariables> & ({ variables: GetStockDeepAnalysisQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetStockDeepAnalysisQuery, GetStockDeepAnalysisQueryVariables>(GetStockDeepAnalysisDocument, options);
      }
export function useGetStockDeepAnalysisLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetStockDeepAnalysisQuery, GetStockDeepAnalysisQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetStockDeepAnalysisQuery, GetStockDeepAnalysisQueryVariables>(GetStockDeepAnalysisDocument, options);
        }
// @ts-ignore
export function useGetStockDeepAnalysisSuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetStockDeepAnalysisQuery, GetStockDeepAnalysisQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetStockDeepAnalysisQuery, GetStockDeepAnalysisQueryVariables>;
export function useGetStockDeepAnalysisSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetStockDeepAnalysisQuery, GetStockDeepAnalysisQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetStockDeepAnalysisQuery | undefined, GetStockDeepAnalysisQueryVariables>;
export function useGetStockDeepAnalysisSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetStockDeepAnalysisQuery, GetStockDeepAnalysisQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetStockDeepAnalysisQuery, GetStockDeepAnalysisQueryVariables>(GetStockDeepAnalysisDocument, options);
        }
export type GetStockDeepAnalysisQueryHookResult = ReturnType<typeof useGetStockDeepAnalysisQuery>;
export type GetStockDeepAnalysisLazyQueryHookResult = ReturnType<typeof useGetStockDeepAnalysisLazyQuery>;
export type GetStockDeepAnalysisSuspenseQueryHookResult = ReturnType<typeof useGetStockDeepAnalysisSuspenseQuery>;
export const GetSimulationSessionsDocument = gql`
    query GetSimulationSessions($input: SimulationSessionsFilterInput) {
  simulationSessions(input: $input) {
    id
    name
    description
    market
    exchangeCode
    stockCode
    stockName
    countryCode
    strategyName
    status
    currentCash
    quota
    cycle
    maxCycles
    stopLossRate
    strategyParams
    lastExecutionStatus
    lastExecutionDate
    lastExecutionDetails
    portfolioValue
    startedAt
    stoppedAt
    createdAt
  }
}
    `;

/**
 * __useGetSimulationSessionsQuery__
 *
 * To run a query within a React component, call `useGetSimulationSessionsQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetSimulationSessionsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetSimulationSessionsQuery({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useGetSimulationSessionsQuery(baseOptions?: ApolloReactHooks.QueryHookOptions<GetSimulationSessionsQuery, GetSimulationSessionsQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetSimulationSessionsQuery, GetSimulationSessionsQueryVariables>(GetSimulationSessionsDocument, options);
      }
export function useGetSimulationSessionsLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetSimulationSessionsQuery, GetSimulationSessionsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetSimulationSessionsQuery, GetSimulationSessionsQueryVariables>(GetSimulationSessionsDocument, options);
        }
// @ts-ignore
export function useGetSimulationSessionsSuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetSimulationSessionsQuery, GetSimulationSessionsQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetSimulationSessionsQuery, GetSimulationSessionsQueryVariables>;
export function useGetSimulationSessionsSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetSimulationSessionsQuery, GetSimulationSessionsQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetSimulationSessionsQuery | undefined, GetSimulationSessionsQueryVariables>;
export function useGetSimulationSessionsSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetSimulationSessionsQuery, GetSimulationSessionsQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetSimulationSessionsQuery, GetSimulationSessionsQueryVariables>(GetSimulationSessionsDocument, options);
        }
export type GetSimulationSessionsQueryHookResult = ReturnType<typeof useGetSimulationSessionsQuery>;
export type GetSimulationSessionsLazyQueryHookResult = ReturnType<typeof useGetSimulationSessionsLazyQuery>;
export type GetSimulationSessionsSuspenseQueryHookResult = ReturnType<typeof useGetSimulationSessionsSuspenseQuery>;
export const GetSimulationSessionDocument = gql`
    query GetSimulationSession($id: String!) {
  simulationSession(id: $id) {
    id
    name
    description
    market
    exchangeCode
    stockCode
    stockName
    countryCode
    strategyName
    status
    currentCash
    quota
    cycle
    maxCycles
    stopLossRate
    strategyParams
    lastExecutionStatus
    lastExecutionDate
    lastExecutionDetails
    portfolioValue
    startedAt
    stoppedAt
    createdAt
  }
}
    `;

/**
 * __useGetSimulationSessionQuery__
 *
 * To run a query within a React component, call `useGetSimulationSessionQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetSimulationSessionQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetSimulationSessionQuery({
 *   variables: {
 *      id: // value for 'id'
 *   },
 * });
 */
export function useGetSimulationSessionQuery(baseOptions: ApolloReactHooks.QueryHookOptions<GetSimulationSessionQuery, GetSimulationSessionQueryVariables> & ({ variables: GetSimulationSessionQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetSimulationSessionQuery, GetSimulationSessionQueryVariables>(GetSimulationSessionDocument, options);
      }
export function useGetSimulationSessionLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetSimulationSessionQuery, GetSimulationSessionQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetSimulationSessionQuery, GetSimulationSessionQueryVariables>(GetSimulationSessionDocument, options);
        }
// @ts-ignore
export function useGetSimulationSessionSuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetSimulationSessionQuery, GetSimulationSessionQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetSimulationSessionQuery, GetSimulationSessionQueryVariables>;
export function useGetSimulationSessionSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetSimulationSessionQuery, GetSimulationSessionQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetSimulationSessionQuery | undefined, GetSimulationSessionQueryVariables>;
export function useGetSimulationSessionSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetSimulationSessionQuery, GetSimulationSessionQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetSimulationSessionQuery, GetSimulationSessionQueryVariables>(GetSimulationSessionDocument, options);
        }
export type GetSimulationSessionQueryHookResult = ReturnType<typeof useGetSimulationSessionQuery>;
export type GetSimulationSessionLazyQueryHookResult = ReturnType<typeof useGetSimulationSessionLazyQuery>;
export type GetSimulationSessionSuspenseQueryHookResult = ReturnType<typeof useGetSimulationSessionSuspenseQuery>;
export const GetSimulationPositionsDocument = gql`
    query GetSimulationPositions($sessionId: String!) {
  simulationPositions(sessionId: $sessionId) {
    id
    market
    exchangeCode
    stockCode
    stockName
    quantity
    avgPrice
    currentPrice
    totalInvested
    profitLoss
    profitRate
  }
}
    `;

/**
 * __useGetSimulationPositionsQuery__
 *
 * To run a query within a React component, call `useGetSimulationPositionsQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetSimulationPositionsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetSimulationPositionsQuery({
 *   variables: {
 *      sessionId: // value for 'sessionId'
 *   },
 * });
 */
export function useGetSimulationPositionsQuery(baseOptions: ApolloReactHooks.QueryHookOptions<GetSimulationPositionsQuery, GetSimulationPositionsQueryVariables> & ({ variables: GetSimulationPositionsQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetSimulationPositionsQuery, GetSimulationPositionsQueryVariables>(GetSimulationPositionsDocument, options);
      }
export function useGetSimulationPositionsLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetSimulationPositionsQuery, GetSimulationPositionsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetSimulationPositionsQuery, GetSimulationPositionsQueryVariables>(GetSimulationPositionsDocument, options);
        }
// @ts-ignore
export function useGetSimulationPositionsSuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetSimulationPositionsQuery, GetSimulationPositionsQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetSimulationPositionsQuery, GetSimulationPositionsQueryVariables>;
export function useGetSimulationPositionsSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetSimulationPositionsQuery, GetSimulationPositionsQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetSimulationPositionsQuery | undefined, GetSimulationPositionsQueryVariables>;
export function useGetSimulationPositionsSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetSimulationPositionsQuery, GetSimulationPositionsQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetSimulationPositionsQuery, GetSimulationPositionsQueryVariables>(GetSimulationPositionsDocument, options);
        }
export type GetSimulationPositionsQueryHookResult = ReturnType<typeof useGetSimulationPositionsQuery>;
export type GetSimulationPositionsLazyQueryHookResult = ReturnType<typeof useGetSimulationPositionsLazyQuery>;
export type GetSimulationPositionsSuspenseQueryHookResult = ReturnType<typeof useGetSimulationPositionsSuspenseQuery>;
export const GetSimulationTradesDocument = gql`
    query GetSimulationTrades($input: SimulationTradesFilterInput!) {
  simulationTrades(input: $input) {
    id
    market
    exchangeCode
    stockCode
    stockName
    side
    quantity
    price
    totalAmount
    tradeStatus
    failReason
    strategyName
    reason
    createdAt
  }
}
    `;

/**
 * __useGetSimulationTradesQuery__
 *
 * To run a query within a React component, call `useGetSimulationTradesQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetSimulationTradesQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetSimulationTradesQuery({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useGetSimulationTradesQuery(baseOptions: ApolloReactHooks.QueryHookOptions<GetSimulationTradesQuery, GetSimulationTradesQueryVariables> & ({ variables: GetSimulationTradesQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetSimulationTradesQuery, GetSimulationTradesQueryVariables>(GetSimulationTradesDocument, options);
      }
export function useGetSimulationTradesLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetSimulationTradesQuery, GetSimulationTradesQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetSimulationTradesQuery, GetSimulationTradesQueryVariables>(GetSimulationTradesDocument, options);
        }
// @ts-ignore
export function useGetSimulationTradesSuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetSimulationTradesQuery, GetSimulationTradesQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetSimulationTradesQuery, GetSimulationTradesQueryVariables>;
export function useGetSimulationTradesSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetSimulationTradesQuery, GetSimulationTradesQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetSimulationTradesQuery | undefined, GetSimulationTradesQueryVariables>;
export function useGetSimulationTradesSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetSimulationTradesQuery, GetSimulationTradesQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetSimulationTradesQuery, GetSimulationTradesQueryVariables>(GetSimulationTradesDocument, options);
        }
export type GetSimulationTradesQueryHookResult = ReturnType<typeof useGetSimulationTradesQuery>;
export type GetSimulationTradesLazyQueryHookResult = ReturnType<typeof useGetSimulationTradesLazyQuery>;
export type GetSimulationTradesSuspenseQueryHookResult = ReturnType<typeof useGetSimulationTradesSuspenseQuery>;
export const GetSimulationSnapshotsDocument = gql`
    query GetSimulationSnapshots($sessionId: String!) {
  simulationSnapshots(sessionId: $sessionId) {
    id
    snapshotDate
    portfolioValue
    cashBalance
    totalValue
    dailyPnl
    dailyPnlRate
    drawdown
    peakValue
    positionCount
    tradeCount
  }
}
    `;

/**
 * __useGetSimulationSnapshotsQuery__
 *
 * To run a query within a React component, call `useGetSimulationSnapshotsQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetSimulationSnapshotsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetSimulationSnapshotsQuery({
 *   variables: {
 *      sessionId: // value for 'sessionId'
 *   },
 * });
 */
export function useGetSimulationSnapshotsQuery(baseOptions: ApolloReactHooks.QueryHookOptions<GetSimulationSnapshotsQuery, GetSimulationSnapshotsQueryVariables> & ({ variables: GetSimulationSnapshotsQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetSimulationSnapshotsQuery, GetSimulationSnapshotsQueryVariables>(GetSimulationSnapshotsDocument, options);
      }
export function useGetSimulationSnapshotsLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetSimulationSnapshotsQuery, GetSimulationSnapshotsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetSimulationSnapshotsQuery, GetSimulationSnapshotsQueryVariables>(GetSimulationSnapshotsDocument, options);
        }
// @ts-ignore
export function useGetSimulationSnapshotsSuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetSimulationSnapshotsQuery, GetSimulationSnapshotsQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetSimulationSnapshotsQuery, GetSimulationSnapshotsQueryVariables>;
export function useGetSimulationSnapshotsSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetSimulationSnapshotsQuery, GetSimulationSnapshotsQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetSimulationSnapshotsQuery | undefined, GetSimulationSnapshotsQueryVariables>;
export function useGetSimulationSnapshotsSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetSimulationSnapshotsQuery, GetSimulationSnapshotsQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetSimulationSnapshotsQuery, GetSimulationSnapshotsQueryVariables>(GetSimulationSnapshotsDocument, options);
        }
export type GetSimulationSnapshotsQueryHookResult = ReturnType<typeof useGetSimulationSnapshotsQuery>;
export type GetSimulationSnapshotsLazyQueryHookResult = ReturnType<typeof useGetSimulationSnapshotsLazyQuery>;
export type GetSimulationSnapshotsSuspenseQueryHookResult = ReturnType<typeof useGetSimulationSnapshotsSuspenseQuery>;
export const GetSimulationMetricsDocument = gql`
    query GetSimulationMetrics($sessionId: String!) {
  simulationMetrics(sessionId: $sessionId) {
    totalReturn
    totalReturnAmount
    realizedPnL
    unrealizedPnL
    maxDrawdown
    winRate
    totalTrades
    winTrades
    lossTrades
    sharpeRatio
    profitFactor
    currentCash
    currentPortfolioValue
  }
}
    `;

/**
 * __useGetSimulationMetricsQuery__
 *
 * To run a query within a React component, call `useGetSimulationMetricsQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetSimulationMetricsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetSimulationMetricsQuery({
 *   variables: {
 *      sessionId: // value for 'sessionId'
 *   },
 * });
 */
export function useGetSimulationMetricsQuery(baseOptions: ApolloReactHooks.QueryHookOptions<GetSimulationMetricsQuery, GetSimulationMetricsQueryVariables> & ({ variables: GetSimulationMetricsQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetSimulationMetricsQuery, GetSimulationMetricsQueryVariables>(GetSimulationMetricsDocument, options);
      }
export function useGetSimulationMetricsLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetSimulationMetricsQuery, GetSimulationMetricsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetSimulationMetricsQuery, GetSimulationMetricsQueryVariables>(GetSimulationMetricsDocument, options);
        }
// @ts-ignore
export function useGetSimulationMetricsSuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetSimulationMetricsQuery, GetSimulationMetricsQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetSimulationMetricsQuery, GetSimulationMetricsQueryVariables>;
export function useGetSimulationMetricsSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetSimulationMetricsQuery, GetSimulationMetricsQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetSimulationMetricsQuery | undefined, GetSimulationMetricsQueryVariables>;
export function useGetSimulationMetricsSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetSimulationMetricsQuery, GetSimulationMetricsQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetSimulationMetricsQuery, GetSimulationMetricsQueryVariables>(GetSimulationMetricsDocument, options);
        }
export type GetSimulationMetricsQueryHookResult = ReturnType<typeof useGetSimulationMetricsQuery>;
export type GetSimulationMetricsLazyQueryHookResult = ReturnType<typeof useGetSimulationMetricsLazyQuery>;
export type GetSimulationMetricsSuspenseQueryHookResult = ReturnType<typeof useGetSimulationMetricsSuspenseQuery>;
export const CreateSimulationDocument = gql`
    mutation CreateSimulation($input: CreateSimulationInput!) {
  createSimulation(input: $input) {
    id
    name
    market
    exchangeCode
    stockCode
    stockName
    countryCode
    strategyName
    status
    currentCash
    quota
    cycle
    maxCycles
    stopLossRate
    strategyParams
  }
}
    `;

/**
 * __useCreateSimulationMutation__
 *
 * To run a mutation, you first call `useCreateSimulationMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useCreateSimulationMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [createSimulationMutation, { data, loading, error }] = useCreateSimulationMutation({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useCreateSimulationMutation(baseOptions?: ApolloReactHooks.MutationHookOptions<CreateSimulationMutation, CreateSimulationMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useMutation<CreateSimulationMutation, CreateSimulationMutationVariables>(CreateSimulationDocument, options);
      }
export type CreateSimulationMutationHookResult = ReturnType<typeof useCreateSimulationMutation>;
export const UpdateSimulationSettingsDocument = gql`
    mutation UpdateSimulationSettings($input: UpdateSimulationSettingsInput!) {
  updateSimulationSettings(input: $input) {
    id
    name
    currentCash
    quota
    stopLossRate
    maxCycles
    cycle
    strategyParams
  }
}
    `;

/**
 * __useUpdateSimulationSettingsMutation__
 *
 * To run a mutation, you first call `useUpdateSimulationSettingsMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useUpdateSimulationSettingsMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [updateSimulationSettingsMutation, { data, loading, error }] = useUpdateSimulationSettingsMutation({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useUpdateSimulationSettingsMutation(baseOptions?: ApolloReactHooks.MutationHookOptions<UpdateSimulationSettingsMutation, UpdateSimulationSettingsMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useMutation<UpdateSimulationSettingsMutation, UpdateSimulationSettingsMutationVariables>(UpdateSimulationSettingsDocument, options);
      }
export type UpdateSimulationSettingsMutationHookResult = ReturnType<typeof useUpdateSimulationSettingsMutation>;
export const UpdateSimulationStatusDocument = gql`
    mutation UpdateSimulationStatus($input: UpdateSimulationStatusInput!) {
  updateSimulationStatus(input: $input) {
    id
    status
    stoppedAt
  }
}
    `;

/**
 * __useUpdateSimulationStatusMutation__
 *
 * To run a mutation, you first call `useUpdateSimulationStatusMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useUpdateSimulationStatusMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [updateSimulationStatusMutation, { data, loading, error }] = useUpdateSimulationStatusMutation({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useUpdateSimulationStatusMutation(baseOptions?: ApolloReactHooks.MutationHookOptions<UpdateSimulationStatusMutation, UpdateSimulationStatusMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useMutation<UpdateSimulationStatusMutation, UpdateSimulationStatusMutationVariables>(UpdateSimulationStatusDocument, options);
      }
export type UpdateSimulationStatusMutationHookResult = ReturnType<typeof useUpdateSimulationStatusMutation>;
export const ResetSimulationDocument = gql`
    mutation ResetSimulation($id: String!) {
  resetSimulation(id: $id) {
    id
    status
    currentCash
    quota
  }
}
    `;

/**
 * __useResetSimulationMutation__
 *
 * To run a mutation, you first call `useResetSimulationMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useResetSimulationMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [resetSimulationMutation, { data, loading, error }] = useResetSimulationMutation({
 *   variables: {
 *      id: // value for 'id'
 *   },
 * });
 */
export function useResetSimulationMutation(baseOptions?: ApolloReactHooks.MutationHookOptions<ResetSimulationMutation, ResetSimulationMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useMutation<ResetSimulationMutation, ResetSimulationMutationVariables>(ResetSimulationDocument, options);
      }
export type ResetSimulationMutationHookResult = ReturnType<typeof useResetSimulationMutation>;
export const DeleteSimulationDocument = gql`
    mutation DeleteSimulation($id: String!) {
  deleteSimulation(id: $id)
}
    `;

/**
 * __useDeleteSimulationMutation__
 *
 * To run a mutation, you first call `useDeleteSimulationMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useDeleteSimulationMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [deleteSimulationMutation, { data, loading, error }] = useDeleteSimulationMutation({
 *   variables: {
 *      id: // value for 'id'
 *   },
 * });
 */
export function useDeleteSimulationMutation(baseOptions?: ApolloReactHooks.MutationHookOptions<DeleteSimulationMutation, DeleteSimulationMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useMutation<DeleteSimulationMutation, DeleteSimulationMutationVariables>(DeleteSimulationDocument, options);
      }
export type DeleteSimulationMutationHookResult = ReturnType<typeof useDeleteSimulationMutation>;
export const TriggerSimulationNowDocument = gql`
    mutation TriggerSimulationNow($id: String!) {
  triggerSimulationNow(id: $id) {
    success
    message
  }
}
    `;

/**
 * __useTriggerSimulationNowMutation__
 *
 * To run a mutation, you first call `useTriggerSimulationNowMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useTriggerSimulationNowMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [triggerSimulationNowMutation, { data, loading, error }] = useTriggerSimulationNowMutation({
 *   variables: {
 *      id: // value for 'id'
 *   },
 * });
 */
export function useTriggerSimulationNowMutation(baseOptions?: ApolloReactHooks.MutationHookOptions<TriggerSimulationNowMutation, TriggerSimulationNowMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useMutation<TriggerSimulationNowMutation, TriggerSimulationNowMutationVariables>(TriggerSimulationNowDocument, options);
      }
export type TriggerSimulationNowMutationHookResult = ReturnType<typeof useTriggerSimulationNowMutation>;
export const SearchStocksDocument = gql`
    query SearchStocks($input: SearchStocksInput!) {
  searchStocks(input: $input) {
    stockCode
    stockName
    englishName
    market
    exchangeCode
  }
}
    `;

/**
 * __useSearchStocksQuery__
 *
 * To run a query within a React component, call `useSearchStocksQuery` and pass it any options that fit your needs.
 * When your component renders, `useSearchStocksQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useSearchStocksQuery({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useSearchStocksQuery(baseOptions: ApolloReactHooks.QueryHookOptions<SearchStocksQuery, SearchStocksQueryVariables> & ({ variables: SearchStocksQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<SearchStocksQuery, SearchStocksQueryVariables>(SearchStocksDocument, options);
      }
export function useSearchStocksLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<SearchStocksQuery, SearchStocksQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<SearchStocksQuery, SearchStocksQueryVariables>(SearchStocksDocument, options);
        }
// @ts-ignore
export function useSearchStocksSuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<SearchStocksQuery, SearchStocksQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<SearchStocksQuery, SearchStocksQueryVariables>;
export function useSearchStocksSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<SearchStocksQuery, SearchStocksQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<SearchStocksQuery | undefined, SearchStocksQueryVariables>;
export function useSearchStocksSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<SearchStocksQuery, SearchStocksQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<SearchStocksQuery, SearchStocksQueryVariables>(SearchStocksDocument, options);
        }
export type SearchStocksQueryHookResult = ReturnType<typeof useSearchStocksQuery>;
export type SearchStocksLazyQueryHookResult = ReturnType<typeof useSearchStocksLazyQuery>;
export type SearchStocksSuspenseQueryHookResult = ReturnType<typeof useSearchStocksSuspenseQuery>;
export const GetTradesDocument = gql`
    query GetTrades($input: TradeFilterInput) {
  trades(input: $input) {
    id
    market
    exchangeCode
    stockCode
    stockName
    side
    orderType
    quantity
    price
    executedPrice
    executedQty
    orderNo
    status
    strategyName
    reason
    createdAt
  }
}
    `;

/**
 * __useGetTradesQuery__
 *
 * To run a query within a React component, call `useGetTradesQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetTradesQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetTradesQuery({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useGetTradesQuery(baseOptions?: ApolloReactHooks.QueryHookOptions<GetTradesQuery, GetTradesQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetTradesQuery, GetTradesQueryVariables>(GetTradesDocument, options);
      }
export function useGetTradesLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetTradesQuery, GetTradesQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetTradesQuery, GetTradesQueryVariables>(GetTradesDocument, options);
        }
// @ts-ignore
export function useGetTradesSuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetTradesQuery, GetTradesQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetTradesQuery, GetTradesQueryVariables>;
export function useGetTradesSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetTradesQuery, GetTradesQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetTradesQuery | undefined, GetTradesQueryVariables>;
export function useGetTradesSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetTradesQuery, GetTradesQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetTradesQuery, GetTradesQueryVariables>(GetTradesDocument, options);
        }
export type GetTradesQueryHookResult = ReturnType<typeof useGetTradesQuery>;
export type GetTradesLazyQueryHookResult = ReturnType<typeof useGetTradesLazyQuery>;
export type GetTradesSuspenseQueryHookResult = ReturnType<typeof useGetTradesSuspenseQuery>;
export const GetTradeDocument = gql`
    query GetTrade($id: ID!) {
  trade(id: $id) {
    id
    market
    exchangeCode
    stockCode
    stockName
    side
    orderType
    quantity
    price
    executedPrice
    executedQty
    orderNo
    status
    strategyName
    reason
    createdAt
  }
}
    `;

/**
 * __useGetTradeQuery__
 *
 * To run a query within a React component, call `useGetTradeQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetTradeQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetTradeQuery({
 *   variables: {
 *      id: // value for 'id'
 *   },
 * });
 */
export function useGetTradeQuery(baseOptions: ApolloReactHooks.QueryHookOptions<GetTradeQuery, GetTradeQueryVariables> & ({ variables: GetTradeQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetTradeQuery, GetTradeQueryVariables>(GetTradeDocument, options);
      }
export function useGetTradeLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetTradeQuery, GetTradeQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetTradeQuery, GetTradeQueryVariables>(GetTradeDocument, options);
        }
// @ts-ignore
export function useGetTradeSuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetTradeQuery, GetTradeQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetTradeQuery, GetTradeQueryVariables>;
export function useGetTradeSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetTradeQuery, GetTradeQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetTradeQuery | undefined, GetTradeQueryVariables>;
export function useGetTradeSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetTradeQuery, GetTradeQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetTradeQuery, GetTradeQueryVariables>(GetTradeDocument, options);
        }
export type GetTradeQueryHookResult = ReturnType<typeof useGetTradeQuery>;
export type GetTradeLazyQueryHookResult = ReturnType<typeof useGetTradeLazyQuery>;
export type GetTradeSuspenseQueryHookResult = ReturnType<typeof useGetTradeSuspenseQuery>;
export const GetPositionsDocument = gql`
    query GetPositions($input: PositionsFilterInput) {
  positions(input: $input) {
    id
    market
    exchangeCode
    stockCode
    stockName
    quantity
    avgPrice
    currentPrice
    profitLoss
    profitRate
    totalInvested
  }
}
    `;

/**
 * __useGetPositionsQuery__
 *
 * To run a query within a React component, call `useGetPositionsQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetPositionsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetPositionsQuery({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useGetPositionsQuery(baseOptions?: ApolloReactHooks.QueryHookOptions<GetPositionsQuery, GetPositionsQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetPositionsQuery, GetPositionsQueryVariables>(GetPositionsDocument, options);
      }
export function useGetPositionsLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetPositionsQuery, GetPositionsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetPositionsQuery, GetPositionsQueryVariables>(GetPositionsDocument, options);
        }
// @ts-ignore
export function useGetPositionsSuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetPositionsQuery, GetPositionsQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetPositionsQuery, GetPositionsQueryVariables>;
export function useGetPositionsSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetPositionsQuery, GetPositionsQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetPositionsQuery | undefined, GetPositionsQueryVariables>;
export function useGetPositionsSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetPositionsQuery, GetPositionsQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetPositionsQuery, GetPositionsQueryVariables>(GetPositionsDocument, options);
        }
export type GetPositionsQueryHookResult = ReturnType<typeof useGetPositionsQuery>;
export type GetPositionsLazyQueryHookResult = ReturnType<typeof useGetPositionsLazyQuery>;
export type GetPositionsSuspenseQueryHookResult = ReturnType<typeof useGetPositionsSuspenseQuery>;
export const GetQuoteDocument = gql`
    query GetQuote($stockCode: String!) {
  quote(stockCode: $stockCode) {
    stockCode
    stockName
    currentPrice
    changeRate
    openPrice
    highPrice
    lowPrice
    volume
    technicalRatings {
      timeframe
      oscillatorSummary {
        score
        recommendation
        buyCount
        neutralCount
        sellCount
      }
      movingAverageSummary {
        score
        recommendation
        buyCount
        neutralCount
        sellCount
      }
      overallSummary {
        score
        recommendation
        buyCount
        neutralCount
        sellCount
      }
      oscillators {
        key
        label
        value
        action
      }
      movingAverages {
        key
        label
        value
        action
      }
    }
  }
}
    `;

/**
 * __useGetQuoteQuery__
 *
 * To run a query within a React component, call `useGetQuoteQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetQuoteQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetQuoteQuery({
 *   variables: {
 *      stockCode: // value for 'stockCode'
 *   },
 * });
 */
export function useGetQuoteQuery(baseOptions: ApolloReactHooks.QueryHookOptions<GetQuoteQuery, GetQuoteQueryVariables> & ({ variables: GetQuoteQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetQuoteQuery, GetQuoteQueryVariables>(GetQuoteDocument, options);
      }
export function useGetQuoteLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetQuoteQuery, GetQuoteQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetQuoteQuery, GetQuoteQueryVariables>(GetQuoteDocument, options);
        }
// @ts-ignore
export function useGetQuoteSuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetQuoteQuery, GetQuoteQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetQuoteQuery, GetQuoteQueryVariables>;
export function useGetQuoteSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetQuoteQuery, GetQuoteQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetQuoteQuery | undefined, GetQuoteQueryVariables>;
export function useGetQuoteSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetQuoteQuery, GetQuoteQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetQuoteQuery, GetQuoteQueryVariables>(GetQuoteDocument, options);
        }
export type GetQuoteQueryHookResult = ReturnType<typeof useGetQuoteQuery>;
export type GetQuoteLazyQueryHookResult = ReturnType<typeof useGetQuoteLazyQuery>;
export type GetQuoteSuspenseQueryHookResult = ReturnType<typeof useGetQuoteSuspenseQuery>;
export const GetQuoteHistoryDocument = gql`
    query GetQuoteHistory($stockCode: String!, $months: Int) {
  quoteHistory(stockCode: $stockCode, months: $months) {
    date
    close
    open
    high
    low
    volume
  }
}
    `;

/**
 * __useGetQuoteHistoryQuery__
 *
 * To run a query within a React component, call `useGetQuoteHistoryQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetQuoteHistoryQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetQuoteHistoryQuery({
 *   variables: {
 *      stockCode: // value for 'stockCode'
 *      months: // value for 'months'
 *   },
 * });
 */
export function useGetQuoteHistoryQuery(baseOptions: ApolloReactHooks.QueryHookOptions<GetQuoteHistoryQuery, GetQuoteHistoryQueryVariables> & ({ variables: GetQuoteHistoryQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetQuoteHistoryQuery, GetQuoteHistoryQueryVariables>(GetQuoteHistoryDocument, options);
      }
export function useGetQuoteHistoryLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetQuoteHistoryQuery, GetQuoteHistoryQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetQuoteHistoryQuery, GetQuoteHistoryQueryVariables>(GetQuoteHistoryDocument, options);
        }
// @ts-ignore
export function useGetQuoteHistorySuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetQuoteHistoryQuery, GetQuoteHistoryQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetQuoteHistoryQuery, GetQuoteHistoryQueryVariables>;
export function useGetQuoteHistorySuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetQuoteHistoryQuery, GetQuoteHistoryQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetQuoteHistoryQuery | undefined, GetQuoteHistoryQueryVariables>;
export function useGetQuoteHistorySuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetQuoteHistoryQuery, GetQuoteHistoryQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetQuoteHistoryQuery, GetQuoteHistoryQueryVariables>(GetQuoteHistoryDocument, options);
        }
export type GetQuoteHistoryQueryHookResult = ReturnType<typeof useGetQuoteHistoryQuery>;
export type GetQuoteHistoryLazyQueryHookResult = ReturnType<typeof useGetQuoteHistoryLazyQuery>;
export type GetQuoteHistorySuspenseQueryHookResult = ReturnType<typeof useGetQuoteHistorySuspenseQuery>;
export const GetOverseasQuoteDocument = gql`
    query GetOverseasQuote($input: OverseasQuoteInput!) {
  overseasQuote(input: $input) {
    stockCode
    stockName
    currentPrice
    changeRate
    openPrice
    highPrice
    lowPrice
    volume
    technicalRatings {
      timeframe
      oscillatorSummary {
        score
        recommendation
        buyCount
        neutralCount
        sellCount
      }
      movingAverageSummary {
        score
        recommendation
        buyCount
        neutralCount
        sellCount
      }
      overallSummary {
        score
        recommendation
        buyCount
        neutralCount
        sellCount
      }
      oscillators {
        key
        label
        value
        action
      }
      movingAverages {
        key
        label
        value
        action
      }
    }
  }
}
    `;

/**
 * __useGetOverseasQuoteQuery__
 *
 * To run a query within a React component, call `useGetOverseasQuoteQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetOverseasQuoteQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetOverseasQuoteQuery({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useGetOverseasQuoteQuery(baseOptions: ApolloReactHooks.QueryHookOptions<GetOverseasQuoteQuery, GetOverseasQuoteQueryVariables> & ({ variables: GetOverseasQuoteQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetOverseasQuoteQuery, GetOverseasQuoteQueryVariables>(GetOverseasQuoteDocument, options);
      }
export function useGetOverseasQuoteLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetOverseasQuoteQuery, GetOverseasQuoteQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetOverseasQuoteQuery, GetOverseasQuoteQueryVariables>(GetOverseasQuoteDocument, options);
        }
// @ts-ignore
export function useGetOverseasQuoteSuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetOverseasQuoteQuery, GetOverseasQuoteQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetOverseasQuoteQuery, GetOverseasQuoteQueryVariables>;
export function useGetOverseasQuoteSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetOverseasQuoteQuery, GetOverseasQuoteQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetOverseasQuoteQuery | undefined, GetOverseasQuoteQueryVariables>;
export function useGetOverseasQuoteSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetOverseasQuoteQuery, GetOverseasQuoteQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetOverseasQuoteQuery, GetOverseasQuoteQueryVariables>(GetOverseasQuoteDocument, options);
        }
export type GetOverseasQuoteQueryHookResult = ReturnType<typeof useGetOverseasQuoteQuery>;
export type GetOverseasQuoteLazyQueryHookResult = ReturnType<typeof useGetOverseasQuoteLazyQuery>;
export type GetOverseasQuoteSuspenseQueryHookResult = ReturnType<typeof useGetOverseasQuoteSuspenseQuery>;
export const GetOverseasQuoteHistoryDocument = gql`
    query GetOverseasQuoteHistory($input: OverseasQuoteInput!, $months: Int) {
  overseasQuoteHistory(input: $input, months: $months) {
    date
    close
    open
    high
    low
    volume
  }
}
    `;

/**
 * __useGetOverseasQuoteHistoryQuery__
 *
 * To run a query within a React component, call `useGetOverseasQuoteHistoryQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetOverseasQuoteHistoryQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetOverseasQuoteHistoryQuery({
 *   variables: {
 *      input: // value for 'input'
 *      months: // value for 'months'
 *   },
 * });
 */
export function useGetOverseasQuoteHistoryQuery(baseOptions: ApolloReactHooks.QueryHookOptions<GetOverseasQuoteHistoryQuery, GetOverseasQuoteHistoryQueryVariables> & ({ variables: GetOverseasQuoteHistoryQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetOverseasQuoteHistoryQuery, GetOverseasQuoteHistoryQueryVariables>(GetOverseasQuoteHistoryDocument, options);
      }
export function useGetOverseasQuoteHistoryLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetOverseasQuoteHistoryQuery, GetOverseasQuoteHistoryQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetOverseasQuoteHistoryQuery, GetOverseasQuoteHistoryQueryVariables>(GetOverseasQuoteHistoryDocument, options);
        }
// @ts-ignore
export function useGetOverseasQuoteHistorySuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetOverseasQuoteHistoryQuery, GetOverseasQuoteHistoryQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetOverseasQuoteHistoryQuery, GetOverseasQuoteHistoryQueryVariables>;
export function useGetOverseasQuoteHistorySuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetOverseasQuoteHistoryQuery, GetOverseasQuoteHistoryQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetOverseasQuoteHistoryQuery | undefined, GetOverseasQuoteHistoryQueryVariables>;
export function useGetOverseasQuoteHistorySuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetOverseasQuoteHistoryQuery, GetOverseasQuoteHistoryQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetOverseasQuoteHistoryQuery, GetOverseasQuoteHistoryQueryVariables>(GetOverseasQuoteHistoryDocument, options);
        }
export type GetOverseasQuoteHistoryQueryHookResult = ReturnType<typeof useGetOverseasQuoteHistoryQuery>;
export type GetOverseasQuoteHistoryLazyQueryHookResult = ReturnType<typeof useGetOverseasQuoteHistoryLazyQuery>;
export type GetOverseasQuoteHistorySuspenseQueryHookResult = ReturnType<typeof useGetOverseasQuoteHistorySuspenseQuery>;
export const GetAccountSummaryDocument = gql`
    query GetAccountSummary {
  accountSummary {
    cashBalance
    totalInvested
    totalAssets
    totalProfitLoss
    realizedPnL
    profitRate
    positionCount
    lastSyncedAt
    cashBalances {
      market
      currencyCode
      currencyName
      amount
      withdrawableAmount
    }
  }
}
    `;

/**
 * __useGetAccountSummaryQuery__
 *
 * To run a query within a React component, call `useGetAccountSummaryQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetAccountSummaryQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetAccountSummaryQuery({
 *   variables: {
 *   },
 * });
 */
export function useGetAccountSummaryQuery(baseOptions?: ApolloReactHooks.QueryHookOptions<GetAccountSummaryQuery, GetAccountSummaryQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetAccountSummaryQuery, GetAccountSummaryQueryVariables>(GetAccountSummaryDocument, options);
      }
export function useGetAccountSummaryLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetAccountSummaryQuery, GetAccountSummaryQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetAccountSummaryQuery, GetAccountSummaryQueryVariables>(GetAccountSummaryDocument, options);
        }
// @ts-ignore
export function useGetAccountSummarySuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetAccountSummaryQuery, GetAccountSummaryQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetAccountSummaryQuery, GetAccountSummaryQueryVariables>;
export function useGetAccountSummarySuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetAccountSummaryQuery, GetAccountSummaryQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetAccountSummaryQuery | undefined, GetAccountSummaryQueryVariables>;
export function useGetAccountSummarySuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetAccountSummaryQuery, GetAccountSummaryQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetAccountSummaryQuery, GetAccountSummaryQueryVariables>(GetAccountSummaryDocument, options);
        }
export type GetAccountSummaryQueryHookResult = ReturnType<typeof useGetAccountSummaryQuery>;
export type GetAccountSummaryLazyQueryHookResult = ReturnType<typeof useGetAccountSummaryLazyQuery>;
export type GetAccountSummarySuspenseQueryHookResult = ReturnType<typeof useGetAccountSummarySuspenseQuery>;
export const GetDashboardSummaryDocument = gql`
    query GetDashboardSummary {
  dashboardSummary {
    totalProfitLoss
    totalTradeCount
    todayTradeCount
    winRate
  }
}
    `;

/**
 * __useGetDashboardSummaryQuery__
 *
 * To run a query within a React component, call `useGetDashboardSummaryQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetDashboardSummaryQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetDashboardSummaryQuery({
 *   variables: {
 *   },
 * });
 */
export function useGetDashboardSummaryQuery(baseOptions?: ApolloReactHooks.QueryHookOptions<GetDashboardSummaryQuery, GetDashboardSummaryQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetDashboardSummaryQuery, GetDashboardSummaryQueryVariables>(GetDashboardSummaryDocument, options);
      }
export function useGetDashboardSummaryLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetDashboardSummaryQuery, GetDashboardSummaryQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetDashboardSummaryQuery, GetDashboardSummaryQueryVariables>(GetDashboardSummaryDocument, options);
        }
// @ts-ignore
export function useGetDashboardSummarySuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetDashboardSummaryQuery, GetDashboardSummaryQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetDashboardSummaryQuery, GetDashboardSummaryQueryVariables>;
export function useGetDashboardSummarySuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetDashboardSummaryQuery, GetDashboardSummaryQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetDashboardSummaryQuery | undefined, GetDashboardSummaryQueryVariables>;
export function useGetDashboardSummarySuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetDashboardSummaryQuery, GetDashboardSummaryQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetDashboardSummaryQuery, GetDashboardSummaryQueryVariables>(GetDashboardSummaryDocument, options);
        }
export type GetDashboardSummaryQueryHookResult = ReturnType<typeof useGetDashboardSummaryQuery>;
export type GetDashboardSummaryLazyQueryHookResult = ReturnType<typeof useGetDashboardSummaryLazyQuery>;
export type GetDashboardSummarySuspenseQueryHookResult = ReturnType<typeof useGetDashboardSummarySuspenseQuery>;
export const ManualSellDocument = gql`
    mutation ManualSell($input: ManualSellInput!) {
  manualSell(input: $input) {
    success
    message
    orderNo
  }
}
    `;

/**
 * __useManualSellMutation__
 *
 * To run a mutation, you first call `useManualSellMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useManualSellMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [manualSellMutation, { data, loading, error }] = useManualSellMutation({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useManualSellMutation(baseOptions?: ApolloReactHooks.MutationHookOptions<ManualSellMutation, ManualSellMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useMutation<ManualSellMutation, ManualSellMutationVariables>(ManualSellDocument, options);
      }
export type ManualSellMutationHookResult = ReturnType<typeof useManualSellMutation>;
export const CancelTradeOrderDocument = gql`
    mutation CancelTradeOrder($input: CancelTradeOrderInput!) {
  cancelTradeOrder(input: $input) {
    success
    message
    orderNo
  }
}
    `;

/**
 * __useCancelTradeOrderMutation__
 *
 * To run a mutation, you first call `useCancelTradeOrderMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useCancelTradeOrderMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [cancelTradeOrderMutation, { data, loading, error }] = useCancelTradeOrderMutation({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useCancelTradeOrderMutation(baseOptions?: ApolloReactHooks.MutationHookOptions<CancelTradeOrderMutation, CancelTradeOrderMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useMutation<CancelTradeOrderMutation, CancelTradeOrderMutationVariables>(CancelTradeOrderDocument, options);
      }
export type CancelTradeOrderMutationHookResult = ReturnType<typeof useCancelTradeOrderMutation>;
export const RefreshAccountStateDocument = gql`
    mutation RefreshAccountState {
  refreshAccountState {
    success
    message
    accountSummary {
      cashBalance
      totalInvested
      totalAssets
      totalProfitLoss
      realizedPnL
      profitRate
      positionCount
      lastSyncedAt
      cashBalances {
        market
        currencyCode
        currencyName
        amount
        withdrawableAmount
      }
    }
  }
}
    `;

/**
 * __useRefreshAccountStateMutation__
 *
 * To run a mutation, you first call `useRefreshAccountStateMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useRefreshAccountStateMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [refreshAccountStateMutation, { data, loading, error }] = useRefreshAccountStateMutation({
 *   variables: {
 *   },
 * });
 */
export function useRefreshAccountStateMutation(baseOptions?: ApolloReactHooks.MutationHookOptions<RefreshAccountStateMutation, RefreshAccountStateMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useMutation<RefreshAccountStateMutation, RefreshAccountStateMutationVariables>(RefreshAccountStateDocument, options);
      }
export type RefreshAccountStateMutationHookResult = ReturnType<typeof useRefreshAccountStateMutation>;
export const GetAvailableStrategiesDocument = gql`
    query GetAvailableStrategies {
  availableStrategies {
    name
    displayName
    description
    meta {
      riskLevel
      mddBuyBlock
      mddLiquidate
      expectedReturn
      maxLoss
      investmentPeriod
      tradingFrequency
      suitableFor
      tags
    }
  }
}
    `;

/**
 * __useGetAvailableStrategiesQuery__
 *
 * To run a query within a React component, call `useGetAvailableStrategiesQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetAvailableStrategiesQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetAvailableStrategiesQuery({
 *   variables: {
 *   },
 * });
 */
export function useGetAvailableStrategiesQuery(baseOptions?: ApolloReactHooks.QueryHookOptions<GetAvailableStrategiesQuery, GetAvailableStrategiesQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetAvailableStrategiesQuery, GetAvailableStrategiesQueryVariables>(GetAvailableStrategiesDocument, options);
      }
export function useGetAvailableStrategiesLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetAvailableStrategiesQuery, GetAvailableStrategiesQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetAvailableStrategiesQuery, GetAvailableStrategiesQueryVariables>(GetAvailableStrategiesDocument, options);
        }
// @ts-ignore
export function useGetAvailableStrategiesSuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetAvailableStrategiesQuery, GetAvailableStrategiesQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetAvailableStrategiesQuery, GetAvailableStrategiesQueryVariables>;
export function useGetAvailableStrategiesSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetAvailableStrategiesQuery, GetAvailableStrategiesQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetAvailableStrategiesQuery | undefined, GetAvailableStrategiesQueryVariables>;
export function useGetAvailableStrategiesSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetAvailableStrategiesQuery, GetAvailableStrategiesQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetAvailableStrategiesQuery, GetAvailableStrategiesQueryVariables>(GetAvailableStrategiesDocument, options);
        }
export type GetAvailableStrategiesQueryHookResult = ReturnType<typeof useGetAvailableStrategiesQuery>;
export type GetAvailableStrategiesLazyQueryHookResult = ReturnType<typeof useGetAvailableStrategiesLazyQuery>;
export type GetAvailableStrategiesSuspenseQueryHookResult = ReturnType<typeof useGetAvailableStrategiesSuspenseQuery>;
export const GetMarketRegimeDocument = gql`
    query GetMarketRegime($input: MarketRegimeFilterInput!) {
  marketRegime(input: $input) {
    regime
    market
    exchangeCode
  }
}
    `;

/**
 * __useGetMarketRegimeQuery__
 *
 * To run a query within a React component, call `useGetMarketRegimeQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetMarketRegimeQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetMarketRegimeQuery({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useGetMarketRegimeQuery(baseOptions: ApolloReactHooks.QueryHookOptions<GetMarketRegimeQuery, GetMarketRegimeQueryVariables> & ({ variables: GetMarketRegimeQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetMarketRegimeQuery, GetMarketRegimeQueryVariables>(GetMarketRegimeDocument, options);
      }
export function useGetMarketRegimeLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetMarketRegimeQuery, GetMarketRegimeQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetMarketRegimeQuery, GetMarketRegimeQueryVariables>(GetMarketRegimeDocument, options);
        }
// @ts-ignore
export function useGetMarketRegimeSuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetMarketRegimeQuery, GetMarketRegimeQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetMarketRegimeQuery, GetMarketRegimeQueryVariables>;
export function useGetMarketRegimeSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetMarketRegimeQuery, GetMarketRegimeQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetMarketRegimeQuery | undefined, GetMarketRegimeQueryVariables>;
export function useGetMarketRegimeSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetMarketRegimeQuery, GetMarketRegimeQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetMarketRegimeQuery, GetMarketRegimeQueryVariables>(GetMarketRegimeDocument, options);
        }
export type GetMarketRegimeQueryHookResult = ReturnType<typeof useGetMarketRegimeQuery>;
export type GetMarketRegimeLazyQueryHookResult = ReturnType<typeof useGetMarketRegimeLazyQuery>;
export type GetMarketRegimeSuspenseQueryHookResult = ReturnType<typeof useGetMarketRegimeSuspenseQuery>;
export const GetWatchStocksDocument = gql`
    query GetWatchStocks($input: WatchStocksFilterInput) {
  watchStocks(input: $input) {
    id
    market
    exchangeCode
    stockCode
    stockName
    isActive
    strategyName
    quota
    cycle
    maxCycles
    stopLossRate
    maxPortfolioRate
    strategyParams
    lastExecutionStatus
    lastExecutionDate
    createdAt
    updatedAt
  }
}
    `;

/**
 * __useGetWatchStocksQuery__
 *
 * To run a query within a React component, call `useGetWatchStocksQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetWatchStocksQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetWatchStocksQuery({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useGetWatchStocksQuery(baseOptions?: ApolloReactHooks.QueryHookOptions<GetWatchStocksQuery, GetWatchStocksQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetWatchStocksQuery, GetWatchStocksQueryVariables>(GetWatchStocksDocument, options);
      }
export function useGetWatchStocksLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetWatchStocksQuery, GetWatchStocksQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetWatchStocksQuery, GetWatchStocksQueryVariables>(GetWatchStocksDocument, options);
        }
// @ts-ignore
export function useGetWatchStocksSuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetWatchStocksQuery, GetWatchStocksQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetWatchStocksQuery, GetWatchStocksQueryVariables>;
export function useGetWatchStocksSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetWatchStocksQuery, GetWatchStocksQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetWatchStocksQuery | undefined, GetWatchStocksQueryVariables>;
export function useGetWatchStocksSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetWatchStocksQuery, GetWatchStocksQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetWatchStocksQuery, GetWatchStocksQueryVariables>(GetWatchStocksDocument, options);
        }
export type GetWatchStocksQueryHookResult = ReturnType<typeof useGetWatchStocksQuery>;
export type GetWatchStocksLazyQueryHookResult = ReturnType<typeof useGetWatchStocksLazyQuery>;
export type GetWatchStocksSuspenseQueryHookResult = ReturnType<typeof useGetWatchStocksSuspenseQuery>;
export const GetWatchStockDocument = gql`
    query GetWatchStock($id: ID!) {
  watchStock(id: $id) {
    id
    market
    exchangeCode
    stockCode
    stockName
    isActive
    strategyName
    quota
    cycle
    maxCycles
    stopLossRate
    maxPortfolioRate
    strategyParams
    lastExecutionStatus
    lastExecutionDate
    createdAt
    updatedAt
  }
}
    `;

/**
 * __useGetWatchStockQuery__
 *
 * To run a query within a React component, call `useGetWatchStockQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetWatchStockQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetWatchStockQuery({
 *   variables: {
 *      id: // value for 'id'
 *   },
 * });
 */
export function useGetWatchStockQuery(baseOptions: ApolloReactHooks.QueryHookOptions<GetWatchStockQuery, GetWatchStockQueryVariables> & ({ variables: GetWatchStockQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetWatchStockQuery, GetWatchStockQueryVariables>(GetWatchStockDocument, options);
      }
export function useGetWatchStockLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetWatchStockQuery, GetWatchStockQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetWatchStockQuery, GetWatchStockQueryVariables>(GetWatchStockDocument, options);
        }
// @ts-ignore
export function useGetWatchStockSuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetWatchStockQuery, GetWatchStockQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetWatchStockQuery, GetWatchStockQueryVariables>;
export function useGetWatchStockSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetWatchStockQuery, GetWatchStockQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetWatchStockQuery | undefined, GetWatchStockQueryVariables>;
export function useGetWatchStockSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetWatchStockQuery, GetWatchStockQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetWatchStockQuery, GetWatchStockQueryVariables>(GetWatchStockDocument, options);
        }
export type GetWatchStockQueryHookResult = ReturnType<typeof useGetWatchStockQuery>;
export type GetWatchStockLazyQueryHookResult = ReturnType<typeof useGetWatchStockLazyQuery>;
export type GetWatchStockSuspenseQueryHookResult = ReturnType<typeof useGetWatchStockSuspenseQuery>;
export const GetWatchStockExecutionLogsDocument = gql`
    query GetWatchStockExecutionLogs($watchStockId: String!, $limit: Float) {
  watchStockExecutionLogs(watchStockId: $watchStockId, limit: $limit) {
    id
    watchStockId
    tradeRecordId
    market
    exchangeCode
    stockCode
    stockName
    strategyName
    eventType
    message
    details
    createdAt
  }
}
    `;

/**
 * __useGetWatchStockExecutionLogsQuery__
 *
 * To run a query within a React component, call `useGetWatchStockExecutionLogsQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetWatchStockExecutionLogsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetWatchStockExecutionLogsQuery({
 *   variables: {
 *      watchStockId: // value for 'watchStockId'
 *      limit: // value for 'limit'
 *   },
 * });
 */
export function useGetWatchStockExecutionLogsQuery(baseOptions: ApolloReactHooks.QueryHookOptions<GetWatchStockExecutionLogsQuery, GetWatchStockExecutionLogsQueryVariables> & ({ variables: GetWatchStockExecutionLogsQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetWatchStockExecutionLogsQuery, GetWatchStockExecutionLogsQueryVariables>(GetWatchStockExecutionLogsDocument, options);
      }
export function useGetWatchStockExecutionLogsLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetWatchStockExecutionLogsQuery, GetWatchStockExecutionLogsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetWatchStockExecutionLogsQuery, GetWatchStockExecutionLogsQueryVariables>(GetWatchStockExecutionLogsDocument, options);
        }
// @ts-ignore
export function useGetWatchStockExecutionLogsSuspenseQuery(baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<GetWatchStockExecutionLogsQuery, GetWatchStockExecutionLogsQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetWatchStockExecutionLogsQuery, GetWatchStockExecutionLogsQueryVariables>;
export function useGetWatchStockExecutionLogsSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetWatchStockExecutionLogsQuery, GetWatchStockExecutionLogsQueryVariables>): ApolloReactHooks.UseSuspenseQueryResult<GetWatchStockExecutionLogsQuery | undefined, GetWatchStockExecutionLogsQueryVariables>;
export function useGetWatchStockExecutionLogsSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetWatchStockExecutionLogsQuery, GetWatchStockExecutionLogsQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetWatchStockExecutionLogsQuery, GetWatchStockExecutionLogsQueryVariables>(GetWatchStockExecutionLogsDocument, options);
        }
export type GetWatchStockExecutionLogsQueryHookResult = ReturnType<typeof useGetWatchStockExecutionLogsQuery>;
export type GetWatchStockExecutionLogsLazyQueryHookResult = ReturnType<typeof useGetWatchStockExecutionLogsLazyQuery>;
export type GetWatchStockExecutionLogsSuspenseQueryHookResult = ReturnType<typeof useGetWatchStockExecutionLogsSuspenseQuery>;
export const CreateWatchStockDocument = gql`
    mutation CreateWatchStock($input: CreateWatchStockInput!) {
  createWatchStock(input: $input) {
    id
    market
    exchangeCode
    stockCode
    stockName
    isActive
    strategyName
    quota
    cycle
    maxCycles
    stopLossRate
    maxPortfolioRate
    strategyParams
    createdAt
    updatedAt
  }
}
    `;

/**
 * __useCreateWatchStockMutation__
 *
 * To run a mutation, you first call `useCreateWatchStockMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useCreateWatchStockMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [createWatchStockMutation, { data, loading, error }] = useCreateWatchStockMutation({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useCreateWatchStockMutation(baseOptions?: ApolloReactHooks.MutationHookOptions<CreateWatchStockMutation, CreateWatchStockMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useMutation<CreateWatchStockMutation, CreateWatchStockMutationVariables>(CreateWatchStockDocument, options);
      }
export type CreateWatchStockMutationHookResult = ReturnType<typeof useCreateWatchStockMutation>;
export const UpdateWatchStockDocument = gql`
    mutation UpdateWatchStock($id: ID!, $input: UpdateWatchStockInput!) {
  updateWatchStock(id: $id, input: $input) {
    id
    market
    exchangeCode
    stockCode
    stockName
    isActive
    strategyName
    quota
    cycle
    maxCycles
    stopLossRate
    maxPortfolioRate
    strategyParams
    createdAt
    updatedAt
  }
}
    `;

/**
 * __useUpdateWatchStockMutation__
 *
 * To run a mutation, you first call `useUpdateWatchStockMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useUpdateWatchStockMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [updateWatchStockMutation, { data, loading, error }] = useUpdateWatchStockMutation({
 *   variables: {
 *      id: // value for 'id'
 *      input: // value for 'input'
 *   },
 * });
 */
export function useUpdateWatchStockMutation(baseOptions?: ApolloReactHooks.MutationHookOptions<UpdateWatchStockMutation, UpdateWatchStockMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useMutation<UpdateWatchStockMutation, UpdateWatchStockMutationVariables>(UpdateWatchStockDocument, options);
      }
export type UpdateWatchStockMutationHookResult = ReturnType<typeof useUpdateWatchStockMutation>;
export const DeleteWatchStockDocument = gql`
    mutation DeleteWatchStock($id: ID!) {
  deleteWatchStock(id: $id)
}
    `;

/**
 * __useDeleteWatchStockMutation__
 *
 * To run a mutation, you first call `useDeleteWatchStockMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useDeleteWatchStockMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [deleteWatchStockMutation, { data, loading, error }] = useDeleteWatchStockMutation({
 *   variables: {
 *      id: // value for 'id'
 *   },
 * });
 */
export function useDeleteWatchStockMutation(baseOptions?: ApolloReactHooks.MutationHookOptions<DeleteWatchStockMutation, DeleteWatchStockMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useMutation<DeleteWatchStockMutation, DeleteWatchStockMutationVariables>(DeleteWatchStockDocument, options);
      }
export type DeleteWatchStockMutationHookResult = ReturnType<typeof useDeleteWatchStockMutation>;
export const TriggerWatchStockNowDocument = gql`
    mutation TriggerWatchStockNow($id: ID!) {
  triggerWatchStockNow(id: $id) {
    success
    message
  }
}
    `;

/**
 * __useTriggerWatchStockNowMutation__
 *
 * To run a mutation, you first call `useTriggerWatchStockNowMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useTriggerWatchStockNowMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [triggerWatchStockNowMutation, { data, loading, error }] = useTriggerWatchStockNowMutation({
 *   variables: {
 *      id: // value for 'id'
 *   },
 * });
 */
export function useTriggerWatchStockNowMutation(baseOptions?: ApolloReactHooks.MutationHookOptions<TriggerWatchStockNowMutation, TriggerWatchStockNowMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useMutation<TriggerWatchStockNowMutation, TriggerWatchStockNowMutationVariables>(TriggerWatchStockNowDocument, options);
      }
export type TriggerWatchStockNowMutationHookResult = ReturnType<typeof useTriggerWatchStockNowMutation>;
export const ResetWatchStockCarryDocument = gql`
    mutation ResetWatchStockCarry($id: ID!) {
  resetWatchStockCarry(id: $id) {
    success
    message
  }
}
    `;

/**
 * __useResetWatchStockCarryMutation__
 *
 * To run a mutation, you first call `useResetWatchStockCarryMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useResetWatchStockCarryMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [resetWatchStockCarryMutation, { data, loading, error }] = useResetWatchStockCarryMutation({
 *   variables: {
 *      id: // value for 'id'
 *   },
 * });
 */
export function useResetWatchStockCarryMutation(baseOptions?: ApolloReactHooks.MutationHookOptions<ResetWatchStockCarryMutation, ResetWatchStockCarryMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useMutation<ResetWatchStockCarryMutation, ResetWatchStockCarryMutationVariables>(ResetWatchStockCarryDocument, options);
      }
export type ResetWatchStockCarryMutationHookResult = ReturnType<typeof useResetWatchStockCarryMutation>;