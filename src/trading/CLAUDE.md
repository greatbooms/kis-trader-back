# Trading Module

## 책임
KIS API 기반 실전 자동매매. 전략 신호 평가, 주문 제출, 포지션/주문 상태 동기화, 리스크 관리 조정. 운영 자동매매의 모든 BUY/SELL 주문은 이 모듈에서 출발.

## 주요 서비스
- `trading.service.ts` — 전략 호출 → 주문 실행의 핵심 흐름 (signal executor)
- `trading-sell-approval.service.ts` — 손절/청산성 SELL 및 고 T 무한매수 익절의 Slack 승인 대기/재알림 흐름
- `trading-sell-approval-workflow.service.ts` — 승인자 검증, 승인/거절 pair claim, 최신 broker 잔고 기반 수량 clamp, 승인 SELL 단일 제출 및 결과 영속화
- `trading-sell-approval-notification.service.ts` — 승인 row 기반 원본 Slack 메시지의 authoritative 상태 매핑/갱신을 best-effort로 수행
- `trading-broker-order-submission.service.ts` — 국내/해외·BUY/SELL KIS 주문 mutation dispatch의 단일 gateway
- `trading-position-sync.service.ts` — Broker 잔고를 DB `Position` 테이블에 반영
- `trading-position-refresh.service.ts` — 주문 직전 broker 잔고 조회와 DB position 동기화를 한 번에 수행하는 공용 서비스
- `trading-account-cash-sync.service.ts` — KIS 예수금 조회와 `account_status_cache`의 전체/시장별 원자적 갱신
- `trading-order-reconciliation.service.ts` — 미체결 주문 상태 추적, 취소/체결 확정 + 전략별 후처리(carry 리셋 등)
- `trading-broker-order-matcher.service.ts` — 저장된 broker context를 검증하고 완전한 KIS 주문 이력에서 불명 주문 복구 후보만 보수적으로 필터링하는 GET-only 서비스
- `trading-broker-order-resolution.service.ts` — 불명 주문 후보의 기존 기록 충돌 검사, 사용자 선택 후보 연결, 미주문/기존 기록 일치 확정을 CAS/감사 트랜잭션으로 처리하는 서비스. 모든 확인은 mutation 시점의 완전한 KIS 재조회 후 수행하며 KIS POST는 호출하지 않음
- `trading-broker-cancellation-recovery.service.ts` — 취소 결과 불명 주문을 완전한 KIS 체결/미체결 GET으로 재검증하고, 확인 가능한 종료 또는 미접수 상태만 CAS/감사 트랜잭션으로 확정하는 서비스
- `trading-broker-order-recovery.resolver.ts` — 웹 인증 사용자와 복구 서비스 사이의 얇은 GraphQL 어댑터. 15초 목록 조회는 DB-only이며 KIS 조회는 명시적 mutation에서만 수행
- `trading-orchestrator.service.ts` — 국내/해외 시장별 거래 루프 (전략 그룹핑, 컨텍스트 빌드, 신호 평가 + 주문, 리스크 알림, 시장 레짐 감지, 수동 실행 엔트리)
- `trading-slack-commands.service.ts` — Slack 슬래시 커맨드/승인 액션을 거래 서비스와 연결하는 인바운드 어댑터
- `trading-slack-actor-authorization.service.ts` — `slack.approverUserIds` exact allowlist를 fail-closed로 검사하는 Slack actor 인증 경계
- `trading-slack-recovery-presentation.service.ts` — 불명 주문 알림, 후보 표시, 확인 modal, 해결 후 원본 메시지 best-effort 갱신을 담당하는 Slack 표현 계층
- `trading-slack-recovery-actions.service.ts` — `/확인필요주문`과 복구 action/view를 등록하고 승인된 actor/channel로 공용 복구 서비스에만 위임하는 인바운드 어댑터
- `trading-broker-recovery-slack-alert.service.ts` — durable UNKNOWN TradeRecord를 안전한 Slack 복구 알림으로 변환하며 broker account hash는 표현 계층에 전달하지 않는 서비스
- `market-state-sync.service.ts` — 장중 broker 상태 동기화 (미체결 주문 재조정, 포지션/잔고 동기화, 휴장일 캐시 및 시장 오픈/휴장 판단 헬퍼)
- `trading.scheduler.ts` — 시작 시 남은 주문/취소 상태 인계를 시작하고 recovery-ready barrier 뒤에서만 cron 콜백을 orchestrator / market-state-sync로 위임. `isBusy()` facade 노출 (SimulationScheduler 등이 사용)
- `market-analysis.service.ts` — 기술 지표(RSI/MA/ATR/ADX/Bollinger/볼륨 등)와 시장 조건 계산. `calculateTechnicalRatings`도 제공 (UI 전광판용)
- `market-regime.service.ts` — 시장 레짐(강세/약세/중립) 판단
- `risk-management.service.ts` — 포트폴리오 MDD/투자율 평가
- `order-sync.service.ts` — 주기적 주문 동기화 헬퍼
- `strategy/` — 전략 구현체 + 레지스트리
  - `strategy-registry.service.ts` — 모든 전략을 name → instance 맵으로 등록
  - `infinite-buy.strategy.ts` — 무한매수법 (intraday VWAP exit / quota carry / RSI policy)
  - `infinite-buy-v4.strategy.ts` — **무한매수법 V4** (라오어 V4.0 원본 충실 구현, **해외 전용**, LOC/MOC 종가 체결, T>N-1 소진 시 REVERSE 모드). 규칙·결정 근거는 `docs/infinite-buy-v4-spec.md`, A/B 성과는 `docs/infinite-buy-v4-ab-summary.md`. 상태(T/잔금/모드)는 `WatchStock.strategyParams.v4` 장부가 진실 — 수동매매로 broker 보유와 어긋나면 흡수하지 않고 평가 중단. 보조: `infinite-buy-v4-math.util.ts`(순수 수식), `infinite-buy-v4-ledger.util.ts`(체결 장부 전이 — 실거래 `handleStrategySignalFill`과 백테스트 엔진이 동일 함수 공유)
  - `momentum-breakout.strategy.ts` — **당일청산 변동성 돌파** (국내 전용 데이트레이딩). 돌파가 = 당일 시가 + 전일변동폭×K(0.5). hard 조건(시간 윈도우 09:05~14:30, 추격 가드 +1%, **MA20 위**, RSI≤75) + soft 채점(시간보정 거래량/VWAP/수급 중 2개). 청산: 이월 → 손절(-2%) → 트레일링 → 익절(기본 off) → 15:10 당일청산. 모든 주문 시장가, 1일 1진입. **MA20 hard 필터 근거**: 2023-06~2026-05 레짐 분석에서 K돌파 gross 엣지가 MA20 위에서만 유의 (005930 +0.176% vs +0.007%/거래). **적합 종목**: 변동성 크고 거래세 없는 레버리지 ETF류 — 일반 주식은 거래세(0.18%)가 gross 엣지보다 커서 데이트레이딩 비용 구조상 불리
  - `grid-mean-reversion.strategy.ts`, `conservative.strategy.ts`, `trend-following.strategy.ts`, `value-factor.strategy.ts`, `daily-dca.strategy.ts`, `noop.strategy.ts`
  - `infinite-buy-quota.util.ts`, `infinite-buy-target-table.ts` — 무한매수 보조 유틸 (백테스트와 공유)

