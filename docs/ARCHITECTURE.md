# Architecture

Design decision: one local Node/Express process, SQLite durability, pure typed verification and narrow external adapters. No agent framework, orchestration cluster or frontend dependency was added.

## Authority and data flow

1. Operator selects an order from server-owned merchant records and proposes an exact USD amount.
2. Fixture extraction or the optional structured model adapter yields a typed claim. The server retains the original statement and merchant/customer identity. Missing or foreign model references fail validation.
3. Provider reads the capture and order, then attaches merchant-reported fulfillment. These records are never accepted from the case POST body.
4. Relationship binding validates claim/order/capture/customer/merchant and evidence parent IDs. Contradictions deny; incomplete relationships review and cannot be human-overridden.
5. Verification determines VERIFIED, CONTRADICTED or UNKNOWN. Policy checks financial history, currency and limits.
6. Case snapshot is persisted. Evaluation itself has no external side effect.
7. An exact-action human approval may be created by the reviewer endpoint. All action, claim and evidence fields and policy digest are bound. Approval IDs are server-side opaque references, not self-authorizing signed bearer tokens. Authentication is the authority boundary.
8. Execution re-fetches facts. An immediate SQLite transaction reserves capture balance and daily capacity and consumes the case approval marker. Unique constraints prevent repeated logical execution, reuse of an approval, and overlapping uncertain writes to one capture.
9. The durable approval record is consumed, then execution intent is saved before a provider call. A crash can strand a reservation, which is fail-closed and requires investigation.
10. Provider response updates reservation and appends a new case snapshot. HTTP success alone does not imply completed refund. Unknown outcome stays PENDING.

## Financial state

Internal reservations use integer USD cents. Public action amounts use validated numeric dollars; provider amounts are exact two-decimal strings. Database transactions never span network awaits. Conservative local reservation sums cover stale concurrent reads. Provider refusal is still required to arbitrate changes by other payment systems.

## Trust and deployment boundary

Local loopback only. Sandbox requires distinct operator and reviewer tokens; simulation uses an explicitly simulated local reviewer. CSRF header, loopback Host checks and same-origin checks protect browser actions. No production host selection or public deployment is provided. Authentication is single-merchant prototype access, not multi-tenant RBAC.

## Recovery

Case snapshots are append-only by application convention with digest columns. They are not a cryptographically immutable chain. Reservations retain uncertain outcomes. Refund GET reconciles a known refund ID; an unknown refund ID must be investigated against PayPal using the request ID. The system never blindly repeats a write after a timeout.
