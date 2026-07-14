# Sell Approval Safety Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every KIS order/cancellation single-attempt and recoverable, make protective SELL approval atomic and authorized, and let operators resolve ambiguous broker outcomes from Slack or the Portfolio page without resubmitting an order.

**Architecture:** KIS infrastructure classifies mutation results as `ACCEPTED`, `REJECTED`, or `UNKNOWN`; trading services persist that state before any retry can occur. Small services own live-switch checks, broker context, admission locks, position refresh, order execution, approval workflow, and recovery. Slack and GraphQL are thin adapters over the same recovery service, and the Portfolio card polls only persisted DB state.

**Tech Stack:** NestJS 11, TypeScript 5.9, Prisma 7/PostgreSQL, GraphQL/Apollo, Slack Bolt, React 19/Vite/Apollo Client, Jest 30.

## Global Constraints

- This is a live-money system: no mutating KIS POST may be retried automatically.
- `TRADING_ENABLED` is enabled only for the normalized literal value `true`; missing, blank, malformed, and `false` are disabled.
- Approval is limited to stop-loss, MDD/risk liquidation, EOD/carryover liquidation, trailing stop, and infinite-buy take-profit where `T >= 20`.
- Ordinary SELL, manual SELL, BUY, and infinite-buy `T < 20` remain free of a pre-submit approval gate.
- Approval validity is 10 minutes from successful Slack delivery; successful-notification cooldown is 30 minutes.
- Empty `SLACK_APPROVER_USER_IDS` is fail-closed.
- KIS order/cancellation ambiguity is durable and never causes an automatic order or cancellation retry.
- Every order path re-syncs broker positions before submission; a failed refresh aborts the order.
- `TradingService` and `TradingOrchestrator` receive delegation-only edits because both exceed 900 lines.
- Resolver logic is authentication/input forwarding only; DTOs and pure TypeScript types stay in `dto/` and `types/`.
- Prisma schema changes ship with `prisma/migrations/20260713000000_harden_sell_approval_state/migration.sql`.
- GraphQL changes include client operations and regenerated `client/src/graphql/generated.ts` and `schema.json`.
- Do not commit or push during plan execution unless the user explicitly requests it.
- Preserve the user-local untracked `.codex/` directory.
- MDD scope for this plan is exact restoration of the prior `riskState.liquidateAll`/strategy signal branch with `metadata.phase = 'risk-liquidation'`; it does not activate a new live portfolio-MDD threshold.

## Locked Interfaces

Create these contracts once and reuse them unchanged in later tasks:

```ts
// src/kis/types/order-outcome.type.ts
export type OrderOutcome = 'ACCEPTED' | 'REJECTED' | 'UNKNOWN';

// src/kis/types/order-result.type.ts
export interface OrderResult {
  outcome: OrderOutcome;
  success: boolean;
  orderNo?: string;
  brokerOrderDate?: string;
  orderTime?: string;
  message: string;
}

// src/kis/types/kis-response-metadata.type.ts
export interface KisResponseWithMetadata<T> {
  data: T;
  trCont?: string;
}

// src/trading/types/order-admission-key.type.ts
export interface OrderAdmissionKey {
  market: 'DOMESTIC' | 'OVERSEAS';
  exchangeCode: string;
  stockCode: string;
  side: 'BUY' | 'SELL';
}

// src/trading/types/broker-action-context.type.ts
export interface BrokerActionContext {
  channel: 'SYSTEM' | 'SLACK' | 'WEB';
  actor: string;
}
```

Recovery GraphQL/service operations are fixed as:

```ts
listRecoveryItems(): Promise<BrokerOrderRecoveryItem[]>;
inspectCandidates(tradeRecordId: string, context: BrokerActionContext): Promise<BrokerOrderCandidateInspection>;
assignCurrentContext(tradeRecordId: string, context: BrokerActionContext): Promise<BrokerOrderRecoveryItem>;
linkCandidate(input: BrokerOrderCandidateIdentityInput, context: BrokerActionContext): Promise<BrokerOrderRecoveryItem>;
confirmNotSubmitted(tradeRecordId: string, context: BrokerActionContext): Promise<BrokerOrderRecoveryItem>;
confirmMatchesExisting(input: MatchExistingBrokerOrderInput, context: BrokerActionContext): Promise<BrokerOrderRecoveryItem>;
inspectCancellation(tradeRecordId: string, context: BrokerActionContext): Promise<BrokerOrderRecoveryItem>;
confirmCancellationNotAccepted(tradeRecordId: string, context: BrokerActionContext): Promise<BrokerOrderRecoveryItem>;
```

---

### Task 1: Fail-closed live-trading switch

**Files:**
- Create: `src/config/configuration.spec.ts`
- Create: `src/trading/trading-live-switch.service.ts`
- Create: `src/trading/trading-live-switch.service.spec.ts`
- Modify: `src/config/configuration.ts`
- Modify: `src/config/AGENTS.md`
- Modify: `.env.example`
- Modify: `src/trading/trading.scheduler.ts`
- Modify: `src/trading/trading-orchestrator.service.ts`

**Interfaces:**
- Produces: `TradingLiveSwitchService.isEnabled(): boolean` and `assertEnabled(action: string): void`.
- Consumers: automatic order, approved order, manual sell, manual cancel, and automatic cancel services.

