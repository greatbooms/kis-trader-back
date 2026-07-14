# Adversarial Order Safety Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` for every task. Independent file groups may use `superpowers:dispatching-parallel-agents`; integration changes must be reviewed after the groups are combined. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the wrong-account, duplicate-order, false broker-recovery, terminal-partial blocking, and approval-aftercare defects found by the 2026-07-14 adversarial review.

**Architecture:** Keep the existing Prisma state model. Enforce one canonical instrument tuple at admission, bind every broker mutation/reconciliation to the stored broker context, treat KIS history as complete only when every required scope and KST identity is valid, and drive Slack/strategy aftercare from durable final state instead of optimistic UI updates.

**Tech Stack:** NestJS 11, TypeScript 5.9, Prisma 7/PostgreSQL, KIS REST, Slack Bolt, Jest 30.

## Global Constraints

- This is a live-money system: fail closed before a KIS mutation whenever identity, context, history completeness, or pre-submit persistence is uncertain.
- A KIS order/cancellation POST is attempted at most once.
- The stored `brokerEnvironment` and `brokerAccountHash` must match the current KIS context before account-specific reads, reconciliation writes, and mutation POSTs.
- `PARTIAL` is unresolved only while `orderNo` remains non-null; `PARTIAL + orderNo=null` is a terminal partially-filled order.
- Overseas complete history uses documented environment-specific filters and explicit KST response fields; local broker timestamps are never interpreted as KST.
- Existing public GraphQL operations and service signatures remain compatible unless the change is internal-only.
- Every production change starts with a RED test and ends with focused GREEN tests.
- Do not commit or push unless the user explicitly requests it. Preserve `.codex/` and unrelated working-tree changes.

---

### Task 1: Canonical admission tuple and terminal PARTIAL semantics

**Files:**
- Modify: `src/trading/trading-order-guard.service.ts`
- Modify: `src/trading/trading-order-guard.service.spec.ts`
- Modify: `src/trading/trading-order-execution.service.ts`
- Modify: `src/trading/trading-order-execution.service.spec.ts`
- Modify: `src/trading/trading-sell-approval.service.ts`
- Modify: `src/trade-record/trade-record-manual-order.service.ts`
- Modify: `src/trading/trading-orchestrator.service.ts`
- Modify: related focused specs for changed callers

**Interfaces:**
- `TradingOrderGuardService.admit<T>(key, createWithTx)` passes `(tx, normalizedKey)` to the callback.
- Every caller persists and submits the callback's `normalizedKey` values.

- [ ] **Step 1: Add RED tests for callback normalization and terminal PARTIAL**

```ts
it('passes the canonical tuple to the admitted creator', async () => {
  const create = jest.fn().mockResolvedValue('created');
  await service.admit(
    { market: 'DOMESTIC', exchangeCode: ' kospi ', stockCode: ' 005930 ', side: 'SELL' },
    create,
  );
  expect(create).toHaveBeenCalledWith(expect.anything(), {
    market: 'DOMESTIC', exchangeCode: 'KRX', stockCode: '005930', side: 'SELL',
  });
});

it('does not block a new order for terminal PARTIAL with no broker order number', async () => {
  tx.tradeRecord.findFirst.mockResolvedValue(null);
  await service.admit(key, create);
  expect(tx.tradeRecord.findFirst).toHaveBeenCalledWith({
    where: expect.objectContaining({
      OR: expect.arrayContaining([
        { status: OrderStatus.PARTIAL, orderNo: { not: null } },
      ]),
    }),
  });
  expect(create).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run RED**

Run: `npx jest src/trading/trading-order-guard.service.spec.ts src/trading/trading-order-execution.service.spec.ts src/trading/trading-orchestrator.service.spec.ts --runInBand`

Expected: callback has one argument; unresolved query includes every `PARTIAL`; execution persists raw tuple.

- [ ] **Step 3: Implement the minimal canonical flow**

```ts
createWithTx: (
  tx: Prisma.TransactionClient,
  normalizedKey: OrderAdmissionKey,
) => Promise<T>

