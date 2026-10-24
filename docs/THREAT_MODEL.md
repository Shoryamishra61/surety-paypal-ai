# Threat model

| Threat | Implemented boundary | Remaining limitation |
|---|---|---|
| Cross-order substitution | Exact parent, merchant, customer and claim binding | OMS mapping is merchant-maintained |
| Missing relationship | REVIEW; cannot approve around missing linkage | Operator must supply valid records |
| Customer says shipment is LOST | Provider allowlist and server-only evidence ingestion | Merchant itself may lie |
| Stale or conflicting delivery | UNKNOWN / REVIEW; 24-hour observation limit | Freshness is a design choice, not carrier SLA |
| Prompt injection / hallucinated IDs | Strict model schema; no tools; exact selected-order check | Semantic extraction quality unmeasured |
| Wrong amount / currency | USD cent validation, capture history, reservation cap | No other currencies |
| Approval replay / changed arguments | Full digests, durable consumed approval, case-unique marker | No external human identity provider |
| Two executions / retries | Unique logical case ID and provider request ID | Separate legitimate partial cases are permitted within balance |
| Concurrent over-refund | Immediate SQLite reservation and unresolved capture lock | External actors ultimately arbitrate at PayPal |
| Provider timeout | PENDING retains reservation; no automatic write retry | Unknown refund ID needs manual investigation |
| Process crash | Reservation written before financial call | Crash after reservation may strand capacity |
| Browser CSRF / DNS rebinding | Same-origin, CSRF header and loopback Host allowlist | Local machine compromise is out of scope |
| Database tampering | Snapshots record digests | A privileged writer can rewrite both bytes and hashes |
| False benchmark certainty | Numerators, denominators and caveats | Independent evaluation absent |

No regex injection detector is a security boundary. A hash does not establish truth, authorship, legal validity or Seller Protection. Production credentials and public deployment are deliberately outside this prototype.
