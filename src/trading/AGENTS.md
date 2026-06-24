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
  - `momentum-breakout.strategy.ts` — **당일청산 변동성 돌파** (국내 전용 데이트레이딩). 돌파가 = 당일 시가 + 전일변동폭×K(0.5). hard 조건(시간 윈도우 09:05~14:30, 추격 가드 +1%, **MA20 위**, RSI≤75) + soft 채점(시간보정 거래량/VWAP/수급 중 2개). 청산: 이월 → 손절(-2%) → 트레일링 → 익절(기본 off) → 15:10 당일청산. 모든 주문 시장가, 1일 1진입. **MA20 hard 필터 근거**: 2023-06~2026-05 레짐 분석에서 K돌파 gross 엣지가 MA20 위에서만 유의 (005930 +0.176% vs +0.007%/거래). **적합 종목**: 변동성 크고 거래세 없는 레버리지 ETF류 — 일반 주식은 거래세(0.18%)가 gross 엣지보다 커서 데이트레이딩 비용 구조상 불리
  - `grid-mean-reversion.strategy.ts`, `conservative.strategy.ts`, `trend-following.strategy.ts`, `value-factor.strategy.ts`, `daily-dca.strategy.ts`, `noop.strategy.ts`
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
- **Slack 호출 게이트웨이**: 체결 알림은 `TradingOrderReconciliationService` 내부의 `reconcileOpenOrders`가 자체 호출(`notifyTradeFill` private). 그 외 거래 흐름의 Slack 호출은 `TradingService`를 거쳐야 — strategy가 직접 `SlackService` 호출 금지
- **`trading.enabled=false`** 이면 `TradingScheduler.onModuleInit`에서 모든 cron 등록을 건너뜀 (개발/모의 환경 안전망). 단, 직접 mutation으로 호출되는 경로(예: `manualSell`)는 별도 가드
- **Cron 시간대는 모두 KST**:
  - 국내: 매 1분 09:00-14:59 + 15:00-15:29 (장 마감 부분 분리). 미체결 주문 동기화 매 10초. 포트폴리오 동기화 매 10분
  - 해외 시간대별 비슷한 패턴 (미국 22-23 + 다음날 00-06, 아시아 09-16). 미체결 주문 동기화 매 15초, 포트폴리오 매 10분
  - 시장 레짐 감지: KR/AsiaEarly 08:50, AsiaLate 10:20, US 22:20·23:20
- **수정주가 일관성**: `MarketAnalysisService.fetchDailyPrices`로 시세 호출 시 KIS 수정주가 옵션 강제 (백테스트와 동일)
- **In-memory 상태**:
  - `TradingOrchestrator.isDomesticRunning`/`isOverseasRunning` — 루프 중복 실행 방지 mutex
  - `TradingOrchestrator.lastRiskAlertDate` — 일별 리스크 알림 중복 방지 (날짜 단위)
  - `MarketStateSyncService` 휴장일 캐시 — 일 1회 KIS API 갱신
