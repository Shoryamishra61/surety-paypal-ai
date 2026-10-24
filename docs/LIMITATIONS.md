# Limitations — what is verified, and what is not

Honest accounting as of 2026-10-24. Verified claims live in docs/FINAL_AUDIT.md and the committed artifacts; this file lists the boundaries.

1. Sandbox refund: OAuth, order creation, buyer approval, capture, and refund through the adjudication path have been exercised via `scripts/sandbox-loop.ts`; keep `artifacts/sandbox-loop.json` as the evidence record for the specific run. Re-run it to reproduce.
2. Live LLM inference: implemented (Gemini/Groq/OpenAI structured output, server-validated) with synthetic contract tests; runs whenever an API key is configured. The deterministic fallback brain is used in its absence and is plainly labeled in the UI.
3. Automated claim contracts: NOT_DELIVERED (fresh LOST), DUPLICATE_CHARGE (two same-amount captures), ALREADY_REFUNDED (prior refund blocks), WRONG_AMOUNT (capture vs order). DAMAGED_ITEM / NOT_AS_DESCRIBED / CANCELLATION deliberately require human review.
4. Refund-history reconciliation: partially refunded or non-COMPLETED captures are refused rather than guessed. Webhook events trigger reconciliation but never authorize state changes by themselves.
5. Disputes, payouts, subscriptions: not implemented. The Agent Toolkit reader exposes dispute reads only.
6. Unknown write outcomes retain their reservation and require operator investigation with the stored request ID; no automatic resubmission, no background reconciliation worker.
7. A crash between adjacent synchronous steps can strand an approval or reservation; recovery is conservative (fail-closed), not seamless.
8. Case snapshots are append-only and hashed, not cryptographically signed. Digests bind approvals to exact action/claim/evidence/policy state but do not prove external truth.
9. Fulfillment evidence is merchant-reported (PayPal tracking or OMS), provenance-labeled in every FactPack. A mistaken or malicious merchant can poison it; no independent carrier proof is claimed.
10. The 84-case evaluation is synthetic and self-authored, with deterministic claim typing to isolate governance from extraction quality. The ungoverned baseline is a modeled LLM-discretion agent, not a specific product. Not held out; not production security evidence.
11. Hosted mode adds session auth, rate limiting, and proxy trust; this is a demo deployment, not multi-tenant production hardening. PayPal writes are sandbox-only by construction (no production host is configured anywhere).
12. "Surety" is a provisional name with known collisions; no trademark clearance.
13. Screen-reader and low-powered-device testing remain unverified; keyboard navigation, focus states, and reduced-motion handling are implemented but not professionally audited.
