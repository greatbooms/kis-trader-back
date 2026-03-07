import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/hooks/useAuth'
import { LogOut, Shield, Server } from 'lucide-react'

export function SettingsPage() {
  const { logout } = useAuth()

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
            <Server className="h-5 w-5 text-primary-500" />
            <CardTitle>시스템 정보</CardTitle>
          </div>
          <CardDescription>백엔드 서버 연결 정보</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">GraphQL API</span>
              <code className="text-xs bg-muted px-2 py-1 rounded">/graphql</code>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">프론트엔드 버전</span>
              <span className="font-medium">0.1.0</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
