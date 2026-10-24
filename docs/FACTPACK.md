# FactPack

The downloadable JSON is the latest `EvaluatedCase` snapshot. SQLite retains earlier versions in `case_snapshots`.

| Field | Meaning |
|---|---|
| caseId / version / createdAt | Stable case, append-only application version, creation time |
| action | Exact refund type, capture, order, amount, currency, merchant, customer and reason |
| claim | Typed claim plus original statement and references |
| evidence | Provider IDs, parent links, observation/update timestamp, state, payload and provenance |
| verification | Premise verdict, decision, reasons, unresolved facts and relationship graph |
| policy / policyDigest | Evaluated limits and digest of exact configuration |
| evidenceDigest | Hash of full evidence records sorted by evidence ID |
| approvalId | Opaque server-side approval reference; database stores reviewer, expiry and consumption |
| requestId / refundId | Stable provider request ID and returned refund ID, if available |
| executionState / error | NOT_EXECUTED, EXECUTING, SUCCEEDED, PENDING or FAILED |
| mode | SIMULATION or PAYPAL_SANDBOX |

The UI preserves a REVIEW verdict after human-approved execution: it records why automatic execution was not allowed. SUCCEEDED describes the execution, not a retroactive assertion that the premise became VERIFIED.

New snapshots include extractionMode, claimSchemaVersion, previousVersion, updatedAt and an approvalLifecycle row when present. Older snapshots retain their historical shape. The current export does not include every prior snapshot, webhooks, dispute IDs or a cryptographic signature. Digests are integrity checks only; no immutability claim. Evidence can inform later dispute preparation, but automated dispute submission is not implemented.