- [ ] **Step 1: Write the failing configuration tests**

```ts
describe('trading.enabled', () => {
  afterEach(() => delete process.env.TRADING_ENABLED);

  it.each([undefined, '', 'false', '1', 'yes'])('is disabled for %p', (value) => {
    if (value !== undefined) process.env.TRADING_ENABLED = value;
    expect(configuration().trading.enabled).toBe(false);
  });

  it.each(['true', ' TRUE ', 'True'])('is enabled only for normalized true: %s', (value) => {
    process.env.TRADING_ENABLED = value;
    expect(configuration().trading.enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run RED**

Run: `npx jest src/config/configuration.spec.ts --runInBand`

Expected: missing/blank/malformed cases fail because current configuration is default-open.

- [ ] **Step 3: Implement the normalized parser and live service**

```ts
// configuration.ts
enabled: process.env.TRADING_ENABLED?.trim().toLowerCase() === 'true',

// trading-live-switch.service.ts
isEnabled(): boolean {
  return this.configService.get<boolean>('trading.enabled') === true;
}

assertEnabled(action: string): void {
  if (!this.isEnabled()) throw new Error(`${action} blocked: live trading is disabled`);
}
```

Change scheduler/orchestrator fallbacks from `?? true` to `=== true`; add `SLACK_APPROVER_USER_IDS=` to `.env.example` while configuration is already being touched.

- [ ] **Step 4: Run GREEN and focused regressions**

Run: `npx jest src/config/configuration.spec.ts src/trading/trading-live-switch.service.spec.ts src/trading/trading.scheduler.spec.ts src/trading/trading-orchestrator.service.spec.ts --runInBand`

Expected: all selected suites pass.

### Task 2: Single-attempt KIS mutations and typed outcomes

**Files:**
- Create: `src/kis/kis-base.service.spec.ts`
- Create: `src/kis/kis-domestic.service.spec.ts`
- Create: `src/kis/kis-mutation.error.ts`
- Create: `src/kis/types/order-outcome.type.ts`
- Create: `src/kis/types/order-result.type.ts`
- Create: `src/kis/types/kis-response-metadata.type.ts`
- Create: `src/kis/types/index.ts`
- Modify: `src/kis/kis-base.service.ts`
- Modify: `src/kis/kis-domestic.service.ts`
- Modify: `src/kis/kis-overseas.service.ts`
- Modify: `src/kis/kis-overseas.service.spec.ts`
- Modify: `src/kis/types/kis-api.types.ts`
- Modify: `src/kis/AGENTS.md`

**Interfaces:**
- Produces: locked `OrderResult`, `KisResponseWithMetadata`, and `KisMutationError` with `kind: 'BUSINESS_REJECTION' | 'TRANSPORT_UNKNOWN'`.
- Keeps: `KisBaseService.get()` retry behavior and existing public order/cancel method signatures.

- [ ] **Step 1: Write RED transport tests**

```ts
it.each(['ETIMEDOUT', 'ECONNRESET'])('issues one POST for %s', async (code) => {
  mockedAxios.post.mockRejectedValue(Object.assign(new Error(code), { code }));
  await expect(service.post('/order', 'TTTC0012U', {})).rejects.toMatchObject({
    kind: 'TRANSPORT_UNKNOWN',
  });
  expect(mockedAxios.post).toHaveBeenCalledTimes(1);
});

it('keeps bounded retries for GET', async () => {
  mockedAxios.get
    .mockRejectedValueOnce(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))
    .mockResolvedValueOnce({ data: { rt_cd: '0', output: [] }, headers: {} });
  await service.get('/history', 'TTTC0081R', {});
  expect(mockedAxios.get).toHaveBeenCalledTimes(2);
});
```

Also test: HTTP error with valid `rt_cd != 0` is a business rejection; bare 4xx/5xx, malformed body, and contradictory HTTP error with `rt_cd = 0` are transport unknown.

- [ ] **Step 2: Run RED**

Run: `npx jest src/kis/kis-base.service.spec.ts --runInBand`

Expected: POST retry count is greater than one and typed errors do not exist.

- [ ] **Step 3: Implement single-attempt POST and metadata GET**

`post()` performs rate limit/header construction, then exactly one `axios.post`. Preserve a valid KIS rejection envelope from either a normal or Axios error response in `KisMutationError`. Add:

```ts
async getWithMetadata<T>(
  path: string,
  trId: string,
  params: Record<string, string>,
  additionalHeaders?: Record<string, string>,
): Promise<KisResponseWithMetadata<KisApiResponse<T>>>;
```

`get()` delegates to `getWithMetadata()` and returns `.data` for compatibility.

- [ ] **Step 4: Write RED order classification tests**

Use fake timers/system time and fixtures containing `ODNO` plus `ORD_TMD`. Assert:

```ts
expect(result).toEqual(expect.objectContaining({
  outcome: 'ACCEPTED',
  success: true,
  orderNo: '0001234567',
  brokerOrderDate: '20260713',
  orderTime: '235959',
}));
```

Cover six-digit midnight selection, valid 14-digit timestamp, blank order number, invalid time, time farther than 10 minutes, explicit KIS rejection, unsupported exchange before POST, timeout, and bare HTTP error.

- [ ] **Step 5: Implement the result classifier**

Acceptance requires `rt_cd === '0'`, trimmed `ODNO`, and a broker timestamp within 10 minutes of the actual call start. A supported six-digit time chooses the nearest KST D-1/D/D+1 date; a supported 14-digit value uses its explicit valid KST date. Set `success = outcome === 'ACCEPTED'`. Domestic/overseas order and cancel wrappers must branch on the typed error kind and never flatten unknown into rejection.

- [ ] **Step 6: Run GREEN**

Run: `npx jest src/kis/kis-base.service.spec.ts src/kis/kis-domestic.service.spec.ts src/kis/kis-overseas.service.spec.ts --runInBand`

Expected: all KIS transport/classification tests pass with one POST per mutation case.

### Task 3: Prisma state, audit model, migration, and isolated PostgreSQL harness

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260713000000_harden_sell_approval_state/migration.sql`
- Create: `test/postgres-test-harness.ts`
- Create: `test/sell-approval-migration.integration.spec.ts`
- Modify: `jest.config.ts`
- Modify: `package.json`

