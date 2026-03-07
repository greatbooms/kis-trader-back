// @ts-nocheck
import { gql } from "@apollo/client";
import * as ApolloReactCommon from "@apollo/client/react";
import * as ApolloReactHooks from "@apollo/client/react";
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = {
  [K in keyof T]: T[K];
};
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]?: Maybe<T[SubKey]>;
};
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]: Maybe<T[SubKey]>;
};
export type MakeEmpty<
  T extends { [key: string]: unknown },
  K extends keyof T,
> = { [_ in K]?: never };
export type Incremental<T> =
  | T
  | {
      [P in keyof T]?: P extends " $fragmentName" | "__typename" ? T[P] : never;
    };
const defaultOptions = {} as const;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string };
  String: { input: string; output: string };
  Boolean: { input: boolean; output: boolean };
  Int: { input: number; output: number };
  Float: { input: number; output: number };
  DateTime: { input: any; output: any };
};

export type AddSimulationWatchStockInput = {
  exchangeCode?: InputMaybe<Scalars["String"]["input"]>;
  market: Market;
  maxPortfolioRate?: InputMaybe<Scalars["Float"]["input"]>;
  quota?: InputMaybe<Scalars["Float"]["input"]>;
  sessionId: Scalars["String"]["input"];
  stockCode: Scalars["String"]["input"];
  stockName: Scalars["String"]["input"];
  stopLossRate?: InputMaybe<Scalars["Float"]["input"]>;
  strategyParams?: InputMaybe<Scalars["String"]["input"]>;
};

export type AuthPayload = {
  __typename?: "AuthPayload";
  success: Scalars["Boolean"]["output"];
};

export type CreateSimulationInput = {
  description?: InputMaybe<Scalars["String"]["input"]>;
  initialCapital: Scalars["Float"]["input"];
  market: Market;
  name: Scalars["String"]["input"];
  strategyName: Scalars["String"]["input"];
  watchStocks?: InputMaybe<Array<WatchStockInput>>;
};

export type CreateWatchStockInput = {
  exchangeCode?: InputMaybe<Scalars["String"]["input"]>;
  market: Market;
  maxCycles?: InputMaybe<Scalars["Int"]["input"]>;
  maxPortfolioRate?: InputMaybe<Scalars["Float"]["input"]>;
  quota?: InputMaybe<Scalars["Float"]["input"]>;
  stockCode: Scalars["String"]["input"];
  stockName: Scalars["String"]["input"];
  stopLossRate?: InputMaybe<Scalars["Float"]["input"]>;
  strategyName?: InputMaybe<Scalars["String"]["input"]>;
  strategyParams?: InputMaybe<Scalars["String"]["input"]>;
};

export type DashboardSummaryType = {
  __typename?: "DashboardSummaryType";
  todayTradeCount: Scalars["Int"]["output"];
  totalProfitLoss: Scalars["Float"]["output"];
  totalTradeCount: Scalars["Int"]["output"];
  winRate: Scalars["Float"]["output"];
};

export type Market = "DOMESTIC" | "OVERSEAS";

export type MarketRegimeType = {
  __typename?: "MarketRegimeType";
  exchangeCode: Scalars["String"]["output"];
  market: Scalars["String"]["output"];
  regime: Scalars["String"]["output"];
};

export type Mutation = {
  __typename?: "Mutation";
  addSimulationWatchStock: SimulationWatchStockType;
  createSimulation: SimulationSessionType;
  createWatchStock: WatchStockType;
  deleteSimulation: Scalars["Boolean"]["output"];
  deleteWatchStock: Scalars["Boolean"]["output"];
  login: AuthPayload;
  logout: AuthPayload;
  removeSimulationWatchStock: Scalars["Boolean"]["output"];
  resetSimulation: SimulationSessionType;
  setStrategyAllocation: StrategyAllocationType;
  updateSimulationStatus: SimulationSessionType;
  updateWatchStock: WatchStockType;
};

export type MutationAddSimulationWatchStockArgs = {
  input: AddSimulationWatchStockInput;
};

export type MutationCreateSimulationArgs = {
  input: CreateSimulationInput;
};

export type MutationCreateWatchStockArgs = {
  input: CreateWatchStockInput;
};

export type MutationDeleteSimulationArgs = {
  id: Scalars["String"]["input"];
};

export type MutationDeleteWatchStockArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationLoginArgs = {
  password: Scalars["String"]["input"];
  username: Scalars["String"]["input"];
};

export type MutationRemoveSimulationWatchStockArgs = {
  id: Scalars["String"]["input"];
};

export type MutationResetSimulationArgs = {
  id: Scalars["String"]["input"];
};

export type MutationSetStrategyAllocationArgs = {
  input: SetStrategyAllocationInput;
};

export type MutationUpdateSimulationStatusArgs = {
  id: Scalars["String"]["input"];
  status: SimulationStatus;
};

export type MutationUpdateWatchStockArgs = {
  id: Scalars["ID"]["input"];
  input: UpdateWatchStockInput;
};

export type OrderStatus =
  | "CANCELLED"
  | "FAILED"
  | "FILLED"
  | "PARTIAL"
  | "PENDING";

export type OrderType = "LIMIT" | "LOC" | "MARKET";

export type PositionType = {
  __typename?: "PositionType";
  avgPrice: Scalars["Float"]["output"];
  currentPrice: Scalars["Float"]["output"];
  exchangeCode?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  market: Market;
  profitLoss: Scalars["Float"]["output"];
  profitRate: Scalars["Float"]["output"];
  quantity: Scalars["Int"]["output"];
  stockCode: Scalars["String"]["output"];
  stockName: Scalars["String"]["output"];
  totalInvested: Scalars["Float"]["output"];
};

export type Query = {
  __typename?: "Query";
  availableStrategies: Array<StrategyInfo>;
  dashboardSummary: DashboardSummaryType;
  marketRegime: MarketRegimeType;
  overseasQuote?: Maybe<StockPriceType>;
  positions: Array<PositionType>;
  quote?: Maybe<StockPriceType>;
  riskState: RiskStateType;
  searchStocks: Array<StockSearchResult>;
  simulationMetrics: SimulationMetricsType;
  simulationPositions: Array<SimulationPositionType>;
  simulationSession?: Maybe<SimulationSessionType>;
  simulationSessions: Array<SimulationSessionType>;
  simulationSnapshots: Array<SimulationSnapshotType>;
  simulationTrades: Array<SimulationTradeType>;
  strategyAllocations: Array<StrategyAllocationType>;
  strategyExecutions: Array<StrategyExecutionType>;
  trade?: Maybe<TradeRecordType>;
  trades: Array<TradeRecordType>;
  watchStocks: Array<WatchStockType>;
};

export type QueryMarketRegimeArgs = {
  exchangeCode: Scalars["String"]["input"];
  market: Market;
};

export type QueryOverseasQuoteArgs = {
  exchangeCode: Scalars["String"]["input"];
  symbol: Scalars["String"]["input"];
};

export type QueryPositionsArgs = {
  market?: InputMaybe<Market>;
};

export type QueryQuoteArgs = {
  stockCode: Scalars["String"]["input"];
};

export type QueryRiskStateArgs = {
  market: Market;
};

export type QuerySearchStocksArgs = {
  keyword: Scalars["String"]["input"];
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  market?: InputMaybe<Market>;
};

export type QuerySimulationMetricsArgs = {
  sessionId: Scalars["String"]["input"];
};

export type QuerySimulationPositionsArgs = {
  sessionId: Scalars["String"]["input"];
};

export type QuerySimulationSessionArgs = {
  id: Scalars["String"]["input"];
};

export type QuerySimulationSessionsArgs = {
  status?: InputMaybe<SimulationStatus>;
};

export type QuerySimulationSnapshotsArgs = {
  sessionId: Scalars["String"]["input"];
};

export type QuerySimulationTradesArgs = {
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
  sessionId: Scalars["String"]["input"];
};

export type QueryStrategyAllocationsArgs = {
  market: Market;
};

export type QueryStrategyExecutionsArgs = {
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  stockCode?: InputMaybe<Scalars["String"]["input"]>;
  strategyName?: InputMaybe<Scalars["String"]["input"]>;
};

export type QueryTradeArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryTradesArgs = {
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  market?: InputMaybe<Market>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
  side?: InputMaybe<Side>;
};

export type QueryWatchStocksArgs = {
  market?: InputMaybe<Market>;
};

export type RiskStateType = {
  __typename?: "RiskStateType";
  buyBlocked: Scalars["Boolean"]["output"];
  dailyPnlRate: Scalars["Float"]["output"];
  drawdown: Scalars["Float"]["output"];
  investedRate: Scalars["Float"]["output"];
  liquidateAll: Scalars["Boolean"]["output"];
  positionCount: Scalars["Float"]["output"];
  reasons: Array<Scalars["String"]["output"]>;
};

export type SetStrategyAllocationInput = {
  allocationRate: Scalars["Float"]["input"];
  isActive?: InputMaybe<Scalars["Boolean"]["input"]>;
  market: Market;
  strategyName: Scalars["String"]["input"];
};

export type Side = "BUY" | "SELL";

export type SimulationMetricsType = {
  __typename?: "SimulationMetricsType";
  currentCash: Scalars["Float"]["output"];
  currentPortfolioValue: Scalars["Float"]["output"];
  lossTrades: Scalars["Int"]["output"];
  maxDrawdown: Scalars["Float"]["output"];
  profitFactor: Scalars["Float"]["output"];
  sharpeRatio: Scalars["Float"]["output"];
  totalReturn: Scalars["Float"]["output"];
  totalReturnAmount: Scalars["Float"]["output"];
  totalTrades: Scalars["Int"]["output"];
  winRate: Scalars["Float"]["output"];
  winTrades: Scalars["Int"]["output"];
};