## 외부 의존성
- `@prisma/client` — `Position`, `TradeRecord`, `WatchStock`, `WatchStockExecutionLog`, 각종 enum
- `KisModule` — `KisDomesticService`, `KisOverseasService`
- `NotificationModule` — outbound `SlackService` (`@Optional()`로 주입 — Slack 비활성 환경 대응)
- `MarketDataModule` (Global) — `MarketDataCacheService` (재무/공시/매크로 시그널)

## 주의사항
- 공개 API는 각 서비스별로 분리됨 — 호출부는 책임에 맞는 서비스를 직접 주입해서 사용해야 함
  - `TradingService.executePerStockStrategy` / `handleStrategySignalFill` — 신호 평가/일반 주문 위임/전략 fill 후처리 진입점
  - `TradingSellApprovalWorkflowService.approve` / `reject` — SELL 승인 결정 및 승인 주문 제출의 유일한 진입점
  - `TradingPositionSyncService.syncPositions` — Broker 잔고 기반 포지션 동기화 (scheduler/orchestrator에서 호출)
  - `TradingAccountCashSyncService.refreshMarketCash` / `replaceCache` — 체결 후 시장별 예수금 갱신과 수동 전체 계좌 캐시 교체
  - `TradingOrderReconciliationService.reconcileOpenOrders` / `markOpenOrderCancelled` — 미체결 주문 정리 (order-sync/market-state-sync에서 호출)
  - `TradingOrchestrator.executeDomestic` / `executeOverseas` / `triggerWatchStockNow` / `runMarketRegimeDetection` / `isBusy` — cron이 호출하는 거래 루프 엔트리
  - `TradingOrchestrator.previewWatchStockExecution` — "오늘 실행 미리보기". `strategy.evaluateStock()`를 주문 제출 없이 그대로 호출해 결과만 반환 (미리보기 전용 계산식 없음 — evaluateStock은 Prisma/KIS/Slack 미접근 순수 함수라 어떤 전략이든 안전). `executePerStockStrategy`를 호출하지 않으므로 주문 제출/실행 로그/strategyParams 영속화(v4StateUpdate 등)가 전혀 없음. `trading.enabled=false`에서도 동작(주문을 내지 않으므로 라이브 스위치와 무관)
  - `MarketStateSyncService.syncDomesticOpenOrders` / `syncOverseasOpenOrders` / `syncDomesticPortfolioState` / `syncOverseasPortfolioState` / `isMarketOpen` / `isExchangeHoliday` — 장중 broker 상태 동기화 및 시장 오픈 판단
  - `StrategyRegistryService.getStrategy(name)` — `screening`/`simulation`/`backtest`에서 같은 전략 인스턴스를 재사용
