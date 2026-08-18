# Watch Stock Module

## 책임
사용자가 등록한 관심 종목(WatchStock)과 전략 설정의 CRUD. 자동 거래 루프(`TradingOrchestrator`)가 이 테이블을 읽어 어떤 종목에 어떤 전략을 돌릴지 결정. 실행 로그(`WatchStockExecutionLog`)도 함께 관리해 UI에 마지막 실행 상태를 노출한다.

## 주요 서비스 / 컴포넌트
- `watch-stock.module.ts` — `WatchStockService` export. `TradingModule` import (resolver가 `TradingOrchestrator` 사용)
- `watch-stock.service.ts` — `findAll`/`findOne`/`create`/`update`/`delete`, 실행 로그 CRUD (`findLatestExecutionLogs`, `findExecutionLogs`, `logExecution`), 사이클 계산(`findCurrentCycleMap` — 포지션 평균가 기반 동적 사이클 — infinite-buy 등 사이클 기반 전략용), 글로벌 상한 체크(`checkGlobalLimit` — 활성 30개), 이월 금액 리셋(`resetAccumulatedQuota`), **`convertToInfiniteBuyV4`** — 기존 `infinite-buy` 종목을 `infinite-buy-v4`로 전환(시딩 계산 + dryRun 미리보기), `@Cron`로 7일 지난 SKIPPED 로그 정리
- `watch-stock.resolver.ts` — query: `watchStocks`/`watchStock`/`watchStockExecutionLogs`/`previewWatchStockExecution`. mutation: `createWatchStock`/`updateWatchStock`/`deleteWatchStock`/`triggerWatchStockNow`/`resetWatchStockCarry`/`convertWatchStockToInfiniteBuyV4`. `triggerWatchStockNow`는 **`TradingOrchestrator.triggerWatchStockNow(id)`** 에 위임 — 즉시 전략 실행. `previewWatchStockExecution`은 **`TradingOrchestrator.previewWatchStockExecution(id)`** 에 위임 — "오늘 실행 미리보기"(주문 제출 없이 평가만)
- `dto/` — `WatchStockType`, `CreateWatchStockInput`, `UpdateWatchStockInput`, `WatchStockExecutionLogType`, `WatchStocksFilterInput`, `ManualTriggerResult`, `ConvertWatchStockToInfiniteBuyV4Result` (모두 1타입 1파일로 분리됨)
- `types/` — `ConvertWatchStockToV4Seed` (서비스 내부 반환 타입, dto의 GraphQL 타입과 필드 동일)

## 외부 의존성
- `@prisma/client` — `WatchStock`, `WatchStockExecutionLog`, `Position`, `Market`, `WatchStockExecutionEventType`, `Prisma.Decimal`
- `TradingModule` — `TradingOrchestrator` (수동 실행 위임)

