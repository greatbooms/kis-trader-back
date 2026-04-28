# Hooks

## 책임
앱 전역에서 재사용되는 커스텀 React 훅. 현재는 인증 훅(`useAuth`) 1개로, GraphQL 뮤테이션과
모듈 스코프 인증 상태 store(`@/lib/auth`)를 묶어서 컴포넌트가 React 식으로 구독할 수 있게 해준다.

## 주요 파일 / 하위 폴더
- `useAuth.ts` — `useSyncExternalStore`로 `lib/auth` 상태 구독 + `useLoginMutation`/`useLogoutMutation` 래핑.
  성공 시 `setAuthenticated(true)` + `navigate('/')`, 로그아웃 시 `apolloClient.clearStore()`로 캐시 비우고 `/login`으로 이동.
- `types/use-auth-return.type.ts` — `UseAuthReturn` 인터페이스 (1타입 1파일 컨벤션)
- `types/index.ts` — re-export

## 외부 의존성
- `react` — `useState`, `useCallback`, `useSyncExternalStore`
- `react-router-dom` — `useNavigate`
- 내부: `@/graphql/generated`(생성된 mutation 훅), `@/lib/auth`, `@/lib/apollo`

## 주의사항 / 비자명한 규칙
- **위치 결정 기준**:
  - 2개 이상의 페이지/컴포넌트에서 쓰이거나 인증/세션 같은 cross-cutting 관심사 → `src/hooks/`
  - 한 페이지에서만 쓰는 데이터 페칭/상태 관리 훅 → 그 페이지 폴더 안(예: `pages/{page}/use-something.ts`)
- **타입은 `hooks/types/`에 1타입 1파일** (`use-{name}-return.type.ts`)로 분리 — 훅 시그니처가 길어지면 가독성을 위해 별도 파일 권장.
- 인증 상태는 React Context가 아닌 `lib/auth.ts`의 모듈 스코프 store + `useSyncExternalStore`로 구현 — Provider 트리에 묶이지 않으므로 라우트 바깥(예: AuthGuard)에서도 동기 접근 가능.
- `useLoginMutation` 내부 catch는 `setError`만 호출하고 throw 하지 않는다 — 호출부에서 try/catch 불필요.
- 새 훅을 추가할 때:
  - 파일명 `use{Name}.ts`, default export 금지(named export 통일)
  - 반환 타입은 `types/`에 정의해 import
  - GraphQL을 쓰면 codegen으로 만들어진 훅을 합성, 직접 `useQuery(gql\`...\`)`을 쓰지 말 것
