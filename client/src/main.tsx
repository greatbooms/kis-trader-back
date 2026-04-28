import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ApolloProvider } from '@apollo/client/react'
import { apolloClient } from '@/lib/apollo'
import { AppErrorBoundary } from '@/components/AppErrorBoundary'
// Pretendard 가변폰트를 npm 패키지로 자체 호스팅 (CSP 외부 CDN 차단 회피).
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <ApolloProvider client={apolloClient}>
        <App />
      </ApolloProvider>
    </AppErrorBoundary>
  </StrictMode>,
)
