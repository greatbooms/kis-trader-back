# Buy Fill Slack Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore BUY fill Slack notifications when a trade has separate signal-submission and broker-acceptance logs.

**Architecture:** Keep notification ownership in `TradingOrderReconciliationService`. Change only submitted-signal reconstruction so it selects the newest valid signal-bearing execution log, retaining the approval fallback and adding observability for unrecoverable fills.

**Tech Stack:** NestJS, TypeScript, Prisma, Jest

## Global Constraints

- Do not change broker order submission, fill status reconciliation, approval behavior, or schema.
- Do not send duplicate alerts for one reconciliation transition.
- Do not commit or push without explicit user request.

---

### Task 1: Recover the newest valid submitted signal

**Files:**
- Modify: `src/trading/trading-order-reconciliation.service.ts`
- Test: `src/trading/trading-order-reconciliation.service.spec.ts`

**Interfaces:**
- Consumes: `watchStockExecutionLog.findMany` results ordered by `createdAt: 'desc'`.
- Produces: existing private `getSubmittedSignal(tradeRecordId): Promise<TradingSignal | undefined>` behavior with invalid-log skipping.

- [ ] **Step 1: Write the failing regression test**

Mock two `ORDER_SUBMITTED` logs: a newest broker-acceptance log without `side`/`quantity`, followed by an earlier full BUY signal log. Reconcile a filled BUY and expect `sendTradeAlert` to receive that BUY signal.

- [ ] **Step 2: Run the regression test and verify RED**

Run: `npx jest src/trading/trading-order-reconciliation.service.spec.ts --runInBand -t "uses the newest valid submitted signal"`

Expected: FAIL because current code calls `findFirst` and returns no signal from the newest incomplete log.

- [ ] **Step 3: Implement minimal valid-log selection**

Query matching logs newest-first, normalize each log's details as a signal candidate, and return the first valid candidate. If none exists, preserve the approved-signal fallback. Add a warning at the fill-notification call site when no signal can be reconstructed.

- [ ] **Step 4: Verify GREEN and regressions**

Run the focused test, the complete reconciliation spec, `npm run build`, and `npx jest --runInBand`.

- [ ] **Step 5: Review the diff**

Confirm only the reconciliation service, its spec, and these documentation files changed; confirm no secret or environment file is included.
