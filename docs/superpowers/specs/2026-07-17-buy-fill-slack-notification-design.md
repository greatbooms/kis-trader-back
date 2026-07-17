# Buy Fill Slack Notification Design

## Problem

An accepted trade writes two `ORDER_SUBMITTED` execution logs. The earlier log contains the submitted trading signal, while the later broker-acceptance log contains only broker metadata. Fill reconciliation currently reads only the newest log, so it cannot reconstruct the signal and silently skips the Slack fill alert.

## Design

- Keep the existing order submission, reconciliation, and Slack message formats unchanged.
- When reconstructing a submitted signal, inspect `ORDER_SUBMITTED` logs newest-first and use the newest log whose details contain a valid `side` and positive `quantity`.
- Preserve the approved stop-loss signal fallback when no valid submission log exists.
- Log a warning when a filled trade cannot reconstruct a signal, so future notification gaps are observable.
- Add a regression test reproducing the two-log production shape and asserting that the BUY fill alert is sent using the valid earlier signal.

## Safety

This change is read-only with respect to broker and order state. It does not alter order placement, fill detection, quantities, prices, approvals, or database schema.