**Interfaces:**
- Produces Prisma enums/fields used by every later task.
- Produces script: `test:integration:postgres` targeting a temporary database URL only.

- [ ] **Step 1: Add a RED migration fixture test**

The harness must refuse a URL lacking a database name ending `_test`; create/drop a unique schema per run. Seed old approval/trade cases and assert post-migration classification, required `expiresAt`, and both partial unique constraints. The guard is exact:

```ts
if (!new URL(databaseUrl).pathname.endsWith('_test')) {
  throw new Error('PostgreSQL integration tests require a *_test database');
}
```

Run against an ephemeral local PostgreSQL cluster started under `/tmp` rather than `.env` dev/prod databases.

- [ ] **Step 2: Run RED**

Run: `TEST_DATABASE_URL=postgresql://localhost:55432/kis_trader_test npx jest test/sell-approval-migration.integration.spec.ts --runInBand`

Expected: schema fields/enums/migration do not exist.

- [ ] **Step 3: Add schema contracts**

Add `SUBMITTING` and `SUBMISSION_UNKNOWN` to `OrderStatus`; add broker environment, submission resolution, cancellation-attempt, audit channel/action enums. Add the design fields to `TradeRecord` and `StopLossApproval`, plus:

```prisma
model BrokerOrderActionAuditLog {
  id                 String                   @id @default(uuid())
  tradeRecordId      String                   @map("trade_record_id")
  channel            BrokerOrderActionChannel
  action             BrokerOrderAction
  actor              String
  brokerOrderDate    String?                  @map("broker_order_date")
  exchangeCode       String?                  @map("exchange_code")
  orderNo            String?                  @map("order_no")
  beforeStatus       OrderStatus?             @map("before_status")
  afterStatus        OrderStatus?             @map("after_status")
  details            Json?
  createdAt          DateTime                 @default(now()) @map("created_at")
  tradeRecord        TradeRecord              @relation(fields: [tradeRecordId], references: [id], onDelete: Cascade)

  @@index([tradeRecordId, createdAt])
  @@map("broker_order_action_audit_logs")
}
```

- [ ] **Step 4: Write migration SQL in safe order**

The SQL must: add enum values/types; add nullable columns; backfill every approval `expires_at`; expire every old pending approval; classify old awaiting/pending/recent failed rows exactly as Section 9 of the design; insert `SYSTEM/UNKNOWN_DETECTED` audits; make `expires_at` required; then create:

```sql
CREATE UNIQUE INDEX "stop_loss_approvals_one_pending_per_instrument"
ON "stop_loss_approvals" ("market", "exchange_code", "stock_code")
WHERE "status" = 'PENDING';

CREATE UNIQUE INDEX "trade_records_broker_identity_unique"
ON "trade_records" (
  "broker_environment", "broker_account_hash", "market",
  "exchange_code", "broker_order_date", "order_no"
)
WHERE "broker_environment" IS NOT NULL
  AND "broker_account_hash" IS NOT NULL
  AND "broker_order_date" IS NOT NULL
  AND "order_no" IS NOT NULL;
```

- [ ] **Step 5: Generate Prisma and run GREEN**

Run: `npm run prisma:generate`

Run: `TEST_DATABASE_URL=postgresql://localhost:55432/kis_trader_test npx jest test/sell-approval-migration.integration.spec.ts --runInBand`

Expected: fixture classifications and uniqueness races pass.

### Task 4: Broker context and transaction-scoped order admission

**Files:**
- Create: `src/trading/trading-broker-context.service.ts`
- Create: `src/trading/trading-broker-context.service.spec.ts`
- Create: `src/trading/trading-order-guard.service.ts`
- Create: `src/trading/trading-order-guard.service.spec.ts`
- Create: `test/trading-order-guard.integration.spec.ts`
- Create: `src/trading/types/order-admission-key.type.ts`
- Create: `src/trading/types/broker-context.type.ts`
- Modify: `src/trading/types/index.ts`
- Modify: `src/trading/trading.module.ts`

**Interfaces:**
- Produces: `TradingBrokerContextService.getCurrentContext(): BrokerContext`.
- Produces: `TradingOrderGuardService.admit<T>(key, createWithTx): Promise<T | null>`.

- [ ] **Step 1: Write RED broker-context tests**

Assert effective `CANO + ACNT_PRDT_CD` hashing, product-code distinction, paper/prod distinction through the context tuple, masked-only display, invalid-account failure, and absence of raw account text in returned values/errors/log arguments.

