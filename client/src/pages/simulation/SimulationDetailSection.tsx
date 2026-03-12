import { useGetSimulationSessionQuery, useGetAvailableStrategiesQuery } from '@/graphql/generated'
import { SimulationControls } from '@/pages/simulation/SimulationControls'
import { SimulationMetricsCards } from '@/pages/simulation/SimulationMetricsCards'
import { SimulationEquityChart } from '@/pages/simulation/SimulationEquityChart'
import { SimulationCapitalSummary } from '@/pages/simulation/SimulationCapitalSummary'
import { SimulationWatchStocks } from '@/pages/simulation/SimulationWatchStocks'
import { SimulationPositionsTable } from '@/pages/simulation/SimulationPositionsTable'
import { SimulationTradesTable } from '@/pages/simulation/SimulationTradesTable'
import type { SimulationDetailSectionProps } from '@/pages/simulation/types'

export function SimulationDetailSection({ sessionId, onBack }: SimulationDetailSectionProps) {
  const { data, loading, refetch } = useGetSimulationSessionQuery({
    variables: { id: sessionId },
  })
  const { data: strategiesData } = useGetAvailableStrategiesQuery()

  const session = data?.simulationSession
  const strategies = strategiesData?.availableStrategies ?? []

  if (loading) {
    return <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">로딩중...</div>
  }

  if (!session) {
    return <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">세션을 찾을 수 없습니다</div>
  }

  const exchangeCodes = [...new Set((session.watchStocks ?? []).map((ws) => ws.exchangeCode).filter((c): c is string => !!c))]
  const primaryExchangeCode = exchangeCodes[0]

  return (
    <div className="space-y-6">
      <SimulationControls
        sessionId={sessionId}
        status={session.status}
        sessionName={session.name}
        strategyDisplayName={strategies.find((s) => s.name === session.strategyName)?.displayName ?? session.strategyName}
        market={session.market}
        exchangeCodes={exchangeCodes}
        onBack={onBack}
        onStatusChange={() => refetch()}
      />
      <SimulationMetricsCards sessionId={sessionId} market={session.market} exchangeCode={primaryExchangeCode} />
      <SimulationCapitalSummary
        sessionId={sessionId}
        initialCapital={session.initialCapital}
        currentCash={session.currentCash}
        market={session.market}
        exchangeCode={primaryExchangeCode}
        watchStocks={session.watchStocks ?? []}
      />
      <SimulationEquityChart sessionId={sessionId} market={session.market} exchangeCode={primaryExchangeCode} />
      <SimulationWatchStocks sessionId={sessionId} />
      <SimulationPositionsTable sessionId={sessionId} />
      <SimulationTradesTable sessionId={sessionId} />
    </div>
  )
}
