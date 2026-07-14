# Sell Approval Safety Hardening Design

> Status: **Implemented and locally verified on 2026-07-14; changes remain uncommitted on the feature branch.**
>
> Branch: `feat/manual-sell-approvals`
>
> Draft PR: [#13 fix(trading): require approval for sell exits](https://github.com/greatbooms/kis-trader-back/pull/13)
>
> Baseline implementation commit: `cc7177c05f37308c32bb2147fdac489bd8ab1d7b`
>
> Documentation checkpoint commit: `e1c7bb77026815723613887ce271d226cb4062e4`

## 1. Baseline at design start (historical)

At the start of this design, PR #13 contained only the first implementation of Slack-gated sell approvals and was not safe to merge. The hardening described below has since been implemented and verified; this section remains as the historical baseline that motivated the work.

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
6. **Ambiguous KIS outcomes are retry-unsafe.** There is no explicit state for a claimed request whose external order result is unknown. In addition, `KisBaseService.post()` currently retries timeout, network, and 5xx failures up to two times even though every current caller is a mutating order or cancellation endpoint. A broker may have accepted the first request before the client lost the response, so this retry can itself create duplicate live orders.
7. **The live-trading switch is default-open.** Current configuration treats any value other than the literal string `false`, including a missing `TRADING_ENABLED`, as enabled. A financial order path must instead require the explicit value `true` and re-check that guard immediately before every order/cancellation POST.
8. **The current SELL classifier is broader than the approved policy.** Its fallback requires approval for every SELL reason it does not recognize as take-profit. That can gate ordinary strategy sells, while the approved scope is an explicit allowlist of protective exits plus infinite-buy take-profit at `T >= 20`.

Relevant implementation paths:

- `src/kis/kis-base.service.ts`
- `src/kis/kis-domestic.service.ts`
- `src/kis/kis-overseas.service.ts`
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

“Unchanged” means these paths do not gain a pre-submit approval gate. The transport-safety contract is broader: if any automatic BUY/SELL or manual sell has an ambiguous KIS result, it must stop in `SUBMISSION_UNKNOWN` for reconciliation instead of being labelled `FAILED` and becoming eligible for an unsafe reissue.

### MDD behavior

Restore the previous infinite-buy MDD liquidation SELL signal, identify it as `risk-liquidation`, and route it through Slack approval. MDD detection must never submit KIS orders directly.

### Timing

- A Slack approval button is valid for **10 minutes from message delivery**.
- An expired button must not execute an order.
- If the qualifying condition persists, a new Slack request may be sent **30 minutes after the previous successful notification**.

### Authorization

- Add comma-separated `SLACK_APPROVER_USER_IDS` configuration.
- Parse it through `ConfigService` by trimming entries, removing blanks, and de-duplicating into a set; never read `process.env` from a service.
- Only listed Slack user IDs may approve or reject.
- An empty/missing allowlist is fail-closed: no approval action may mutate DB state or call KIS.

### Live-trading switch

- Parse `TRADING_ENABLED` as enabled only when its normalized value is exactly `true`; missing, blank, malformed, or `false` values are disabled.
- Every approved, ordinary automatic, manual order, and cancellation path checks the shared `trading.enabled` guard at admission and again immediately before its one allowed mutating KIS POST. A disabled transition cancels a pre-submit order intent or releases a pre-POST cancellation claim without invoking KIS.
- Read-only broker reconciliation remains available while trading is disabled.

### Ambiguous external results

- Never retry an approved sell automatically when the KIS result is unknown.
- Never automatically retry a mutating KIS POST. Retriable read-only GET behavior remains unchanged.
- Treat an order as accepted only when a valid KIS success response includes a non-empty broker order number.
- Treat a well-formed KIS business response with `rt_cd != 0`, or a deterministic local failure before the order HTTP invocation (validation/auth/header setup), as safely not accepted. Timeout, network failure after invocation, HTTP failure without that business response, malformed response, and a success response missing the order number are all unknown.
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
- `notifiedAt DateTime?` — successful Slack delivery time and 30-minute cooldown anchor;
- `respondedBy String?` — Slack user ID for auditability;
- indexes on `(market, exchangeCode, stockCode, status, expiresAt)` for active/expired lookup and `(market, exchangeCode, stockCode, notifiedAt)` for cooldown lookup;
- a PostgreSQL partial unique index on `(market, exchange_code, stock_code) WHERE status = 'PENDING'` so concurrent strategy evaluations cannot create two independently approvable exits for the same instrument. Prisma cannot declare this partial index, so the generated migration adds it explicitly and the service handles the unique-conflict loser by reloading the winning request.

`timeoutMinutes` remains for message/backwards compatibility, is written as 10 for every new request, and is not an execution authority; `expiresAt` is authoritative.

Extend `OrderStatus`:

```text
AWAITING_APPROVAL -> SUBMITTING -> PENDING | FAILED | SUBMISSION_UNKNOWN | CANCELLED
```

Add nullable fields to `TradeRecord`:

- `submissionStartedAt DateTime?` — timestamp written immediately before the one allowed KIS order call and used as the center of the broker-history match window;
- `brokerOrderDate String?` — KST `yyyyMMdd` identity component for a broker order number;
- `brokerOrderTime String?` — normalized KIS `HHmmss` order time;
- `brokerEnvironment BrokerEnvironment?` (`PAPER`/`PROD`) and `brokerAccountHash String?` — current KIS environment and a non-secret SHA-256 fingerprint of the effective `CANO + ACNT_PRDT_CD` pair (including the configured product-code fallback when the account string omits it); populate both on every new order intent before Slack/KIS, including attempts that later become unknown, and never store/log the raw account number for identity matching;
- `brokerMessage String?` — sanitized KIS acceptance/rejection/transport message, separate from the strategy reason;
- `submissionResolvedAt DateTime?` — operator recovery completion time;
- `submissionResolvedBy String?` — `slack:<userId>` or `web:<username>`;
- `submissionResolution SubmissionResolution?` — enum values `LINKED_BROKER_ORDER`, `CONFIRMED_NOT_SUBMITTED`, or `MATCHED_EXISTING_TRADE_RECORD`.
- `cancellationStatus CancellationAttemptStatus?` — `SUBMITTING`, `ACCEPTED`, `REJECTED`, `UNKNOWN`, or `RESOLVED`;
- `cancellationStartedAt DateTime?`, `cancellationResolvedAt DateTime?`, `cancellationResolvedBy String?`, and `cancellationMessage String?` — durable cancellation-attempt lifecycle independent of the original order status.

The existing strategy `reason` is never overwritten by recovery metadata. A linked broker order is stored in the existing `orderNo` field; detailed before/after state and candidate data remain in the audit log. Add a PostgreSQL partial unique index on `(broker_environment, broker_account_hash, market, exchange_code, broker_order_date, order_no)` where every identity component is non-null, preventing the same environment/account/date/exchange broker order from being linked to two TradeRecords. Historical rows may keep the new identity fields null; every new accepted or manually linked order writes them.

Extend `WatchStockExecutionEventType` with `ORDER_SUBMISSION_UNKNOWN` for entering operator review and `ORDER_RECONCILIATION` for lookup/link/dismiss audit entries. The latter stores its concrete action and channel in `details`.

Add an authoritative `BrokerOrderActionAuditLog` model because manual sells may have no `WatchStock` and cancellation recovery is also audited:

- required TradeRecord relation with `onDelete: Cascade`;
- `channel` enum values `SYSTEM`, `SLACK`, `WEB`;
- `action` enum values `UNKNOWN_DETECTED`, `LEGACY_CONTEXT_ASSIGNED`, `CANDIDATES_INSPECTED`, `BROKER_ORDER_LINKED`, `CONFIRMED_NOT_SUBMITTED`, `MATCHED_EXISTING_TRADE_RECORD`, `CANCELLATION_UNKNOWN`, `CANCELLATION_RECONCILED`, and `CANCELLATION_NOT_ACCEPTED`;
- `actor`, optional broker date/exchange/order number, before/after `OrderStatus`, `details`, and `createdAt`;
- an index on `(tradeRecordId, createdAt)`;
- state-changing link/dismiss writes this audit row in the same transaction as the TradeRecord transition.
- entering `SUBMISSION_UNKNOWN` likewise writes `UNKNOWN_DETECTED` atomically with the status transition.

Strategy orders with a matching WatchStock also mirror the event to `WatchStockExecutionLog`; failure to find a WatchStock never removes the authoritative generic audit trail.

All Prisma schema changes require a checked-in migration.

### Service boundaries

- `TradingSellApprovalService`
  - classify approval-required signals;
  - create approval/trade pairs atomically;
  - let only the transaction that created the partial-index winner deliver Slack; concurrent callers reuse it without redelivery;
  - expire pending requests;
  - enforce the 30-minute notification cooldown.
- New `TradingSellApprovalWorkflowService`
  - validate Slack approver IDs;
  - atomically claim approve/reject actions;
  - refresh positions and clamp quantity;
  - submit the single allowed KIS request;
  - persist the approved sell's success, explicit failure, or unknown outcome;
  - delegate unknown-result alerting/reconciliation to the shared recovery service.
- New `TradingBrokerOrderRecoveryService`
  - own `SUBMISSION_UNKNOWN` entry and cold-start recovery for every real order-submission path, including ordinary automatic orders and manual sells;
  - inspect complete KIS order history without submitting orders;
  - atomically link or dismiss unknown submissions;
  - reconcile ambiguous cancellation results by read-only inspection of the original order, without creating or retrying a cancellation request.
- New `TradingOrderGuardService`
  - query unresolved same-side intents by market/exchange/stock;
  - canonicalize domestic exchange as `KRX`, otherwise use `trim().toUpperCase()` for exchange/stock code, then build `length:value` components for market/exchange/stock/side joined by `|` and serialize `check + intent creation` with `pg_advisory_xact_lock(hashtextextended(key, 0))`;
  - run the parameterized lock query, unresolved lookup, and intent create through the provided `tx` inside one interactive `prisma.$transaction(async tx => ...)`; using the root Prisma client, an array transaction, or awaiting Slack/KIS inside that transaction is forbidden because it would lose the same physical-connection/short-transaction invariant;
  - provide the shared defense-in-depth admission primitive used by approval creation, automatic execution, and `TradeRecordManualOrderService.manualSell`. The transaction commits before any Slack or KIS call.
- New `TradingBrokerContextService`
  - derive the normalized `PAPER`/`PROD` context, SHA-256 fingerprint of effective `CANO + ACNT_PRDT_CD`, and masked CANO suffix/product code from `ConfigService` only;
  - fail closed before intent creation when the account number/product code or environment is missing or invalid;
  - centralize context comparison/legacy assignment so no caller logs or persists the raw account number.
- New `TradingPositionRefreshService`
  - fetch the current domestic/overseas broker balance through KIS, synchronize DB positions, and return the broker snapshot;
  - throw after `logger.warn` on refresh failure so every caller can abort before order submission;
  - let sell callers clamp from the returned broker snapshot rather than trusting a stale DB row. `TradingPositionSyncService` must also delete all positions for the market when a successful broker snapshot is empty.
- New `TradingOrderExecutionService`
  - own ordinary automatic BUY/SELL TradeRecord admission, guarded KIS submission, structured outcome persistence, and order execution audit;
  - enforce the fail-closed live-trading switch at admission and immediately before KIS;
  - keep this new behavior out of the existing 1,400+ line `TradingService`, which delegates after approval classification.
- New `TradeRecordManualOrderService`
  - first receive a behavior-preserving extraction of `manualSell`, `cancelTradeOrder`, and their broker snapshot helpers from the existing 623-line `TradeRecordService`;
  - then consume the exported guard/recovery services for manual-order safety without growing the read-mostly service;
  - keep the existing GraphQL operation names, inputs, and outputs unchanged while the resolver delegates mutations to the new service.
- Move the trading/portfolio command adapter to `TradingSlackCommandsService` in `TradingModule`
  - register Slack trading commands/actions, extract action input, and delegate approval/recovery decisions only;
  - contain no direct approval/trade state mutations;
  - remove the current unused `TradeRecordService` import/injection during the move, so `TradingModule` does not import `TradeRecordModule` and the dependency remains acyclic.
- `NotificationModule`
  - retain `SlackService` as outbound/Bolt infrastructure and export it;
  - stop importing `TradingModule` or providing the trading command adapter.
- `TradingModule`
  - import `NotificationModule` and provide `TradingSlackCommandsService`, yielding a one-way `Trading -> Notification` dependency;
  - remove the existing `forwardRef` cycle. `TradeRecordModule` can also import `TradingModule` normally once notification no longer pulls it back through trade-record.
- New `TradingBrokerOrderRecoveryResolver`
  - expose authenticated read/resolve operations for unknown submissions;
  - obtain the JWT username and pass `web:<username>` as the audit actor;
  - contain no matching or state-transition business logic.
- `TradingService`
  - remove the approved-sell execution block added by PR #13;
  - delegate ordinary execution to `TradingOrderExecutionService` and do not add more approval/order workflow logic to this existing 1,400+ line service.
- `InfiniteBuyStrategy`
  - restore the prior MDD liquidation branch;
  - attach explicit `risk-liquidation` metadata.

### KIS order submission contract

- `KisBaseService.post()` becomes a single-attempt operation. Its current callers are all order/cancellation mutations, so none may be retried after a transport or HTTP failure. `KisBaseService.get()` retains its bounded retry behavior for read-only lookups.
- Preserve the distinction between a valid KIS business rejection and every other thrown result with a typed infrastructure error instead of flattening both to a plain `Error`.
- Extend the backwards-compatible `OrderResult` contract with a required `outcome` discriminator:

```text
ACCEPTED  — HTTP success, a well-formed KIS envelope with rt_cd = 0, a trimmed non-empty orderNo, and a valid normalized broker order date/time
REJECTED  — a well-formed KIS envelope with rt_cd != 0 (including one carried in an HTTP error response), or deterministic validation/auth/header failure before invoking the order POST
UNKNOWN   — timeout/network error, HTTP error without an explicit rt_cd != 0 business envelope, empty/malformed body, contradictory HTTP-error + rt_cd = 0 response, or nominal success with a missing/blank orderNo
```

- Classification precedence is explicit business rejection first, then fully proven acceptance, otherwise unknown. Never infer rejection from HTTP status alone.
- Extend `OrderResult` with `brokerOrderDate` and `orderTime`. Accept only an explicitly supported KIS `ORD_TMD` shape: normalize a six-digit `HHmmss` value by combining it with the KST dates immediately before/on/after the local order-call start and choosing the nearest timestamp; if an endpoint returns a documented 14-digit `yyyyMMddHHmmss` value, validate and use its explicit KST date/time. The normalized timestamp must be within 10 minutes of the call start or the result is `UNKNOWN` even when an order number is present. This handles an order response crossing KST midnight without guessing the date from TradeRecord creation time.
- Accepted persistence and candidate linking preserve the environment/account hash captured on intent creation. The database may contain paper/prod or changed-account history; uniqueness never assumes one account/environment per database.
- Recovery verifies that the record's stored broker environment/account hash matches the currently configured KIS context before any broker read. A mismatch is fail-closed and instructs the operator to use the matching account context; it is never treated as zero candidates.
- A migrated legacy unknown whose context is null exposes `현재 계좌 컨텍스트 지정` before lookup. An authorized Slack/web confirmation shows only environment and a masked account suffix, then atomically stores the current environment/hash with a `LEGACY_CONTEXT_ASSIGNED` audit row. Until that explicit assignment, broker lookup/link/dismiss is disabled.
- Keep `success` for existing callers (`true` only for `ACCEPTED`), but every mutating caller must branch on `outcome`; it must never collapse `REJECTED` and `UNKNOWN` through the boolean.
- Apply the same no-retry and outcome mapping to domestic and overseas order/cancellation wrappers. Every TradeRecord-producing caller maps order `UNKNOWN` to durable `SUBMISSION_UNKNOWN`; cancellation callers re-read the original broker order to determine its current state and leave it unchanged when that read is incomplete. This removes transport-level duplicate submission risk without changing which ordinary BUY/SELL signals require approval.
- Add a read-only `getWithMetadata()` path that preserves the KIS response `tr_cont` header for paginated history queries; existing simple GET callers may keep the data-only method. This was verified against KIS's official [domestic order-history sample](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_daily_ccld/inquire_daily_ccld.py) and [overseas order-history sample](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/overseas_stock/inquire_ccnl/inquire_ccnl.py).

## 5. Approved approval and submission flow

1. A protective SELL or infinite-buy `T >= 20` take-profit creates `TradeRecord(AWAITING_APPROVAL)` and `StopLossApproval(PENDING)` in one Prisma transaction. The partial unique index elects one request per market/exchange/stock under concurrency; a losing create rolls back its paired TradeRecord, reloads the winner, and does not send another Slack message.
2. The initial transaction sets a fail-closed provisional `expiresAt = requestedAt + 2 minutes`, then posts the request to Slack outside the DB transaction. On successful delivery, derive `notifiedAt` from the returned Slack message timestamp and set `expiresAt = notifiedAt + 10 minutes`. If the process dies between Slack delivery and this update, the button stops working after the provisional two-minute lease instead of remaining unbounded.
3. Slack delivery failure, a missing channel/message timestamp, or an invalid Slack timestamp atomically changes the approval to `EXPIRED` and the trade to `CANCELLED`. Because `notifiedAt` remains null, failed delivery does not start the 30-minute notification cooldown.
4. Repeated qualifying strategy evaluations do not extend the original button. Before creating/reusing requests or processing actions, the service atomically expires due `PENDING` rows and cancels their `AWAITING_APPROVAL` trades. The next request may be delivered only when there is no unresolved same-side TradeRecord for the same market/exchange/stock and 30 minutes have passed since that key's most recent non-null `notifiedAt`.
5. An approval or rejection action first validates the Slack actor against `SLACK_APPROVER_USER_IDS`. A missing or empty allowlist is fail-closed.
6. Approval also checks `trading.enabled` before claiming and again before the guarded KIS invocation. If disabled before claim, it leaves the request unclaimed for expiry and performs no order mutation; rejection remains available. If it becomes disabled after claim, atomically cancel the still-`SUBMITTING` trade before any KIS call. An authorized approval conditionally claims both rows in one transaction: `PENDING -> APPROVED`, `AWAITING_APPROVAL -> SUBMITTING`, while `respondedAt` and `respondedBy` are recorded. An authorized rejection uses the same conditional pattern for `PENDING -> REJECTED` and `AWAITING_APPROVAL -> CANCELLED`. Both decisions require `expiresAt > now` and the expected current statuses.
7. Only the transaction winner may call KIS. Concurrent, retried, or already-handled actions return the persisted outcome and never submit another order.
8. Refresh broker positions after the claim. A refresh failure changes the still-pre-submit trade to `CANCELLED` and alerts the operator; it must never fall through to KIS. No holdings also changes the trade to `CANCELLED`; lower holdings clamp the stored quantity from the returned broker snapshot. Immediately before invoking KIS, conditionally write `submissionStartedAt = now` only while the trade is still `SUBMITTING` and the field is null. KIS may be called only if that write wins.
9. The strategy and order price are not recomputed inside the approved 10-minute lease. The user approves the displayed recent order intent; current holdings remain the final safety constraint.
10. Submit exactly one KIS POST and branch on its structured outcome. Only `ACCEPTED` with a non-empty `orderNo` and valid normalized `brokerOrderDate`/`orderTime` changes the trade to `PENDING`; `REJECTED` changes it to `FAILED`; `UNKNOWN` changes it to `SUBMISSION_UNKNOWN`. A nominal success response with a missing/blank order number or invalid broker time is `UNKNOWN`, never `PENDING`.
11. `SUBMISSION_UNKNOWN` is never automatically retried. The deployment retains the project's existing single-active-trading-process invariant. On cold startup, a leftover `SUBMITTING` row with `submissionStartedAt` becomes `SUBMISSION_UNKNOWN`; a row with no submission timestamp becomes `CANCELLED` because the guarded KIS invocation was never reached. Startup recovery changes each row once and sends a best-effort warning for unknown attempts. It must not run periodically while another trading process could still own an in-flight call.
12. Rejection and expiration change approval/trade rows atomically and remove actionable Slack buttons on a best-effort basis. A Slack update failure cannot roll back the DB decision.

### Common automatic/manual order flow

- Ordinary automatic orders and manual sells still bypass approval, but create their TradeRecord as `SUBMITTING` with a null `submissionStartedAt` inside the shared advisory-lock transaction rather than pre-labelling the order `PENDING`. After commit and immediately before their one KIS call, a conditional update sets the timestamp; only that update's winner may call KIS.
- Each ordinary/manual path requires the fail-closed live-trading switch both before intent admission and immediately before KIS. If it becomes disabled after admission but before the call, conditionally cancel the still-pre-submit TradeRecord without invoking KIS.
- They use the same fail-closed position refresh. Refresh failure cancels the pre-submit intent and returns an operator-visible error without calling KIS; manual/approved sells derive available quantity from the successful broker snapshot.
- `ACCEPTED`, `REJECTED`, and `UNKNOWN` map to `PENDING`, `FAILED`, and `SUBMISSION_UNKNOWN` exactly as in the approved-sell workflow.
- If the broker returns `ACCEPTED` but the following DB update fails, retry only the idempotent DB status/order-number write up to two additional times; never issue another KIS request and never overwrite the record as `FAILED`. If all DB writes fail, leave it `SUBMITTING` for cold-start recovery and send a best-effort Slack warning containing the known broker order number when available.
- Before a cancel POST, conditionally set `cancellationStatus = SUBMITTING` and `cancellationStartedAt = now` only when the original order is cancellable and has no blocking cancellation state. `SUBMITTING`, `ACCEPTED`, and `UNKNOWN` block another cancel; only `REJECTED`, `RESOLVED`, or null permit a new explicit attempt when the original order remains open. Only the conditional-update winner may call KIS. `ACCEPTED`/`REJECTED` persist their cancellation outcome and reconcile the original order from complete broker state as appropriate; `UNKNOWN` atomically persists `cancellationStatus = UNKNOWN` plus audit while leaving the original `PENDING`/`PARTIAL` status intact.
- Cancellation re-checks the live-trading switch after claiming and immediately before POST. If disabled, it changes only that still-pre-POST cancellation claim to `REJECTED` with a sanitized disabled reason and performs no KIS call; the original order remains unchanged.
- `manualSell`, user cancellation, and automatic close cancellation all refuse another mutation while the relevant submission/cancellation status is unresolved. No path automatically repeats an unknown cancel POST.
- Order-admission checks treat `AWAITING_APPROVAL`, `SUBMITTING`, `SUBMISSION_UNKNOWN`, `PENDING`, and `PARTIAL` as an unresolved same-side intent for that market/exchange/stock. The transaction-scoped advisory lock serializes the check with intent creation, including approval requests. `TradingOrchestrator` also includes these states in its BUY/SELL open-order context without miscounting them as executed trades, and `manualSell` refuses a second sell while such an intent exists. This prevents concurrent evaluations, later reevaluation, and repeated UI clicks from reissuing an unknown order.

### Cancellation-unknown recovery

- The Portfolio `확인 필요 주문` list and Slack alert include TradeRecords with `cancellationStatus = UNKNOWN` as a distinct `취소 결과 불명` item.
- `취소 상태 조회` performs complete paginated execution + unfilled-order reads without a POST. If the original order is no longer open, reconcile it to `FILLED`, `PARTIAL`, or `CANCELLED` from broker quantities and set cancellation status `RESOLVED` atomically with audit.
- If the original order is still open, keep cancellation `UNKNOWN` and offer `취소 미접수 확정`. Slack/web require explicit confirmation that the operator checked KIS; the mutation re-queries complete history, requires the order still be open, then sets cancellation status `REJECTED` while preserving the original `PENDING`/`PARTIAL` status. Only then may a later explicit cancel attempt be made.
- A partial/failed history read changes neither order nor cancellation state. Cold-start recovery changes leftover cancellation `SUBMITTING` to `UNKNOWN` without issuing a POST.

## 6. Approved common unknown-submission recovery

Approved sells, ordinary automatic BUY/SELL orders, and manual sells use the same `TradingBrokerOrderRecoveryService`. Slack and web differ only in presentation and authenticated actor extraction; entering this recovery flow does not retroactively add approval to an ordinary order.

### Conservative KIS candidate lookup

- Query KIS order/execution history read-only for the calendar dates covering `submissionStartedAt ± 10 minutes`, normalize broker timestamps to KST, and filter in memory to that exact 20-minute window.
- When the response header `tr_cont` is `M` or `F`, send the response body's domestic `CTX_AREA_FK100/CTX_AREA_NK100` or overseas `CTX_AREA_FK200/CTX_AREA_NK200` values in the next request with request header `tr_cont: N`. Continue until the response header no longer indicates another page, with a 100-page safety cap. Track visited header/body token tuples to reject loops. The result is `complete` only after the final page; a page error, missing header/context, malformed continuation response, loop, or cap hit is incomplete and fail-closed. Apply this to both execution history and unfilled/cancellable-order reads.
- Filter by market, exchange, stock, the TradeRecord's `BUY`/`SELL` side, intended quantity, and order time. Price is displayed but is not a universal matching key because market orders may not have an input price.
- De-duplicate execution rows by broker order date/exchange/order number and return all matching candidates with those identity fields, order time, quantity, filled quantity, remaining quantity, price, and rejection state.
- Normalize rejection state for both markets as `true`, `false`, or `unknown`; domestic responses that omit a reliable rejection field must return `unknown`, not a fabricated `false`.
- Never automatically select or link a candidate, even when exactly one candidate exists.
- Re-query the complete KIS history and validate the selected current-environment/account broker date/exchange/order number at mutation time before changing DB state.
- A broker-history lookup error is not the same as zero candidates. Link/dismiss fails without any state change when KIS history cannot be read; only a successful query with zero matching candidates can support `미주문 확정`.
- Candidate inspection is exposed as an authenticated GraphQL mutation rather than the 15-second list query because it performs an explicit KIS read and writes a `CANDIDATES_INSPECTED` audit entry before returning candidates.

### Slack recovery

1. An unknown result sends an alert containing side, stock, quantity, intended price, submission time, TradeRecord ID, and a `KIS 주문 조회` action.
2. Every recovery action, including the read-only lookup, validates the Slack actor against `SLACK_APPROVER_USER_IDS` before reading broker data or mutating state. The lookup displays the current candidates without issuing an order.
3. An authorized operator may select `이 주문 연결` for a candidate or `미주문 확정` after checking the KIS app. A candidate already/possibly associated with another TradeRecord instead offers `기존 기록과 동일`. Each opens a Slack confirmation modal naming the relevant records/order or requiring acknowledgement that KIS history was checked.
4. Candidate linking conditionally changes a still-unknown record, stores the environment/account hash, `brokerOrderDate`, `brokerOrderTime`, and `orderNo`, and sets it to `PENDING`; normal order synchronization then determines `PENDING`, `PARTIAL`, `FILLED`, `FAILED`, or `CANCELLED`. The broker-identity partial unique index makes a concurrent attempt to link the same KIS order to another TradeRecord fail without changing that record.
5. `미주문 확정` re-queries KIS. If a matching candidate exists, it refuses the dismissal and requires candidate review. Otherwise it changes the record to `FAILED`.

### Web recovery

- Add an `확인 필요 주문` card above the Portfolio page's trade history. Hide it when no unknown records exist and poll the database-backed unknown-record list every 15 seconds while the page is open.
- Label each row as `주문 제출 결과 불명` or `취소 결과 불명` and expose only the recovery actions valid for that lifecycle.
- Legacy rows with no broker context show the context-assignment confirmation before enabling `KIS 주문 조회`.
- The 15-second poll never calls KIS. Show intent details first and query the same KIS candidates as Slack only when the operator clicks `KIS 주문 조회`.
- `주문 연결` requires a confirmation dialog naming the broker order number.
- `기존 기록과 동일` requires a confirmation dialog naming both TradeRecord IDs and the broker date/order number.
- `미주문 확정` requires a second confirmation that the operator checked KIS order history.
- All queries and mutations use `GqlAuthGuard`. The resolver records the JWT username as `web:<username>`.
- Neither web action can submit or retry a KIS order.

### Idempotency and audit

- Link/dismiss mutations condition on `status = SUBMISSION_UNKNOWN`; the first successful action wins across Slack and web.
- Link also requires the selected broker identity not already belong to another TradeRecord; the database unique constraint is the final authority across concurrent resolutions.
- Before linking, also treat a legacy row with null identity as a possible collision when market/exchange/order number match and its KST `createdAt` date is within one calendar day before/after the candidate broker date. The conservative ±1-day window covers approval/order calls crossing midnight; it may block a direct link rather than infer a false date.
- For an exact new identity collision or conservative legacy collision, `기존 기록과 동일` re-queries complete KIS history, records the existing TradeRecord ID, and conditionally resolves the unknown record to `FAILED` with `MATCHED_EXISTING_TRADE_RECORD`; it never attaches one broker order to both records.
- Store the chosen order number plus resolution enum, actor, and timestamp on the TradeRecord without overwriting its strategy reason.
- Write channel, actor, action, candidate identity, and before/after status to `BrokerOrderActionAuditLog`; state-changing entries are atomic with the transition. Mirror to `WatchStockExecutionLog` when the TradeRecord belongs to a WatchStock.
- A zero- or multi-candidate result remains `SUBMISSION_UNKNOWN` until an authorized operator resolves it.

## 7. Expected implementation files

The implementation plan has not been written yet, but the approved design is expected to touch:

- `prisma/schema.prisma`
- a generated Prisma migration named `harden_sell_approval_state`
- `.env.example`
- `src/config/configuration.ts`
- `src/config/AGENTS.md`
- `src/kis/kis-base.service.ts`
- `src/kis/kis-domestic.service.ts`
- `src/kis/kis-overseas.service.ts`
- `src/kis/types/` for the order outcome discriminator
- `src/kis/` error type plus focused `*.spec.ts` coverage
- `src/kis/AGENTS.md`
- move `src/notification/slack-commands.service.ts` to `src/trading/trading-slack-commands.service.ts`
- `src/notification/slack.service.ts`
- `src/notification/notification.module.ts`
- `src/notification/AGENTS.md`
- `src/trading/trading-sell-approval.service.ts`
- `src/trading/trading-sell-approval-workflow.service.ts` (new)
- `src/trading/trading-broker-order-recovery.service.ts` (new)
- `src/trading/trading-broker-order-recovery.resolver.ts` (new)
- `src/trading/trading-order-guard.service.ts` (new)
- `src/trading/trading-broker-context.service.ts` (new)
- `src/trading/trading-position-refresh.service.ts` (new)
- `src/trading/trading-order-execution.service.ts` (new)
- `src/trading/dto/` for unknown-submission GraphQL inputs and objects
- `src/trading/trading.service.ts`
- `src/trading/trading.module.ts`
- `src/trading/trading-orchestrator.service.ts`
- `src/trading/trading-position-sync.service.ts`
- `src/trading/market-state-sync.service.ts`
- `src/trading/strategy/infinite-buy.strategy.ts`
- `src/trading/types/` for workflow result types
- `src/trade-record/trade-record.service.ts`
- `src/trade-record/trade-record-manual-order.service.ts` (new)
- `src/trade-record/trade-record.resolver.ts`
- `src/trade-record/trade-record.module.ts`
- `src/trade-record/AGENTS.md`
- focused `*.spec.ts` files for all behavior below
- `src/trading/AGENTS.md`
- `docs/slack-setup-guide.md`
- `client/src/graphql/trading.graphql`
- generated `client/src/graphql/generated.ts` and `client/src/graphql/schema.json`
- `client/src/pages/PortfolioPage.tsx`
- `client/src/pages/portfolio/UnknownOrderReconciliationCard.tsx` (new)
- `client/src/pages/portfolio/types/` for props derived from generated GraphQL types

## 8. Required TDD coverage

Every production change must be preceded by a failing regression test. At minimum:

- PostgreSQL-backed integration coverage (not only mocked Prisma) proves advisory-lock admission across separate service instances/connections, both partial unique indexes, conditional cross-channel resolution, and representative migration data cleanup;
- existing manual-sell/cancel tests pass unchanged through the behavior-preserving service extraction before safety behavior is added;
- two concurrent approvals result in exactly one KIS call;
- two concurrent qualifying signals create one approval/trade pair and deliver one Slack message;
- advisory-lock admission lets concurrent ordinary/manual/approval intents for the same instrument and side create only one unresolved TradeRecord, while different instruments/sides do not block each other;
- advisory lock normalization maps domestic aliases/case consistently and all guarded queries use the interactive transaction client;
- a retry after `APPROVED` or `SUBMITTING` never calls KIS;
- an expired request cannot be approved and becomes cancelled;
- new notifications respect 10-minute validity and 30-minute cooldown;
- Slack delivery failure leaves no actionable approval;
- malformed/missing Slack delivery metadata fails closed without starting cooldown;
- empty and non-matching approver allowlists are fail-closed;
- approver allowlist parsing trims, removes empty entries, and de-duplicates IDs;
- `trading.enabled=false` prevents approval claim/order submission while still allowing rejection;
- missing/blank/malformed `TRADING_ENABLED` is fail-closed, and only explicit `true` enables any order or cancellation POST;
- approved, automatic, manual, and cancellation paths re-check the live switch immediately before KIS and cancel/release their pre-submit claim without a POST if it changed;
- unauthorized Slack actors cannot query recovery candidates, link, or dismiss;
- approve/reject paired state changes roll back together on failure;
- no holdings cancels safely and reduced holdings clamp quantity;
- broker balance refresh failure cancels the pre-submit intent and never calls KIS order endpoints;
- a successful empty balance snapshot deletes stale market positions and is treated as no holdings for a sell;
- a timeout/network failure during a mutating KIS POST performs exactly one HTTP request;
- HTTP success and HTTP-error responses containing a well-formed `rt_cd != 0` business envelope map to `REJECTED`, while bare HTTP errors map to `UNKNOWN`;
- deterministic validation/auth/header failure before the order HTTP invocation maps to `REJECTED` and performs no order request;
- empty/malformed bodies, contradictory HTTP-error + `rt_cd = 0`, and success responses with missing/blank order numbers map to `UNKNOWN`;
- missing/malformed/unsupported `ORD_TMD`, an invalid 14-digit date, or a broker timestamp more than 10 minutes from the call start maps to `UNKNOWN`; six-digit KST midnight cases choose the nearest prior/current/next date correctly, and `PENDING` persistence requires the resulting full broker identity;
- domestic/overseas order and cancellation wrappers all preserve `ACCEPTED`/`REJECTED`/`UNKNOWN`;
- explicit KIS rejection becomes `FAILED`;
- KIS `UNKNOWN` outcomes become `SUBMISSION_UNKNOWN` with no workflow retry;
- ordinary automatic BUY/SELL and manual-sell unknown outcomes also persist `SUBMISSION_UNKNOWN` without adding an approval gate;
- unresolved approval/submitting/unknown records block same-side strategy reissue but are not counted as executed trades;
- manual sell refuses a second request while the instrument has an unresolved sell intent;
- concurrent/manual/automatic cancel paths claim one cancellation attempt, and an ambiguous result persists `cancellationStatus = UNKNOWN` with exactly one POST;
- unresolved cancellation blocks every later cancel POST until Slack/web reconciliation;
- complete recovery reconciles a no-longer-open order, while operator-confirmed still-open recovery sets cancellation `REJECTED`; partial/failed history reads change nothing;
- cold-start recovery changes cancellation `SUBMITTING` to `UNKNOWN` without a POST;
- cold-start recovery converts leftover `SUBMITTING` rows with a submission timestamp to `SUBMISSION_UNKNOWN` and rows without one to `CANCELLED`, without issuing KIS requests;
- an accepted KIS response followed by DB write failures retries only that idempotent DB write twice, leaves `SUBMITTING` if still unsuccessful, and never issues a second POST; restart recovery makes it unknown;
- KIS lookup follows all continuation pages, returns candidates but never links automatically, and treats page failure/token loop/100-page cap as incomplete;
- domestic and overseas candidates normalize rejection as true/false/unknown;
- linking revalidates the selected broker order and is idempotent;
- two different unknown records cannot link the same full environment/account/date/exchange/order number identity, including under concurrency;
- broker identity uniqueness distinguishes paper/prod and account hashes while never storing/logging the raw account number;
- broker context hashing is stable for the effective `CANO + ACNT_PRDT_CD`, distinguishes product codes and environments, fails closed on invalid context, and exposes only a masked suffix/product code for confirmation;
- recovery refuses broker reads/resolution when the record's stored environment/account hash differs from current KIS configuration;
- migrated null-context rows require an audited authorized context assignment before broker lookup;
- a possible ±1-day pre-migration identity collision blocks direct linkage and can only resolve through the explicit `기존 기록과 동일` confirmation/audit path;
- dismissing re-queries KIS and refuses when a candidate exists;
- a failed broker-history query cannot link or dismiss an unknown submission;
- concurrent Slack/web resolutions allow only one state transition;
- GraphQL and Slack adapters delegate to the same recovery/workflow services and preserve actor IDs;
- module metadata contains no Notification/Trading `forwardRef` cycle after moving the Slack trading adapter;
- Portfolio polling reads only persisted unknown records and calls KIS only on explicit candidate lookup;
- infinite-buy MDD emits a `risk-liquidation` SELL that requires approval;
- infinite-buy take profit requires approval at `T >= 20` and remains automatic below 20;
- ordinary non-protective sells remain automatic.

The client currently has no test runner. Do not add a new frontend test framework solely for this card. Keep the component thin, keep all safety decisions in tested backend services, and verify the UI through generated types, lint/build, and an in-browser smoke test.

## 9. Migration and deployment behavior

- Add the new enum values and columns through Prisma migration SQL; do not rely on `db push`.
- Existing `PENDING` approvals are unsafe because they predate expiry and actor rules, so mark every one `EXPIRED`.
- Classify old `AWAITING_APPROVAL` trades instead of cancelling them indiscriminately: a trade with an `APPROVED` approval may already have reached KIS in the old crash window, so migrate it to `SUBMISSION_UNKNOWN` and use that approval's `respondedAt` as `submissionStartedAt`; an orphan or a trade whose approvals are only pending/rejected/expired becomes `CANCELLED`.
- Preserve existing submitted records with broker order numbers. Existing real `PENDING` records with no `orderNo` are ambiguous under the old create-before-submit flow, so migrate them to `SUBMISSION_UNKNOWN` with `createdAt` as the best available submission timestamp.
- The old code flattened transport ambiguity and explicit rejection into `FAILED`. Conservatively migrate every `FAILED` TradeRecord with no `orderNo` created during the 30 days before migration to `SUBMISSION_UNKNOWN`, using `createdAt` as the best available timestamp; this intentionally sends some true rejections to review rather than allowing a possibly accepted recent order to be reissued. Before production trading is re-enabled, the operator must clear these migrated unknowns through Slack/web broker reconciliation.
- Historical `orderNo` rows may retain nullable broker identity fields because inferring them around KST date/account/environment boundaries is unsafe; all newly accepted/linked orders populate the full identity and participate in the duplicate-link partial unique index.
- Enforce exactly one active trading process in production deployment configuration. Under that invariant, `SUBMITTING` rows left by the stopped process become ambiguous on cold startup and are never safe retry candidates. Do not run this takeover concurrently with a still-active trading instance; deployment verification must fail or keep `TRADING_ENABLED=false` if multiple active workers can execute trading workflows.
- Deployment of this change removes automatic retry from every current KIS mutating POST caller. Read-only KIS GET retries remain enabled.
- The migration first adds `expiresAt` as nullable, backfills **every** historical approval status from `requestedAt + timeoutMinutes`, then makes it required.
- The migration expires old pending rows before creating the partial unique pending-approval index.
- Migration verification seeds representative orphan, pending, approved-but-awaiting, submitted-with-order-number, pending-without-order-number, recent failed-without-order-number, and older failed rows and asserts each post-migration classification.
- The migration inserts `SYSTEM/UNKNOWN_DETECTED` audit rows for records it moves to `SUBMISSION_UNKNOWN`; startup sends one best-effort Slack summary with the unresolved count (not one message per historical row), while the web card is the authoritative work queue.
- Production must configure `SLACK_APPROVER_USER_IDS` before operators can approve or reject through Slack.
- Roll out initially with `TRADING_ENABLED=false`, run the migration/startup summary, and clear migrated unknowns through read-only reconciliation; only then restart with trading enabled. Recovery reads/resolutions remain available while live order submission is disabled.
- GraphQL schema changes require a backend build and client code generation in the same change.

## 10. Final verification

```bash
npm run build
npx jest --runInBand
npm run client:codegen
npm run client:build
cd client && yarn lint
```

Then exercise the Portfolio unknown-order card in the browser for empty state, legacy context assignment, candidate lookup, link/existing-record confirmations, dismissal blocking/success, cancellation-status lookup/not-accepted confirmation, and concurrent/stale error feedback.

## 11. Implementation gate

1. The user reviews and approves this written spec.
2. Invoke `superpowers:writing-plans` and save the implementation plan under `docs/superpowers/plans/`.
3. Do not write production code before the plan handoff is complete.
4. Implement each behavior with a failing regression test first.
5. Do not merge PR #13 until all blockers in Section 2 are fixed and the final verification passes.

No documentation change should be interpreted as fixing the merge blockers.
