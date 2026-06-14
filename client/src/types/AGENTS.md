# Types

## 책임
프론트엔드 전역에서 공유되는 순수 TypeScript 타입(필터 상태, 페이지네이션, 기술분석 view 모델 등). GraphQL 스키마에서 파생되지 않는,
UI/상태 레벨의 인터페이스를 보관한다. 1타입 1파일 + `index.ts` re-export 규칙을 따른다.

## 주요 파일 / 하위 폴더
- `market-filter-state.type.ts` — `MarketFilterState`(market 필터 셀렉터 상태)
- `trade-filter-state.type.ts` — `TradeFilterState`(MarketFilterState 확장 + side)
- `pagination-state.type.ts` — `PaginationState`(page/limit)
- `technical-ratings.type.ts` — `TechnicalIndicatorView`, `TechnicalRatingSummaryView`, `TechnicalRatingsView` (기술 평점 패널 view 모델)
- `index.ts` — 위 타입 re-export

## 외부 의존성
- 외부 npm 패키지 의존 없음 (순수 타입)
- 내부: `@/graphql/generated`의 enum 타입(`Market`, `Side`)만 import

## 주의사항 / 비자명한 규칙
- **GraphQL 타입은 여기에 정의 금지** — 모두 `@/graphql/generated`에서 import. 응답 형태가 필요하면 페이지 측에서 `GetXxxQuery['xxx']` 인덱스 액세스로 파생.
- **공통 vs 페이지 전용 구분**:
  - 2개 이상의 페이지/컴포넌트가 사용 → 여기(`src/types/`)
  - 1개 페이지 전용 → `src/pages/types/` 또는 `src/pages/{page}/types/`
  - 공통 컴포넌트의 props → `src/components/types/`
  - 훅 반환 타입 → `src/hooks/types/`
- **1타입 1파일 + kebab-case 파일명** (`{type-name}.type.ts`). 밀접하게 묶이는 2~3개 타입(예: technical-ratings의 view 3종)은 한 파일 허용.
- **`index.ts`에서 모든 타입 re-export** — 사용처에서는 `import type { ... } from '@/types'` 하나로 끝낼 수 있게 유지. 신규 타입 추가 시 index.ts 갱신 필수.
- 타입은 모두 `interface` 또는 `type` 별칭으로 정의 (런타임 코드 금지). enum이 필요하면 GraphQL 스키마(generated.ts) 또는 string union 사용 — codegen이 `enumsAsTypes: true`라 enum도 union으로 통일된다.
