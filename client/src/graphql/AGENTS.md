# GraphQL

## 책임
프론트엔드의 GraphQL operation(`*.graphql`) 정의를 모아 두고, GraphQL Code Generator로 타입 안전한 React Apollo 훅/타입을
`generated.ts`에 자동 생성한다. 백엔드 스키마(`../src/schema.gql`)를 source of truth로 사용한다.

## 주요 파일 / 하위 폴더
- `auth.graphql` — `Login`, `Logout` 뮤테이션
- `screening.graphql` — 종목 추천 / 스크리닝 설정 쿼리·뮤테이션
- `simulation.graphql` — 시뮬레이션 세션 CRUD 및 상세 데이터
- `stock-search.graphql` — `SearchStocks` 자동완성 쿼리
- `trade-record.graphql` — 거래 내역 / 포지션 / 대시보드 / 계정 요약 / 가격 조회
- `trading.graphql` — 사용 가능 전략, 시장 레짐 조회
- `watch-stock.graphql` — 관심 종목 CRUD
- `generated.ts` — codegen 생성 산출물(타입, Document, `use*Query`/`use*Mutation` 훅)
- `schema.json` — codegen introspection 산출물 (IDE 자동완성/캐싱용)

## 외부 의존성
- `@graphql-codegen/cli` + 플러그인: `typescript`, `typescript-operations`, `typescript-react-apollo`, `introspection`
- `@apollo/client` / `@apollo/client/react` — 생성된 훅이 의존
- 백엔드 빌드 산출물: `../src/schema.gql` (NestJS code-first가 만들어 두는 파일)

## 주의사항 / 비자명한 규칙
- **`generated.ts` / `schema.json`은 직접 수정 금지.** 파일 상단에 `// @ts-nocheck`가 자동 주입되며, codegen `afterAllFileWrite` 훅이 prettier 적용까지 수행한다.
- **새 query/mutation 추가 절차**:
  1. 적절한 도메인 `*.graphql` 파일에 operation 정의 (operation 이름은 PascalCase, 예: `GetWatchStocks`).
  2. 백엔드 스키마가 변경됐으면 백엔드에서 NestJS 빌드 한 번 돌려 `src/schema.gql` 갱신.
  3. `yarn codegen` (또는 개발 중에는 `yarn codegen:watch`) 실행.
  4. 컴포넌트에서 `import { useGetWatchStocksQuery } from '@/graphql/generated'`로 사용.
- **operation 이름 = 훅 이름 prefix**: 예) `query GetFoo` → `useGetFooQuery`, `mutation CreateBar` → `useCreateBarMutation`.
- **타입은 `generated.ts`에서 import**, 절대 별도 파일에 직접 정의하지 않는다(루트 AGENTS.md 규칙).
- `refetchQueries`로 캐시 무효화할 때는 **operation 이름 문자열**을 사용 (예: `refetchQueries: ['GetScreeningSettings']`). Document 객체를 넘겨도 되지만 문자열 컨벤션을 따른다.
- `apolloClient`는 `cache-and-network`가 default fetchPolicy(`@/lib/apollo`) — 페이지 진입 시 캐시 즉시 표시 + 백그라운드 재요청 동작이라는 점을 알고 사용.
- enum은 codegen 설정상 `enumsAsTypes: true`로 string union 타입(`'BUY' | 'SELL'` 등)으로 생성된다 — TypeScript enum이 아니므로 `Side.BUY` 식 접근 불가, 문자열 리터럴로 비교.
