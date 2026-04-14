import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

type AppErrorBoundaryProps = {
  children: ReactNode
}

type AppErrorBoundaryState = {
  hasError: boolean
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    hasError: false,
  }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('App render error:', error, errorInfo)
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleGoHome = () => {
    window.location.href = '/'
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div className="min-h-screen bg-background px-6 py-10">
        <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <p className="text-sm font-medium text-danger">페이지를 표시하는 중 오류가 발생했습니다</p>
          <h1 className="mt-2 text-2xl font-bold text-foreground">일시적으로 화면을 불러오지 못했습니다</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            메뉴 이동 중 렌더링 오류가 발생했습니다. 새로고침하면 회복되는 경우가 많고, 다시 문제가 생기면 같은 경로에서 재현 여부를 확인해보겠습니다.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            현재 경로: {window.location.pathname}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button onClick={this.handleReload}>새로고침</Button>
            <Button variant="outline" onClick={this.handleGoHome}>홈으로 이동</Button>
          </div>
        </div>
      </div>
    )
  }
}
