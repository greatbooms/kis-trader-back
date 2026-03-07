import { useState, useCallback, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLoginMutation, useLogoutMutation } from '@/graphql/generated'
import { setAuthenticated, subscribeAuth, getAuthSnapshot } from '@/lib/auth'
import { apolloClient } from '@/lib/apollo'
import type { UseAuthReturn } from '@/hooks/types'

export function useAuth(): UseAuthReturn {
  const authenticated = useSyncExternalStore(subscribeAuth, getAuthSnapshot)
  const navigate = useNavigate()
  const [loginMutation, { loading }] = useLoginMutation()
  const [logoutMutation] = useLogoutMutation()
  const [error, setError] = useState<string | null>(null)

  const login = useCallback(
    async (username: string, password: string) => {
      setError(null)
      try {
        const { data } = await loginMutation({ variables: { username, password } })
        if (data?.login.success) {
          setAuthenticated(true)
          navigate('/')
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '로그인에 실패했습니다')
      }
    },
    [loginMutation, navigate],
  )

  const logout = useCallback(async () => {
    try {
      await logoutMutation()
    } catch {
      // ignore logout errors
    }
    setAuthenticated(false)
    await apolloClient.clearStore()
    navigate('/login')
  }, [logoutMutation, navigate])

  return { authenticated, login, logout, loading, error }
}
