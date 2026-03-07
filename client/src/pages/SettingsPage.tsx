import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/hooks/useAuth'
import { LogOut, Shield, Search } from 'lucide-react'
import {
  useGetScreeningSettingsQuery,
  useUpdateScreeningSettingsMutation,
} from '@/graphql/generated'

export function SettingsPage() {
  const { logout } = useAuth()
  const { data, loading } = useGetScreeningSettingsQuery()
  const [updateSettings] = useUpdateScreeningSettingsMutation()

  const countries = data?.screeningSettings?.countries ?? []

  const handleToggle = async (country: string, currentEnabled: boolean) => {
    await updateSettings({
      variables: { input: { country, enabled: !currentEnabled } },
      refetchQueries: ['GetScreeningSettings'],
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">설정</h2>
        <p className="text-sm text-muted-foreground mt-1">계정 및 시스템 설정을 관리하세요</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary-500" />
            <CardTitle>계정 정보</CardTitle>
          </div>
          <CardDescription>현재 로그인된 계정 정보</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">상태</span>
              <Badge variant="success">인증됨</Badge>
            </div>
            <div className="pt-3 border-t border-border">
              <Button variant="danger" onClick={logout} className="w-full">
                <LogOut size={16} /> 로그아웃
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Search className="h-5 w-5 text-primary-500" />
            <CardTitle>종목 스크리닝</CardTitle>
          </div>
          <CardDescription>국가별 종목 추천 스크리닝 활성화 설정</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">로딩 중...</p>
          ) : (
            <div className="space-y-3">
              {countries.map((c) => (
                <div key={c.country} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{c.label}</span>
                    <span className="text-xs text-muted-foreground">({c.country})</span>
                  </div>
                  <button
                    onClick={() => handleToggle(c.country, c.enabled)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      c.enabled ? 'bg-primary-500' : 'bg-muted'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        c.enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              ))}
              <p className="text-xs text-muted-foreground pt-2 border-t border-border">
                활성화된 국가만 매일 장 시작 전 자동 스크리닝됩니다
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