export type SimulationPositionType = {
  __typename?: "SimulationPositionType";
  avgPrice: Scalars["Float"]["output"];
  currentPrice: Scalars["Float"]["output"];
  exchangeCode?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  market: Market;
  profitLoss: Scalars["Float"]["output"];
  profitRate: Scalars["Float"]["output"];
  quantity: Scalars["Int"]["output"];
  sessionId: Scalars["String"]["output"];
  stockCode: Scalars["String"]["output"];
  stockName: Scalars["String"]["output"];
  totalInvested: Scalars["Float"]["output"];
};

export type SimulationSessionType = {
  __typename?: "SimulationSessionType";
  createdAt: Scalars["DateTime"]["output"];
  currentCash: Scalars["Float"]["output"];
  description?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  initialCapital: Scalars["Float"]["output"];
  market: Market;
  name: Scalars["String"]["output"];
  startedAt: Scalars["DateTime"]["output"];
  status: SimulationStatus;
  stoppedAt?: Maybe<Scalars["DateTime"]["output"]>;
  strategyName: Scalars["String"]["output"];
  updatedAt: Scalars["DateTime"]["output"];
  watchStocks?: Maybe<Array<SimulationWatchStockType>>;
};

export type SimulationSnapshotType = {
  __typename?: "SimulationSnapshotType";
  cashBalance: Scalars["Float"]["output"];
  createdAt: Scalars["DateTime"]["output"];
  dailyPnl: Scalars["Float"]["output"];
  dailyPnlRate: Scalars["Float"]["output"];
  drawdown: Scalars["Float"]["output"];
  id: Scalars["ID"]["output"];
  peakValue: Scalars["Float"]["output"];
  portfolioValue: Scalars["Float"]["output"];
  positionCount: Scalars["Int"]["output"];
  sessionId: Scalars["String"]["output"];
  snapshotDate: Scalars["String"]["output"];
  totalValue: Scalars["Float"]["output"];
  tradeCount: Scalars["Int"]["output"];
};

export type SimulationStatus = "COMPLETED" | "PAUSED" | "RUNNING";

export type SimulationTradeType = {
  __typename?: "SimulationTradeType";
  createdAt: Scalars["DateTime"]["output"];
  exchangeCode?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  market: Market;
  price: Scalars["Float"]["output"];
  quantity: Scalars["Int"]["output"];
  reason?: Maybe<Scalars["String"]["output"]>;
  sessionId: Scalars["String"]["output"];
  side: Side;
  stockCode: Scalars["String"]["output"];
  stockName: Scalars["String"]["output"];
  strategyName?: Maybe<Scalars["String"]["output"]>;
  totalAmount: Scalars["Float"]["output"];
};

export type SimulationWatchStockType = {
  __typename?: "SimulationWatchStockType";
  cycle: Scalars["Int"]["output"];
  exchangeCode?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  isActive: Scalars["Boolean"]["output"];
  market: Market;
  maxCycles: Scalars["Int"]["output"];
  maxPortfolioRate: Scalars["Float"]["output"];
  quota?: Maybe<Scalars["Float"]["output"]>;
  sessionId: Scalars["String"]["output"];
  stockCode: Scalars["String"]["output"];
  stockName: Scalars["String"]["output"];
  stopLossRate: Scalars["Float"]["output"];
  strategyParams?: Maybe<Scalars["String"]["output"]>;
};

export type StockPriceType = {
  __typename?: "StockPriceType";
  currentPrice: Scalars["Float"]["output"];
  highPrice?: Maybe<Scalars["Float"]["output"]>;
  lowPrice?: Maybe<Scalars["Float"]["output"]>;
  openPrice?: Maybe<Scalars["Float"]["output"]>;
  stockCode: Scalars["String"]["output"];
  stockName: Scalars["String"]["output"];
  volume?: Maybe<Scalars["Int"]["output"]>;
};

export type StockSearchResult = {
  __typename?: "StockSearchResult";
  englishName?: Maybe<Scalars["String"]["output"]>;
  exchangeCode: Scalars["String"]["output"];
  market: Scalars["String"]["output"];
  stockCode: Scalars["String"]["output"];
  stockName: Scalars["String"]["output"];
};

export type StrategyAllocationType = {
  __typename?: "StrategyAllocationType";
  allocationRate: Scalars["Float"]["output"];
  id: Scalars["ID"]["output"];
  isActive: Scalars["Boolean"]["output"];
  market: Market;
  strategyName: Scalars["String"]["output"];
};

export type StrategyExecutionType = {
  __typename?: "StrategyExecutionType";
  createdAt: Scalars["DateTime"]["output"];
  details?: Maybe<Scalars["String"]["output"]>;
  executedDate: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  market: Market;
  progress: Scalars["Float"]["output"];
  signalCount: Scalars["Int"]["output"];
  stockCode: Scalars["String"]["output"];
  strategyName: Scalars["String"]["output"];
};

export type StrategyInfo = {
  __typename?: "StrategyInfo";
  description: Scalars["String"]["output"];
  displayName: Scalars["String"]["output"];
  name: Scalars["String"]["output"];
};

export type TradeRecordType = {
  __typename?: "TradeRecordType";
  createdAt: Scalars["DateTime"]["output"];
  exchangeCode?: Maybe<Scalars["String"]["output"]>;
  executedPrice?: Maybe<Scalars["Float"]["output"]>;
  executedQty?: Maybe<Scalars["Int"]["output"]>;
  id: Scalars["ID"]["output"];
  market: Market;
  orderNo?: Maybe<Scalars["String"]["output"]>;
  orderType: OrderType;
  price: Scalars["Float"]["output"];
  quantity: Scalars["Int"]["output"];
  reason?: Maybe<Scalars["String"]["output"]>;
  side: Side;
  status: OrderStatus;
  stockCode: Scalars["String"]["output"];
  stockName: Scalars["String"]["output"];
  strategyName?: Maybe<Scalars["String"]["output"]>;
};

export type UpdateWatchStockInput = {
  cycle?: InputMaybe<Scalars["Int"]["input"]>;
  exchangeCode?: InputMaybe<Scalars["String"]["input"]>;
  isActive?: InputMaybe<Scalars["Boolean"]["input"]>;
  maxCycles?: InputMaybe<Scalars["Int"]["input"]>;
  maxPortfolioRate?: InputMaybe<Scalars["Float"]["input"]>;
  quota?: InputMaybe<Scalars["Float"]["input"]>;
  stockName?: InputMaybe<Scalars["String"]["input"]>;
  stopLossRate?: InputMaybe<Scalars["Float"]["input"]>;
  strategyName?: InputMaybe<Scalars["String"]["input"]>;
  strategyParams?: InputMaybe<Scalars["String"]["input"]>;
};

export type WatchStockInput = {
  exchangeCode?: InputMaybe<Scalars["String"]["input"]>;
  market: Market;
  maxPortfolioRate?: InputMaybe<Scalars["Float"]["input"]>;
  quota?: InputMaybe<Scalars["Float"]["input"]>;
  stockCode: Scalars["String"]["input"];
  stockName: Scalars["String"]["input"];
  stopLossRate?: InputMaybe<Scalars["Float"]["input"]>;
  strategyParams?: InputMaybe<Scalars["String"]["input"]>;
};

export type WatchStockType = {
  __typename?: "WatchStockType";
  createdAt: Scalars["DateTime"]["output"];
  cycle: Scalars["Int"]["output"];
  exchangeCode?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  isActive: Scalars["Boolean"]["output"];
  market: Market;
  maxCycles: Scalars["Int"]["output"];
  maxPortfolioRate: Scalars["Float"]["output"];
  quota?: Maybe<Scalars["Float"]["output"]>;
  stockCode: Scalars["String"]["output"];
  stockName: Scalars["String"]["output"];
  stopLossRate: Scalars["Float"]["output"];
  strategyName?: Maybe<Scalars["String"]["output"]>;
  strategyParams?: Maybe<Scalars["String"]["output"]>;
  updatedAt: Scalars["DateTime"]["output"];
};

export type LoginMutationVariables = Exact<{
  username: Scalars["String"]["input"];
  password: Scalars["String"]["input"];
}>;

export type LoginMutation = {
  __typename?: "Mutation";
  login: { __typename?: "AuthPayload"; success: boolean };
};

export type LogoutMutationVariables = Exact<{ [key: string]: never }>;

export type LogoutMutation = {
  __typename?: "Mutation";
  logout: { __typename?: "AuthPayload"; success: boolean };
};

export type GetSimulationSessionsQueryVariables = Exact<{
  status?: InputMaybe<SimulationStatus>;
}>;

export type GetSimulationSessionsQuery = {
  __typename?: "Query";
  simulationSessions: Array<{
    __typename?: "SimulationSessionType";
    id: string;
    name: string;
    description?: string | null;
    market: Market;
    strategyName: string;
    status: SimulationStatus;
    initialCapital: number;
    currentCash: number;
    startedAt: any;
    stoppedAt?: any | null;
    createdAt: any;
    watchStocks?: Array<{
      __typename?: "SimulationWatchStockType";
      id: string;
      stockCode: string;
      stockName: string;
      market: Market;
      exchangeCode?: string | null;
      quota?: number | null;
      cycle: number;
      maxCycles: number;
      stopLossRate: number;
      maxPortfolioRate: number;
      isActive: boolean;
    }> | null;
  }>;
};

export type GetSimulationSessionQueryVariables = Exact<{
  id: Scalars["String"]["input"];
}>;

export type GetSimulationSessionQuery = {
  __typename?: "Query";
  simulationSession?: {
    __typename?: "SimulationSessionType";
    id: string;
    name: string;
    description?: string | null;
    market: Market;
    strategyName: string;
    status: SimulationStatus;
    initialCapital: number;
    currentCash: number;
    startedAt: any;
    stoppedAt?: any | null;
    createdAt: any;
    watchStocks?: Array<{
      __typename?: "SimulationWatchStockType";
      id: string;
      stockCode: string;
      stockName: string;
      market: Market;
      exchangeCode?: string | null;
      quota?: number | null;
      cycle: number;
      maxCycles: number;
      stopLossRate: number;
      maxPortfolioRate: number;
      strategyParams?: string | null;
      isActive: boolean;
    }> | null;
  } | null;
};

