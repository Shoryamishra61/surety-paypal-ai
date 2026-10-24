# Demo video script — target 2:45 (under the 3:00 limit)

Record at 1440×900. Fresh database per take (`DATABASE_PATH=demo-$(date +%s).db npm start`).
Keep the mode badge visible. State simulation vs sandbox explicitly every time.

| Time | On screen | Narration |
|---|---|---|
| 0:00–0:15 | Console masthead + tagline, then ARIA reading the inbox | "AI agents can now move money. But should they decide when? Klarna walked back AI refund decisions. The FTC fined an AI over claims it couldn't prove. Surety is the layer that fixes this: agents propose, Surety verifies against real PayPal records, and only then does money move." |
| 0:15–0:45 | Select honest lost + false-delivery messages; run agent; live trace streams | "ARIA reads customer messages and proposes refunds through the governed gateway. Watch the trace: she reads, reasons, and proposes. For the honest claim, a fresh LOST delivery record supports the premise — the refund executes on PayPal sandbox. For the false claim, the same words hit a DELIVERED record — blocked, with the evidence shown." |
| 0:45–1:10 | Switch to the injection email; run; show escalation + trace | "Now the attack. This message tells the agent to ignore its rules and mark a refund approved. ARIA refuses instruction-shaped content and escalates. And even if a compromised agent pushed the proposal through anyway, the gateway still adjudicates it against evidence — the delivered record blocks it. Defense in depth." |
| 1:10–1:40 | Case inbox grid; open the duplicate-charge case; FactPack | "Every proposal becomes a case on the record. This duplicate-charge claim needed two same-amount captures in settlement history — here they are, with provenance for every record. The FactPack is digest-chained and downloadable." |
| 1:40–2:05 | Review queue: $600 case; approve; executes | "Judgment calls belong to people. This $600 refund exceeds the autonomous cap — but the records support it. A reviewer approves the exact action — digests bind action, claim, evidence, and policy version — and it executes. An approval can exceed daily limits, never the refundable balance." |
| 2:05–2:30 | Analytics page; then terminal: `npm run evaluate` output | "The numbers: on an 84-case adversarial suite — zero false refunds, zero withheld honest ones, every injection blocked, under five milliseconds. An ungoverned baseline pays 38 false refunds on identical inputs." |
| 2:30–2:45 | Terminal: `npx tsx scripts/sandbox-loop.ts` artifact; tagline | "And this is real: a PayPal sandbox order, captured, refunded through the full adjudication path. LLM agents propose. Surety verifies, enforces, and proves. PayPal executes." |

Before recording:
- [ ] Public repo pushed; license visible in About
- [ ] Hosted demo up (or README quickstart verified fresh)
- [ ] `artifacts/sandbox-loop.json` shows a SUCCEEDED real sandbox refund
- [ ] No copyrighted music; no third-party trademarks beyond nominative PayPal/UI mentions
