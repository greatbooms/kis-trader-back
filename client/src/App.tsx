import { lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { LoginPage } from '@/pages/LoginPage'

const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage }))
)
const WatchlistPage = lazy(() =>
  import('@/pages/WatchlistPage').then((m) => ({ default: m.WatchlistPage }))
)
const WatchStockDetailPage = lazy(() =>
  import('@/pages/WatchStockDetailPage').then((m) => ({ default: m.WatchStockDetailPage }))
)
const PortfolioPage = lazy(() =>
  import('@/pages/PortfolioPage').then((m) => ({ default: m.PortfolioPage }))
)
const StrategyGuidePage = lazy(() =>
  import('@/pages/StrategyGuidePage').then((m) => ({ default: m.StrategyGuidePage }))
)
const ScreeningPage = lazy(() =>
  import('@/pages/ScreeningPage').then((m) => ({ default: m.ScreeningPage }))
)
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage }))
)
const QuotePage = lazy(() =>
  import('@/pages/QuotePage').then((m) => ({ default: m.QuotePage }))
)

const SimulationPage = lazy(() =>
  import('@/pages/SimulationPage').then((m) => ({ default: m.SimulationPage }))
)

function RouteFallback() {
  return <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">로딩중...</div>
}

function LazyRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>
}

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
          <Route path="/" element={<LazyRoute><DashboardPage /></LazyRoute>} />
          <Route path="/watchlist" element={<LazyRoute><WatchlistPage /></LazyRoute>} />
          <Route path="/watchlist/:id" element={<LazyRoute><WatchStockDetailPage /></LazyRoute>} />
          <Route path="/portfolio" element={<LazyRoute><PortfolioPage /></LazyRoute>} />
          <Route path="/strategy-guide" element={<LazyRoute><StrategyGuidePage /></LazyRoute>} />
          <Route path="/simulation" element={<LazyRoute><SimulationPage /></LazyRoute>} />
          <Route path="/screening" element={<LazyRoute><ScreeningPage /></LazyRoute>} />
          <Route path="/quote" element={<LazyRoute><QuotePage /></LazyRoute>} />
          <Route path="/settings" element={<LazyRoute><SettingsPage /></LazyRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
