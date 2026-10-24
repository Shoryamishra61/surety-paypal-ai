# Limitations and release blockers

1. No real sandbox refund has yet been observed. OAuth and order creation succeeded; buyer approval/capture/refund remain pending.
2. No actual model inference has run. Fixture extraction is plainly labeled. OpenAI adapter has synthetic contract tests only. Paid credentials are deferred; no local model runtime was found.
3. USD-only, single merchant prototype. Only trusted LOST non-delivery cases automate. Duplicate-charge/cancellation claims require review.
4. Sandbox facts support unrefunded COMPLETED captures only. Complete external refund-history synchronization is not implemented.
5. No webhooks, disputes, carrier API, signature-backed mandates or production PayPal endpoint.
6. Unknown write outcomes with no refund ID need manual PayPal investigation. Reservations deliberately remain blocked; no background reconciliation worker exists.
7. Approval and reservation tables span adjacent synchronous steps. A crash can strand an approval or reservation, but the write cannot occur before reservation. Recovery is conservative, not seamless.
8. Case snapshots are append-only by convention and hashed, not immutable or signed. New exports include the approval lifecycle; prior case versions are retained in SQLite rather than bundled in the download.
9. Merchant fulfillment is merchant-reported. A malicious or mistaken merchant can poison evidence. No independent delivery claim.
10. Synthetic evaluation is self-authored; independent held-out evaluation is missing.
11. Local loopback binding and bearer credentials are not production multi-tenant authentication. No public deployment is claimed.
12. No public repository, recorded video, Devpost submission or external user validation has been produced in this run.
13. Surety is a provisional name: another AI-delivery-assurance product uses the name. No trademark clearance.
14. UI performance on low-powered real devices, screen-reader testing and complete reduced-motion emulation remain unverified. Audit script is heuristic, not accessibility certification.

Do not publish this as a complete hackathon submission or a production security product until the relevant blockers are resolved.
