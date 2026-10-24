# Devpost draft — not submitted; not ready to publish unchanged

**Title:** Surety (provisional name)

**Tagline:** Agents can move money. Surety makes them prove why.

**Short description:** A merchant refund prototype that binds an AI support claim to an exact PayPal capture, checks transaction and fulfillment evidence, and executes, blocks or requests human review with a persisted FactPack.

## Problem and approach

An agent can have permission to refund under $50 while relying on a false non-delivery claim. Surety makes the claim-to-transaction relationship explicit. Trusted records determine whether the premise is supported, contradicted or unresolved. Deterministic policy and durable reservations govern execution.

## What is built

The local application shows customer claim, linked capture/order/shipment evidence, verdict, exact action and execution state. Human approval binds the complete action, claim, evidence and policy configuration. SQLite tracks approvals, concurrent reservations and versioned case snapshots. A PayPal sandbox adapter reads captures/orders and implements refund creation and refund-state reconciliation. An optional model adapter extracts structured claims with no financial tools.

## Verified accomplishments

Reproduced failures in the starting core included missing capture linkage, stale/customer-reported evidence, incomplete digests and unstable request IDs. Added runnable regression, execution, provider-contract and HTTP checks. Local browser journeys cover deny, simulated execution and human review. Sandbox authentication and order creation were reproduced.

## Challenges and lessons

Incomplete evidence must remain unresolved. A timeout is not a failed refund and must retain its reservation. Approval identity alone is insufficient without full argument/evidence binding. Merchant-reported fulfillment is not independent delivery proof. Synthetic tests validate selected contracts; they do not measure fraud prevention.

## Outstanding before submission

Actual model inference, approved sandbox capture/refund, independent evaluation, public source publication, recorded video, and entrant eligibility confirmation. Do not describe current fixture extraction as live AI or simulated refunds as PayPal execution.

## Next steps

Complete the real sandbox/AI journey, then add complete refund-history reconciliation and independent merchant evidence evaluation. Disputes and multi-tenant production deployment are beyond the current verified scope.

**Built with:** TypeScript, Node.js, Express, SQLite/better-sqlite3, Zod, Vitest, HTML/CSS/JavaScript, PayPal sandbox REST. OpenAI adapter exists but actual use is unverified/deferred.

**Disclosure:** AI coding assistance was used to implement and review this prototype. Starting checkout contained core TypeScript files; the runnable application, tests and artifacts were added during this work.

**Repository URL:** not published. **Demo:** local instructions in README. **Video:** not recorded. Do not invent URLs.