- `TradingOrderReconciliationService`는 전략별 체결 후처리(carry 리셋 등)를 위해 `TradingService.handleStrategySignalFill`을 호출 — `TradingService` → `TradingOrderReconciliationService` 주입 금지 (순환 의존성)
- 주문 직전 포지션 재동기화는 `TradingPositionRefreshService`를 사용하는 order execution/approval workflow가 담당한다. `TradingService`에 승인 전용 refresh/order 로직을 다시 추가하지 않는다.
- **체결 후 예수금 동기화**: `OrderSyncService`는 reconciliation에서 새 체결이 확인된 경우에만 `TradingAccountCashSyncService.refreshMarketCash`를 시장당 한 번 호출한다. KIS/캐시 실패는 체결 확정을 되돌리지 않으며, 캐시 병합은 `account_status_cache` advisory transaction lock 아래 반대 시장 항목을 보존한다.
- `TradingOrchestrator` → `TradingService`, `MarketStateSyncService` 주입. 반대로 `MarketStateSyncService`는 `TradingOrchestrator`를 참조하지 않음 (순환 의존성 회피)
- **Slack 호출 게이트웨이**: 체결 알림은 `TradingOrderReconciliationService` 내부의 `reconcileOpenOrders`가 자체 호출(`notifyTradeFill` private). 승인 요청 전송은 `TradingSellApprovalService`, 승인 결과 원본 메시지 갱신은 `TradingSellApprovalNotificationService`, 불명 주문 알림/복구 표현은 `TradingBrokerRecoverySlackAlertService`/`TradingSlackRecoveryPresentationService`가 담당한다. strategy와 승인 workflow가 직접 `SlackService`를 호출하는 것은 금지한다.
- **자동 주문 실패 Slack**: `TradingOrderFailureNotificationService`만 automatic strategy `FAILED`를 Slack 컨텍스트로 변환한다. submission/reconciliation CAS winner가 DB 확정 뒤 호출하며 UNKNOWN·CANCELLED·manual·승인 SELL은 기존 흐름을 유지한다.
- **Slack adapter 소유권**: `TradingSlackCommandsService`, Slack 복구 authorization/presentation/actions/alert 서비스, `TradingSellApprovalWorkflowService`는 `TradingModule`의 local provider이며 export하지 않는다. `TradingModule -> NotificationModule` 단방향만 허용하고 `NotificationModule`은 Trading을 역참조하지 않는다.
- **시작 인계 barrier**: `TradingScheduler.onModuleInit`은 `TradingBrokerOrderRecoveryService.takeOverStartupState()`를 한 번 실행한다. timestamp가 있는 제출 `SUBMITTING`은 `SUBMISSION_UNKNOWN`, 없는 제출은 감사 로그와 함께 `CANCELLED`, 취소 `SUBMITTING`은 `UNKNOWN`으로 전환하며 KIS POST는 호출하지 않는다. 모든 cron callback은 이 Promise를 기다리고 인계 실패 시 계속 차단된다. Slack에는 개별 row가 아니라 현재 unresolved 총건수만 한 번 best-effort로 알린다.
- **`trading.enabled=false`** 이면 시작 인계는 수행하되 모든 trading cron 등록을 건너뜀 (개발/모의 환경 안전망). 인증된 Slack/웹 복구는 계속 사용할 수 있다. 직접 mutation으로 호출되는 경로(예: `manualSell`)는 별도 가드
- **Cron 시간대는 모두 KST**:
  - 국내: 매 1분 09:00-14:59 + 15:00-15:29 (장 마감 부분 분리). 미체결 주문 동기화 매 10초. 포트폴리오 동기화 매 10분
  - 해외 시간대별 비슷한 패턴 (미국 22-23 + 다음날 00-06, 아시아 09-16). 미체결 주문 동기화 매 15초, 포트폴리오 매 10분
  - 시장 레짐 감지: KR/AsiaEarly 08:50, AsiaLate 10:20, US 22:20·23:20
