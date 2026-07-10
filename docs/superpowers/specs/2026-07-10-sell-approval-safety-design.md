# Sell Approval Safety Hardening Design (WIP)

> Status: **Paused during design review — no safety-hardening implementation has started.**
>
> Branch: `feat/manual-sell-approvals`
>
> Draft PR: [#13 fix(trading): require approval for sell exits](https://github.com/greatbooms/kis-trader-back/pull/13)
>
> Baseline implementation commit: `cc7177c05f37308c32bb2147fdac489bd8ab1d7b`

## 1. Current development state

PR #13 contains the first implementation of Slack-gated sell approvals. It is intentionally still a draft and must not be merged in its current state. The branch currently has no safety-hardening code beyond commit `cc7177c`; this document is the only new workspace artifact created for the pause/handoff.

The existing implementation already:

- introduces `TradingSellApprovalService`;
- creates/reuses `StopLossApproval` records;
- sends Slack approve/reject buttons;
- routes protective sell signals and infinite-buy high-T take-profit signals into approval;
- refreshes broker positions and clamps quantity before an approved sell;
- carries infinite-buy T metadata into take-profit signals;
- removes the prior infinite-buy MDD liquidation block.

The untracked `.codex/` directory is user-local state and is explicitly outside this work.

## 2. Confirmed merge blockers in PR #13

The following are confirmed from the current code, not speculative review notes:

1. **Duplicate live sell race (critical).** Two Slack callbacks can both read `PENDING`, both write `APPROVED`, and both invoke KIS because approval claiming is not conditional or atomic.
2. **Approvals do not expire (high).** `timeoutMinutes` controls reminder copy only. No path writes `EXPIRED`, and execution does not validate request age.
3. **Approval/trade state divergence (high).** Paired `TradeRecord` and `StopLossApproval` creates/updates/rejections are not wrapped in Prisma transactions.
4. **No approver authorization (high).** Slack action handlers do not inspect `body.user.id`; any member able to click the message can approve a live sell.
5. **Infinite-buy MDD protection removed (high policy impact).** The strategy no longer emits its previous portfolio-MDD liquidation SELL, and the approval service cannot replace a signal that is never created.
6. **Ambiguous KIS outcomes are retry-unsafe.** There is no explicit state for a claimed request whose external order result is unknown.

Relevant implementation paths:

- `src/notification/slack-commands.service.ts`
- `src/trading/trading.service.ts`
- `src/trading/trading-sell-approval.service.ts`
- `src/trading/strategy/infinite-buy.strategy.ts`
- `src/trading/strategy/infinite-buy.strategy.spec.ts`
- `prisma/schema.prisma`

## 3. Product and safety decisions already approved

### Approval scope

Slack approval is required only for:

- stop-loss sells;
- MDD/risk liquidation sells;
- end-of-day and carryover liquidation sells;
- trailing-stop sells;
- infinite-buy take-profit sells when `T >= 20`.

The following keep their existing behavior:

- infinite-buy take profit when `T < 20`: automatic sell;
- other ordinary strategy sells: automatic sell;
- BUY signals: unchanged;
- user-initiated manual sell: unchanged.

### MDD behavior

Restore the previous infinite-buy MDD liquidation SELL signal, identify it as `risk-liquidation`, and route it through Slack approval. MDD detection must never submit KIS orders directly.

### Timing

- A Slack approval button is valid for **10 minutes from message delivery**.
- An expired button must not execute an order.
- If the qualifying condition persists, a new Slack request may be sent **30 minutes after the previous successful notification**.

### Authorization

- Add comma-separated `SLACK_APPROVER_USER_IDS` configuration.
- Only listed Slack user IDs may approve or reject.
- An empty/missing allowlist is fail-closed: no approval action may mutate DB state or call KIS.

### Ambiguous external results

- Never retry an approved sell automatically when the KIS result is unknown.
- Persist an explicit operator-review state and send a Slack warning.
- The operator must inspect broker order history before any later action.

## 4. Approved architecture and state model

The explicit state-machine approach was selected over a minimal conditional update or a full outbox/worker architecture.

### Prisma changes

`StopLossApproval` keeps its decision states:

```text
PENDING -> APPROVED | REJECTED | EXPIRED
```

Add:

- `expiresAt DateTime` — fixed 10-minute approval deadline;
- `respondedBy String?` — Slack user ID for auditability;
- an index supporting stock/status lookup and expiry processing.

Extend `OrderStatus`:

```text
AWAITING_APPROVAL -> SUBMITTING -> PENDING | FAILED | SUBMISSION_UNKNOWN | CANCELLED
```

All Prisma schema changes require a checked-in migration.

### Service boundaries

- `TradingSellApprovalService`
  - classify approval-required signals;
  - create approval/trade pairs atomically;
  - expire pending requests;
  - enforce the 30-minute notification cooldown.
- New `TradingSellApprovalWorkflowService`
  - validate Slack approver IDs;
  - atomically claim approve/reject actions;
  - refresh positions and clamp quantity;
  - submit the single allowed KIS request;
  - persist success, explicit failure, or unknown outcome.
- `SlackCommandsService`
  - extract Slack action input and delegate only;
  - no direct approval/trade state mutations.
- `TradingService`
  - remove the approved-sell execution block added by PR #13;
  - do not add more approval workflow logic to this existing 1,400+ line service.
- `InfiniteBuyStrategy`
  - restore the prior MDD liquidation branch;
  - attach explicit `risk-liquidation` metadata.

## 5. Proposed data flow — awaiting user approval

This section was presented but the session paused before approval.

1. A protective SELL or infinite-buy `T >= 20` take-profit creates `TradeRecord(AWAITING_APPROVAL)` and `StopLossApproval(PENDING)` in one transaction.
2. Slack delivery makes the request actionable for 10 minutes. Delivery failure expires/cancels the pair and does not start the 30-minute successful-notification cooldown.
3. An authorized click conditionally claims both rows in one transaction: approval becomes `APPROVED`, trade becomes `SUBMITTING`, and `respondedBy` is recorded.
4. Only the transaction winner may call KIS. Concurrent or retried callbacks return an already-handled result.
5. Immediately before KIS, refresh broker positions; cancel when quantity is zero and clamp when quantity decreased.
6. Do not recompute the strategy or order price inside the approved 10-minute lease.
7. KIS success sets `PENDING`; an explicit broker rejection sets `FAILED`; timeout/transport ambiguity sets `SUBMISSION_UNKNOWN` and emits an operator warning.
8. Never auto-retry `SUBMISSION_UNKNOWN`.
9. On process restart, stale `SUBMITTING` records become `SUBMISSION_UNKNOWN` so they cannot be resubmitted silently.
10. Rejection and expiration update approval/trade rows atomically and remove the actionable Slack state.

## 6. Expected implementation files

The exact plan has not been written yet, but the approved design is expected to touch:

- `prisma/schema.prisma`
- `prisma/migrations/<timestamp>_harden_sell_approval_state/migration.sql`
- `.env.example`
- `src/config/configuration.ts`
- `src/config/AGENTS.md`
- `src/notification/slack-commands.service.ts`
- `src/notification/slack.service.ts`
- `src/notification/AGENTS.md`
- `src/trading/trading-sell-approval.service.ts`
- `src/trading/trading-sell-approval-workflow.service.ts` (new)
- `src/trading/trading.service.ts`
- `src/trading/trading.module.ts`
- `src/trading/strategy/infinite-buy.strategy.ts`
- `src/trading/types/` for workflow result types
- focused `*.spec.ts` files for all behavior below
- `src/trading/AGENTS.md`
- `docs/slack-setup-guide.md`

## 7. Required TDD coverage

Every production change must be preceded by a failing regression test. At minimum:

- two concurrent approvals result in exactly one KIS call;
- a retry after `APPROVED` or `SUBMITTING` never calls KIS;
- an expired request cannot be approved and becomes cancelled;
- new notifications respect 10-minute validity and 30-minute cooldown;
- Slack delivery failure leaves no actionable approval;
- empty and non-matching approver allowlists are fail-closed;
- approve/reject paired state changes roll back together on failure;
- no holdings cancels safely and reduced holdings clamp quantity;
- explicit KIS rejection becomes `FAILED`;
- thrown/timeout KIS calls become `SUBMISSION_UNKNOWN` with no retry;
- stale `SUBMITTING` recovery becomes `SUBMISSION_UNKNOWN`;
- infinite-buy MDD emits a `risk-liquidation` SELL that requires approval;
- infinite-buy take profit requires approval at `T >= 20` and remains automatic below 20;
- ordinary non-protective sells remain automatic.

Final verification remains:

```bash
npm run build
npx jest --runInBand
```

## 8. Resume point

1. Re-read this document and the current PR #13 diff.
2. Resume brainstorming at **Section 5, Proposed data flow** and obtain explicit user approval.
3. Present and approve the remaining testing/operational design.
4. Self-review this spec for ambiguity and update it from WIP to approved.
5. Ask the user to review the written spec.
6. Invoke `superpowers:writing-plans`; do not write implementation code before that gate.
7. Implement via strict red-green-refactor cycles.

No commit beyond this WIP documentation should be interpreted as fixing the merge blockers.
