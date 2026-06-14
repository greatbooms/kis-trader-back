# Pages

## 책임
라우트 단위 화면 컴포넌트 모음. 각 페이지는 GraphQL 훅으로 데이터를 가져와 `components/ui/`와 도메인 위젯을 조합해 렌더링한다.
라우팅은 `src/App.tsx`의 `<Routes>`에서 정의되며, 인증된 라우트는 모두 `<AuthGuard><Layout /></AuthGuard>` 하위에 위치한다.

## 주요 파일 / 하위 폴더
- `LoginPage.tsx` — `/login` (AuthGuard 외부, 유일한 공개 라우트)
- `DashboardPage.tsx` — `/` 계정/포지션/시장 레짐 요약
- `WatchlistPage.tsx` — `/watchlist` 관심종목 목록 + 추가/수정 폼
- `WatchStockDetailPage.tsx` — `/watchlist/:id` 관심종목 상세 (전략 설정, 차트, 거래 내역)
- `PortfolioPage.tsx` — `/portfolio` 보유 포지션 + 일별 손익
- `StrategyGuidePage.tsx` — `/strategy-guide` 전략 설명/가이드 (정적 + 메타 데이터)
- `ScreeningPage.tsx` — `/screening` 종목 추천 / 딥 분석 결과
- `QuotePage.tsx` — `/quote` 시세 단건 조회 (`StockSearchInput` 사용)
- `SimulationPage.tsx` — `/simulation` (`?id=` 유무로 List/Detail 분기)
- `SettingsPage.tsx` — `/settings` 계정/스크리닝 활성화 토글
- `simulation/` — 시뮬레이션 페이지를 구성하는 sub-component들
  - `SimulationListSection.tsx`, `SimulationDetailSection.tsx` (entry)
  - `SimulationCapitalSummary.tsx`, `SimulationControls.tsx`, `SimulationEquityChart.tsx`, `SimulationMetricsCards.tsx`, `SimulationPositionsTable.tsx`, `SimulationTradesTable.tsx`
  - `simulation/types/simulation.types.ts` — 시뮬레이션 sub-component props
- `watchlist/` — 관심종목 페이지 sub-component (`WatchlistFilters`, `WatchlistTable`, `WatchStockRow`, `AddWatchStockModal`, `EditWatchStockModal`, `strategy-meta.ts`)
- `portfolio/` — 포트폴리오 페이지 sub-component (`PortfolioFilters`, `AccountSummaryCard`, `PositionsCard`, `TradesCard`, `PortfolioCommon`, `portfolio-helpers.ts`)
- `screening/` — 스크리닝 페이지 sub-component (`DateListView`, `StockDetailView`, `RecommendationCard`, `AddToSimulationModal`, `ScreeningCommon`, `screening-helpers.ts`)
- `types/` — 페이지 간 공유되는 props/입력 타입 (`dashboard.types.ts`, `add-watch-stock-form-*.type.ts`, `watch-stock-row-props.type.ts`, `market-{select,filter}-props.type.ts` 등)

## 외부 의존성
- `react-router-dom` — `useSearchParams`, `useParams`, `useNavigate`, `Navigate`
- `@apollo/client/react` (codegen 훅 경유) — 데이터 페칭/뮤테이션
- `recharts` — 차트(equity 등)
- `lucide-react` — 아이콘
- 내부: `@/components/{ui,layout}`, `@/components/StockSearchInput`, `@/lib/*`, `@/graphql/generated`, `@/hooks/useAuth`

## 주의사항 / 비자명한 규칙
- **라우팅은 `src/App.tsx`에서만 정의** — 페이지 추가 시 ① 새 `*.tsx` 파일 작성 → ② `App.tsx`에 `lazy()` import + `<Route>` 등록 → ③ 사이드바 메뉴는 `components/layout/Sidebar.tsx`의 `navItems`에 추가. 페이지 자체는 `BrowserRouter`/`Routes`를 모르는 채 export.
- **모든 페이지는 lazy() + `<LazyRoute>` Suspense 래핑** — `LoginPage`만 예외(즉시 로드).
- **페이지 컴포넌트는 named export** (`export function DashboardPage()`). `App.tsx`의 lazy 래퍼가 `(m) => ({ default: m.PageName })`로 변환.
- **페이지 전용 타입은 `pages/types/`에 1타입 1파일**, 시뮬레이션처럼 페이지가 sub-component를 가지면 그 폴더 안 `types/`에 둔다 (예: `pages/simulation/types/simulation.types.ts`). 루트 AGENTS.md의 프론트엔드 타입 규칙 따름.
- **GraphQL 타입 직접 정의 금지** — `generated.ts`에서 import. 응답 일부만 alias 하고 싶으면 `pages/types/dashboard.types.ts`처럼 `GetXxxQuery['xxx']` 인덱스 액세스로 파생.
- **`SimulationPage` 패턴**: query string(`?id=`) 기반 master-detail. 페이지 자체는 분기만, 실제 UI는 `simulation/` 하위 `*Section` 컴포넌트가 담당.
- **거대 페이지 분해 패턴**: `WatchlistPage`/`PortfolioPage`/`ScreeningPage`는 entry 파일에서 GraphQL hook + 상태만 관리하고, 섹션별 UI(필터, 테이블, 카드, 모달)는 `pages/{name}/` 하위로 분리. 자식 컴포넌트는 명시적 props 받고 stateless에 가깝게 유지하며, 공통 헬퍼/타입은 `{name}-helpers.ts`/`types/{name}.types.ts`로 따로 둔다.
- **다국가 시장 처리**: 거래소/통화 매핑은 `lib/market-constants.ts`로 통합 — 페이지에서 직접 매핑 테이블을 만들지 말 것 (단, `DashboardPage`처럼 국가→통화 같은 페이지 한정 작은 매핑은 페이지 내 const 허용).
- **`refetchQueries`는 operation 이름 문자열로** (예: `['GetWatchStocks']`).