- **해외 cron 초 분산**: 거래는 0초, 주문 동기화는 10/25/40/55초, 포트폴리오 동기화는 10분 주기의 20초에 시작한다. `orchestratorBusy` 가드는 그대로 유지한다.
- **수정주가 일관성**: `MarketAnalysisService.fetchDailyPrices`로 시세 호출 시 KIS 수정주가 옵션 강제 (백테스트와 동일)
- **In-memory 상태**:
  - `TradingOrchestrator.isDomesticRunning`/`isOverseasRunning` — 루프 중복 실행 방지 mutex
  - `TradingOrchestrator.lastRiskAlertDate` — 일별 리스크 알림 중복 방지 (날짜 단위)
  - `MarketStateSyncService` 휴장일 캐시 — 일 1회 KIS API 갱신
- **백테스트와의 관계**: 전략 클래스(`*.strategy.ts`)는 `BacktestEngine`/`SimulationTickEngine`에서도 동일 인스턴스를 재사용. 즉 전략의 `evaluate()` 시그니처(`PerStockTradingStrategy`)는 backtest/simulation/실거래의 공유 계약 — breaking change는 3곳 모두 영향
- **`@Optional() SlackService`**: trading 모듈은 Slack이 없어도 부팅돼야 함. 모든 Slack 호출 분기는 `if (this.slackService)` 가드 또는 try/catch
- **청산성 SELL은 관리자 승인 대기**: 손절, 리스크 전량청산, 당일청산, 이월청산, 트레일링 스탑 등 청산성 매도는 reason 언어와 무관하게 `TradingService`에서 KIS 주문 제출 전 `StopLossApproval` 기반 Slack 승인 요청으로 전환한다. 일반 익절은 자동 실행을 유지하되, `infinite-buy` 익절에서 T가 20 이상이면 승인 대기로 보낸다.
- **SELL 승인 분류는 명시적 allowlist**: `stop-loss`/`intraday-stop`, `risk-liquidation`, `eod-exit`, `carryover-exit`, `trailing-stop` phase와 레거시 보호성 reason만 승인 대상으로 본다. 추세소멸·과열청산·일반 익절·알 수 없는 일반 SELL은 자동 실행을 유지하고, `infinite-buy` 익절만 T가 20 이상일 때 추가로 승인 대기한다. (`isHighTInfiniteBuyTakeProfitSignal`은 전략명 **정확 일치** 비교 — `infinite-buy-v4`는 대상 아님)
- **infinite-buy-v4 정례 매도는 승인 예외 (스펙 D3)**: `v4-quarter-sell`/`v4-final-sell`/`v4-reverse-sell`은 승인 allowlist에 포함하지 않고 자동 실행한다. 후반전 쿼터매도·리버스 매도는 성격상 손절이지만 방법론상 **매일 발생하는 정례 주문**이라 건별 Slack 승인은 운영 불가능하다. 대신 REVERSE 진입 시점에 실행 로그(phase=`v4-reverse-enter`)로 1회 가시화하고, 일일 체결 알림으로 가시성을 확보한다. 이 phase들을 승인 allowlist에 추가하지 말 것.
- **infinite-buy 외부 리스크 청산**: 기존 리스크 소스가 `riskState.liquidateAll=true`를 전달한 경우에만, 보유 종목 손실률이 `mddLiquidateStockLossThreshold`(기본 20%) 이상이면 전량 `SELL`을 `metadata.phase='risk-liquidation'`으로 발행한다. 이 분기는 새 MDD 임계값을 활성화하거나 전략 meta/RiskManagementService의 판단을 대체하지 않는다.
- **SELL 승인 생성/전송 lease**: `TradingSellApprovalService`는 요청 진입 시 종목 식별자를 한 번 정규화한다(국내 exchange=`KRX`, 해외 exchange/stockCode=`trim().toUpperCase()`). 만료·cooldown·order guard·생성·재조회·Slack은 모두 이 동일 tuple을 사용한다. broker environment/account hash를 캡처하고 공용 advisory order guard 안에서 `TradeRecord(AWAITING_APPROVAL)`와 `StopLossApproval(PENDING)`를 한 트랜잭션으로 생성한다. 기존 PENDING 요청은 읽기만 하며 갱신·재전송하지 않는다. 최초 만료는 2분이고, 유효한 Slack `ts/channel` 전달이 확인되면 Slack `ts` 기준 10분으로 확정한다. Slack `ts`는 별도 clock-skew 허용 없이 승인 `requestedAt <= ts <= Slack 응답 수신 시각`이어야 한다. 전달 실패·비활성·잘못된 metadata는 두 row를 원자적으로 `EXPIRED/CANCELLED` 처리하고 `notifiedAt`을 남기지 않는다. 새 요청 cooldown은 마지막 성공 `notifiedAt`부터 고정 30분이다.
- **Slack 승인 액션은 thin adapter**: `TradingSlackCommandsService` approve/reject 콜백은 `approvalId`와 `(body as any).user?.id`만 추출해 workflow에 한 번 위임한다. approval/trade row 조회·mutation, KIS 호출, 승인 원본 메시지 update는 금지한다. `PENDING`, delivery metadata, expiry, actor allowlist 검증은 모두 workflow가 소유한다.
- **SELL 승인 결정/제출 원자성**: `TradingSellApprovalWorkflowService`만 `PENDING/AWAITING_APPROVAL` pair를 한 트랜잭션에서 `APPROVED/SUBMITTING` 또는 `REJECTED/CANCELLED`로 claim한다. 승인자는 `slack.approverUserIds` exact allowlist로 DB/KIS 접근 전에 검증한다. APPROVE는 저장된 broker environment/account hash를 pair claim 전·잔고 refresh 전·`submissionStartedAt` CAS 직전·CAS 직후·감사 로그 후 KIS 호출 직전에 현재 KIS context와 비교하고, 누락/불일치/도중 전환이면 fail-closed한다. CAS 뒤 전환은 자신이 획득한 정확한 `submissionStartedAt`으로만 `CANCELLED` 전환하며, REJECT는 계좌 context와 무관하게 기존 pair를 취소할 수 있다. claim winner만 broker 잔고를 새로 읽고 venue/stock holding을 매칭해 수량을 clamp한 뒤 `submissionStartedAt` CAS winner로서 감사 로그를 남기고 KIS SELL을 한 번 호출한다. pre-claim·pre-POST live switch 중 하나라도 꺼지면 제출하지 않으며, `UNKNOWN`/throw/불완전 ACCEPTED identity는 `SUBMISSION_UNKNOWN` recovery로 보낸다. ACCEPTED 뒤에는 KIS를 재호출하지 않고 DB 저장만 최대 총 3회 시도한다. Slack 버튼 업데이트는 항상 DB transaction 밖의 best-effort이며, 미제출 표시는 거래가 `CANCELLED`로 확정된 경우에만 사용한다.
- **주문 mutation gateway**: 자동 주문과 승인 SELL은 `TradingBrokerOrderSubmissionService.submit(signal)`만 호출한다. 국내/해외 및 BUY/SELL별 `orderBuy`/`orderSell` 선택은 gateway가 소유하며, gateway는 외부 throw를 종목 prefix로 경고한 뒤 그대로 재전파해 caller가 durable UNKNOWN 처리를 결정하게 한다. 자동 주문도 `submissionStartedAt` CAS 직후 broker context와 live switch를 다시 확인하고, 실패 시 자신이 획득한 정확한 timestamp의 row만 `CANCELLED`로 되돌린 뒤 POST하지 않는다.
- **legacy 승인 실행 차단**: `TradingService.executeApprovedStopLoss(approvalId)`는 소스 호환성만 위한 deprecated fail-closed facade다. 항상 `[APPROVAL ${approvalId}]` 경고 후 `TradingSellApprovalWorkflowService` 사용을 지시하는 예외를 던지며 Prisma/KIS/Slack/position refresh에 접근하지 않는다. 이 메서드에 workflow를 주입해 actorless delegation을 복원하지 않는다.
- **불명 주문/취소 복구 경계**: `TradingBrokerOrderRecoveryService`가 Slack/웹 공용 public API와 DB-only 큐를 소유한다. 제출 후보 연결·미제출·기존 기록 일치는 `TradingBrokerOrderResolutionService`, 취소 불명 상태는 `TradingBrokerCancellationRecoveryService`에 위임한다. 상태 변경 전에는 현재 broker context와 완전한 KIS GET 결과를 다시 검증하고 CAS와 감사 로그를 한 트랜잭션으로 처리한다. 양쪽 목록에서 주문이 보이지 않는다는 사실만으로 종료를 추론하지 않으며, 어떤 복구 액션도 KIS POST/취소 재시도를 호출하지 않는다.
- **자동 미체결 취소 TOCTOU 경계**: `TradingOrderCancellationService`는 broker 미체결 식별자를 fail-closed 정규화하고 현재 환경/계좌 hash를 포함한 전체 주문 tuple로 로컬 open record를 조회한다. cancellation claim 뒤 record를 재조회해 `SUBMITTING`과 최초 tuple/context가 그대로인지 확인하고, KIS POST 직전에 live switch와 현재 broker context를 다시 확인한다. 어느 검증이든 실패하면 claim을 해제하며 취소 POST는 호출하지 않는다.
- **Slack 복구는 승인된 thin adapter**: 목록/후보 조회를 포함한 모든 action은 DB/KIS 접근 전에 `slack.approverUserIds` exact allowlist를 통과해야 한다. 상태 변경은 필수 확인 modal 이후 `{ channel: 'SLACK', actor: 'slack:<userId>' }`로 공용 복구 서비스에 한 번만 위임하며 Prisma/KIS를 직접 호출하지 않는다. 어떤 Slack action도 주문이나 취소를 제출·재시도하지 않고, 해결 후 원본 메시지 갱신 실패는 authoritative DB 결과를 되돌리지 않는다.
- **broker context preview binding**: 복구 목록 polling은 현재 KIS context를 조회하거나 계정 정보를 보강하지 않는다. legacy context 배정 확인창을 열 때만 별도 인증 query로 환경·마스킹 계좌와 해당 context에 HMAC으로 묶인 opaque token을 발급한다. 웹과 Slack은 확인 시 같은 token을 제출해야 하며, 계좌/환경이 바뀌면 DB 접근 전에 fail-closed한다. hash/raw 계좌와 token은 로그·감사 details에 남기지 않는다.
- **'관망:' prefix 스킵은 무로깅**: continuous 전략이 매분 반복하는 정상 대기 상태(돌파 대기, 시간 윈도우 외, 미체결 대기 등)는 `TradingService.executePerStockStrategy`가 실행 로그/Slack 없이 조용히 건너뜀 (`isSilentWaitSkip`). 미동작 진단은 시뮬레이션 세션 또는 `triggerWatchStockNow`로 수행
- **시그널과 skipReasons 동시 발생 시에도 스킵 사유를 남긴다**: `infinite-buy`/`infinite-buy-v4`는 SELL(쿼터매도·익절 등)은 항상 평가하고 BUY만 잔고 부족 등으로 거절할 수 있어, 같은 평가에서 `signals`와 `skipReasons`가 함께 채워질 수 있다. `executePerStockStrategy`는 이 경우 SIGNAL_CREATED 로그와 별도로 `매수 스킵: ...` SKIPPED 로그를 남긴다 (`관망:`/`오늘 이미 실행됨` 계열은 기존 무로깅 규칙 유지). 이 스킵 로그가 없으면 "매도만 찍히고 이월/잔고부족 사유가 흔적 없이 사라지는" 진단 공백이 생긴다
- **ctx.hasOpenBuyOrder / hasOpenSellOrder**: orchestrator가 broker 미체결 주문 + **당일 로컬 PENDING TradeRecord**를 종목별로 매핑해 전달 — continuous 전략의 중복 주문 방지. 시장가 주문은 제출~reconciliation 사이에 broker 목록에서 이미 빠져 있을 수 있어 로컬 PENDING을 함께 봐야 그 공백(수 초~수십 초)의 중복 제출을 막는다. `undefined`는 "정보 없음"이며 차단하지 않음 (수동 트리거 경로는 자체 가드 보유)
- **ctx.evaluationMode**: `'daily-bar'`는 백테스트의 일봉 단위 평가. momentum-breakout은 이 모드에서 장중 의존 조건(시간/추격/soft)을 생략하고 `metadata.fillModel='stop-entry'` 조건부 신호를 발행 — 체결 판정은 backtest 엔진 책임
- **국내 일봉 지표 캐시는 KST 날짜 키**: `MarketAnalysisService.getStockIndicators`는 DOMESTIC 캐시 키에 날짜를 포함하고, `prices[0]`가 당일 봉인지 검증해 prevHigh/prevLow/todayOpen을 보정 (전일 캐시 잔존·장 시작 직후 당일 봉 미생성 오염 방지). 해외는 세션이 KST 자정을 걸치므로 기존 키 유지
- **momentum-breakout WatchStock 운영 주의**: 같은 종목에 수동 매수를 섞으면 전략이 그 물량까지 당일청산 대상으로 흡수한다. 전일 진입분이 남은 채 전략을 켜면 이월청산 규칙이 즉시 전량 매도함 (의도된 안전망)
- **momentum-breakout 시세 이상 시 청산 동작**: 보유 중 현재가가 0/음수여도 강제 청산(리스크/이월/15:10 당일청산)은 시장가로 진행된다 — 시세 글리치가 강제 청산을 막으면 포지션이 밤을 넘기기 때문. 가격의존 청산(손절/트레일링/익절)만 보류 (curPrice=0이 손절 -100%로 오판되는 것 방지)
- **momentum-breakout 트레일링은 "진입 후 고가" 기준**: 체결 시 BUY 신호 metadata의 `entryDayHigh`(진입 시점 당일 고가)를 strategyParams에 기록하고, 현재 세션 고가가 이를 넘어선 경우에만 트레일링 기준으로 사용한다 — 진입 전 스파이크가 섞인 세션 고가로 인한 진입 직후 오발동 방지. `entryDayHigh` 기록이 없으면(수동 포지션/레거시) 트레일링 미발동(손절만 동작). `entryDate`는 reconciliation 시각이 아닌 **주문 레코드 시각(KST)** 기준으로 기록 — reconciliation이 자정을 넘겨도 이월청산 판정이 밀리지 않게
- **infinite-buy 같은 사이클 BUY/SELL 비용버퍼**: 목표 익절가가 이미 현재가 이하이고 같은 평가 사이클에 BUY가 함께 생성되면, SELL을 `max(현재가, BUY가격) × (1 + sameCycleMinProfitRate)` 이상(호가 올림)으로 제출한다. 기본 `sameCycleMinProfitRate=0.006`은 해외 1주 왕복 제비용/스프레드가 0.5% 안팎인 실제 SOXL 체결 사례를 기준으로 둔 안전 버퍼다. 같은 사이클 BUY는 SELL 가격이 이 버퍼를 넘지 못하면 `TradingService`에서 제출 직전 스킵하고 quota는 기존 이월 흐름을 탄다.
