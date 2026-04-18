# Trading Module

## 책임
KIS API 기반 실전 자동매매. 전략 신호 평가, 주문 제출, 포지션/주문 상태 동기화, 리스크 관리 조정.

## 주요 서비스
- `trading.service.ts` — 전략 호출 → 주문 실행의 핵심 흐름 (signal executor)
- `trading-position-sync.service.ts` — Broker 잔고를 DB Position 테이블에 반영
- `trading-order-reconciliation.service.ts` — 미체결 주문 상태 추적, 취소/체결 확정
- `trading-orchestrator.service.ts` — 국내/해외 시장별 거래 루프 (전략 그룹핑, 컨텍스트 빌드, 신호 평가 + 주문, 리스크 알림, 시장 레짐 감지, 수동 실행 엔트리)
- `market-state-sync.service.ts` — 장중 broker 상태 동기화 (미체결 주문 재조정, 포지션/잔고 동기화, 휴장일 캐시 및 시장 오픈/휴장 판단 헬퍼)
- `trading.scheduler.ts` — cron 등록 전용 (각 cron 콜백은 orchestrator / market-state-sync로 위임)
- `market-analysis.service.ts` — 기술 지표(RSI/MA/ATR 등)와 시장 조건 계산
- `market-regime.service.ts` — 시장 레짐(강세/약세) 판단
- `risk-management.service.ts` — 포트폴리오 MDD/투자율 평가
- `order-sync.service.ts` — 주기적 주문 동기화
- `strategy/` — 전략 구현체들 (`infinite-buy.strategy.ts` 등)

## 외부 의존성
- `@prisma/client` — Position, TradeRecord, WatchStock, WatchStockExecutionLog 등
- `KisModule` — `KisDomesticService`, `KisOverseasService`
- `NotificationModule` — `SlackService` (Optional)

## 주의사항
- 공개 API는 각 서비스별로 분리됨 — 호출부는 책임에 맞는 서비스를 직접 주입해서 사용해야 함
  - `TradingService.executePerStockStrategy` / `executeApprovedStopLoss` / `handleStrategySignalFill` — 신호 평가/주문 제출/전략 fill 후처리 진입점
  - `TradingPositionSyncService.syncPositions` — Broker 잔고 기반 포지션 동기화 (scheduler/orchestrator에서 호출)
  - `TradingOrderReconciliationService.reconcileOpenOrders` / `markOpenOrderCancelled` — 미체결 주문 정리 (order-sync/market-state-sync에서 호출)
  - `TradingOrchestrator.executeDomestic` / `executeOverseas` / `triggerWatchStockNow` / `runMarketRegimeDetection` — cron이 호출하는 거래 루프 엔트리
  - `MarketStateSyncService.syncDomesticOpenOrders` / `syncOverseasOpenOrders` / `syncDomesticPortfolioState` / `syncOverseasPortfolioState` / `isMarketOpen` / `isExchangeHoliday` — 장중 broker 상태 동기화 및 시장 오픈 판단
- `TradingOrderReconciliationService`는 전략별 체결 후처리(carry 리셋 등)를 위해 `TradingService.handleStrategySignalFill`을 호출 — `TradingService` → `TradingOrderReconciliationService` 주입 금지 (순환 의존성)
- `TradingService`는 주문 직전 포지션 재동기화를 위해 `TradingPositionSyncService`에 의존
- `TradingOrchestrator` → `TradingService`, `MarketStateSyncService` 주입. 반대로 `MarketStateSyncService`는 `TradingOrchestrator`를 참조하지 않음 (순환 의존성 회피)
- Slack 호출은 `TradingOrderReconciliationService.notifyTradeFill` 또는 `TradingService`를 거쳐야 (strategy가 직접 SlackService 호출 금지)