export type GetSimulationPositionsQueryVariables = Exact<{
  sessionId: Scalars["String"]["input"];
}>;

export type GetSimulationPositionsQuery = {
  __typename?: "Query";
  simulationPositions: Array<{
    __typename?: "SimulationPositionType";
    id: string;
    market: Market;
    exchangeCode?: string | null;
    stockCode: string;
    stockName: string;
    quantity: number;
    avgPrice: number;
    currentPrice: number;
    totalInvested: number;
    profitLoss: number;
    profitRate: number;
  }>;
};

export type GetSimulationTradesQueryVariables = Exact<{
  sessionId: Scalars["String"]["input"];
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
}>;

export type GetSimulationTradesQuery = {
  __typename?: "Query";
  simulationTrades: Array<{
    __typename?: "SimulationTradeType";
    id: string;
    market: Market;
    exchangeCode?: string | null;
    stockCode: string;
    stockName: string;
    side: Side;
    quantity: number;
    price: number;
    totalAmount: number;
    strategyName?: string | null;
    reason?: string | null;
    createdAt: any;
  }>;
};

export type GetSimulationSnapshotsQueryVariables = Exact<{
  sessionId: Scalars["String"]["input"];
}>;

export type GetSimulationSnapshotsQuery = {
  __typename?: "Query";
  simulationSnapshots: Array<{
    __typename?: "SimulationSnapshotType";
    id: string;
    snapshotDate: string;
    portfolioValue: number;
    cashBalance: number;
    totalValue: number;
    dailyPnl: number;
    dailyPnlRate: number;
    drawdown: number;
    peakValue: number;
    positionCount: number;
    tradeCount: number;
  }>;
};

export type GetSimulationMetricsQueryVariables = Exact<{
  sessionId: Scalars["String"]["input"];
}>;

export type GetSimulationMetricsQuery = {
  __typename?: "Query";
  simulationMetrics: {
    __typename?: "SimulationMetricsType";
    totalReturn: number;
    totalReturnAmount: number;
    maxDrawdown: number;
    winRate: number;
    totalTrades: number;
    winTrades: number;
    lossTrades: number;
    sharpeRatio: number;
    profitFactor: number;
    currentCash: number;
    currentPortfolioValue: number;
  };
};

export type CreateSimulationMutationVariables = Exact<{
  input: CreateSimulationInput;
}>;

export type CreateSimulationMutation = {
  __typename?: "Mutation";
  createSimulation: {
    __typename?: "SimulationSessionType";
    id: string;
    name: string;
    market: Market;
    strategyName: string;
    status: SimulationStatus;
    initialCapital: number;
    currentCash: number;
  };
};

export type AddSimulationWatchStockMutationVariables = Exact<{
  input: AddSimulationWatchStockInput;
}>;

export type AddSimulationWatchStockMutation = {
  __typename?: "Mutation";
  addSimulationWatchStock: {
    __typename?: "SimulationWatchStockType";
    id: string;
    stockCode: string;
    stockName: string;
    market: Market;
    exchangeCode?: string | null;
    quota?: number | null;
    isActive: boolean;
  };
};

export type RemoveSimulationWatchStockMutationVariables = Exact<{
  id: Scalars["String"]["input"];
}>;

export type RemoveSimulationWatchStockMutation = {
  __typename?: "Mutation";
  removeSimulationWatchStock: boolean;
};

export type UpdateSimulationStatusMutationVariables = Exact<{
  id: Scalars["String"]["input"];
  status: SimulationStatus;
}>;

export type UpdateSimulationStatusMutation = {
  __typename?: "Mutation";
  updateSimulationStatus: {
    __typename?: "SimulationSessionType";
    id: string;
    status: SimulationStatus;
    stoppedAt?: any | null;
  };
};

export type ResetSimulationMutationVariables = Exact<{
  id: Scalars["String"]["input"];
}>;

export type ResetSimulationMutation = {
  __typename?: "Mutation";
  resetSimulation: {
    __typename?: "SimulationSessionType";
    id: string;
    status: SimulationStatus;
    currentCash: number;
    initialCapital: number;
  };
};

export type DeleteSimulationMutationVariables = Exact<{
  id: Scalars["String"]["input"];
}>;

export type DeleteSimulationMutation = {
  __typename?: "Mutation";
  deleteSimulation: boolean;
};

export type SearchStocksQueryVariables = Exact<{
  keyword: Scalars["String"]["input"];
  market?: InputMaybe<Market>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
}>;

export type SearchStocksQuery = {
  __typename?: "Query";
  searchStocks: Array<{
    __typename?: "StockSearchResult";
    stockCode: string;
    stockName: string;
    englishName?: string | null;
    market: string;
    exchangeCode: string;
  }>;
};

export type GetTradesQueryVariables = Exact<{
  market?: InputMaybe<Market>;
  side?: InputMaybe<Side>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
}>;

export type GetTradesQuery = {
  __typename?: "Query";
  trades: Array<{
    __typename?: "TradeRecordType";
    id: string;
    market: Market;
    exchangeCode?: string | null;
    stockCode: string;
    stockName: string;
    side: Side;
    orderType: OrderType;
    quantity: number;
    price: number;
    executedPrice?: number | null;
    executedQty?: number | null;
    orderNo?: string | null;
    status: OrderStatus;
    strategyName?: string | null;
    reason?: string | null;
    createdAt: any;
  }>;
};

export type GetTradeQueryVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type GetTradeQuery = {
  __typename?: "Query";
  trade?: {
    __typename?: "TradeRecordType";
    id: string;
    market: Market;
    exchangeCode?: string | null;
    stockCode: string;
    stockName: string;
    side: Side;
    orderType: OrderType;
    quantity: number;
    price: number;
    executedPrice?: number | null;
    executedQty?: number | null;
    orderNo?: string | null;
    status: OrderStatus;
    strategyName?: string | null;
    reason?: string | null;
    createdAt: any;
  } | null;
};

export type GetPositionsQueryVariables = Exact<{
  market?: InputMaybe<Market>;
}>;

export type GetPositionsQuery = {
  __typename?: "Query";
  positions: Array<{
    __typename?: "PositionType";
    id: string;
    market: Market;
    exchangeCode?: string | null;
    stockCode: string;
    stockName: string;
    quantity: number;
    avgPrice: number;
    currentPrice: number;
    profitLoss: number;
    profitRate: number;
    totalInvested: number;
  }>;
};

export type GetQuoteQueryVariables = Exact<{
  stockCode: Scalars["String"]["input"];
}>;

export type GetQuoteQuery = {
  __typename?: "Query";
  quote?: {
    __typename?: "StockPriceType";
    stockCode: string;
    stockName: string;
    currentPrice: number;
    openPrice?: number | null;
    highPrice?: number | null;
    lowPrice?: number | null;
    volume?: number | null;
  } | null;
};

export type GetOverseasQuoteQueryVariables = Exact<{
  exchangeCode: Scalars["String"]["input"];
  symbol: Scalars["String"]["input"];
}>;

export type GetOverseasQuoteQuery = {
  __typename?: "Query";
  overseasQuote?: {
    __typename?: "StockPriceType";
    stockCode: string;
    stockName: string;
    currentPrice: number;
    openPrice?: number | null;
    highPrice?: number | null;
    lowPrice?: number | null;
    volume?: number | null;
  } | null;
};

export type GetDashboardSummaryQueryVariables = Exact<{ [key: string]: never }>;

export type GetDashboardSummaryQuery = {
  __typename?: "Query";
  dashboardSummary: {
    __typename?: "DashboardSummaryType";
    totalProfitLoss: number;
    totalTradeCount: number;
    todayTradeCount: number;
    winRate: number;
  };
};

export type GetStrategyExecutionsQueryVariables = Exact<{
  stockCode?: InputMaybe<Scalars["String"]["input"]>;
  strategyName?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
}>;

export type GetStrategyExecutionsQuery = {
  __typename?: "Query";
  strategyExecutions: Array<{
    __typename?: "StrategyExecutionType";
    id: string;
    market: Market;
    stockCode: string;
    strategyName: string;
    executedDate: string;
    progress: number;
    signalCount: number;
    details?: string | null;
    createdAt: any;
  }>;
};

export type GetAvailableStrategiesQueryVariables = Exact<{
  [key: string]: never;
}>;

export type GetAvailableStrategiesQuery = {
  __typename?: "Query";
  availableStrategies: Array<{
    __typename?: "StrategyInfo";
    name: string;
    displayName: string;
    description: string;
  }>;
};

export type GetMarketRegimeQueryVariables = Exact<{
  market: Market;
  exchangeCode: Scalars["String"]["input"];
}>;

export type GetMarketRegimeQuery = {
  __typename?: "Query";
  marketRegime: {
    __typename?: "MarketRegimeType";
    regime: string;
    market: string;
    exchangeCode: string;
  };
};

export type GetRiskStateQueryVariables = Exact<{
  market: Market;
}>;

export type GetRiskStateQuery = {
  __typename?: "Query";
  riskState: {
    __typename?: "RiskStateType";
    buyBlocked: boolean;
    liquidateAll: boolean;
    positionCount: number;
    investedRate: number;
    dailyPnlRate: number;
    drawdown: number;
    reasons: Array<string>;
  };
};

export type GetWatchStocksQueryVariables = Exact<{
  market?: InputMaybe<Market>;
}>;

