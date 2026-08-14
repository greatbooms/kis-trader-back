# Multi-Broker Phase 0~1 Implementation Plan

> **For agentic workers:** 이 플랜은 `docs/multi-broker-spec.md`를 근거로 한다. 작업 전 스펙 전체와 `src/trading/CLAUDE.md`, `src/kis/CLAUDE.md`를 반드시 읽을 것. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Broker 차원(스키마)과 BrokerPort 추상화를 도입하되, **기능 변화 0** (행동 보존)으로 KIS 단일 운용이 기존과 동일하게 동작한다.

**Architecture:** `Broker` enum + `broker` 컬럼 5개 모델 추가(기본 `KIS`) → 주문·계좌·체결 호출을 broker당 1개의 `BrokerPort`로 추상화 → KIS 어댑터가 기존 국내/해외 서비스를 감싼다. 시세/랭킹/휴장일 조회는 포트 대상이 아니다 (스펙 D3).

**Tech Stack:** NestJS, Prisma(PostgreSQL), Jest

**Spec:** `docs/multi-broker-spec.md` (D1, D2, D4 해당분만. D5~D11은 Phase 2+ — 이번 작업 아님)

## Global Constraints

- **행동 보존이 게이트**: 모든 기존 테스트가 수정 없이는 못 지나가는 경우, 테스트 수정은 "mock 대상 교체"(kisDomestic/kisOverseas mock → port/registry mock)까지만 허용. 기대값(expectation) 변경 금지
- 커밋 전 `npm run build` + `npx jest` 통과 필수. 커밋은 아래 Task 단위(3개)로 분리
- Prisma 스키마 변경은 `npm run prisma:migrate -- --name <name>`으로 마이그레이션 생성
- 타입 정의는 `src/common/types/` — 서비스 파일 내 타입 정의 금지
- 푸시 금지 (사용자 요청 시에만). 브랜치: `feat/multi-broker-phase0-1`
- 로그 prefix 등 메시지 형식 변경 금지 (Phase 3에서 일괄)

---

### Task 1: Phase 0 — Broker enum + broker 컬럼 마이그레이션

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: compound unique 참조 9파일 13곳 (아래 Step 3)
- Create: `prisma/migrations/<ts>_add_broker_dimension/migration.sql` (prisma 생성)

**Interfaces:**
- Produces: Prisma `Broker` enum (`KIS` | `TOSS`), 각 모델의 `broker` 필드, 새 compound unique 입력명 `broker_market_exchangeCode_stockCode` 등

- [ ] **Step 1: schema.prisma 수정**

```prisma
enum Broker {
  KIS
  TOSS
}
```

아래 5개 모델에 `broker Broker @default(KIS)` 추가 및 unique 확장:

| 모델 | 컬럼 추가 | unique 변경 |
|---|---|---|
| `TradeRecord` | `broker Broker @default(KIS)` | (unique 없음 — 컬럼만) |
| `Position` | 동일 | `@@unique([broker, market, exchangeCode, stockCode])` |
| `WatchStock` | 동일 | `@@unique([broker, market, exchangeCode, stockCode])` |
| `RiskSnapshot` | 동일 | `@@unique([broker, market, snapshotDate])` |
| `StrategyAllocation` | 동일 | `@@unique([broker, market, strategyName])` |

`WatchStockExecutionLog`는 변경하지 않는다 (watchStockId로 broker 파생 가능 — YAGNI).

- [ ] **Step 2: 마이그레이션 생성**

Run: `npm run prisma:migrate -- --name add_broker_dimension`
Expected: enum 생성 + `ALTER TABLE ... ADD COLUMN broker ... DEFAULT 'KIS'` + 인덱스 재생성. 데이터 손실 구문(DROP COLUMN/TABLE) 없어야 함 — SQL 확인 후 진행

- [ ] **Step 3: compound unique 참조 갱신**

`market_exchangeCode_stockCode` → `broker_market_exchangeCode_stockCode`(+ `broker: Broker.KIS` 값 추가), `market_snapshotDate` → `broker_market_snapshotDate`, `market_strategyName` → `broker_market_strategyName`. 대상 9파일:
`trade-record.service.ts`, `watch-stock.service.ts`, `backtest/data/historical-collector.service.ts`, `trading-order-reconciliation.service.ts`, `risk-management.service.ts`, `trading-position-sync.service.ts`, `trading-sell-approval-workflow.service.ts`, `trading-sell-approval.service.ts`, `strategy/strategy-registry.service.ts`