- [ ] **Step 2: Implement broker context**

Return:

```ts
export interface BrokerContext {
  environment: 'PAPER' | 'PROD';
  accountHash: string;
  maskedAccount: string;
}
```

Use `ConfigService` only; normalize an 8- or 10-digit account and two-digit product code, SHA-256 the effective 10 digits, and expose `****1234-01` style display only.

- [ ] **Step 3: Write RED admission tests**

Unit-test canonical key encoding and callback use of the interactive transaction client. PostgreSQL integration uses two Prisma clients/connections and asserts same canonical key creates one unresolved intent while different side/instrument keys do not block each other.

- [ ] **Step 4: Implement one-connection admission**

```ts
return this.prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${canonicalKey}, 0))`;
  const unresolved = await tx.tradeRecord.findFirst({ where: unresolvedWhere });
  if (unresolved) return null;
  return createWithTx(tx);
});
```

The unresolved set is `AWAITING_APPROVAL`, `SUBMITTING`, `SUBMISSION_UNKNOWN`, `PENDING`, `PARTIAL`. No root Prisma, Slack, KIS, or array transaction is permitted inside the callback.

- [ ] **Step 5: Run GREEN**

Run: `npx jest src/trading/trading-broker-context.service.spec.ts src/trading/trading-order-guard.service.spec.ts --runInBand`

Run: `TEST_DATABASE_URL=postgresql://localhost:55432/kis_trader_test npx jest test/trading-order-guard.integration.spec.ts --runInBand`

Expected: unit and real-connection concurrency tests pass.

### Task 5: Position refresh safety and empty-snapshot deletion

**Files:**
- Create: `src/trading/trading-position-refresh.service.ts`
- Create: `src/trading/trading-position-refresh.service.spec.ts`
- Modify: `src/trading/trading-position-sync.service.ts`
- Modify: `src/trading/trading-position-sync.service.spec.ts`
- Modify: `src/trading/trading.module.ts`

**Interfaces:**
- Produces: `refresh(market: 'DOMESTIC' | 'OVERSEAS'): Promise<BalanceItem[]>`.
- Consumers: automatic execution, approval workflow, and manual sell.

- [ ] **Step 1: Reverse the stale-position test to RED**

```ts
it('deletes all market positions after a successful empty broker snapshot', async () => {
  await service.syncPositions('DOMESTIC', []);
  expect(prisma.position.deleteMany).toHaveBeenCalledWith({ where: { market: 'DOMESTIC' } });
});
```

Add refresh tests proving KIS failure logs warn and throws, successful data is synchronized and returned, and empty data is a successful no-holdings snapshot.

- [ ] **Step 2: Run RED**

Run: `npx jest src/trading/trading-position-sync.service.spec.ts src/trading/trading-position-refresh.service.spec.ts --runInBand`

Expected: empty deletion and new refresh service tests fail.

- [ ] **Step 3: Implement and run GREEN**

Use KIS `getBalance()` for domestic and overseas, call `syncPositions`, return the same snapshot, and rethrow after `logger.warn` on failure.

Run the same Jest command; expect all selected tests to pass.

### Task 6: Break the module cycle and extract manual order mutations without behavior change

**Files:**
- Move: `src/notification/slack-commands.service.ts` to `src/trading/trading-slack-commands.service.ts`
- Move: `src/notification/slack-commands.service.spec.ts` to `src/trading/trading-slack-commands.service.spec.ts`
- Create: `src/trade-record/trade-record-manual-order.service.ts`
- Create: `src/trade-record/trade-record-manual-order.service.spec.ts`
- Modify: `src/trade-record/trade-record.service.ts`
- Modify: `src/trade-record/trade-record.resolver.ts`
- Modify: `src/trade-record/trade-record.module.ts`
- Modify: `src/notification/notification.module.ts`
- Modify: `src/trading/trading.module.ts`
- Modify: `src/trading/trading.module.spec.ts`
- Modify: `src/trading/trading-orchestrator.service.ts`
- Modify: `src/notification/AGENTS.md`
- Modify: `src/trade-record/AGENTS.md`

**Interfaces:**
- Keeps GraphQL mutation names/input/output unchanged.
- Produces `TradeRecordManualOrderService.manualSell()` and `.cancelTradeOrder()` with existing signatures.
- Produces `TradingSlackCommandsService` in `TradingModule`; `NotificationModule` exports only `SlackService`.

- [ ] **Step 1: Add characterization tests**

Move current manual sell/cancel cases into the new service spec before moving production methods. Assert current success, explicit failure, position snapshot, disabled guard, and resolver delegation contracts.

- [ ] **Step 2: Run characterization RED for the missing service**

Run: `npx jest src/trade-record/trade-record-manual-order.service.spec.ts --runInBand`

Expected: module/service is missing.

- [ ] **Step 3: Extract methods and broker helpers only**

Move `manualSell`, `cancelTradeOrder`, and their private broker snapshot/date helpers verbatim first. Inject the new service into the resolver. Do not add UNKNOWN behavior in this step.

- [ ] **Step 4: Move Slack adapter and remove cycles**

Remove the unused `TradeRecordService` injection. `NotificationModule` has no imports; `TradingModule` imports `NotificationModule` and provides the moved adapter; `TradeRecordModule` imports `TradingModule` without `forwardRef`.

