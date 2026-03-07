import { useSearchParams } from 'react-router-dom'
import { SimulationListSection } from '@/pages/simulation/SimulationListSection'
import { SimulationDetailSection } from '@/pages/simulation/SimulationDetailSection'

export function SimulationPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedSessionId = searchParams.get('id')

  if (selectedSessionId) {
    return (
      <SimulationDetailSection
        sessionId={selectedSessionId}
        onBack={() => setSearchParams({})}
      />
    )
  }

  return <SimulationListSection onSelect={(id) => setSearchParams({ id })} />
}
