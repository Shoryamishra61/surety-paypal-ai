# Execution ledger

## Baseline — 2026-10-04
Repository contains seven TypeScript files and installed dependencies. No Git metadata, repository instructions, tests, evaluation corpus, UI, server, PayPal adapter, or deployment config found. The historical 19 tests / 129 cases were not supplied and cannot be reproduced.

| Component | Exists | Initial verification | Gap |
|---|---|---|---|
| Typed claims | Yes | TypeScript initially failed configuration | Runtime boundaries need validation |
| Binding / verification / policy | Yes | 13 of 21 new regressions failed | Missing provenance, linkage, precision checks |
| Approval / SQLite | Yes | Altered customer binding failed | Durable execution reservation missing |
| PayPal / LLM / UI | No | Not runnable | Build required; credentials absent |
| Evaluation / demo / documentation | No | Not runnable | Build required |

## P0 security corrections
Evidence: `npm test` first ran 21 tests: 13 failures, 8 passes. Failures include missing capture/parent, untrusted/stale evidence, conflicting delivery states, incomplete duplicate inference, policy allowing contradicted premise, NaN/subcent amounts, missing refund history, incomplete evidence digest, unstable request IDs, changed approval customer.
Fixes: strict linkage completeness; provenance/freshness checks; unresolved duplicates review; policy financial validation; full action/claim/evidence hashing; stable request IDs; reviewer required; SQL expiry check at consumption.
Files: src/core/*.ts, src/db/database.ts, tsconfig.json, package.json, tests/security.test.ts.
Verification: `npm test` 21/21 passed; `npm run typecheck` passed. This is a core unit milestone, not proof of complete financial execution.
Remaining: durable orchestration, provider adapter, external-side-effect concurrency and reconciliation, integration and UI.

## Prioritized queue
1. Durable execution state, remaining balance reservations, approval replay and concurrent execution tests.
2. Sandbox-only PayPal adapter, exact response validation and explicit uncertain outcomes.
3. Bounded model extraction, server-controlled financial facts, API and case UI.
4. Synthetic evaluation, documentation, browser checks and final claim audit.
5. Live verification, hosted deployment and recording require external access; never claim them from simulation.

## Final local milestone
- Added durable orchestration, provider adapters, loopback HTTP application, evidence-docket UI, 60-case synthetic evaluator and documentation.
- Separate-process approval race passed: one successful consumption across two processes.
- Final `npm run check`: typecheck (source + tests + scripts), 51 tests across 5 files, and TypeScript build passed.
- `npm run format:check`: passed. Prettier was added as a development-only formatter to make the new implementation readable and reproducible.
- `npm run evaluate`: 60 cases; Surety unsupported execution 0/57, eligible autonomous resolution 2/2, false denial 0/3, review 43/60. Self-authored; not held out.
- `ui_audit.py`: 22 source files, zero findings. Browser deny, simulated execute, exact review and keyboard form sequence verified; four target widths have no horizontal overflow. Console showed no warnings/errors during these journeys.
- Browser download click produced the application notification, but automation waiting for a download event timed out. HTTP attachment response is verified; no claim of verified browser file placement.
- PayPal credentials saved only in local .env. OAuth returned 200; real USD 1 order 466738561R160443Y was created/read. Latest sandbox validation reported PAYER_ACTION_REQUIRED; no capture/refund attempted.
- User deferred paid model setup. No Ollama/LM Studio runtime available. Actual inference remains unverified.
- Final review narrowed autonomous claims to non-delivery LOST; RETURNED/CANCELLED and duplicate-charge shortcuts no longer verify automatically. Added expiry, policy-change and future-date tests.
- Case exports now include extraction mode/schema version, previous version, updated timestamp and approval lifecycle snapshot. Database mode binding prevents mixing simulation and sandbox stores.
- Remaining blockers and exact publishable claims are in FINAL_AUDIT.md.
