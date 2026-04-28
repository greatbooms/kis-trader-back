# Trading Module

## 책임
KIS API 기반 실전 자동매매. 전략 신호 평가, 주문 제출, 포지션/주문 상태 동기화, 리스크 관리 조정. 운영 자동매매의 모든 BUY/SELL 주문은 이 모듈에서 출발.

## 주요 서비스
- `trading.service.ts` — 전략 호출 → 주문 실행의 핵심 흐름 (signal executor)
- `trading-position-sync.service.ts` — Broker 잔고를 DB `Position` 테이블에 반영
- `trading-order-reconciliation.service.ts` — 미체결 주문 상태 추적, 취소/체결 확정 + 전략별 후처리(carry 리셋 등)
- `trading-orchestrator.service.ts` — 국내/해외 시장별 거래 루프 (전략 그룹핑, 컨텍스트 빌드, 신호 평가 + 주문, 리스크 알림, 시장 레짐 감지, 수동 실행 엔트리)
- `market-state-sync.service.ts` — 장중 broker 상태 동기화 (미체결 주문 재조정, 포지션/잔고 동기화, 휴장일 캐시 및 시장 오픈/휴장 판단 헬퍼)
- `trading.scheduler.ts` — cron 등록 전용. 각 cron 콜백은 orchestrator / market-state-sync로 위임. `isBusy()` facade 노출 (SimulationScheduler 등이 사용)
- `market-analysis.service.ts` — 기술 지표(RSI/MA/ATR/ADX/Bollinger/볼륨 등)와 시장 조건 계산. `calculateTechnicalRatings`도 제공 (UI 전광판용)
- `market-regime.service.ts` — 시장 레짐(강세/약세/중립) 판단
- `risk-management.service.ts` — 포트폴리오 MDD/투자율 평가
- `order-sync.service.ts` — 주기적 주문 동기화 헬퍼
- `strategy/` — 전략 구현체 + 레지스트리
  - `strategy-registry.service.ts` — 모든 전략을 name → instance 맵으로 등록
  - `infinite-buy.strategy.ts` — 무한매수법 (intraday VWAP exit / quota carry / RSI policy)
  - `momentum-breakout.strategy.ts`, `grid-mean-reversion.strategy.ts`, `conservative.strategy.ts`, `trend-following.strategy.ts`, `value-factor.strategy.ts`, `daily-dca.strategy.ts`, `noop.strategy.ts`
  - `infinite-buy-quota.util.ts`, `infinite-buy-target-table.ts` — 무한매수 보조 유틸 (백테스트와 공유)

## 외부 의존성
- `@prisma/client` — `Position`, `TradeRecord`, `WatchStock`, `WatchStockExecutionLog`, 각종 enum
- `KisModule` — `KisDomesticService`, `KisOverseasService`
- `NotificationModule` — `SlackService`/`SlackCommandsService` (`@Optional()`로 주입 — Slack 비활성 환경 대응)
- `MarketDataModule` (Global) — `MarketDataCacheService` (재무/공시/매크로 시그널)

## 주의사항
- 공개 API는 각 서비스별로 분리됨 — 호출부는 책임에 맞는 서비스를 직접 주입해서 사용해야 함
  - `TradingService.executePerStockStrategy` / `executeApprovedStopLoss` / `handleStrategySignalFill` — 신호 평가/주문 제출/전략 fill 후처리 진입점
  - `TradingPositionSyncService.syncPositions` — Broker 잔고 기반 포지션 동기화 (scheduler/orchestrator에서 호출)
  - `TradingOrderReconciliationService.reconcileOpenOrders` / `markOpenOrderCancelled` — 미체결 주문 정리 (order-sync/market-state-sync에서 호출)
  - `TradingOrchestrator.executeDomestic` / `executeOverseas` / `triggerWatchStockNow` / `runMarketRegimeDetection` / `isBusy` — cron이 호출하는 거래 루프 엔트리
  - `MarketStateSyncService.syncDomesticOpenOrders` / `syncOverseasOpenOrders` / `syncDomesticPortfolioState` / `syncOverseasPortfolioState` / `isMarketOpen` / `isExchangeHoliday` — 장중 broker 상태 동기화 및 시장 오픈 판단
  - `StrategyRegistryService.getStrategy(name)` — `screening`/`simulation`/`backtest`에서 같은 전략 인스턴스를 재사용
- `TradingOrderReconciliationService`는 전략별 체결 후처리(carry 리셋 등)를 위해 `TradingService.handleStrategySignalFill`을 호출 — `TradingService` → `TradingOrderReconciliationService` 주입 금지 (순환 의존성)
- `TradingService`는 주문 직전 포지션 재동기화를 위해 `TradingPositionSyncService`에 의존
- `TradingOrchestrator` → `TradingService`, `MarketStateSyncService` 주입. 반대로 `MarketStateSyncService`는 `TradingOrchestrator`를 참조하지 않음 (순환 의존성 회피)
- **Slack 호출 게이트웨이**: `TradingOrderReconciliationService.notifyTradeFill` 또는 `TradingService`를 거쳐야 — strategy가 직접 `SlackService` 호출 금지
- **`trading.enabled=false`** 이면 `TradingScheduler.onModuleInit`에서 모든 cron 등록을 건너뜀 (개발/모의 환경 안전망). 단, 직접 mutation으로 호출되는 경로(예: `manualSell`)는 별도 가드
- **Cron 시간대는 모두 KST**:
  - 국내: 매 1분 09:00-14:59 + 15:00-15:29 (장 마감 부분 분리). 미체결 주문 동기화 매 10초. 포트폴리오 동기화 매 10분
  - 해외 시간대별 비슷한 패턴 (미국/홍콩/중국/일본/베트남)
- **수정주가 일관성**: `MarketAnalysisService.fetchDailyPrices`로 시세 호출 시 KIS 수정주가 옵션 강제 (백테스트와 동일)
- **In-memory 상태**:
  - `TradingOrchestrator.isDomesticRunning`/`isOverseasRunning` — 루프 중복 실행 방지 mutex
  - `TradingOrchestrator.lastRiskAlertDate` — 일별 리스크 알림 중복 방지 (날짜 단위)
  - `MarketStateSyncService` 휴장일 캐시 — 일 1회 KIS API 갱신
- **백테스트와의 관계**: 전략 클래스(`*.strategy.ts`)는 `BacktestEngine`/`SimulationTickEngine`에서도 동일 인스턴스를 재사용. 즉 전략의 `evaluate()` 시그니처(`PerStockTradingStrategy`)는 backtest/simulation/실거래의 공유 계약 — breaking change는 3곳 모두 영향
- **`@Optional() SlackService`**: trading 모듈은 Slack이 없어도 부팅돼야 함. 모든 Slack 호출 분기는 `if (this.slackService)` 가드 또는 try/catch
