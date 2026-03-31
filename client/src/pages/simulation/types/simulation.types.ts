export interface SimulationDetailSectionProps {
  sessionId: string
  onBack: () => void
}

export interface SimulationEquityChartProps {
  sessionId: string
  market: string
  exchangeCode?: string
}

export interface SimulationMetricsCardsProps {
  sessionId: string
  market: string
  exchangeCode?: string
}

export interface SimulationPositionsTableProps {
  sessionId: string
}

export interface SimulationTradesTableProps {
  sessionId: string
}

export interface SimulationCapitalSummaryProps {
  sessionId: string
  stockName: string
  currentCash: number
  market: string
  exchangeCode?: string
  quota: number
}

export interface SimulationControlsProps {
  sessionId: string
  status: string
  sessionName: string
  stockName: string
  strategyDisplayName: string
  market: string
  exchangeCodes: string[]
  onBack: () => void
  onStatusChange: () => void
}