- [ ] **Step 5: Run GREEN**

Run: `npx jest src/trade-record/trade-record-manual-order.service.spec.ts src/trade-record/trade-record.service.spec.ts src/trading/trading-slack-commands.service.spec.ts src/trading/trading.module.spec.ts --runInBand`

Expected: behavior is preserved and module metadata is acyclic.

### Task 7: Guarded automatic/manual order execution and cancellation lifecycle

**Files:**
- Create: `src/trading/trading-order-execution.service.ts`
- Create: `src/trading/trading-order-execution.service.spec.ts`
- Create: `src/trading/trading-broker-order-recovery.service.ts` (submission/cancellation state-entry primitives first)
- Create: `src/trading/trading-broker-order-recovery.service.spec.ts`
- Modify: `src/trading/trading.service.ts`
- Modify: `src/trading/trading.service.spec.ts`
- Modify: `src/trade-record/trade-record-manual-order.service.ts`
- Modify: `src/trade-record/trade-record-manual-order.service.spec.ts`
- Modify: `src/trading/market-state-sync.service.ts`
- Modify: `src/trading/market-state-sync.service.spec.ts`
- Modify: `src/trading/trading-order-reconciliation.service.ts`
- Modify: `src/trading/trading-order-reconciliation.service.spec.ts`
- Modify: `src/trading/trading-orchestrator.service.ts`
- Modify: `src/trading/trading-orchestrator.service.spec.ts`

**Interfaces:**
- Produces `TradingOrderExecutionService.execute(signal, strategyName, ctx, details): Promise<boolean>`.
- Recovery service initially produces atomic `markSubmissionUnknown`, `markCancellationUnknown`, and cold-start takeover methods.

- [ ] **Step 1: Write RED automatic-order tests**

Assert intent creation as `SUBMITTING` with null `submissionStartedAt`; one CAS winner sets time and calls KIS; accepted/rejected/unknown map to `PENDING`/`FAILED`/`SUBMISSION_UNKNOWN`; UNKNOWN writes audit and never retries; switch/refresh failure cancels pre-submit; accepted DB update retries DB only twice.

- [ ] **Step 2: Run RED**

Run: `npx jest src/trading/trading-order-execution.service.spec.ts --runInBand`

Expected: service is missing.

- [ ] **Step 3: Implement automatic execution and delegate**

`TradingService.executeSignal()` retains classification/price selection then delegates. New intents capture broker environment/account hash inside the guard transaction. Immediately before KIS, re-check live switch and conditionally set `submissionStartedAt`; only the update winner calls KIS.

- [ ] **Step 4: Write RED manual-order tests, then wire the same primitives**

Manual sell remains unapproved but uses guard, broker context, position refresh/clamp, CAS, and structured outcome persistence. A second same-side unresolved sell is rejected without KIS.

- [ ] **Step 5: Write RED cancellation tests**

Test concurrent manual/automatic cancellation claims, one POST, UNKNOWN persistence, unresolved-blocking, switch release, accepted reconciliation, DB failure takeover, and no mutation of original `PENDING/PARTIAL` on ambiguity.

- [ ] **Step 6: Implement cancellation lifecycle**

CAS `cancellationStatus` to `SUBMITTING`; only the winner calls KIS. Persist `ACCEPTED`, `REJECTED`, or `UNKNOWN`. Reconciliation must atomically change `ACCEPTED` to `RESOLVED` when the original broker order closes. Cold startup changes leftover cancellation `SUBMITTING` to `UNKNOWN` without POST.

- [ ] **Step 7: Update unresolved readers and run GREEN**

Update orchestrator/open-order context/manual trigger/reconciliation filters for the locked unresolved set without counting approval/submitting/unknown as executed trades.

Run: `npx jest src/trading/trading-order-execution.service.spec.ts src/trading/trading.service.spec.ts src/trade-record/trade-record-manual-order.service.spec.ts src/trading/market-state-sync.service.spec.ts src/trading/trading-order-reconciliation.service.spec.ts src/trading/trading-orchestrator.service.spec.ts --runInBand`

Expected: all submission/cancellation paths are single-attempt and durable.

### Task 8: Exact SELL classifier and MDD signal restoration

**Files:**
- Create: `src/trading/trading-sell-approval.service.spec.ts`
- Modify: `src/trading/trading-sell-approval.service.ts`
- Modify: `src/trading/trading.service.spec.ts`
- Modify: `src/trading/strategy/infinite-buy.strategy.ts`
- Modify: `src/trading/strategy/infinite-buy.strategy.spec.ts`
- Modify: `src/trading/types/infinite-buy-strategy-params.type.ts`
- Modify: `src/trading/AGENTS.md`

**Interfaces:**
- Keeps `shouldRequireApproval(signal, strategyName?, ctx?): boolean`.
- Produces an infinite-buy risk SELL with `metadata.phase = 'risk-liquidation'` when an existing risk source sets `liquidateAll` and the existing per-stock loss threshold is met.

- [ ] **Step 1: Write RED classifier table tests**

```ts
it.each([
  ['stop-loss', true],
  ['risk-liquidation', true],
  ['eod-exit', true],
  ['carryover-exit', true],
  ['trailing-stop', true],
  ['trend-exit', false],
  ['overheat-exit', false],
  ['take-profit', false],
])('classifies phase %s as approval=%s', (phase, expected) => {
  expect(service.shouldRequireApproval(makeSell({ phase }))).toBe(expected);
});
```