- **백테스트와의 관계**: 전략 클래스(`*.strategy.ts`)는 `BacktestEngine`/`SimulationTickEngine`에서도 동일 인스턴스를 재사용. 즉 전략의 `evaluate()` 시그니처(`PerStockTradingStrategy`)는 backtest/simulation/실거래의 공유 계약 — breaking change는 3곳 모두 영향
- **`@Optional() SlackService`**: trading 모듈은 Slack이 없어도 부팅돼야 함. 모든 Slack 호출 분기는 `if (this.slackService)` 가드 또는 try/catch
- **momentum-breakout 청산 reason은 한글 유지 (의도된 설계)**: `TradingService.isStopLossSignal`은 영문 'stop loss'가 포함된 SELL reason을 수동 승인 대기(Slack 알림 후 수동 매도)로 보낸다. 당일청산 전략의 손절/청산('손절청산'/'당일청산' 등)은 **자동 실행되어야 하므로** reason에 'stop loss' 문구를 쓰지 않는다 — 영문으로 통일하면 장중 청산이 마비됨
- **'관망:' prefix 스킵은 무로깅**: continuous 전략이 매분 반복하는 정상 대기 상태(돌파 대기, 시간 윈도우 외, 미체결 대기 등)는 `TradingService.executePerStockStrategy`가 실행 로그/Slack 없이 조용히 건너뜀 (`isSilentWaitSkip`). 미동작 진단은 시뮬레이션 세션 또는 `triggerWatchStockNow`로 수행
- **ctx.hasOpenBuyOrder / hasOpenSellOrder**: orchestrator가 broker 미체결 주문 + **당일 로컬 PENDING TradeRecord**를 종목별로 매핑해 전달 — continuous 전략의 중복 주문 방지. 시장가 주문은 제출~reconciliation 사이에 broker 목록에서 이미 빠져 있을 수 있어 로컬 PENDING을 함께 봐야 그 공백(수 초~수십 초)의 중복 제출을 막는다. `undefined`는 "정보 없음"이며 차단하지 않음 (수동 트리거 경로는 자체 가드 보유)
- **ctx.evaluationMode**: `'daily-bar'`는 백테스트의 일봉 단위 평가. momentum-breakout은 이 모드에서 장중 의존 조건(시간/추격/soft)을 생략하고 `metadata.fillModel='stop-entry'` 조건부 신호를 발행 — 체결 판정은 backtest 엔진 책임
- **국내 일봉 지표 캐시는 KST 날짜 키**: `MarketAnalysisService.getStockIndicators`는 DOMESTIC 캐시 키에 날짜를 포함하고, `prices[0]`가 당일 봉인지 검증해 prevHigh/prevLow/todayOpen을 보정 (전일 캐시 잔존·장 시작 직후 당일 봉 미생성 오염 방지). 해외는 세션이 KST 자정을 걸치므로 기존 키 유지
- **momentum-breakout WatchStock 운영 주의**: 같은 종목에 수동 매수를 섞으면 전략이 그 물량까지 당일청산 대상으로 흡수한다. 전일 진입분이 남은 채 전략을 켜면 이월청산 규칙이 즉시 전량 매도함 (의도된 안전망)
- **momentum-breakout 시세 이상 시 청산 동작**: 보유 중 현재가가 0/음수여도 강제 청산(리스크/이월/15:10 당일청산)은 시장가로 진행된다 — 시세 글리치가 강제 청산을 막으면 포지션이 밤을 넘기기 때문. 가격의존 청산(손절/트레일링/익절)만 보류 (curPrice=0이 손절 -100%로 오판되는 것 방지)
- **momentum-breakout 트레일링은 "진입 후 고가" 기준**: 체결 시 BUY 신호 metadata의 `entryDayHigh`(진입 시점 당일 고가)를 strategyParams에 기록하고, 현재 세션 고가가 이를 넘어선 경우에만 트레일링 기준으로 사용한다 — 진입 전 스파이크가 섞인 세션 고가로 인한 진입 직후 오발동 방지. `entryDayHigh` 기록이 없으면(수동 포지션/레거시) 트레일링 미발동(손절만 동작). `entryDate`는 reconciliation 시각이 아닌 **주문 레코드 시각(KST)** 기준으로 기록 — reconciliation이 자정을 넘겨도 이월청산 판정이 밀리지 않게
- **infinite-buy 같은 사이클 BUY/SELL 비용버퍼**: 목표 익절가가 이미 현재가 이하이고 같은 평가 사이클에 BUY가 함께 생성되면, SELL을 `max(현재가, BUY가격) × (1 + sameCycleMinProfitRate)` 이상(호가 올림)으로 제출한다. 기본 `sameCycleMinProfitRate=0.006`은 해외 1주 왕복 제비용/스프레드가 0.5% 안팎인 실제 SOXL 체결 사례를 기준으로 둔 안전 버퍼다. 같은 사이클 BUY는 SELL 가격이 이 버퍼를 넘지 못하면 `TradingService`에서 제출 직전 스킵하고 quota는 기존 이월 흐름을 탄다.
