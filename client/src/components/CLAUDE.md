# Components

## 책임
페이지 간 재사용되는 React 컴포넌트와 디자인 시스템(`ui/`)이 모인 폴더. shadcn/ui 패턴(headless + Tailwind + cva)을 따라
프리미티브 UI 컴포넌트를 제공하고, 공통 레이아웃 셸과 도메인 전반에서 쓰이는 위젯(StockSearchInput, TechnicalRatingsPanel 등)을 정의한다.

## 주요 파일 / 하위 폴더
- `ui/` — shadcn/ui 기반 디자인 시스템 (Button, Input, Select, Table, Card, Badge, Label, Tooltip)
  - `cn()` 기반 스타일 합성. variant가 필요한 컴포넌트(Button 등)는 cva, DOM ref가 필요한 곳은 `forwardRef` 사용 (Tooltip처럼 단순 함수형도 있음)
- `layout/` — 인증된 라우트의 셸
  - `Layout.tsx` — Sidebar/Header/Footer + `<Outlet />` 컴포지션
  - `Sidebar.tsx` — 네비게이션 메뉴 정의(navItems 배열). 라우트 추가 시 여기에 항목 추가
  - `Header.tsx` / `Footer.tsx` — 상단/하단 바 (collapsed 상태 반영)
  - `AuthGuard.tsx` — `GetDashboardSummary` 쿼리로 세션 확인 후 미인증 시 `/login` 리다이렉트
- `AppErrorBoundary.tsx` — 최상위 ErrorBoundary (`main.tsx`에서 ApolloProvider 바깥으로 감쌈)
- `Logo.tsx` — KIS Trader SVG 로고 (size prop)
- `StockSearchInput.tsx` — `SearchStocks` 쿼리 기반 자동완성 입력 (debounce 300ms, 키보드 네비게이션)
- `TechnicalRatingsPanel.tsx` — 기술 평점 카드(오실레이터/이동평균 요약 + 표)
- `types/` — 본 폴더 컴포넌트의 props 타입 (`{component}-props.type.ts`)

## 외부 의존성
- `class-variance-authority`, `clsx`, `tailwind-merge` — variant/className 유틸
- `lucide-react` — 아이콘
- `@apollo/client/react` — `StockSearchInput`, `AuthGuard`에서 사용
- 내부: `@/lib/utils`(cn, format*), `@/lib/auth`, `@/graphql/generated`

## 주의사항 / 비자명한 규칙
- **shadcn/ui 컴포넌트는 직접 손보는 식으로 커스터마이즈** — 별도 npm 패키지가 아니라 소스에 들여놓은 형태이므로 필요한 variant/스타일은 `ui/` 파일을 직접 수정한다.
- **Variant 추가 규칙**: 신규 색/크기는 cva 정의에 추가, 페이지별 일회성 스타일링은 `className` prop으로 합성 (cva variant를 무분별하게 늘리지 말 것).
- **layout/ 컴포넌트는 라우트 셸 전용** — 페이지에서 `<Layout />`을 직접 import 하지 않는다. `App.tsx`의 `<Route element={<Layout />}>` 하위 경로로 등록.
- **공통 vs 페이지 전용**: 2개 이상 페이지가 쓰면 여기, 한 페이지에서만 쓰면 `pages/{page}/` 또는 `pages/types/`로 둔다.
- **컴포넌트 props 타입**은 3개 이하 단순 prop이면 같은 파일 인라인 허용, 그 이상이면 `components/types/` 또는 `pages/types/`로 분리 (루트 CLAUDE.md 컨벤션).
- `StockSearchInput`의 dropdown은 `position: fixed` + `getBoundingClientRect()` 기반으로 띄움 — 부모에 `overflow:hidden`이 있어도 잘리지 않게 하기 위함. 스크롤 컨테이너 안에서는 위치가 고정 안 따라올 수 있으니 사용처에서 검증 필요.
- `AuthGuard`는 토큰을 직접 보지 않고 GraphQL 쿼리 성공/실패로 인증 판정 — 쿠키 기반 세션이라는 점에 의존(`apollo.ts`의 `credentials: 'include'`).
