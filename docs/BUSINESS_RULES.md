# LM App — Canonical Business Rules

**Status:** v0.1 baseline  
**Date:** 2026-09-18

This document defines business invariants for LM App. UI labels may evolve, but code must not create conflicting domain behavior without an approved update to this document.

## 1. Source-of-Truth Rule

Business rules must be centralized and reusable. Do not independently hard-code competing versions of prices, SLA, status transitions, role permissions, payment rules, loyalty rules, or delivery eligibility in multiple pages.

Configuration that legitimately differs by outlet must be represented explicitly as configuration/data, not copied logic.

## 2. Canonical Order Lifecycle

Target canonical lifecycle:

`DRAFT → WAITING_CONFIRMATION → WAITING_PICKUP → DRIVER_ASSIGNED → PICKED_UP → RECEIVED_AT_OUTLET → IN_PRODUCTION → QUALITY_CONTROL → READY → OUT_FOR_DELIVERY → DELIVERED → COMPLETED`

Exceptional terminal/side states include:

- `CANCELLED`
- `COMPLAINT`
- `VOID` where applicable to the transaction/accounting representation

### Transition rules

1. Code must not invent a new canonical status ad hoc.
2. Legacy database/UI statuses may continue during migration, but must be mapped deliberately to the canonical lifecycle.
3. A transition must record sufficient timestamps/actor context where operationally important.
4. Payment state and operational order state are separate concepts; `paid` must not be inferred merely because an order advanced operationally.
5. `VOID` must preserve the original financial record and audit context.

## 3. Service, Price and SLA

1. Service catalog, base price, unit and SLA must have one authoritative source.
2. Speed/service variants (for example Regular, One Day, Express, Quick) must use centrally defined configuration or calculation rules.
3. Client-supplied totals are not authoritative for sensitive payment verification.
4. Outlet-specific overrides require explicit configuration and traceability.
5. Any promotion/discount must identify its rule/source and must not silently mutate base pricing definitions.

## 4. Outlet Selection and Capacity

Outlet selection may consider:

- service availability
- outlet operating status/hours
- geographic coverage/distance
- current capacity/queue
- explicit management configuration

The selection algorithm must be implemented as shared domain logic. A user with appropriate permission may override an automatic suggestion when the workflow records the final outlet.

## 5. Internal Driver Rules

1. A driver is eligible for automatic/internal assignment only when operationally `ON_DUTY`.
2. Attendance/active outlet context is authoritative for availability where the feature is enabled.
3. An `OFF_DUTY` driver must not appear as a normal available assignment option.
4. Pickup and delivery jobs must be traceable to the assigned driver/provider.
5. Proof requirements must follow the configured job stage.

## 6. Third-Party Delivery Rules

Approved third-party delivery is a fallback/alternative delivery provider and should be modeled through a common dispatch abstraction.

Provider-specific API payloads, pricing and statuses should not leak throughout unrelated customer/POS code. The order stores the selected provider and relevant external reference when applicable.

## 7. Pickup to POS

1. One pickup must not produce duplicate POS transactions through concurrent conversion.
2. Existing claim/idempotency protection must be preserved.
3. Outlet receipt/acceptance should establish the operational handoff into outlet processing.

## 8. Production and Quality Control

1. Production stages must follow controlled transitions.
2. `QUALITY_CONTROL` is the target explicit stage before `READY`.
3. Evidence/photo requirements may be configured per stage but must not cause unnecessary bulk media loading.
4. Exceptions/damage/complaints must remain traceable to the order/customer context.

## 9. Payment Rules

Payment is a protected domain.

1. Client UI state is never sufficient proof of successful gateway payment.
2. Gateway confirmation must use approved server-side verification paths.
3. Webhook, status check and reconciliation may converge on the same idempotent paid operation.
4. Repeated external events must not create duplicate credits/payments.
5. Manual mark-paid requires an authorized role, server authorization and audit evidence/context.
6. Pending QRIS must remain pending until verified; it must not be converted to paid for UI convenience.
7. Payment amount should be checked against authoritative expected amount where supported.

## 10. Deposit Rules

1. Deposit credit/debit is a server-controlled money operation.
2. Client/anon access must not directly perform privileged deposit RPC mutations.
3. Top-up/payment credits must be idempotent where a payment identifier exists.
4. Deposit mutation must produce an audit trail.
5. Balance must not be allowed to silently diverge because of duplicate retries.

## 11. Cash and Closing

Cash transactions, setoran and closing must retain enough actor/outlet/shift context to investigate discrepancies. Adjustments to sensitive totals require explicit authorized workflows rather than direct destructive editing.

## 12. Void and Deletion

1. Financial transactions use soft-void rather than routine hard deletion.
2. Original receipt/amount/history remains available for audit.
3. Reporting excludes void transactions according to finance rules without erasing the source record.
4. Requests and approvals for void should identify the actor and reason.

## 13. Loyalty and CRM

1. Tier, reward rate, evaluation window and redemption values are centrally configured.
2. Rewards are based on authoritative eligible transactions.
3. Void/cancelled/ineligible transactions must not create valid loyalty value.
4. Changes to loyalty configuration apply prospectively unless an explicit migration/recalculation is approved.

## 14. Complaint Rules

Complaints must remain linked to relevant customer/order/outlet context when known. Complaint status changes, resolution and responsible team/actor should be traceable. Closing/cleanup automation must not destroy evidence required for operational or financial investigation.

## 15. Finance Rules

1. P&L and other reports use controlled COA/category mappings.
2. Revenue must not count void transactions.
3. Financial source records should remain traceable to their operational source.
4. Mapping/configuration changes must not silently rewrite historical evidence.
5. Sensitive reconciliation and adjustment actions require appropriate authorization.

## 16. Role and Authorization Rules

UI visibility is not authorization. Sensitive operations must enforce authorization at the server boundary.

Especially protected operations include:

- manual payment verification
- payment resync/diagnostics
- deposit mutation
- employee credential management
- financial void/approval
- privileged configuration
- production data corrections with financial impact

## 17. AI Rules

AI is advisory by default.

AI may:

- summarize operational data
- identify anomalies/patterns
- propose changes
- implement code on isolated development branches

AI must not by default:

- change production financial records
- mark payments paid
- mutate customer balances
- change permissions/credentials
- deploy directly to production
- invent canonical business rules/statuses
- expose or commit secrets

## 18. Change-Control Rule

If a requested feature conflicts with this document, the coding agent must stop treating the request as a routine implementation. The conflict must be surfaced, and the business-rule/document change must be explicitly approved together with the code change.
