# Devpost submission draft — Surety 2.0

> Status: ready to paste into the Devpost form once the video is recorded and
> the repo is public. Replace the three placeholder URLs before submitting.

**Title:** Surety — the policy and proof layer for AI agents that move money on PayPal

**Tagline:** LLM agents propose. Surety verifies, enforces, and proves. PayPal executes.

**Short description:** A deterministic governance layer between customer-facing AI agents and PayPal: every agent-proposed refund is checked against real payment and fulfillment evidence, adjudicated by a policy engine in exact integer arithmetic, executed idempotently on PayPal sandbox — or blocked, or routed to human review — with a verifiable FactPack for every decision.

## Inspiration

AI assistants now handle refunds end-to-end, and the failures are public: Klarna's AI support walked back resolutions when model discretion met edge cases; the FTC fined "AI lawyer" DoNotPay over unsubstantiated claims. Meanwhile PayPal is building agentic commerce (Agent Toolkit, MCP server, Agent Ready) where *other parties' agents* will request actions on merchant accounts. The missing piece isn't a smarter agent — it's an adjudicator the merchant controls.

## What it does

- **ARIA**, the merchant's support agent, reads customer messages — including adversarial prompt-injection attempts — and proposes refunds through a governed gateway. She never sees PayPal credentials and can never execute a payment herself.
- Surety **extracts** the claim with a structured-output LLM (customer text is fenced data, never instructions; identity comes from the server), **binds** it to the real PayPal capture/order plus fulfillment evidence (shipment tracking via the official PayPal Agent Toolkit, merchant records, settlement history), and **verifies the premise deterministically**:
  - DELIVERED record contradicts "never arrived" → blocked with evidence
  - fresh consistent LOST record → executes
  - duplicate-charge claim needs two same-amount captures (settlement history)
  - double-refund attempt caught against prior refunds
  - subjective claims (damaged/not-as-described) go to a human, honestly
- The **policy engine** enforces autonomous caps and per-currency daily limits in integer minor units (JPY-style zero-decimal currencies included) with refundable-balance math that cannot be argued around.
- **Human review** approvals are cryptographically bound to the exact action, claim, evidence, and policy version — a reviewer may exceed daily limits, never the refundable balance.
- Every decision produces a **FactPack**: versioned, digest-chained evidence with provenance, streamed live over SSE and downloadable from the console.

## Demonstration highlights

- Agent console: run the agent over an inbox containing an injection attempt; watch every thought, proposal, and verdict stream live.
- Case inbox (AG Grid ledger), case detail with evidence provenance, review queue, policy studio, analytics ("Refunded USD 98 / Blocked USD 649"), webhook event log.
- `npm run evaluate`: 84-case adversarial suite — **0 false refunds, 0 withheld honest refunds, 100% of injections blocked, p95 < 5 ms** — versus an ungoverned LLM-discretion baseline that pays 38 false refunds ($1,862) on identical inputs.
- `npx tsx scripts/sandbox-loop.ts`: real PayPal sandbox order → buyer approval → capture → Surety-adjudicated refund, fully logged.

## How we built it

- **PayPal**: REST (order/capture/refund with idempotency keys, fail-closed reconciliation), **@paypal/agent-toolkit** for evidence reads (tracking, transactions, refund lookup), verified webhooks triggering reconciliation.
- **AI**: provider-agnostic structured-output layer (Gemini Flash free tier default; Groq, OpenAI adapters); one schema-validated decision per step; deterministic fallback brain so governance demos never depend on API availability.
- **Engineering**: Node built-in `node:sqlite` (zero native builds), 84 Vitest tests including cross-process approval races and concurrency reservations, React + Vite console with AG Grid themed to a forensic-ledger system, SSE, Dockerfile + Render blueprint.

## Challenges

- Root-caused a cross-process race: a missing busy-timeout made a concurrent SQLite writer fail instantly and silently; fixed and regression-tested.
- Reviewer approvals dead-ended at daily-limit reservations; redesigned approvals to be consumed atomically inside the reservation (humans exceed soft limits, never balances).
- Strict CSP blocked AG Grid's injected styles; scoped the relaxation to styles only.

## Accomplishments

Zero false pays with millisecond latency; injection refused at the brain *and* still safe at the gateway (a compromised agent's proposal still hits evidence rules); an honest audit trail where every artifact labels simulated versus verified.

## What we learned

Deterministic verification is cheap and strong; the hard parts are human-approval semantics and honest provenance. The biggest agent-payment risks are mundane: double execution, replayed approvals, unauditable evidence.

## What's next

Dispute acceptance flows, carrier-grade tracking, multi-tenant policy isolation, and an MCP server exposing `propose_refund` to third-party agents under merchant policy.

**Built with:** TypeScript, Node.js, Express, node:sqlite, Zod, Vitest, React, Vite, AG Grid, SSE, Docker, Render; PayPal sandbox REST + @paypal/agent-toolkit; Gemini (structured output) with Groq/OpenAI adapters.

**Disclosure:** AI coding assistance was used to implement and review this project.

**Links:** Repository: (public GitHub URL) · Video: (YouTube URL) · Hosted demo: (Render URL)
