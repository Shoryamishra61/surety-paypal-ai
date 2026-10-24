# SURETY — the policy and proof layer for AI agents that move money on PayPal

**LLM agents propose. Surety verifies, enforces, and proves. PayPal executes.**

Autonomous agents can now initiate payments — but the field's own track record (an AI assistant that mishandled refunds at scale, an "AI lawyer" FTC settlement over unsubstantiated claims) shows what happens when model discretion meets money movement. Surety is the missing governance layer: a deterministic adjudicator that sits between customer-facing AI agents and the PayPal REST API, checks every proposed refund against real payment and fulfillment records, enforces policy in exact integer arithmetic, and produces a verifiable evidence record — a FactPack — for every decision.

## The 90-second version

ARIA, a support agent, reads customer emails and proposes refunds through Surety's governed gateway. For each proposal, Surety:

1. **Extracts** the claim with an LLM (Gemini/Groq/OpenAI) under a strict JSON schema — customer text is fenced data, never instructions; identity comes from the server, never the model.
2. **Binds** it to the real PayPal capture, order, and merchant/customer relationships, plus delivery evidence (PayPal shipment tracking via the official **PayPal Agent Toolkit**, merchant records, and settlement history).
3. **Verifies** the premise deterministically: a fresh, consistent LOST record supports a non-delivery refund; a DELIVERED record *contradicts* it; duplicate-charge claims need two same-amount captures; double-refund attempts are caught against settlement history.
4. **Enforces policy** in integer minor units: autonomous caps, per-currency daily limits, refundable-balance math (JPY-style zero-decimal currencies included).
5. **Executes** on PayPal sandbox with idempotency keys and durable reservations — or blocks, or routes to a human review queue with the exact action pre-bound (digests pin action, claim, evidence, and policy version; an approval can exceed daily limits but never the refundable balance).

Every step streams to a live console and lands in a durable audit trail.

## What the evidence shows

An 84-case adversarial suite (`npm run evaluate`, artifacts committed in `artifacts/`): **0 false refunds, 0 withheld honest refunds, 100% of prompt-injection attempts blocked, p95 latency under 5 ms.** The same suite through an ungoverned LLM-discretion baseline pays **38 false refunds ($1,862)** — that contrast is the product.

## Quickstart (5 minutes, zero credentials)

Requires Node 22.5+ (uses the built-in `node:sqlite`; no native builds).

```bash
npm ci
cd web && npm install && npm run build && cd ..
npm run build          # optional; the server also runs via tsx
npm start
```

Open **http://127.0.0.1:3100** — the console boots in **simulation mode**: seeded orders, deterministic agent brain, simulated refunds. Then:

- **Agent console** — select inbox messages (including a prompt-injection attempt) and run the agent; watch every thought, proposal, and verdict stream live.
- **Case inbox** — every adjudicated case in a ledger grid; click through for the full FactPack: evidence with provenance, verdicts, digests.
- **Review queue** — approve an over-cap refund as the reviewer; execution uses the exact approved action.
- **Policy** — adjust per-currency caps; **Analytics** — dollars moved vs dollars kept.

## Adding live AI (recommended for judging)

The demo works without keys, but live inference is one free key away — [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (Gemini free tier), then:

```bash
cp .env.example .env   # add GEMINI_API_KEY=...
npm start
```

The masthead shows `AI · gemini` and ARIA's brain switches from deterministic to LLM (with automatic deterministic fallback on rate limits).

## Real PayPal sandbox money

With [PayPal developer credentials](https://developer.paypal.com/):

```bash
npx tsx scripts/sandbox-loop.ts
```

creates a USD 1 sandbox order, waits for buyer approval (prints the link), captures, binds a disclosed synthetic LOST fulfillment record, and pushes a **real refund through Surety's adjudication** — every API call logged to `artifacts/sandbox-loop.json`. Fulfillment records are explicitly synthetic and labeled; nothing fabricates PayPal state.

Set `SURETY_MODE=PAYPAL_SANDBOX` to run the server against live sandbox calls (requires `PAYPAL_CLIENT_ID/SECRET`, distinct `OPERATOR_TOKEN`/`REVIEWER_TOKEN`, and a `merchant-records.json`).

## Architecture

```
Customer email ──► ARIA agent (LLM, fenced input)      ──► governed gateway
                                                              │ propose_refund (typed, no credentials)
                                                              ▼
                     ┌──────────── Surety adjudication ─────────────┐
                     │ claim extraction (schema-bound)               │
                     │ relationship binding (order↔capture↔shipment) │
                     │ premise verification (evidence contracts)     │
                     │ policy engine (integer minor units)           │
                     │ durable reservation + exact-action approval   │
                     └───────────────┬───────────────────────────────┘
                                     ▼
                     PayPal sandbox REST (writes, idempotent)
                     PayPal Agent Toolkit (reads: tracking, transactions)
                     Webhooks (verified, reconcile hints)
                                     ▼
                     FactPack: versioned, digest-chained evidence record
```

Full details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), the threat model in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md), evidence contracts in [docs/CLAIMS.md](docs/CLAIMS.md).

## Repository map

- `src/core` — binding, verification, policy, approvals, orchestration, money
- `src/agent` — ARIA runtime, governed gateway, adversarial inbox, SSE event bus
- `src/providers` — PayPal sandbox adapter, Agent Toolkit reader, simulation, LLM providers
- `src/db` — reservations, approvals, events (Node built-in `node:sqlite`)
- `web` — React + Vite console (agent console, case inbox on AG Grid, review queue, policy studio, analytics, event log)
- `tests` — 84 tests: security regressions, concurrency, cross-process races, provider contracts, agent scenarios, HTTP journeys
- `scripts` — sandbox money loop, demo seeding
- `docs` — architecture, threat model, evaluation, judge Q&A

## What is real, and what is not

Verified working: PayPal sandbox OAuth, order creation, buyer approval, capture, and refund through the adjudication path (see `artifacts/sandbox-loop.json`); Agent Toolkit reads (tracking, transactions, refunds); webhook intake with signature verification; live LLM claim extraction (structured output, server-validated).

Explicitly not: real-money production use (sandbox only), independent carrier proof (delivery evidence is merchant-reported, and labeled as such), held-out security evaluation (the suite is synthetic and self-authored). LLM outputs can never execute payments — the deterministic engine is the only writer, and every write carries an idempotency key.

## Deployment

One-command local container: `docker build -t surety . && docker run -p 10000:10000 surety` — or deploy `render.yaml` to Render. Hosted mode adds session auth (operator/reviewer roles), rate limiting, and proxy trust automatically when `HOST` is non-loopback.

## License

ISC — see [LICENSE](LICENSE).
