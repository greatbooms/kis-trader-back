import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { LoginPage } from '@/pages/LoginPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { WatchlistPage } from '@/pages/WatchlistPage'
import { PortfolioPage } from '@/pages/PortfolioPage'
import { StrategyGuidePage } from '@/pages/StrategyGuidePage'
import { SettingsPage } from '@/pages/SettingsPage'

const SimulationPage = lazy(() =>
  import('@/pages/SimulationPage').then((m) => ({ default: m.SimulationPage }))
)

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <AuthGuard>
              <Layout />
            </AuthGuard>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/watchlist" element={<WatchlistPage />} />
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="/strategy-guide" element={<StrategyGuidePage />} />
          <Route path="/simulation" element={<Suspense fallback={<div className="flex items-center justify-center h-32 text-muted-foreground text-sm">로딩중...</div>}><SimulationPage /></Suspense>} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
