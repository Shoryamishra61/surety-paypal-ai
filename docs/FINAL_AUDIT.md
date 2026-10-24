# Final audit — 2026-10-04

Status: **local prototype implemented and tested; full hackathon submission incomplete**. Actual model inference is deferred by the user. Real PayPal capture/refund is blocked on sandbox buyer approval.

| Claim | Evidence | Reproduced? | Safe to publish? |
|---|---|---|---|
| App starts locally | npm start; /health; browser at 127.0.0.1:3100 | Yes | Yes, local prototype |
| Build and type checks pass | npm run check; checks src, tests and scripts | Yes | Yes |
| 51 automated tests pass | 5 Vitest files, final check run | Yes | Yes, exact tested scope |
| Initial core had security defects | 13/21 first regression failures logged | Yes | Yes |
| Cross-order and missing-link evidence cannot auto-execute in tested cases | security and execution tests | Yes | Yes, bounded claim |
| Approval is single-consumption | Replay tests and separate-process race test | Yes | Yes, tested local database boundary |
| Concurrent calls do not double-refund | Same-case, competing-case and SQLite tests | Yes | Yes, local/stub provider boundary |
| Unknown provider outcome remains reserved | Timeout stub and no-retry test | Yes | Yes, not a live outage result |
| Deny / execute / review UI works | Browser journeys, SIM-prefixed IDs | Yes | Yes, explicitly simulation |
| Keyboard form flow has visible focus | Tab through amount, AI checkbox, verify; Enter evaluates | Yes | Yes, this sequence only |
| Responsive layout has no horizontal overflow | 360, 768, 1024, 1440 widths | Yes | Yes, tested viewports |
| Palette text contrasts on paper exceed 4.5:1 | Calculated ratios: minimum 6.03:1 for tested text tokens | Yes | Yes; not whole-app accessibility certification |
| UI audit has no findings | ui_audit.py, 22 source files, zero findings | Yes | Yes, heuristic only |
| FactPack export endpoint returns JSON attachment | HTTP test and UI click notification | Yes (HTTP); browser download event timed out | Limit to endpoint/export interaction claim |
| Real PayPal OAuth and order creation/read work | 200 OAuth, order 466738561R160443Y | Yes | Yes, sandbox only |
| Real PayPal refund works end-to-end | Adapter exists; buyer action still required | No | No |
| Actual LLM extraction works | Structured adapter and stub contract tests only | No | No |
| Synthetic evaluation is reproducible | 60 cases, artifacts/evaluation.json | Yes | Yes, self-authored specification suite |
| Surety had 0/57 unsupported executions | Same synthetic run; only 2 eligible auto cases | Yes | Only with population and caveats |
| Independent held-out / production efficacy | No such dataset or run | No | No |
| Dispute submission / webhooks / Seller Protection | Not implemented or evaluated | No | No |
| Public repo, hosted service, video, Devpost entry | Not created/published | No | No |
| Complete security, immutable audit or production readiness | Not established | No | No |

## Quality gates

Product and local deterministic-core gates have concrete evidence. PayPal, actual AI, independent evaluation and recorded demo gates remain open. UX checks cover specified widths, representative keyboard flow, native labels/focus, token contrast and no console errors; screen-reader, low-powered-device performance and reduced-motion emulation remain unverified. The CSS includes reduced-motion handling and no continuous animation.

## Highest-value next work

1. Buyer approves the USD 1 sandbox order, then run `npx tsx scripts/sandbox-validate.ts`. It checks approval, captures once, then runs the actual refund through Surety. Synthetic fulfillment and a manual typed claim are explicitly disclosed. No LLM result is implied.
2. Select a free/local model path when the user resumes that decision; run real extraction and adversarial language cases.
3. Expand legitimate populations and obtain independent labels before stronger benchmark claims.
4. Publish source and record the under-three-minute demonstration after the real integration gates pass. Do not publish credentials, databases or private artifacts.