export type GetWatchStocksQuery = {
  __typename?: "Query";
  watchStocks: Array<{
    __typename?: "WatchStockType";
    id: string;
    market: Market;
    exchangeCode?: string | null;
    stockCode: string;
    stockName: string;
    isActive: boolean;
    strategyName?: string | null;
    quota?: number | null;
    cycle: number;
    maxCycles: number;
    stopLossRate: number;
    maxPortfolioRate: number;
    strategyParams?: string | null;
    createdAt: any;
    updatedAt: any;
  }>;
};

export type CreateWatchStockMutationVariables = Exact<{
  input: CreateWatchStockInput;
}>;

export type CreateWatchStockMutation = {
  __typename?: "Mutation";
  createWatchStock: {
    __typename?: "WatchStockType";
    id: string;
    market: Market;
    exchangeCode?: string | null;
    stockCode: string;
    stockName: string;
    isActive: boolean;
    strategyName?: string | null;
    quota?: number | null;
    cycle: number;
    maxCycles: number;
    stopLossRate: number;
    maxPortfolioRate: number;
    strategyParams?: string | null;
    createdAt: any;
    updatedAt: any;
  };
};

export type UpdateWatchStockMutationVariables = Exact<{
  id: Scalars["ID"]["input"];
  input: UpdateWatchStockInput;
}>;

export type UpdateWatchStockMutation = {
  __typename?: "Mutation";
  updateWatchStock: {
    __typename?: "WatchStockType";
    id: string;
    market: Market;
    exchangeCode?: string | null;
    stockCode: string;
    stockName: string;
    isActive: boolean;
    strategyName?: string | null;
    quota?: number | null;
    cycle: number;
    maxCycles: number;
    stopLossRate: number;
    maxPortfolioRate: number;
    strategyParams?: string | null;
    createdAt: any;
    updatedAt: any;
  };
};

export type DeleteWatchStockMutationVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type DeleteWatchStockMutation = {
  __typename?: "Mutation";
  deleteWatchStock: boolean;
};

export const LoginDocument = gql`
  mutation Login($username: String!, $password: String!) {
    login(username: $username, password: $password) {
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
 *      username: // value for 'username'
 *      password: // value for 'password'
 *   },
 * });
 */
export function useLoginMutation(
  baseOptions?: ApolloReactHooks.MutationHookOptions<
    LoginMutation,
    LoginMutationVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useMutation<LoginMutation, LoginMutationVariables>(
    LoginDocument,
    options,
  );
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
export function useLogoutMutation(
  baseOptions?: ApolloReactHooks.MutationHookOptions<
    LogoutMutation,
    LogoutMutationVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useMutation<LogoutMutation, LogoutMutationVariables>(
    LogoutDocument,
    options,
  );
}
export type LogoutMutationHookResult = ReturnType<typeof useLogoutMutation>;
export const GetSimulationSessionsDocument = gql`
  query GetSimulationSessions($status: SimulationStatus) {
    simulationSessions(status: $status) {
      id
      name
      description
      market
      strategyName
      status
      initialCapital
      currentCash
      startedAt
      stoppedAt
      createdAt
      watchStocks {
        id
        stockCode
        stockName
        market
        exchangeCode
        quota
        cycle
        maxCycles
        stopLossRate
        maxPortfolioRate
        isActive
      }
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
 *      status: // value for 'status'
 *   },
 * });
 */
export function useGetSimulationSessionsQuery(
  baseOptions?: ApolloReactHooks.QueryHookOptions<
    GetSimulationSessionsQuery,
    GetSimulationSessionsQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useQuery<
    GetSimulationSessionsQuery,
    GetSimulationSessionsQueryVariables
  >(GetSimulationSessionsDocument, options);
}
export function useGetSimulationSessionsLazyQuery(
  baseOptions?: ApolloReactHooks.LazyQueryHookOptions<
    GetSimulationSessionsQuery,
    GetSimulationSessionsQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useLazyQuery<
    GetSimulationSessionsQuery,
    GetSimulationSessionsQueryVariables
  >(GetSimulationSessionsDocument, options);
}
// @ts-ignore
export function useGetSimulationSessionsSuspenseQuery(
  baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<
    GetSimulationSessionsQuery,
    GetSimulationSessionsQueryVariables
  >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetSimulationSessionsQuery,
  GetSimulationSessionsQueryVariables
>;
export function useGetSimulationSessionsSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetSimulationSessionsQuery,
        GetSimulationSessionsQueryVariables
      >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetSimulationSessionsQuery | undefined,
  GetSimulationSessionsQueryVariables
>;
export function useGetSimulationSessionsSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetSimulationSessionsQuery,
        GetSimulationSessionsQueryVariables
      >,
) {
  const options =
    baseOptions === ApolloReactHooks.skipToken
      ? baseOptions
      : { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useSuspenseQuery<
    GetSimulationSessionsQuery,
    GetSimulationSessionsQueryVariables
  >(GetSimulationSessionsDocument, options);
}
export type GetSimulationSessionsQueryHookResult = ReturnType<
  typeof useGetSimulationSessionsQuery
>;
export type GetSimulationSessionsLazyQueryHookResult = ReturnType<
  typeof useGetSimulationSessionsLazyQuery
>;
export type GetSimulationSessionsSuspenseQueryHookResult = ReturnType<
  typeof useGetSimulationSessionsSuspenseQuery
>;
export const GetSimulationSessionDocument = gql`
  query GetSimulationSession($id: String!) {
    simulationSession(id: $id) {
      id
      name
      description
      market
      strategyName
      status
      initialCapital
      currentCash
      startedAt
      stoppedAt
      createdAt
      watchStocks {
        id
        stockCode
        stockName
        market
        exchangeCode
        quota
        cycle
        maxCycles
        stopLossRate
        maxPortfolioRate
        strategyParams
        isActive
      }
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
export function useGetSimulationSessionQuery(
  baseOptions: ApolloReactHooks.QueryHookOptions<
    GetSimulationSessionQuery,
    GetSimulationSessionQueryVariables
  > &
    (
      | { variables: GetSimulationSessionQueryVariables; skip?: boolean }
      | { skip: boolean }
    ),
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useQuery<
    GetSimulationSessionQuery,
    GetSimulationSessionQueryVariables
  >(GetSimulationSessionDocument, options);
}
export function useGetSimulationSessionLazyQuery(
  baseOptions?: ApolloReactHooks.LazyQueryHookOptions<
    GetSimulationSessionQuery,
    GetSimulationSessionQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useLazyQuery<
    GetSimulationSessionQuery,
    GetSimulationSessionQueryVariables
  >(GetSimulationSessionDocument, options);
}
// @ts-ignore
export function useGetSimulationSessionSuspenseQuery(
  baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<
    GetSimulationSessionQuery,
    GetSimulationSessionQueryVariables
  >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetSimulationSessionQuery,
  GetSimulationSessionQueryVariables
>;
export function useGetSimulationSessionSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetSimulationSessionQuery,
        GetSimulationSessionQueryVariables
      >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetSimulationSessionQuery | undefined,
  GetSimulationSessionQueryVariables
>;
export function useGetSimulationSessionSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetSimulationSessionQuery,
        GetSimulationSessionQueryVariables
      >,
) {
  const options =
    baseOptions === ApolloReactHooks.skipToken
      ? baseOptions
      : { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useSuspenseQuery<
    GetSimulationSessionQuery,
    GetSimulationSessionQueryVariables
  >(GetSimulationSessionDocument, options);
}
export type GetSimulationSessionQueryHookResult = ReturnType<
  typeof useGetSimulationSessionQuery
>;
export type GetSimulationSessionLazyQueryHookResult = ReturnType<
  typeof useGetSimulationSessionLazyQuery
>;
export type GetSimulationSessionSuspenseQueryHookResult = ReturnType<
  typeof useGetSimulationSessionSuspenseQuery
>;
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
export function useGetSimulationPositionsQuery(
  baseOptions: ApolloReactHooks.QueryHookOptions<
    GetSimulationPositionsQuery,
    GetSimulationPositionsQueryVariables
  > &
    (
      | { variables: GetSimulationPositionsQueryVariables; skip?: boolean }
      | { skip: boolean }
    ),
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useQuery<
    GetSimulationPositionsQuery,
    GetSimulationPositionsQueryVariables
  >(GetSimulationPositionsDocument, options);
}
export function useGetSimulationPositionsLazyQuery(
  baseOptions?: ApolloReactHooks.LazyQueryHookOptions<
    GetSimulationPositionsQuery,
    GetSimulationPositionsQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useLazyQuery<
    GetSimulationPositionsQuery,
    GetSimulationPositionsQueryVariables
  >(GetSimulationPositionsDocument, options);
}
// @ts-ignore
export function useGetSimulationPositionsSuspenseQuery(
  baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<
    GetSimulationPositionsQuery,
    GetSimulationPositionsQueryVariables
  >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetSimulationPositionsQuery,
  GetSimulationPositionsQueryVariables
>;
export function useGetSimulationPositionsSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetSimulationPositionsQuery,
        GetSimulationPositionsQueryVariables
      >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetSimulationPositionsQuery | undefined,
  GetSimulationPositionsQueryVariables
>;
export function useGetSimulationPositionsSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetSimulationPositionsQuery,
        GetSimulationPositionsQueryVariables
      >,
) {
  const options =
    baseOptions === ApolloReactHooks.skipToken
      ? baseOptions
      : { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useSuspenseQuery<
    GetSimulationPositionsQuery,
    GetSimulationPositionsQueryVariables
  >(GetSimulationPositionsDocument, options);
}
export type GetSimulationPositionsQueryHookResult = ReturnType<
  typeof useGetSimulationPositionsQuery
>;
export type GetSimulationPositionsLazyQueryHookResult = ReturnType<
  typeof useGetSimulationPositionsLazyQuery
>;
export type GetSimulationPositionsSuspenseQueryHookResult = ReturnType<
  typeof useGetSimulationPositionsSuspenseQuery
>;
export const GetSimulationTradesDocument = gql`
  query GetSimulationTrades($sessionId: String!, $limit: Int, $offset: Int) {
    simulationTrades(sessionId: $sessionId, limit: $limit, offset: $offset) {
      id
      market
      exchangeCode
      stockCode
      stockName
      side
      quantity
      price
      totalAmount
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
 *      sessionId: // value for 'sessionId'
 *      limit: // value for 'limit'
 *      offset: // value for 'offset'
 *   },
 * });
 */
