# Market Data Module

## 책임
KIS 재무·시세·공시·매크로 데이터의 통합 캐시 레이어. 외부 API 호출을 in-memory + DB(`MarketDataSnapshot`) 2-tier 캐시로 감싸 전략/스크리닝/딥분석에서 재호출 비용을 줄인다. **`@Global()` 모듈** — `AppModule` 한 번 import로 모든 모듈에서 `MarketDataCacheService`/`MarketDataSnapshotService` 주입 가능.

## 주요 서비스 / 컴포넌트
- `market-data.module.ts` — `@Global()`. `KisModule`/`OpenDartModule`/`SecModule`/`FredModule` 통합 + Snapshot/Cache export (Warmup은 내부 provider)
- `market-data-snapshot.service.ts` — 범용 cache primitive. `getOrLoad<T>(request, loader)` — in-memory `Map` → DB `marketDataSnapshot` → loader 순. inflight dedup으로 중복 호출 방지. 캐시 키는 `source/category/market/exchangeCode/stockCode` 조합
- `market-data-cache.service.ts` — 도메인별 wrapper. KIS 재무 12종, OpenDART, SEC, FRED 등 카테고리별 메서드 + TTL 정의 (24h / 12h / 6h / 2h)
- `market-data-warmup.service.ts` — `@Cron('0 10 */6 * * *', Asia/Seoul)`. WatchStock의 활성 strategy 종목들을 6시간 단위로 사전 워밍업. 전략별로 필요한 카테고리 분기

## 외부 의존성
- `@prisma/client` — `MarketDataSnapshot` 테이블
- `KisModule`, `OpenDartModule`, `SecModule`, `FredModule` — 데이터 로더
- `@nestjs/schedule` — warmup cron

## 주의사항 / 비자명한 규칙
- **`@Global()` 모듈**: `AppModule`에 한 번만 import. 다른 모듈에서 `imports: [MarketDataModule]` 불필요 — 그냥 `MarketDataCacheService` 주입
- **TTL 정책**: `MarketDataCacheService.TTL` 객체에 카테고리별 정의. 분기/연간 보고서는 24h, 컨센서스/투자의견은 12h, 외국인/기관 일별 매매는 2h
- **캐시 키 규칙** (`buildKey`): `source/category/market/exchangeCode/stockCode` — `forceRefresh=true`면 in-memory + DB 모두 재조회 후 갱신
- **inflight dedup**: 같은 키에 대해 동시 호출이 들어오면 한 번만 loader 실행 → 모두 같은 Promise 공유
- **빈 결과 캐싱**: loader가 `undefined`/`null` 반환해도 캐시됨 (TTL 동안). 외부 API 미설정/장애 상황에 반복 호출 방지 효과
- 직접 `KisDomesticService`/`OpenDartService` 등을 주입해 우회 호출 금지 — 캐시 효과를 잃음. 운영 코드는 항상 `MarketDataCacheService` 경유
- Warmup은 watchStock에 등록된 활성 종목만 대상. screening의 후보 종목은 별도 워밍업 없음 (실시간 호출이 캐시 채움)
