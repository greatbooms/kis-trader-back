# Lib

## 책임
프레임워크 독립적인 클라이언트 측 유틸리티 모음. Apollo 클라이언트 인스턴스, 인증 상태 store, 포맷터, 도메인 상수,
거래/기술분석 표시 헬퍼 등 React 컴포넌트가 아닌 순수 함수/모듈을 둔다.

## 주요 파일 / 하위 폴더
- `apollo.ts` — `ApolloClient` 싱글턴(`/graphql` 엔드포인트, `credentials: 'include'`, default `cache-and-network`)
- `apollo-utils.ts` — `getMutationErrorMessage()` GraphQL 에러 메시지 정규화 (NestJS prefix 제거)
- `auth.ts` — 모듈 스코프 인증 상태 store (`isAuthenticated`/`setAuthenticated`/`subscribeAuth`/`getAuthSnapshot`). React 외부에서 동기 접근 가능
- `utils.ts` — `cn()`(twMerge+clsx) 및 포맷터: `formatCurrency`, `formatCurrencyByCode`, `formatNumber`, `formatPercent`, `formatDate`, `formatDateInputInTimeZone`. 거래소→통화/로케일 매핑 포함
- `market-constants.ts` — `COUNTRY_OPTIONS`(국가/시장/거래소 매핑), `EXCHANGE_LABELS`, 그리고 `exchangeToCountry`/`getCountryByValue`/`filterByCountry`/`countByCountry` 유틸
- `trade-record.ts` — 주문 상태(`OrderStatus`) → 표시 라벨/배지 variant 변환 (`getTradeRecordDisplayInfo`, `canCancelTrade`)
- `technical-ratings.ts` — 기술 지표 툴팁 사전 + `STRONG_BUY`/`BUY`/.../`STRONG_SELL` 라벨/배지 variant/액션 클래스 매핑

## 외부 의존성
- `@apollo/client` — `apollo.ts`
- `clsx`, `tailwind-merge` — `utils.ts`의 `cn`
- 내부: `@/graphql/generated` 타입(`Market`, `OrderStatus` 등)만 의존. 다른 `client/src` 폴더에는 의존하지 않는다(역참조 회피)

## 주의사항 / 비자명한 규칙
- **lib/는 React 의존성 금지** — JSX/hook 사용 금지. React 코드가 필요하면 `hooks/` 또는 `components/`로.
- **순환 의존 회피**: `lib/`는 leaf 계층. components/pages/hooks가 lib을 import할 수 있어도 그 반대는 없다.
- `auth.ts`의 store는 모듈 싱글턴 — HMR로 모듈이 다시 로드되면 상태 리셋 가능(개발 환경 한정 이슈).
- 통화 포맷팅은 거래소 코드 → 통화 코드 → 로케일 2단계 매핑(`utils.ts`). 새로운 거래소 추가 시 `EXCHANGE_CURRENCY` + `CURRENCY_LOCALE` 둘 다 갱신, 그리고 `market-constants.ts`의 `COUNTRY_OPTIONS`와 동기화.
- `formatDateInputInTimeZone`은 `<input type="date">`의 KST 변환용 — `toISOString().slice(0,10)` UTC 표기 버그 회피 목적이라 함부로 단순화하지 말 것.
- `apollo.ts`의 `cache-and-network` 기본값은 페이지 진입 시 stale 데이터 즉시 노출 + 네트워크 갱신 동작을 의미. 정확성이 중요한 화면에서는 호출부에서 `fetchPolicy: 'network-only'` 사용.