Add infinite-buy boundary tests for `T=19.999`, `T=20`, BUY, ordinary take-profit, Korean/English stop-loss, and unknown ordinary SELL.

- [ ] **Step 2: Run RED**

Run: `npx jest src/trading/trading-sell-approval.service.spec.ts --runInBand`

Expected: unknown/trend/overheat SELL currently return true.

- [ ] **Step 3: Replace catch-all with explicit allowlist/patterns**

Remove `return !isTakeProfitReason(reason)`. Only approved phases and precise protective reason patterns return true, plus infinite-buy `T >= 20` take-profit.

- [ ] **Step 4: Restore the prior risk branch test-first**

Reverse the PR tests so `riskState.liquidateAll=true`, a held position, and stock loss at/above the existing 20% threshold emit one full-quantity SELL with `phase: 'risk-liquidation'`; profitable/sub-threshold positions emit none. Do not change `RiskManagementService` or the strategy meta thresholds in this task.

- [ ] **Step 5: Run GREEN**

Run: `npx jest src/trading/trading-sell-approval.service.spec.ts src/trading/strategy/infinite-buy.strategy.spec.ts src/trading/trading.service.spec.ts --runInBand`

Expected: exact policy and risk-signal routing tests pass.

### Task 9: Atomic approval creation, Slack delivery lease, and decision workflow

**Files:**
- Modify: `src/trading/trading-sell-approval.service.ts`
- Modify: `src/trading/trading-sell-approval.service.spec.ts`
- Create: `src/trading/trading-sell-approval-workflow.service.ts`
- Create: `src/trading/trading-sell-approval-workflow.service.spec.ts`
- Modify: `src/trading/trading-slack-commands.service.ts`
- Modify: `src/trading/trading-slack-commands.service.spec.ts`
- Modify: `src/notification/slack.service.ts`
- Modify: `src/notification/slack.service.spec.ts`
- Modify: `src/notification/types/notification.types.ts`
- Modify: `src/config/configuration.ts`
- Modify: `src/trading/trading.module.ts`

**Interfaces:**
- Produces `approve(approvalId, slackUserId)` and `reject(approvalId, slackUserId)` on workflow service.
- Slack adapter extracts IDs and delegates only.

- [ ] **Step 1: Write RED creation/delivery tests**

Cover atomic pair rollback, concurrent pair/Slack single winner, provisional two-minute expiry, valid Slack `ts/channel`, delivery-based ten-minute expiry, invalid metadata cancellation, and 30-minute `notifiedAt` cooldown.

- [ ] **Step 2: Implement approval admission and delivery**

Use the shared advisory guard and partial unique index. Create pair in one transaction with provisional expiry. Send Slack only for the created winner outside the transaction. On valid delivery atomically write `notifiedAt`, ten-minute `expiresAt`, `ts`, and channel; otherwise expire/cancel the pair.

- [ ] **Step 3: Write RED decision tests**

Test allowlist normalization, empty/unauthorized actor, expired decision, conditional pair claim, concurrent approvals with one KIS call, atomic rejection, disabled switch, refresh fail/no holding/clamp, structured KIS outcomes, and `respondedBy`.

- [ ] **Step 4: Implement workflow**

Approve transaction conditionally changes `PENDING -> APPROVED` and `AWAITING_APPROVAL -> SUBMITTING`. Rejection conditionally changes `PENDING -> REJECTED` and trade to `CANCELLED`. Only the approval transaction winner refreshes and submits through the same execution primitives. Slack message update is best effort after DB decision.

- [ ] **Step 5: Make Slack adapter thin and run GREEN**

Callbacks pass `(body as any).user?.id` and approval ID to workflow; they do not inject Prisma or call KIS/TradingService directly.

Run: `npx jest src/trading/trading-sell-approval.service.spec.ts src/trading/trading-sell-approval-workflow.service.spec.ts src/trading/trading-slack-commands.service.spec.ts src/notification/slack.service.spec.ts --runInBand`

Expected: approval creation/decision races are closed and authorization is fail-closed.

### Task 10: Complete KIS pagination and conservative broker matching

**Files:**
- Modify: `src/kis/kis-domestic.service.ts`
- Modify: `src/kis/kis-domestic.service.spec.ts`
- Modify: `src/kis/kis-overseas.service.ts`
- Modify: `src/kis/kis-overseas.service.spec.ts`
- Create: `src/kis/types/broker-order-candidate.type.ts`
- Modify: `src/kis/types/kis-api.types.ts`
- Modify: `src/kis/types/index.ts`

**Interfaces:**
- Keeps public `getOrderExecutions(startDate, endDate): Promise<BrokerOrderStatus[]>` and `getUnfilledOrders(): Promise<UnfilledOrder[]>`.
- Produces complete results or throws; it never returns partial data as complete.

- [ ] **Step 1: Write RED pagination tests**

Test domestic FK/NK100 and overseas FK/NK200 continuation, response `tr_cont` M/F followed by request header `N`, final page, duplicate rows, missing context, looped token tuple, page error, and 100-page cap. Assert incomplete reads throw and never return an empty array.

- [ ] **Step 2: Implement a bounded paginator per service**

