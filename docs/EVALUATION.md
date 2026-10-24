# Evaluation

Run `npm run evaluate`. JSON report and per-case decisions are written to `artifacts/evaluation.json` and `artifacts/evaluation-cases.json`.

This is a **self-authored synthetic specification suite**, not a held-out benchmark. It crosses four delivery states, three amounts and five evidence/claim variants (60 cases). The historical 129-case corpus was not present in the supplied checkout.

Measured run, 2026-10-04:

| System | Unsupported execution / adverse | Legitimate auto-resolution / eligible | False denial / legitimate | Review / all |
|---|---:|---:|---:|---:|
| No guard | 57/57 | 2/2 | 0/3 | 0/60 |
| Amount only | 38/57 | 2/2 | 0/3 | 20/60 |
| Human everything | 0/57 | 0/2 | 0/3 | 60/60 |
| Surety | 0/57 | 2/2 | 0/3 | 43/60 |

"Adverse" includes unresolved evidence: unsupported execution is not necessarily proven fraud. No-guard baseline assumes provider acceptance. Human-everything defers every case; human decision correctness is not simulated. Only two cases are eligible for autonomous execution, so the apparent perfect utility result is weak evidence. Labels and implementation share assumptions. Cases are not independent samples from a production population; statistical confidence intervals would mislead.

Latency is measured for deterministic verification/policy only, excluding model, SQLite, UI and provider calls. Read actual p50/p95 values from the report; they vary per run. Live refund reliability and model accuracy are unmeasured and null, not zero.

Regression tests additionally cover provenance, missing linkage, mutated digests, approval replay, altered amounts/customer, duplicate execution, balance reservations, uncertain outcomes, model-output failures, provider response validation and HTTP journeys. Regression counts are not benchmark populations.

Independent held-out labeling, actual LLM attacks, real sandbox refund outcomes and broader legitimate cases remain required before making stronger efficacy claims.
