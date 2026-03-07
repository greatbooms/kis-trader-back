import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { isAuthenticated, setAuthenticated } from '@/lib/auth'
import { apolloClient } from '@/lib/apollo'
import { GetDashboardSummaryDocument } from '@/graphql/generated'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const [checking, setChecking] = useState(!isAuthenticated())
  const [valid, setValid] = useState(isAuthenticated())

  useEffect(() => {
    if (isAuthenticated()) return

    apolloClient
      .query({ query: GetDashboardSummaryDocument, fetchPolicy: 'network-only' })
      .then(() => {
        setAuthenticated(true)
        setValid(true)
      })
      .catch(() => {
        setValid(false)
      })
      .finally(() => {
        setChecking(false)
      })
  }, [])

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        인증 확인 중...
      </div>
    )
  }

  if (!valid) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}