Each page uses `getWithMetadata`; track `(trCont, fk, nk)` tuples; continue only for M/F; require nonempty continuation tokens; cap at 100. Normalize broker rejection as `REJECTED | NOT_REJECTED | UNKNOWN`, never fabricated false.

- [ ] **Step 3: Run GREEN**

Run: `npx jest src/kis/kis-domestic.service.spec.ts src/kis/kis-overseas.service.spec.ts --runInBand`

Expected: both markets prove complete pagination and fail-closed behavior.

### Task 11: Common submission/cancellation recovery service and authenticated GraphQL

**Files:**
- Complete: `src/trading/trading-broker-order-recovery.service.ts`
- Expand: `src/trading/trading-broker-order-recovery.service.spec.ts`
- Create: `src/trading/trading-broker-order-recovery.resolver.ts`
- Create: `src/trading/trading-broker-order-recovery.resolver.spec.ts`
- Create: `src/trading/dto/broker-order-recovery-item.object.ts`
- Create: `src/trading/dto/broker-order-candidate.object.ts`
- Create: `src/trading/dto/broker-order-candidate-inspection.object.ts`
- Create: `src/trading/dto/broker-order-recovery-trade.input.ts`
- Create: `src/trading/dto/broker-order-candidate-identity.input.ts`
- Create: `src/trading/dto/match-existing-broker-order.input.ts`
- Modify: `src/trading/dto/index.ts`
- Create: `src/trading/types/broker-action-context.type.ts`
- Create: `src/trading/types/broker-order-recovery.type.ts`
- Modify: `src/trading/types/index.ts`
- Modify: `src/trading/trading.module.ts`

**Interfaces:**
- Implements every locked recovery method.
- Resolver passes `web:<username>` and channel `WEB` only.

- [ ] **Step 1: Write RED DB-list and inspection tests**

Assert DB-only list includes `SUBMISSION_UNKNOWN` or cancellation `UNKNOWN`, calls no KIS, and inspection filters complete history by context/market/exchange/stock/side/quantity and `submissionStartedAt ±10m`, de-duplicates full identity, never auto-links, and atomically audits inspection.

- [ ] **Step 2: Write RED context/link/dismiss tests**

Cover context mismatch, audited legacy context assignment, mutation-time re-query, full-identity uniqueness, legacy ±1 calendar-day collision, explicit existing-record match, zero-candidate dismissal, candidate-present dismissal refusal, incomplete read state preservation, and Slack/web CAS winner.

- [ ] **Step 3: Write RED cancellation recovery tests**

Closed original order reconciles `FILLED/PARTIAL/CANCELLED + RESOLVED`; open original remains UNKNOWN; confirmed still-open changes cancellation to `REJECTED`; incomplete history changes nothing.

- [ ] **Step 4: Implement recovery transactions**

Every state-changing mutation re-queries complete KIS history, conditionally updates the expected unknown state, and writes `BrokerOrderActionAuditLog` in the same Prisma transaction. Candidate values other than date/exchange/order number come only from KIS, not client input.

- [ ] **Step 5: Add thin authenticated resolver tests and implementation**

Use class-level `@UseGuards(GqlAuthGuard)`. Extract `ctx.req.user.username`; call service with `{ channel: 'WEB', actor: `web:${username}` }`. Resolver must not inject Prisma/KIS.

- [ ] **Step 6: Run GREEN**

Run: `npx jest src/trading/trading-broker-order-recovery.service.spec.ts src/trading/trading-broker-order-recovery.resolver.spec.ts --runInBand`

Expected: submission/cancellation recovery and actor/audit contracts pass.

### Task 12: Slack recovery actions and confirmations

**Files:**
- Modify: `src/trading/trading-slack-commands.service.ts`
- Modify: `src/trading/trading-slack-commands.service.spec.ts`
- Modify: `src/notification/slack.service.ts`
- Modify: `src/notification/slack.service.spec.ts`
- Modify: `src/notification/types/notification.types.ts`
- Modify: `docs/slack-setup-guide.md`

**Interfaces:**
- Consumes locked recovery methods with `{ channel: 'SLACK', actor: `slack:${userId}` }`.
- No Slack action submits/retries an order or cancellation.

- [ ] **Step 1: Write RED Slack authorization/delegation tests**

Unauthorized actors cannot inspect KIS candidates or mutate state. Authorized lookup/link/not-submitted/existing-match/context/cancellation actions pass exact actor/channel and open confirmation modals. Adapter performs no Prisma/KIS call.

- [ ] **Step 2: Implement alerts/actions/modals**

Unknown alert includes intent, quantity, price, submission time, TradeRecord ID, and lookup action. All state-changing actions require a modal confirmation and delegate to the shared recovery service. Update original message best effort after resolution.

- [ ] **Step 3: Run GREEN**

Run: `npx jest src/trading/trading-slack-commands.service.spec.ts src/notification/slack.service.spec.ts --runInBand`

Expected: Slack and web share state logic while Slack remains a thin authorized adapter.

### Task 13: Portfolio recovery card and generated GraphQL client