export function useGetSimulationTradesQuery(
  baseOptions: ApolloReactHooks.QueryHookOptions<
    GetSimulationTradesQuery,
    GetSimulationTradesQueryVariables
  > &
    (
      | { variables: GetSimulationTradesQueryVariables; skip?: boolean }
      | { skip: boolean }
    ),
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useQuery<
    GetSimulationTradesQuery,
    GetSimulationTradesQueryVariables
  >(GetSimulationTradesDocument, options);
}
export function useGetSimulationTradesLazyQuery(
  baseOptions?: ApolloReactHooks.LazyQueryHookOptions<
    GetSimulationTradesQuery,
    GetSimulationTradesQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useLazyQuery<
    GetSimulationTradesQuery,
    GetSimulationTradesQueryVariables
  >(GetSimulationTradesDocument, options);
}
// @ts-ignore
export function useGetSimulationTradesSuspenseQuery(
  baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<
    GetSimulationTradesQuery,
    GetSimulationTradesQueryVariables
  >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetSimulationTradesQuery,
  GetSimulationTradesQueryVariables
>;
export function useGetSimulationTradesSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetSimulationTradesQuery,
        GetSimulationTradesQueryVariables
      >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetSimulationTradesQuery | undefined,
  GetSimulationTradesQueryVariables
>;
export function useGetSimulationTradesSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetSimulationTradesQuery,
        GetSimulationTradesQueryVariables
      >,
) {
  const options =
    baseOptions === ApolloReactHooks.skipToken
      ? baseOptions
      : { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useSuspenseQuery<
    GetSimulationTradesQuery,
    GetSimulationTradesQueryVariables
  >(GetSimulationTradesDocument, options);
}
export type GetSimulationTradesQueryHookResult = ReturnType<
  typeof useGetSimulationTradesQuery
>;
export type GetSimulationTradesLazyQueryHookResult = ReturnType<
  typeof useGetSimulationTradesLazyQuery
>;
export type GetSimulationTradesSuspenseQueryHookResult = ReturnType<
  typeof useGetSimulationTradesSuspenseQuery
>;
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
export function useGetSimulationSnapshotsQuery(
  baseOptions: ApolloReactHooks.QueryHookOptions<
    GetSimulationSnapshotsQuery,
    GetSimulationSnapshotsQueryVariables
  > &
    (
      | { variables: GetSimulationSnapshotsQueryVariables; skip?: boolean }
      | { skip: boolean }
    ),
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useQuery<
    GetSimulationSnapshotsQuery,
    GetSimulationSnapshotsQueryVariables
  >(GetSimulationSnapshotsDocument, options);
}
export function useGetSimulationSnapshotsLazyQuery(
  baseOptions?: ApolloReactHooks.LazyQueryHookOptions<
    GetSimulationSnapshotsQuery,
    GetSimulationSnapshotsQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useLazyQuery<
    GetSimulationSnapshotsQuery,
    GetSimulationSnapshotsQueryVariables
  >(GetSimulationSnapshotsDocument, options);
}
// @ts-ignore
export function useGetSimulationSnapshotsSuspenseQuery(
  baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<
    GetSimulationSnapshotsQuery,
    GetSimulationSnapshotsQueryVariables
  >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetSimulationSnapshotsQuery,
  GetSimulationSnapshotsQueryVariables
>;
export function useGetSimulationSnapshotsSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetSimulationSnapshotsQuery,
        GetSimulationSnapshotsQueryVariables
      >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetSimulationSnapshotsQuery | undefined,
  GetSimulationSnapshotsQueryVariables
>;
export function useGetSimulationSnapshotsSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetSimulationSnapshotsQuery,
        GetSimulationSnapshotsQueryVariables
      >,
) {
  const options =
    baseOptions === ApolloReactHooks.skipToken
      ? baseOptions
      : { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useSuspenseQuery<
    GetSimulationSnapshotsQuery,
    GetSimulationSnapshotsQueryVariables
  >(GetSimulationSnapshotsDocument, options);
}
export type GetSimulationSnapshotsQueryHookResult = ReturnType<
  typeof useGetSimulationSnapshotsQuery
>;
export type GetSimulationSnapshotsLazyQueryHookResult = ReturnType<
  typeof useGetSimulationSnapshotsLazyQuery
>;
export type GetSimulationSnapshotsSuspenseQueryHookResult = ReturnType<
  typeof useGetSimulationSnapshotsSuspenseQuery
>;
export const GetSimulationMetricsDocument = gql`
  query GetSimulationMetrics($sessionId: String!) {
    simulationMetrics(sessionId: $sessionId) {
      totalReturn
      totalReturnAmount
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
export function useGetSimulationMetricsQuery(
  baseOptions: ApolloReactHooks.QueryHookOptions<
    GetSimulationMetricsQuery,
    GetSimulationMetricsQueryVariables
  > &
    (
      | { variables: GetSimulationMetricsQueryVariables; skip?: boolean }
      | { skip: boolean }
    ),
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useQuery<
    GetSimulationMetricsQuery,
    GetSimulationMetricsQueryVariables
  >(GetSimulationMetricsDocument, options);
}
export function useGetSimulationMetricsLazyQuery(
  baseOptions?: ApolloReactHooks.LazyQueryHookOptions<
    GetSimulationMetricsQuery,
    GetSimulationMetricsQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useLazyQuery<
    GetSimulationMetricsQuery,
    GetSimulationMetricsQueryVariables
  >(GetSimulationMetricsDocument, options);
}
// @ts-ignore
export function useGetSimulationMetricsSuspenseQuery(
  baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<
    GetSimulationMetricsQuery,
    GetSimulationMetricsQueryVariables
  >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetSimulationMetricsQuery,
  GetSimulationMetricsQueryVariables
>;
export function useGetSimulationMetricsSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetSimulationMetricsQuery,
        GetSimulationMetricsQueryVariables
      >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetSimulationMetricsQuery | undefined,
  GetSimulationMetricsQueryVariables
>;
export function useGetSimulationMetricsSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetSimulationMetricsQuery,
        GetSimulationMetricsQueryVariables
      >,
) {
  const options =
    baseOptions === ApolloReactHooks.skipToken
      ? baseOptions
      : { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useSuspenseQuery<
    GetSimulationMetricsQuery,
    GetSimulationMetricsQueryVariables
  >(GetSimulationMetricsDocument, options);
}
export type GetSimulationMetricsQueryHookResult = ReturnType<
  typeof useGetSimulationMetricsQuery
>;
export type GetSimulationMetricsLazyQueryHookResult = ReturnType<
  typeof useGetSimulationMetricsLazyQuery
>;
export type GetSimulationMetricsSuspenseQueryHookResult = ReturnType<
  typeof useGetSimulationMetricsSuspenseQuery
>;
export const CreateSimulationDocument = gql`
  mutation CreateSimulation($input: CreateSimulationInput!) {
    createSimulation(input: $input) {
      id
      name
      market
      strategyName
      status
      initialCapital
      currentCash
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
export function useCreateSimulationMutation(
  baseOptions?: ApolloReactHooks.MutationHookOptions<
    CreateSimulationMutation,
    CreateSimulationMutationVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useMutation<
    CreateSimulationMutation,
    CreateSimulationMutationVariables
  >(CreateSimulationDocument, options);
}
export type CreateSimulationMutationHookResult = ReturnType<
  typeof useCreateSimulationMutation
>;
export const AddSimulationWatchStockDocument = gql`
  mutation AddSimulationWatchStock($input: AddSimulationWatchStockInput!) {
    addSimulationWatchStock(input: $input) {
      id
      stockCode
      stockName
      market
      exchangeCode
      quota
      isActive
    }
  }
`;

/**
 * __useAddSimulationWatchStockMutation__
 *
 * To run a mutation, you first call `useAddSimulationWatchStockMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useAddSimulationWatchStockMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [addSimulationWatchStockMutation, { data, loading, error }] = useAddSimulationWatchStockMutation({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useAddSimulationWatchStockMutation(
  baseOptions?: ApolloReactHooks.MutationHookOptions<
    AddSimulationWatchStockMutation,
    AddSimulationWatchStockMutationVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useMutation<
    AddSimulationWatchStockMutation,
    AddSimulationWatchStockMutationVariables
  >(AddSimulationWatchStockDocument, options);
}
export type AddSimulationWatchStockMutationHookResult = ReturnType<
  typeof useAddSimulationWatchStockMutation
>;
export const RemoveSimulationWatchStockDocument = gql`
  mutation RemoveSimulationWatchStock($id: String!) {
    removeSimulationWatchStock(id: $id)
  }
`;

/**
 * __useRemoveSimulationWatchStockMutation__
 *
 * To run a mutation, you first call `useRemoveSimulationWatchStockMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useRemoveSimulationWatchStockMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [removeSimulationWatchStockMutation, { data, loading, error }] = useRemoveSimulationWatchStockMutation({
 *   variables: {
 *      id: // value for 'id'
 *   },
 * });
 */
export function useRemoveSimulationWatchStockMutation(
  baseOptions?: ApolloReactHooks.MutationHookOptions<
    RemoveSimulationWatchStockMutation,
    RemoveSimulationWatchStockMutationVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useMutation<
    RemoveSimulationWatchStockMutation,
    RemoveSimulationWatchStockMutationVariables
  >(RemoveSimulationWatchStockDocument, options);
}
export type RemoveSimulationWatchStockMutationHookResult = ReturnType<
  typeof useRemoveSimulationWatchStockMutation
>;
export const UpdateSimulationStatusDocument = gql`
  mutation UpdateSimulationStatus($id: String!, $status: SimulationStatus!) {
    updateSimulationStatus(id: $id, status: $status) {
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
 *      id: // value for 'id'
 *      status: // value for 'status'
 *   },
 * });
 */
export function useUpdateSimulationStatusMutation(
  baseOptions?: ApolloReactHooks.MutationHookOptions<
    UpdateSimulationStatusMutation,
    UpdateSimulationStatusMutationVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useMutation<
    UpdateSimulationStatusMutation,
    UpdateSimulationStatusMutationVariables
  >(UpdateSimulationStatusDocument, options);
}
export type UpdateSimulationStatusMutationHookResult = ReturnType<
  typeof useUpdateSimulationStatusMutation
>;
export const ResetSimulationDocument = gql`
  mutation ResetSimulation($id: String!) {
    resetSimulation(id: $id) {
      id
      status
      currentCash
      initialCapital
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
export function useResetSimulationMutation(
  baseOptions?: ApolloReactHooks.MutationHookOptions<
    ResetSimulationMutation,
    ResetSimulationMutationVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useMutation<
    ResetSimulationMutation,
    ResetSimulationMutationVariables
  >(ResetSimulationDocument, options);
}
export type ResetSimulationMutationHookResult = ReturnType<
  typeof useResetSimulationMutation
>;
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
export function useDeleteSimulationMutation(
  baseOptions?: ApolloReactHooks.MutationHookOptions<
    DeleteSimulationMutation,
    DeleteSimulationMutationVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useMutation<
    DeleteSimulationMutation,
    DeleteSimulationMutationVariables
  >(DeleteSimulationDocument, options);
}
export type DeleteSimulationMutationHookResult = ReturnType<
  typeof useDeleteSimulationMutation
>;
export const SearchStocksDocument = gql`
  query SearchStocks($keyword: String!, $market: Market, $limit: Int) {
    searchStocks(keyword: $keyword, market: $market, limit: $limit) {
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
 *      keyword: // value for 'keyword'
 *      market: // value for 'market'
 *      limit: // value for 'limit'
 *   },
 * });
 */
export function useSearchStocksQuery(
  baseOptions: ApolloReactHooks.QueryHookOptions<
    SearchStocksQuery,
    SearchStocksQueryVariables
  > &
    (
      | { variables: SearchStocksQueryVariables; skip?: boolean }
      | { skip: boolean }
    ),
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useQuery<
    SearchStocksQuery,
    SearchStocksQueryVariables
  >(SearchStocksDocument, options);
}
export function useSearchStocksLazyQuery(
  baseOptions?: ApolloReactHooks.LazyQueryHookOptions<
    SearchStocksQuery,
    SearchStocksQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useLazyQuery<
    SearchStocksQuery,
    SearchStocksQueryVariables
  >(SearchStocksDocument, options);
}
// @ts-ignore
export function useSearchStocksSuspenseQuery(
  baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<
    SearchStocksQuery,
    SearchStocksQueryVariables
  >,
): ApolloReactHooks.UseSuspenseQueryResult<
  SearchStocksQuery,
  SearchStocksQueryVariables
>;
export function useSearchStocksSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        SearchStocksQuery,
        SearchStocksQueryVariables
      >,
): ApolloReactHooks.UseSuspenseQueryResult<
  SearchStocksQuery | undefined,
  SearchStocksQueryVariables
>;
export function useSearchStocksSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        SearchStocksQuery,
        SearchStocksQueryVariables
      >,
) {
  const options =
    baseOptions === ApolloReactHooks.skipToken
      ? baseOptions
      : { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useSuspenseQuery<
    SearchStocksQuery,
    SearchStocksQueryVariables
  >(SearchStocksDocument, options);
}
export type SearchStocksQueryHookResult = ReturnType<
  typeof useSearchStocksQuery
>;
export type SearchStocksLazyQueryHookResult = ReturnType<
  typeof useSearchStocksLazyQuery
>;
export type SearchStocksSuspenseQueryHookResult = ReturnType<
  typeof useSearchStocksSuspenseQuery
>;
export const GetTradesDocument = gql`
  query GetTrades($market: Market, $side: Side, $limit: Int, $offset: Int) {
    trades(market: $market, side: $side, limit: $limit, offset: $offset) {
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
 *      market: // value for 'market'
 *      side: // value for 'side'
 *      limit: // value for 'limit'
 *      offset: // value for 'offset'
 *   },
 * });
 */
export function useGetTradesQuery(
  baseOptions?: ApolloReactHooks.QueryHookOptions<
    GetTradesQuery,
    GetTradesQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useQuery<GetTradesQuery, GetTradesQueryVariables>(
    GetTradesDocument,
    options,
  );
}
export function useGetTradesLazyQuery(
  baseOptions?: ApolloReactHooks.LazyQueryHookOptions<
    GetTradesQuery,
    GetTradesQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useLazyQuery<GetTradesQuery, GetTradesQueryVariables>(
    GetTradesDocument,
    options,
  );
}
// @ts-ignore
export function useGetTradesSuspenseQuery(
  baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<
    GetTradesQuery,
    GetTradesQueryVariables
  >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetTradesQuery,
  GetTradesQueryVariables
>;
export function useGetTradesSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetTradesQuery,
        GetTradesQueryVariables
      >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetTradesQuery | undefined,
  GetTradesQueryVariables
>;
export function useGetTradesSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetTradesQuery,
        GetTradesQueryVariables
      >,
) {
  const options =
    baseOptions === ApolloReactHooks.skipToken
      ? baseOptions
      : { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useSuspenseQuery<
    GetTradesQuery,
    GetTradesQueryVariables
  >(GetTradesDocument, options);
}
export type GetTradesQueryHookResult = ReturnType<typeof useGetTradesQuery>;
export type GetTradesLazyQueryHookResult = ReturnType<
  typeof useGetTradesLazyQuery
>;
export type GetTradesSuspenseQueryHookResult = ReturnType<
  typeof useGetTradesSuspenseQuery
>;
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
export function useGetTradeQuery(
  baseOptions: ApolloReactHooks.QueryHookOptions<
    GetTradeQuery,
    GetTradeQueryVariables
  > &
    ({ variables: GetTradeQueryVariables; skip?: boolean } | { skip: boolean }),
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useQuery<GetTradeQuery, GetTradeQueryVariables>(
    GetTradeDocument,
    options,
  );
}
export function useGetTradeLazyQuery(
  baseOptions?: ApolloReactHooks.LazyQueryHookOptions<
    GetTradeQuery,
    GetTradeQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useLazyQuery<GetTradeQuery, GetTradeQueryVariables>(
    GetTradeDocument,
    options,
  );
}
// @ts-ignore
export function useGetTradeSuspenseQuery(
  baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<
    GetTradeQuery,
    GetTradeQueryVariables
  >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetTradeQuery,
  GetTradeQueryVariables
>;
export function useGetTradeSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetTradeQuery,
        GetTradeQueryVariables
      >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetTradeQuery | undefined,
  GetTradeQueryVariables
>;
export function useGetTradeSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetTradeQuery,
        GetTradeQueryVariables
      >,
) {
  const options =
    baseOptions === ApolloReactHooks.skipToken
      ? baseOptions
      : { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useSuspenseQuery<
    GetTradeQuery,
    GetTradeQueryVariables
  >(GetTradeDocument, options);
}
export type GetTradeQueryHookResult = ReturnType<typeof useGetTradeQuery>;
export type GetTradeLazyQueryHookResult = ReturnType<
  typeof useGetTradeLazyQuery
>;
export type GetTradeSuspenseQueryHookResult = ReturnType<
  typeof useGetTradeSuspenseQuery
>;
export const GetPositionsDocument = gql`
  query GetPositions($market: Market) {
    positions(market: $market) {
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
 *      market: // value for 'market'
 *   },
 * });
 */
export function useGetPositionsQuery(
  baseOptions?: ApolloReactHooks.QueryHookOptions<
    GetPositionsQuery,
    GetPositionsQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useQuery<
    GetPositionsQuery,
    GetPositionsQueryVariables
  >(GetPositionsDocument, options);
}
export function useGetPositionsLazyQuery(
  baseOptions?: ApolloReactHooks.LazyQueryHookOptions<
    GetPositionsQuery,
    GetPositionsQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useLazyQuery<
    GetPositionsQuery,
    GetPositionsQueryVariables
  >(GetPositionsDocument, options);
}
// @ts-ignore
export function useGetPositionsSuspenseQuery(
  baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<
    GetPositionsQuery,
    GetPositionsQueryVariables
  >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetPositionsQuery,
  GetPositionsQueryVariables
>;
export function useGetPositionsSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetPositionsQuery,
        GetPositionsQueryVariables
      >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetPositionsQuery | undefined,
  GetPositionsQueryVariables
>;
export function useGetPositionsSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetPositionsQuery,
        GetPositionsQueryVariables
      >,
) {
  const options =
    baseOptions === ApolloReactHooks.skipToken
      ? baseOptions
      : { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useSuspenseQuery<
    GetPositionsQuery,
    GetPositionsQueryVariables
  >(GetPositionsDocument, options);
}
export type GetPositionsQueryHookResult = ReturnType<
  typeof useGetPositionsQuery
>;
export type GetPositionsLazyQueryHookResult = ReturnType<
  typeof useGetPositionsLazyQuery
>;
export type GetPositionsSuspenseQueryHookResult = ReturnType<
  typeof useGetPositionsSuspenseQuery
>;
export const GetQuoteDocument = gql`
  query GetQuote($stockCode: String!) {
    quote(stockCode: $stockCode) {
      stockCode
      stockName
      currentPrice
      openPrice
      highPrice
      lowPrice
      volume
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
export function useGetQuoteQuery(
  baseOptions: ApolloReactHooks.QueryHookOptions<
    GetQuoteQuery,
    GetQuoteQueryVariables
  > &
    ({ variables: GetQuoteQueryVariables; skip?: boolean } | { skip: boolean }),
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useQuery<GetQuoteQuery, GetQuoteQueryVariables>(
    GetQuoteDocument,
    options,
  );
}
export function useGetQuoteLazyQuery(
  baseOptions?: ApolloReactHooks.LazyQueryHookOptions<
    GetQuoteQuery,
    GetQuoteQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useLazyQuery<GetQuoteQuery, GetQuoteQueryVariables>(
    GetQuoteDocument,
    options,
  );
}
// @ts-ignore
export function useGetQuoteSuspenseQuery(
  baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<
    GetQuoteQuery,
    GetQuoteQueryVariables
  >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetQuoteQuery,
  GetQuoteQueryVariables
>;
export function useGetQuoteSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetQuoteQuery,
        GetQuoteQueryVariables
      >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetQuoteQuery | undefined,
  GetQuoteQueryVariables
>;
export function useGetQuoteSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetQuoteQuery,
        GetQuoteQueryVariables
      >,
) {
  const options =
    baseOptions === ApolloReactHooks.skipToken
      ? baseOptions
      : { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useSuspenseQuery<
    GetQuoteQuery,
    GetQuoteQueryVariables
  >(GetQuoteDocument, options);
}
export type GetQuoteQueryHookResult = ReturnType<typeof useGetQuoteQuery>;
export type GetQuoteLazyQueryHookResult = ReturnType<
  typeof useGetQuoteLazyQuery
>;
export type GetQuoteSuspenseQueryHookResult = ReturnType<
  typeof useGetQuoteSuspenseQuery
>;
export const GetOverseasQuoteDocument = gql`
  query GetOverseasQuote($exchangeCode: String!, $symbol: String!) {
    overseasQuote(exchangeCode: $exchangeCode, symbol: $symbol) {
      stockCode
      stockName
      currentPrice
      openPrice
      highPrice
      lowPrice
      volume
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
 *      exchangeCode: // value for 'exchangeCode'
 *      symbol: // value for 'symbol'
 *   },
 * });
 */
export function useGetOverseasQuoteQuery(
  baseOptions: ApolloReactHooks.QueryHookOptions<
    GetOverseasQuoteQuery,
    GetOverseasQuoteQueryVariables
  > &
    (
      | { variables: GetOverseasQuoteQueryVariables; skip?: boolean }
      | { skip: boolean }
    ),
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useQuery<
    GetOverseasQuoteQuery,
    GetOverseasQuoteQueryVariables
  >(GetOverseasQuoteDocument, options);
}
export function useGetOverseasQuoteLazyQuery(
  baseOptions?: ApolloReactHooks.LazyQueryHookOptions<
    GetOverseasQuoteQuery,
    GetOverseasQuoteQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useLazyQuery<
    GetOverseasQuoteQuery,
    GetOverseasQuoteQueryVariables
  >(GetOverseasQuoteDocument, options);
}
// @ts-ignore
export function useGetOverseasQuoteSuspenseQuery(
  baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<
    GetOverseasQuoteQuery,
    GetOverseasQuoteQueryVariables
  >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetOverseasQuoteQuery,
  GetOverseasQuoteQueryVariables
>;
export function useGetOverseasQuoteSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetOverseasQuoteQuery,
        GetOverseasQuoteQueryVariables
      >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetOverseasQuoteQuery | undefined,
  GetOverseasQuoteQueryVariables
>;
export function useGetOverseasQuoteSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetOverseasQuoteQuery,
        GetOverseasQuoteQueryVariables
      >,
) {
  const options =
    baseOptions === ApolloReactHooks.skipToken
      ? baseOptions
      : { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useSuspenseQuery<
    GetOverseasQuoteQuery,
    GetOverseasQuoteQueryVariables
  >(GetOverseasQuoteDocument, options);
}
export type GetOverseasQuoteQueryHookResult = ReturnType<
  typeof useGetOverseasQuoteQuery
>;
export type GetOverseasQuoteLazyQueryHookResult = ReturnType<
  typeof useGetOverseasQuoteLazyQuery
>;
export type GetOverseasQuoteSuspenseQueryHookResult = ReturnType<
  typeof useGetOverseasQuoteSuspenseQuery
>;
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
export function useGetDashboardSummaryQuery(
  baseOptions?: ApolloReactHooks.QueryHookOptions<
    GetDashboardSummaryQuery,
    GetDashboardSummaryQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useQuery<
    GetDashboardSummaryQuery,
    GetDashboardSummaryQueryVariables
  >(GetDashboardSummaryDocument, options);
}
export function useGetDashboardSummaryLazyQuery(
  baseOptions?: ApolloReactHooks.LazyQueryHookOptions<
    GetDashboardSummaryQuery,
    GetDashboardSummaryQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useLazyQuery<
    GetDashboardSummaryQuery,
    GetDashboardSummaryQueryVariables
  >(GetDashboardSummaryDocument, options);
}
// @ts-ignore
export function useGetDashboardSummarySuspenseQuery(
  baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<
    GetDashboardSummaryQuery,
    GetDashboardSummaryQueryVariables
  >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetDashboardSummaryQuery,
  GetDashboardSummaryQueryVariables
>;
export function useGetDashboardSummarySuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetDashboardSummaryQuery,
        GetDashboardSummaryQueryVariables
      >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetDashboardSummaryQuery | undefined,
  GetDashboardSummaryQueryVariables
>;
export function useGetDashboardSummarySuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetDashboardSummaryQuery,
        GetDashboardSummaryQueryVariables
      >,
) {
  const options =
    baseOptions === ApolloReactHooks.skipToken
      ? baseOptions
      : { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useSuspenseQuery<
    GetDashboardSummaryQuery,
    GetDashboardSummaryQueryVariables
  >(GetDashboardSummaryDocument, options);
}
export type GetDashboardSummaryQueryHookResult = ReturnType<
  typeof useGetDashboardSummaryQuery
>;
export type GetDashboardSummaryLazyQueryHookResult = ReturnType<
  typeof useGetDashboardSummaryLazyQuery
>;
export type GetDashboardSummarySuspenseQueryHookResult = ReturnType<
  typeof useGetDashboardSummarySuspenseQuery
>;
export const GetStrategyExecutionsDocument = gql`
  query GetStrategyExecutions(
    $stockCode: String
    $strategyName: String
    $limit: Int
  ) {
    strategyExecutions(
      stockCode: $stockCode
      strategyName: $strategyName
      limit: $limit
    ) {
      id
      market
      stockCode
      strategyName
      executedDate
      progress
      signalCount
      details
      createdAt
    }
  }
`;

/**
 * __useGetStrategyExecutionsQuery__
 *
 * To run a query within a React component, call `useGetStrategyExecutionsQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetStrategyExecutionsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetStrategyExecutionsQuery({
 *   variables: {
 *      stockCode: // value for 'stockCode'
 *      strategyName: // value for 'strategyName'
 *      limit: // value for 'limit'
 *   },
 * });
 */
export function useGetStrategyExecutionsQuery(
  baseOptions?: ApolloReactHooks.QueryHookOptions<
    GetStrategyExecutionsQuery,
    GetStrategyExecutionsQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useQuery<
    GetStrategyExecutionsQuery,
    GetStrategyExecutionsQueryVariables
  >(GetStrategyExecutionsDocument, options);
}
export function useGetStrategyExecutionsLazyQuery(
  baseOptions?: ApolloReactHooks.LazyQueryHookOptions<
    GetStrategyExecutionsQuery,
    GetStrategyExecutionsQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useLazyQuery<
    GetStrategyExecutionsQuery,
    GetStrategyExecutionsQueryVariables
  >(GetStrategyExecutionsDocument, options);
}
// @ts-ignore
export function useGetStrategyExecutionsSuspenseQuery(
  baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<
    GetStrategyExecutionsQuery,
    GetStrategyExecutionsQueryVariables
  >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetStrategyExecutionsQuery,
  GetStrategyExecutionsQueryVariables
>;
export function useGetStrategyExecutionsSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetStrategyExecutionsQuery,
        GetStrategyExecutionsQueryVariables
      >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetStrategyExecutionsQuery | undefined,
  GetStrategyExecutionsQueryVariables
>;
export function useGetStrategyExecutionsSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetStrategyExecutionsQuery,
        GetStrategyExecutionsQueryVariables
      >,
) {
  const options =
    baseOptions === ApolloReactHooks.skipToken
      ? baseOptions
      : { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useSuspenseQuery<
    GetStrategyExecutionsQuery,
    GetStrategyExecutionsQueryVariables
  >(GetStrategyExecutionsDocument, options);
}
export type GetStrategyExecutionsQueryHookResult = ReturnType<
  typeof useGetStrategyExecutionsQuery
>;
export type GetStrategyExecutionsLazyQueryHookResult = ReturnType<
  typeof useGetStrategyExecutionsLazyQuery
>;
export type GetStrategyExecutionsSuspenseQueryHookResult = ReturnType<
  typeof useGetStrategyExecutionsSuspenseQuery
>;
export const GetAvailableStrategiesDocument = gql`
  query GetAvailableStrategies {
    availableStrategies {
      name
      displayName
      description
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
export function useGetAvailableStrategiesQuery(
  baseOptions?: ApolloReactHooks.QueryHookOptions<
    GetAvailableStrategiesQuery,
    GetAvailableStrategiesQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useQuery<
    GetAvailableStrategiesQuery,
    GetAvailableStrategiesQueryVariables
  >(GetAvailableStrategiesDocument, options);
}
export function useGetAvailableStrategiesLazyQuery(
  baseOptions?: ApolloReactHooks.LazyQueryHookOptions<
    GetAvailableStrategiesQuery,
    GetAvailableStrategiesQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useLazyQuery<
    GetAvailableStrategiesQuery,
    GetAvailableStrategiesQueryVariables
  >(GetAvailableStrategiesDocument, options);
}
// @ts-ignore
export function useGetAvailableStrategiesSuspenseQuery(
  baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<
    GetAvailableStrategiesQuery,
    GetAvailableStrategiesQueryVariables
  >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetAvailableStrategiesQuery,
  GetAvailableStrategiesQueryVariables
>;
export function useGetAvailableStrategiesSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetAvailableStrategiesQuery,
        GetAvailableStrategiesQueryVariables
      >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetAvailableStrategiesQuery | undefined,
  GetAvailableStrategiesQueryVariables
>;
export function useGetAvailableStrategiesSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetAvailableStrategiesQuery,
        GetAvailableStrategiesQueryVariables
      >,
) {
  const options =
    baseOptions === ApolloReactHooks.skipToken
      ? baseOptions
      : { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useSuspenseQuery<
    GetAvailableStrategiesQuery,
    GetAvailableStrategiesQueryVariables
  >(GetAvailableStrategiesDocument, options);
}
export type GetAvailableStrategiesQueryHookResult = ReturnType<
  typeof useGetAvailableStrategiesQuery
>;
export type GetAvailableStrategiesLazyQueryHookResult = ReturnType<
  typeof useGetAvailableStrategiesLazyQuery
>;
export type GetAvailableStrategiesSuspenseQueryHookResult = ReturnType<
  typeof useGetAvailableStrategiesSuspenseQuery
>;
export const GetMarketRegimeDocument = gql`
  query GetMarketRegime($market: Market!, $exchangeCode: String!) {
    marketRegime(market: $market, exchangeCode: $exchangeCode) {
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
 *      market: // value for 'market'
 *      exchangeCode: // value for 'exchangeCode'
 *   },
 * });
 */
export function useGetMarketRegimeQuery(
  baseOptions: ApolloReactHooks.QueryHookOptions<
    GetMarketRegimeQuery,
    GetMarketRegimeQueryVariables
  > &
    (
      | { variables: GetMarketRegimeQueryVariables; skip?: boolean }
      | { skip: boolean }
    ),
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useQuery<
    GetMarketRegimeQuery,
    GetMarketRegimeQueryVariables
  >(GetMarketRegimeDocument, options);
}
export function useGetMarketRegimeLazyQuery(
  baseOptions?: ApolloReactHooks.LazyQueryHookOptions<
    GetMarketRegimeQuery,
    GetMarketRegimeQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useLazyQuery<
    GetMarketRegimeQuery,
    GetMarketRegimeQueryVariables
  >(GetMarketRegimeDocument, options);
}
// @ts-ignore
export function useGetMarketRegimeSuspenseQuery(
  baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<
    GetMarketRegimeQuery,
    GetMarketRegimeQueryVariables
  >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetMarketRegimeQuery,
  GetMarketRegimeQueryVariables
>;
export function useGetMarketRegimeSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetMarketRegimeQuery,
        GetMarketRegimeQueryVariables
      >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetMarketRegimeQuery | undefined,
  GetMarketRegimeQueryVariables
>;
export function useGetMarketRegimeSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetMarketRegimeQuery,
        GetMarketRegimeQueryVariables
      >,
) {
  const options =
    baseOptions === ApolloReactHooks.skipToken
      ? baseOptions
      : { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useSuspenseQuery<
    GetMarketRegimeQuery,
    GetMarketRegimeQueryVariables
  >(GetMarketRegimeDocument, options);
}
export type GetMarketRegimeQueryHookResult = ReturnType<
  typeof useGetMarketRegimeQuery
>;
export type GetMarketRegimeLazyQueryHookResult = ReturnType<
  typeof useGetMarketRegimeLazyQuery
>;
export type GetMarketRegimeSuspenseQueryHookResult = ReturnType<
  typeof useGetMarketRegimeSuspenseQuery
>;
export const GetRiskStateDocument = gql`
  query GetRiskState($market: Market!) {
    riskState(market: $market) {
      buyBlocked
      liquidateAll
      positionCount
      investedRate
      dailyPnlRate
      drawdown
      reasons
    }
  }
`;

/**
 * __useGetRiskStateQuery__
 *
 * To run a query within a React component, call `useGetRiskStateQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetRiskStateQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetRiskStateQuery({
 *   variables: {
 *      market: // value for 'market'
 *   },
 * });
 */
export function useGetRiskStateQuery(
  baseOptions: ApolloReactHooks.QueryHookOptions<
    GetRiskStateQuery,
    GetRiskStateQueryVariables
  > &
    (
      | { variables: GetRiskStateQueryVariables; skip?: boolean }
      | { skip: boolean }
    ),
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useQuery<
    GetRiskStateQuery,
    GetRiskStateQueryVariables
  >(GetRiskStateDocument, options);
}
export function useGetRiskStateLazyQuery(
  baseOptions?: ApolloReactHooks.LazyQueryHookOptions<
    GetRiskStateQuery,
    GetRiskStateQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useLazyQuery<
    GetRiskStateQuery,
    GetRiskStateQueryVariables
  >(GetRiskStateDocument, options);
}
// @ts-ignore
export function useGetRiskStateSuspenseQuery(
  baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<
    GetRiskStateQuery,
    GetRiskStateQueryVariables
  >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetRiskStateQuery,
  GetRiskStateQueryVariables
>;
export function useGetRiskStateSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetRiskStateQuery,
        GetRiskStateQueryVariables
      >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetRiskStateQuery | undefined,
  GetRiskStateQueryVariables
>;
export function useGetRiskStateSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetRiskStateQuery,
        GetRiskStateQueryVariables
      >,
) {
  const options =
    baseOptions === ApolloReactHooks.skipToken
      ? baseOptions
      : { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useSuspenseQuery<
    GetRiskStateQuery,
    GetRiskStateQueryVariables
  >(GetRiskStateDocument, options);
}
export type GetRiskStateQueryHookResult = ReturnType<
  typeof useGetRiskStateQuery
>;
export type GetRiskStateLazyQueryHookResult = ReturnType<
  typeof useGetRiskStateLazyQuery
>;
export type GetRiskStateSuspenseQueryHookResult = ReturnType<
  typeof useGetRiskStateSuspenseQuery
>;
export const GetWatchStocksDocument = gql`
  query GetWatchStocks($market: Market) {
    watchStocks(market: $market) {
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
 *      market: // value for 'market'
 *   },
 * });
 */
export function useGetWatchStocksQuery(
  baseOptions?: ApolloReactHooks.QueryHookOptions<
    GetWatchStocksQuery,
    GetWatchStocksQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useQuery<
    GetWatchStocksQuery,
    GetWatchStocksQueryVariables
  >(GetWatchStocksDocument, options);
}
export function useGetWatchStocksLazyQuery(
  baseOptions?: ApolloReactHooks.LazyQueryHookOptions<
    GetWatchStocksQuery,
    GetWatchStocksQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useLazyQuery<
    GetWatchStocksQuery,
    GetWatchStocksQueryVariables
  >(GetWatchStocksDocument, options);
}
// @ts-ignore
export function useGetWatchStocksSuspenseQuery(
  baseOptions?: ApolloReactHooks.SuspenseQueryHookOptions<
    GetWatchStocksQuery,
    GetWatchStocksQueryVariables
  >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetWatchStocksQuery,
  GetWatchStocksQueryVariables
>;
export function useGetWatchStocksSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetWatchStocksQuery,
        GetWatchStocksQueryVariables
      >,
): ApolloReactHooks.UseSuspenseQueryResult<
  GetWatchStocksQuery | undefined,
  GetWatchStocksQueryVariables
>;
export function useGetWatchStocksSuspenseQuery(
  baseOptions?:
    | ApolloReactHooks.SkipToken
    | ApolloReactHooks.SuspenseQueryHookOptions<
        GetWatchStocksQuery,
        GetWatchStocksQueryVariables
      >,
) {
  const options =
    baseOptions === ApolloReactHooks.skipToken
      ? baseOptions
      : { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useSuspenseQuery<
    GetWatchStocksQuery,
    GetWatchStocksQueryVariables
  >(GetWatchStocksDocument, options);
}
export type GetWatchStocksQueryHookResult = ReturnType<
  typeof useGetWatchStocksQuery
>;
export type GetWatchStocksLazyQueryHookResult = ReturnType<
  typeof useGetWatchStocksLazyQuery
>;
export type GetWatchStocksSuspenseQueryHookResult = ReturnType<
  typeof useGetWatchStocksSuspenseQuery
>;
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
export function useCreateWatchStockMutation(
  baseOptions?: ApolloReactHooks.MutationHookOptions<
    CreateWatchStockMutation,
    CreateWatchStockMutationVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useMutation<
    CreateWatchStockMutation,
    CreateWatchStockMutationVariables
  >(CreateWatchStockDocument, options);
}
export type CreateWatchStockMutationHookResult = ReturnType<
  typeof useCreateWatchStockMutation
>;
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
export function useUpdateWatchStockMutation(
  baseOptions?: ApolloReactHooks.MutationHookOptions<
    UpdateWatchStockMutation,
    UpdateWatchStockMutationVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useMutation<
    UpdateWatchStockMutation,
    UpdateWatchStockMutationVariables
  >(UpdateWatchStockDocument, options);
}
export type UpdateWatchStockMutationHookResult = ReturnType<
  typeof useUpdateWatchStockMutation
>;
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
export function useDeleteWatchStockMutation(
  baseOptions?: ApolloReactHooks.MutationHookOptions<
    DeleteWatchStockMutation,
    DeleteWatchStockMutationVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return ApolloReactHooks.useMutation<
    DeleteWatchStockMutation,
    DeleteWatchStockMutationVariables
  >(DeleteWatchStockDocument, options);
}
export type DeleteWatchStockMutationHookResult = ReturnType<
  typeof useDeleteWatchStockMutation
>;