## 주의사항 / 비자명한 규칙
- **글로벌 상한**: 활성 종목 총 30개 (`MAX_TOTAL_ACTIVE_WATCH_STOCKS`). create 시 `checkGlobalLimit` — 운영 안정성·KIS rate limit 고려한 hard cap
- **broker가 WatchStock identity의 일부**: GraphQL create는 broker 생략 시 기존 호환을 위해 `KIS`가 기본이고, 동일 종목도 broker가 다르면 각각 등록할 수 있다. 등록 후 broker 변경은 상태 이월을 막기 위해 삭제 후 재등록만 허용한다. cycle/V4 시딩 등 Position 조회는 항상 WatchStock의 `(broker, market, exchangeCode, stockCode)` 전체 키를 사용한다.
- **수동 트리거 흐름**: `triggerWatchStockNow` resolver → `TradingOrchestrator.triggerWatchStockNow` → orchestrator 내부에서 단일 watchStock에 대해 전략 평가 + 주문. `WatchStockService`가 직접 trading 로직 실행하지 않음 (모듈 책임 분리)
- **"오늘 실행 미리보기"(`previewWatchStockExecution`)는 순수 조회**: `TradingOrchestrator.previewWatchStockExecution`이 `strategy.evaluateStock()`를 직접 호출해 결과를 그대로 반환한다 — `TradingService.executePerStockStrategy`를 거치지 않으므로 주문 제출/실행 로그/strategyParams 영속화가 전혀 없다. `trading.enabled`/시장 개장 여부와 무관하게 항상 호출 가능(KIS 시세·매수가능금액 GET과 멱등적 포지션 동기화만 수행)
- **이월 금액(`accumulatedQuota`)**: infinite-buy 전략에서 매수 안 된 일별 quota를 이월 누적. `resetWatchStockCarry` mutation으로 초기화 가능. 내부 로직은 `TradingOrderReconciliationService`/`TradingService.handleStrategySignalFill`이 갱신
- **`cycle` 컬럼은 명목값**: 실제 표시 cycle은 `findCurrentCycleMap`이 계산 (사이클 기반 전략은 포지션 평균가에서 역산). resolver가 `currentCycles` map으로 override
- **strategyParams는 JSON 컬럼**: resolver에서 `JSON.stringify` ↔ `JSON.parse`로 변환. 내부 타입은 `InfiniteBuyStrategyParams` 등 (전략별 정의는 `src/trading/types/`)
- 7일 지난 SKIPPED 실행 로그는 `@Cron('0 3 * * *')`에서 정리. FILLED/CANCELLED 등은 영구 보관
- `findLatestExecutionLogs`는 batch 조회로 N+1 회피 — list 쿼리에서 활용
- **`convertToInfiniteBuyV4`**: OVERSEAS + quota/maxCycles 설정 + `infinite-buy-v4`가 아닌 종목만 대상. 별% 기본값(`starBasePct`)은 `InfiniteBuyV4Strategy`가 export하는 `DEFAULT_STAR_BASE_PCT_BY_STOCK`(TQQQ/SOXL)을 참조하고, 없으면 `strategyParams.v4.starBasePct` 명시가 있어야 진행(D8, 중복 정의 금지). 시딩값(`turn`/`cashRemaining`/`lastKnownHoldQty`)은 `Position.totalInvested`/`quantity`에서 역산하며 무포지션이면 T=0/잔금=quota 전액으로 시작. `dryRun=true`(기본)는 계산만 반환하고 DB를 쓰지 않으며, `dryRun=false`일 때만 `$transaction` 안에서 `strategyName='infinite-buy-v4'`와 `strategyParams.v4`(mode=NORMAL, cycleSeq=0, recentCloses=[])를 원자 갱신한다 — 트랜잭션 내부에서 최신 상태를 다시 읽어 동시 전환(중복 클릭 등)을 재차 거부한다. `isActive`는 건드리지 않음(기존 토글 사용)
- **`update`의 V4 quota→장부 잔금 동기화(D10, `docs/infinite-buy-v4-spec.md` §10)**: `infinite-buy-v4` 종목의 `quota`가 변경되면 증감분(`newQuota − oldQuota`)을 `strategyParams.v4.cashRemaining`에 그대로 가산한다. `$transaction` 안에서 장부를 다시 읽어 최신 `cashRemaining` 위에 델타를 적용하지만, 이 tx는 **동시 `update()` 호출 간 경합만 방지**한다 — 락 없는 체결 처리(`handleStrategySignalFill`)·평가 영속화(`persistInfiniteBuyV4State`)와의 lost-update 창은 여전히 존재한다(기존 다중 writer 패턴의 연장, 후속 과제: SELECT FOR UPDATE 기반 단일 접근자로 통합). 감액으로 `cashRemaining`이 음수가 되면 `BadRequestException`으로 거부 — 이미 투입된 돈을 장부에서 지울 수 없다는 원칙. v4 장부가 아직 없는 v4 종목(정상적으로는 발생하지 않음)은 quota만 수정하고 경고 로그만 남긴다. `quota`가 실제로 바뀌지 않는 update는 장부를 건드리지 않는다.