where: {
  ...normalizedKey,
  OR: [
    { status: { in: [AWAITING_APPROVAL, SUBMITTING, SUBMISSION_UNKNOWN, PENDING] } },
    { status: PARTIAL, orderNo: { not: null } },
  ],
}
```

Return the canonical key with each newly created record where later refresh/KIS submission needs it. Apply the same terminal `PARTIAL` predicate in orchestrator local-open-order queries.

- [ ] **Step 4: Run GREEN**

Run the Task 1 command plus `src/trading/trading-sell-approval.service.spec.ts` and `src/trade-record/trade-record-manual-order.service.spec.ts`.

---

### Task 2: Complete overseas history and accepted-cancellation closure

**Files:**
- Modify: `src/kis/kis-order-history.service.ts`
- Modify: `src/kis/kis-order-history.service.spec.ts`
- Modify: `src/kis/AGENTS.md`
- Modify: `src/trading/trading-broker-order-matcher.service.spec.ts`
- Modify: `src/trading/trading-order-reconciliation.service.ts`
- Modify: `src/trading/trading-order-reconciliation.service.spec.ts`

**Interfaces:**
- `getOrderExecutions('OVERSEAS', startDate, endDate)` continues accepting KST calendar dates but queries the overseas endpoint from KST start minus one day through KST end.
- Overseas `BrokerOrderStatus.orderDate/orderTime` comes only from valid `dmst_ord_dt/thco_ord_tmd`.

- [ ] **Step 1: Add RED KIS contract tests**

```ts
expect(prodExecutionParams).toEqual(expect.objectContaining({
  PDNO: '%', OVRS_EXCG_CD: '%',
}));
expect(paperExecutionParams).toEqual(expect.objectContaining({
  PDNO: '', OVRS_EXCG_CD: '',
}));
expect(unfilledScopes).toEqual(expect.arrayContaining([
  'NASD', 'NYSE', 'AMEX', 'SEHK', 'SHAA', 'SZAA', 'TKSE', 'HASE', 'VNSE',
]));
expect(mapped).toMatchObject({ orderDate: '20260714', orderTime: '000000' });
```

Add a rejection test proving one failed exchange scope rejects the whole unfilled read, and a malformed/missing KST identity test proving the complete history read throws instead of returning a partial candidate set.

- [ ] **Step 2: Run KIS RED**

Run: `npx jest src/kis/kis-order-history.service.spec.ts src/trading/trading-broker-order-matcher.service.spec.ts --runInBand`

- [ ] **Step 3: Implement documented filters, scoped reads, and KST mapping**

```ts
const allFilter = this.isPaper ? '' : '%';
const queryStartDate = this.subtractCalendarDay(startDate);
const orderDate = this.requireDate(row.dmst_ord_dt, 'dmst_ord_dt');
const orderTime = this.requireTime(row.thco_ord_tmd, 'thco_ord_tmd');
```

Read every supported overseas exchange sequentially through the existing paginator/rate limiter. Merge only after every scope succeeds and de-duplicate by normalized `exchangeCode|orderNo`.

- [ ] **Step 4: Add RED cancellation reconciliation tests**

Use a cancellation-accepted execution with `remainingQuantity > 0` and an empty complete unfilled list; expect `CANCELLED/RESOLVED`. Add the inverse case where the exact order remains in unfilled results and expect no transition.

- [ ] **Step 5: Implement cancellation closure from two complete reads**

```ts
const isStillOpen = unfilledOrders.some((order) =>
  this.matchesOrderTuple(record, order, market),
);
if (!brokerOrder || isStillOpen || !record.orderNo) return false;
```

Keep the existing filled-quantity calculation, CAS, audit, strategy aftercare, and notification behavior.

- [ ] **Step 6: Run GREEN**

Run: `npx jest src/kis/kis-order-history.service.spec.ts src/kis/kis-overseas.service.spec.ts src/trading/trading-broker-order-matcher.service.spec.ts src/trading/trading-order-reconciliation.service.spec.ts src/trading/trading-broker-cancellation-recovery.service.spec.ts --runInBand`

---

### Task 3: Bind approval, reconciliation, and manual cancellation to broker context

**Files:**
- Modify: `src/trading/trading-broker-context.service.ts`
- Modify: `src/trading/trading-broker-context.service.spec.ts`
- Modify: `src/trading/trading-sell-approval-workflow.service.ts`
- Modify: `src/trading/trading-sell-approval-workflow.service.spec.ts`
- Modify: `src/trading/trading-order-reconciliation.service.ts`
- Modify: `src/trading/trading-order-reconciliation.service.spec.ts`
- Modify: `src/trade-record/trade-record-manual-order.service.ts`
- Modify: `src/trade-record/trade-record-manual-order.service.spec.ts`

**Interfaces:**
- `TradingBrokerContextService.matchesCurrent(stored): boolean` compares only environment/account hash and exposes neither raw account nor hash in errors/logs.

- [ ] **Step 1: Add RED context tests**

```ts
expect(service.matchesCurrent({
  brokerEnvironment: 'PROD', brokerAccountHash: 'other-hash',
})).toBe(false);
```

Add workflow tests for an approval created under account A and handled under account B; assert no position refresh, submission claim, KIS call, or optimistic Slack success. Add reconciliation filtering tests and manual-cancel tests that assert no KIS read/POST on mismatch or missing context.

- [ ] **Step 2: Run RED**

Run: `npx jest src/trading/trading-broker-context.service.spec.ts src/trading/trading-sell-approval-workflow.service.spec.ts src/trading/trading-order-reconciliation.service.spec.ts src/trade-record/trade-record-manual-order.service.spec.ts --runInBand`

- [ ] **Step 3: Implement fail-closed context checks**

```ts
const context = this.brokerContext.getCurrentContext();
if (
  record.brokerEnvironment !== context.environment
  || record.brokerAccountHash !== context.accountHash
) {
  // do not issue account-specific KIS reads or POSTs
}
```

Approval checks before refresh and again immediately before POST. Reconciliation filters the DB read to the current context. Manual cancellation requires stored context and broker date, performs complete execution plus unfilled identity verification, claims cancellation only after verification, then rechecks context/live switch before POST.

- [ ] **Step 4: Run GREEN**

Run the Task 3 command and `src/trading/trading.module.spec.ts`.

---

### Task 4: Durable approved-sell aftercare, pre-submit cleanup, and truthful Slack state

**Files:**
- Modify: `src/trading/trading-order-execution.service.ts`
- Modify: `src/trading/trading-order-execution.service.spec.ts`
- Modify: `src/trading/trading-sell-approval-workflow.service.ts`
- Modify: `src/trading/trading-sell-approval-workflow.service.spec.ts`
- Modify: `src/trading/trading-order-reconciliation.service.ts`
- Modify: `src/trading/trading-order-reconciliation.service.spec.ts`
- Modify: `src/notification/slack.service.ts`
- Modify: `src/notification/slack.service.spec.ts`

**Interfaces:**
- Approval Slack terminal rendering distinguishes accepted, not submitted/cancelled, broker rejected, and submission unknown.
- Reconciliation can restore an approved signal from the durable approval row when an execution log is unavailable.

- [ ] **Step 1: Add RED tests**

Add tests proving: ancillary log failure cancels `SUBMITTING + submissionStartedAt=null` and issues no KIS POST; an approved high-T fill without `ORDER_SUBMITTED` log restores `StopLossApproval.signal` and runs strategy/Slack aftercare; refresh/no-holding/disabled approval renders a non-executed Slack terminal state; broker unknown renders “결과 확인 필요”.

- [ ] **Step 2: Run RED**

Run: `npx jest src/trading/trading-order-execution.service.spec.ts src/trading/trading-sell-approval-workflow.service.spec.ts src/trading/trading-order-reconciliation.service.spec.ts src/notification/slack.service.spec.ts --runInBand`

- [ ] **Step 3: Implement cleanup and durable signal fallback**

```ts
try {
  await this.logAdmittedOrder(...);
  await this.markInfiniteBuySecondTargetAttempted(...);
} catch (error) {
  await this.cancelPreSubmit(record.id, '주문 전 감사 로그 저장 실패');
  return false;
}
```

Persist the clamped approved signal before setting `submissionStartedAt`; if that cannot be done, cancel before POST. Make reconciliation fall back to the latest approval signal by `tradeRecordId`. Move the original Slack update after the authoritative workflow result and map it to an accurate terminal label.

- [ ] **Step 4: Run GREEN**

Run the Task 4 command.

---

### Task 5: Integrated verification and adversarial re-review

**Files:**
- Verify all changed source/spec/docs files.

- [ ] **Step 1: Run focused safety suites**

Run all Task 1-4 focused suites together with `--runInBand`.

- [ ] **Step 2: Run repository verification**

Run:

```bash
npx jest --runInBand
npm run build
npm run client:codegen
npm run client:build
npm run client:lint
npx prisma validate
```

- [ ] **Step 3: Re-run adversarial review**

Review exact regression scenarios: account switch between approval and click, noncanonical duplicate key, terminal partial protective sell, KST midnight overseas order, incomplete exchange scope, accepted domestic cancellation, approval aftercare without execution log, and pre-submit DB failure.

- [ ] **Step 4: Confirm working-tree scope**

Ensure no user-local `.codex/` files, secrets, unrelated files, generated artifacts outside codegen outputs, commits, or pushes were introduced.
