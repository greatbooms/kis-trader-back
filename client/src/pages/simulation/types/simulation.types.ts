export interface SimulationDetailSectionProps {
  sessionId: string
  onBack: () => void
}

export interface SimulationEquityChartProps {
  sessionId: string
}

export interface SimulationMetricsCardsProps {
  sessionId: string
  market: string
}

export interface SimulationPositionsTableProps {
  sessionId: string
}

export interface SimulationTradesTableProps {
  sessionId: string
}

export interface SimulationWatchStocksProps {
  sessionId: string
}

export interface SimulationCapitalSummaryProps {
  sessionId: string
  initialCapital: number
  currentCash: number
  market: string
  watchStocks: Array<{
    id: string
    stockName: string
    quota?: number | null
  }>
}

export interface SimulationControlsProps {
  sessionId: string
  status: string
  sessionName: string
  strategyDisplayName: string
  market: string
  exchangeCodes: string[]
  onBack: () => void
  onStatusChange: () => void
}