**Files:**
- Modify: `src/schema.gql` (generated by backend build)
- Modify: `client/src/graphql/trading.graphql`
- Modify: `client/src/graphql/trade-record.graphql`
- Modify: `client/src/graphql/generated.ts` (generated)
- Modify: `client/src/graphql/schema.json` (generated)
- Create: `client/src/pages/portfolio/UnknownOrderReconciliationCard.tsx`
- Create: `client/src/pages/portfolio/UnknownOrderReconciliationDialog.tsx`
- Modify: `client/src/pages/portfolio/types/portfolio.types.ts`
- Modify: `client/src/pages/portfolio/types/index.ts`
- Modify: `client/src/pages/PortfolioPage.tsx`
- Modify: `client/src/pages/portfolio/TradesCard.tsx`
- Modify: `client/src/lib/trade-record.ts`
- Modify: `client/src/pages/AGENTS.md`

**Interfaces:**
- Uses generated types only.
- DB list polling is `pollInterval: 15_000` and `fetchPolicy: 'network-only'`.

- [ ] **Step 1: Build backend schema and add operations**

Run: `npm run build`

Add operations named `GetBrokerOrderRecoveryItems`, `InspectBrokerOrderCandidates`, `AssignCurrentBrokerContext`, `LinkBrokerOrderCandidate`, `ConfirmBrokerOrderNotSubmitted`, `ConfirmBrokerOrderMatchesExisting`, `InspectUnknownCancellation`, and `ConfirmCancellationNotAccepted`.

- [ ] **Step 2: Generate the client**

Run: `npm run client:codegen`

Expected: generated hooks/types exist and generated files have no manual edits.

- [ ] **Step 3: Implement the card/dialog**

Place the card between `PositionsCard` and `TradesCard`; return `null` for empty data. Poll only the DB list. KIS reads happen only on explicit inspect mutations. Show lifecycle-specific actions and confirmations for legacy context, candidate link, existing match, not-submitted, cancellation lookup, and cancellation not accepted. Derive props from `GetBrokerOrderRecoveryItemsQuery` indexed types.

- [ ] **Step 4: Update trade status display/cancel guard**

Add `SUBMITTING` and `SUBMISSION_UNKNOWN` labels. Disable cancel while cancellation status is `SUBMITTING`, `ACCEPTED`, or `UNKNOWN`. Refetch both trades and recovery items after cancel/recovery mutations.

- [ ] **Step 5: Run client checks**

Run: `npm run client:build`

Run: `cd client && yarn lint`

Expected: both commands pass.

### Task 14: Startup takeover, documentation, full verification, and browser smoke

**Files:**
- Modify: `src/trading/trading-broker-order-recovery.service.ts`
- Modify: `src/trading/trading-broker-order-recovery.service.spec.ts`
- Modify: `src/trading/trading.scheduler.ts`
- Modify: `src/trading/trading.scheduler.spec.ts`
- Modify: `src/trading/AGENTS.md`
- Modify: `src/kis/AGENTS.md`
- Modify: `src/trade-record/AGENTS.md`
- Modify: `src/notification/AGENTS.md`
- Modify: `src/config/AGENTS.md`
- Modify: `README.md`
- Modify: `docs/deployment-guide.md`

**Interfaces:**
- Cold-start takeover completes before scheduled trading can execute.
- Recovery reads/resolutions remain available with trading disabled.

- [ ] **Step 1: Write RED cold-start tests**

Leftover submission `SUBMITTING` with a timestamp becomes `SUBMISSION_UNKNOWN`; without a timestamp becomes `CANCELLED`; cancellation `SUBMITTING` becomes `UNKNOWN`; none calls KIS. Startup writes audit entries and sends one best-effort aggregate Slack warning.

- [ ] **Step 2: Implement startup barrier**

Make scheduler callbacks await a recovery-ready promise before any trading loop. Exactly one active process is enforced by the existing single-process Docker command; document that multi-worker deployment is unsupported for live trading.

- [ ] **Step 3: Run all focused and integration tests**

Run: `npx jest --runInBand`

Run: `TEST_DATABASE_URL=postgresql://localhost:55432/kis_trader_test npm run test:integration:postgres`

Expected: all unit/integration suites pass with no unexpected warnings/errors.

- [ ] **Step 4: Run final builds/codegen/lint**

Run in order:

```bash
npm run prisma:generate
npm run build
npm run client:codegen
npm run client:build
cd client && yarn lint
```

Expected: every command exits 0.

- [ ] **Step 5: Browser smoke test**

Use the in-app browser against the local app. Verify hidden empty state; legacy context confirmation; candidate lookup; link confirmation; existing-record collision; dismissal blocked by a candidate; successful zero-candidate dismissal; cancellation status lookup/not-accepted confirmation; and stale/concurrent action feedback. Confirm the 15-second poll does not trigger KIS reads.

- [ ] **Step 6: Review the final diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors, no secret/env files, `.codex/` untouched, generated files included, and no commit/push without a separate user request.

## Self-Review Results

- Spec coverage: every approved requirement maps to Tasks 1–14; MDD threshold activation is explicitly excluded because it was not approved.
- Placeholder scan: the plan contains no deferred implementation placeholders; each behavior has an exact test, interface, file list, and command.
- Type consistency: `OrderResult`, broker action context, recovery method names, Prisma enum names, GraphQL operations, and client hooks are defined once and reused consistently.
- Dependency order: Tasks 1–6 establish infrastructure and acyclic modules; Tasks 7–9 wire live mutation flows; Tasks 10–12 add safe reconciliation; Tasks 13–14 expose and verify the UI/operations.