Phase 1까지는 값이 항상 `Broker.KIS` 리터럴이다. TradeRecord/Position/WatchStock **생성** 경로는 `broker` 명시 없이 `@default(KIS)`에 맡긴다 (diff 최소화).

- [ ] **Step 4: 빌드 + 테스트**

Run: `npm run build && npx jest`
Expected: 전부 통과 (스키마 추가는 기존 동작 무영향)

- [ ] **Step 5: Commit**

```bash
git add prisma/ src/
git commit -m "feat(db): 멀티 브로커 대비 broker 차원 추가 (기본 KIS)"
```

---

### Task 2: 공유 broker 타입을 common으로 이동

**Files:**
- Create: `src/common/types/broker-io.type.ts` (또는 기존 kis 타입 파일들을 `src/common/types/`로 이동)
- Modify: `src/kis/types/index.ts` — 이동한 타입을 re-export (기존 import 경로 유지용 shim)

**Interfaces:**
- Produces: `OrderResult`, `BalanceItem`, `UnfilledOrder`, `BrokerOrderStatus`, `OverseasAccountSnapshot`, `OverseasCashBalance`, `DailyPrice` 중 **포트가 반환하는 타입만** `src/common/types/`로 이동. KIS 원시 응답 타입(내부 전용)은 kis에 남긴다

- [ ] **Step 1: 포트 반환 타입 식별 후 이동** — 스펙 D2의 BrokerPort 시그니처에 등장하는 타입만. 파일은 1타입 1파일 원칙(밀접 소규모는 병합 허용), `src/common/types/index.ts` re-export 추가
- [ ] **Step 2: `src/kis/types/index.ts`에서 re-export** — 기존 `from '../kis/types'` import 전부 무수정으로 컴파일되어야 함
- [ ] **Step 3: 빌드 + 테스트** — Run: `npm run build && npx jest`, Expected: 통과
- [ ] **Step 4: Commit** — `refactor(common): broker 공유 타입을 common/types로 이동`

---

### Task 3: BrokerPort + KIS 어댑터 + 호출부 전환

**Files:**
- Create: `src/common/types/broker-port.type.ts`
- Create: `src/kis/kis-broker.adapter.ts` + `src/kis/kis-broker.adapter.spec.ts`
- Create: `src/broker/broker-port.registry.ts`, `src/broker/broker.module.ts`, `src/broker/CLAUDE.md`
- Modify: `src/trading/types/trading-signal.type.ts` — `broker` 필드 추가
- Modify: 호출부 10파일 (Step 4 표) + 해당 spec 파일들의 mock 교체
- Modify: `src/trading/trading.module.ts`, `src/trade-record/*.module.ts` — BrokerModule import

**Interfaces:**
- Consumes: Task 1의 `Broker` enum, Task 2의 공유 타입
- Produces:

```ts
// src/common/types/broker-port.type.ts — 스펙 D2 원문이 계약. 요지:
export interface BrokerCancelRequest {
  market: Market; exchangeCode: string; orderNo: string; stockCode: string; qty: number; price: number;
}
export interface BrokerPort {
  readonly broker: Broker;
  submitOrder(signal: TradingSignal): Promise<OrderResult>;
  cancelOrder(req: BrokerCancelRequest): Promise<OrderResult>;
  getUnfilledOrders(market: Market): Promise<UnfilledOrder[]>;
  getOrderExecutions(market: Market, startDate: string, endDate: string): Promise<BrokerOrderStatus[]>;
  getBalance(market: Market): Promise<BalanceItem[]>;
  getDomesticBuyableAmount(): Promise<DomesticBuyableAmount>;   // 기존 KisDomesticService.getBuyableAmount 반환 타입에 이름 부여
  getOverseasBuyableAmount(exchangeCode: string, stockCode: string, price: number): Promise<{ foreignCurrencyAvailable: number; maxQuantity: number }>;
  getOverseasAccountSnapshot(nationCode?: string): Promise<OverseasAccountSnapshot>;
  getBrokerContext(): { broker: Broker; environment: BrokerEnvironment; accountHash: string };
}
// src/broker/broker-port.registry.ts
export class BrokerPortRegistry {
  get(broker: Broker): BrokerPort;   // 미등록 broker → throw (fail-closed)
}
```

