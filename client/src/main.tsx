import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ApolloProvider } from '@apollo/client/react'
import { apolloClient } from '@/lib/apollo'
import { AppErrorBoundary } from '@/components/AppErrorBoundary'
import { tryAutoReloadForChunkError } from '@/lib/chunk-error-recovery'
// Pretendard 가변폰트를 npm 패키지로 자체 호스팅 (CSP 외부 CDN 차단 회피).
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import App from './App'
import './index.css'

// Vite가 lazy import preload에 실패할 때(보통 새 빌드 배포 후 옛 해시 청크가 404) 자동 1회 리로드.
// React lazy() 가 reject 하기 전에 잡혀 ErrorBoundary 진입 자체를 방지.
window.addEventListener('vite:preloadError', (event) => {
  if (tryAutoReloadForChunkError('vite:preloadError')) {
    event.preventDefault()
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <ApolloProvider client={apolloClient}>
        <App />
      </ApolloProvider>
    </AppErrorBoundary>
  </StrictMode>,
)
