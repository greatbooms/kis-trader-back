# Simulation Module

## 책임
실전 자동매매 로직을 과거/현재 시장 데이터에 적용하여 paper trading 수행.
세션 단위로 독립적 운용, 결과 메트릭 제공.

## 주요 서비스
- `simulation.service.ts` — 얇은 façade (기존 API 호환성 유지, 내부 위임)
- `simulation-session-manager.service.ts` — 세션 CRUD, strategyParams 병합/리베이스, infinite-buy secondary exit plan
- `simulation-tick-engine.service.ts` — 틱 단위 전략 평가 + 가상 체결, pending order 관리, 수동 실행
- `simulation-position.service.ts` — 포지션 가격 업데이트, 사이클 계산/동기화
- `simulation-metrics.service.ts` — 스냅샷, 메트릭 (수익률/Sharpe/Profit factor/MDD), 리스크 평가

## 외부 의존성
- `@prisma/client` — SimulationSession, SimulationTrade, SimulationPosition, SimulationSnapshot
- `TradingModule` — `StrategyRegistryService`, `MarketAnalysisService`, `MarketRegimeService`
- `KisModule` — 실시간 시세 조회 (`KisDomesticService`, `KisOverseasService`)
- `MarketDataModule` (Global) — `MarketDataCacheService` (재무/공시 시그널)

## 주의사항
- `SimulationService`는 외부(resolver/scheduler)에서 호출되는 public API의 호환성을 유지하기 위한 façade. 내부 로직 변경 시 시그니처는 보존한다.
  - `getSessions` / `getSession` / `getPositions` / `getTrades` / `getSnapshots` / `getMetrics` — 조회
  - `createSession` / `updateStatus` / `updateSettings` / `resetSession` / `deleteSession` — 세션 life-cycle
  - `executeSimulationTick` / `triggerSessionNow` / `checkPendingOrders` / `cancelPendingOrders` / `getPendingOrderCount` — 틱/주문
  - `updatePositionPrices` / `takeSnapshot` / `calculateSessionCycle` — 포지션/스냅샷
- 신규 코드는 `SimulationSessionManager` / `SimulationTickEngine` 등 해당 책임의 서비스를 직접 주입할 것.
- 각 서비스는 자신의 책임 밖의 state 변경을 하지 않는다.
  - `SimulationMetricsService`는 세션/포지션 테이블을 수정하지 않는다 (읽기와 Snapshot upsert만).
  - `SimulationSessionManager`는 거래 레코드를 만들지 않는다 (Tick 실행에서만 생성).
  - `SimulationPositionService`는 거래 레코드 없이 포지션 PnL만 재계산한다.
- Pending order 상태는 `SimulationTickEngine`의 in-memory 맵에 있다 — 세션 삭제/리셋 시 반드시 `clearPendingOrders`를 호출해야 메모리 누수가 없다 (façade가 대신 호출해준다).
- `SimulationTickEngine`은 실전 `TradingService` / `TradingOrchestrator`와 패턴이 유사해야 한다. 전략 신호 평가 → 가상 체결 → 전략 state 후처리 순서가 실거래와 동일하게 유지되어야 시뮬레이션 신뢰성이 보장된다.
- 순환 의존성 회피:
  - `SessionManager` → `Prisma`만
  - `PositionService` → `Prisma`, `Kis*`만
  - `MetricsService` → `Prisma`만
  - `TickEngine` → 위 3개 + `StrategyRegistry` + `MarketAnalysis` + `MarketRegime` + `Kis*` + `MarketDataCache`
  - `SimulationService` façade → 위 4개 주입