- [ ] **Step 1: `broker-port.type.ts` + `TradingSignal.broker?: Broker` 추가**

전략(`*.strategy.ts`)은 broker를 모른다 — signal 생성 시 broker를 채우는 책임은 다음 두 곳뿐:
- `TradingService.executePerStockStrategy` 계열: `watchStock.broker`로 스탬프
- 수동 주문 경로(`trade-record-manual-order.service.ts` 등): Phase 1은 `Broker.KIS` 리터럴

- [ ] **Step 2: `KisBrokerAdapter` 작성 (테스트 먼저)**

adapter spec: submitOrder가 DOMESTIC/BUY→`kisDomestic.orderBuy`, OVERSEAS/SELL→`kisOverseas.orderSell` 등 8분기 위임 + 인자 전달을 검증 (기존 `TradingBrokerOrderSubmissionService`의 분기 로직을 그대로 이식하는 것이므로 기존 gateway 코드가 정답지). `getBrokerContext`는 기존 `TradingBrokerContextService`의 환경/계좌 해석 로직과 동일 소스(ConfigService)를 사용하되, Phase 1에서는 `TradingBrokerContextService`를 변경하지 않는다 (D6은 Phase 3).

- [ ] **Step 3: `BrokerModule` + registry** — `KisModule` import, `KisBrokerAdapter` provider, `BrokerPortRegistry` export. 미등록 broker `get()`은 명시적 throw + 테스트

- [ ] **Step 4: 호출부 전환 (파일당 하나씩, 각각 jest 확인)**

| 파일 | 전환 내용 |
|---|---|
| `trading-broker-order-submission.service.ts` | market 분기 제거 → `registry.get(signal.broker ?? throw).submitOrder(signal)`. **signal.broker 부재 시 throw (fail-closed, 자금 안전)** |
| `trading-order-cancellation.service.ts` | `registry.get(record.broker).cancelOrder({...})` — TradeRecord.broker 사용 |
| `trading-broker-order-matcher.service.ts` | `registry.get(record.broker).getOrderExecutions(market, ...)` |
| `trading-broker-cancellation-recovery.service.ts` | 동일 (record.broker) |
| `trade-record-manual-order.service.ts` | record/입력 기준 broker (Phase 1: KIS) |
| `order-sync.service.ts` | `registry.get(Broker.KIS)` 명시 + `// Phase 3: active broker 루프로 확장` 주석 |
| `market-state-sync.service.ts` | 동일 (KIS 명시) |
| `trading-position-refresh.service.ts` | 동일 |
| `trading-account-cash-sync.service.ts` | 동일 |
| `trading-orchestrator.service.ts` | buyable 조회 → port. signal에 `watchStock.broker` 스탬프 추가 |
| `trade-record.service.ts` | 잔고/스냅샷 조회 → `registry.get(Broker.KIS)` |

각 파일의 `*.spec.ts`는 kisDomestic/kisOverseas mock을 registry/port mock으로 교체하되 **기대값 불변**.

- [ ] **Step 5: 모듈 배선** — TradingModule/TradeRecordModule에서 KisModule 직접 주입 중 포트 대상은 BrokerModule로 대체. 시세용(KisDomesticService/KisOverseasService의 데이터 조회) 주입은 유지
- [ ] **Step 6: 전체 게이트** — Run: `npm run build && npx jest`, Expected: 전부 통과
- [ ] **Step 7: CLAUDE.md 갱신** — `src/broker/CLAUDE.md` 신설(책임/포트 범위/fail-closed 규칙), `src/trading/CLAUDE.md`·`src/kis/CLAUDE.md`에 포트 경유 규칙 1~2줄 반영
- [ ] **Step 8: Commit** — `refactor(trading): BrokerPort 추상화 도입 및 주문·계좌 호출 경로 전환`

---

## Self-Review 체크 (작성자 완료)

- 스펙 커버리지: D1→Task 1, D2→Task 2·3, D4의 라우팅 전제(signal.broker)→Task 3. D3은 "하지 않는 것"으로 반영. D5~D11은 의도적으로 범위 외 (Phase 2+)
- 타입 일관성: `BrokerPort`/`BrokerCancelRequest`/`DomesticBuyableAmount` 명칭 Task 간 일치 확인
- 게이트: 모든 Task가 build+jest 통과 후 커밋. 행동 보존 원칙이 Global Constraints에 명시
