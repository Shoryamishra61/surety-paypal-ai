# Hackathon and API verification — 2026-10-04

## Official event requirements

Source: https://paypalaihackathon.devpost.com/rules

Verified: submission closes November 12, 2026 at 12:00 PST (November 13 at 01:30 IST). Project must centrally use PayPal sandbox and an AI tool. Public GitHub source with an open-source license is required. Judges need a runnable build; complete local instructions may replace hosting. Video should be under three minutes and publicly available on YouTube. Existing projects need significant changes during the submission period. Entrants must meet majority-age, location, employment/conflict and ownership requirements. Individual eligibility is not verified here. Recheck official rules before submission. Source access was successful; no registration or submission was performed.

Official event announcement: https://developer.paypal.com/community/blog/PayPal_AI_Hackathon/

## PayPal capability matrix

| Capability | Endpoint | Auth | Local implementation | Live evidence |
|---|---|---|---|---|
| OAuth | POST /v1/oauth2/token | Client credentials | Yes | 200, token received; token not logged |
| Create sandbox order | POST /v2/checkout/orders | Bearer | Setup script | Order 466738561R160443Y, PAYER_ACTION_REQUIRED |
| Capture read | GET /v2/payments/captures/{id} | Bearer | Adapter | Pending buyer/capture |
| Order read | GET /v2/checkout/orders/{id} | Bearer | Adapter/setup | Setup read reproduced |
| Refund | POST /v2/payments/captures/{id}/refund | Bearer + PayPal-Request-Id | Adapter | Not run |
| Refund read | GET /v2/payments/refunds/{id} | Bearer | Adapter | Not run |
| Complete refund history | Provider reconciliation | Varies | Not implemented | Not claimed |
| Webhooks / disputes | Out of scope | — | Not implemented | Not claimed |

Official refund reference: https://developer.paypal.com/api/payments/v2/captures-refund
Official idempotency reference: https://developer.paypal.com/api/rest/reference/idempotency/
Refund requests send amount.value as a decimal string and amount.currency_code as USD, plus a stable request ID. Refund id and status are parsed; only COMPLETED means success. Provider-specific idempotency retention is not treated as perpetual protection; durable local logical IDs remain necessary.

## Positioning

AP2's current authorization framework supports mandate chains for verifier actions; describing it as only buyer spending caps would be too narrow. Surety's implemented distinction is the selected merchant refund's factual claim-to-record verification, not a claim that AP2 cannot express merchant policies.
Source: https://ap2-protocol.org/ap2/agent_authorization/

PayPal provides dispute evidence workflows. This prototype does not implement them; FactPack reuse is future work, not a live dispute feature.
Source: https://developer.paypal.com/disputes/reasons-evidence/

Basic naming search found an existing Surety AI Delivery Assurance product: https://www.asurety.ai/. Keep the name provisional. This was a basic availability check, not legal clearance.

## Competitive categories (analysis, not exhaustive market research)

| Category | Surety comparison | Evidence boundary |
|---|---|---|
| Shopping/checkout agents | Refund after purchase, not product discovery | Product-scope comparison |
| Spending controls / tool gateways | Permission plus factual premise | Do not claim all gateways lack evidence checks |
| AP2 mandates | Complementary authorization; no replacement protocol built | Official framework above |
| Refund automation | Narrow typed evidence contract and exact transaction binding | Vendor-by-vendor comparison remains unverified |
| Dispute automation | Evidence retained before disputes | Actual dispute submission absent |
| Fraud/chargeback platforms | No fraud classifier or outcome guarantee | Different prototype objective |
| Support agents | Language extraction with deterministic financial authority | Actual model quality unmeasured |

Problem impact is an engineering hypothesis supported by reproduced software failure modes, not merchant interviews or production-loss measurement. No customer traction claim.
