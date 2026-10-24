# Judge Q&A

Answers reflect this prototype, not a future product. Verify latest test and integration status before presenting.

## 1. Isn't this just a policy engine?

**10 seconds:** Policy follows evidence.

**30 seconds:** A cap grants permission but cannot establish non-delivery. The verifier binds the claim to records first; policy then limits any supported action.

Evidence: core/verification-engine.ts; core/policy-engine.ts. Status: IMPLEMENTED.

## 2. Isn't AP2 already solving this?

**10 seconds:** AP2 is complementary authorization.

**30 seconds:** Its current framework is broader than buyer caps. We demonstrate merchant claim-to-record verification rather than claim AP2 cannot support equivalent constraints.

Evidence: docs/RESEARCH.md. Status: OFFICIAL DOCUMENTATION + DESIGN.

## 3. Why does this require AI?

**10 seconds:** AI interprets customer language.

**30 seconds:** The model extracts a typed claim; records and rules own financial truth. Actual model inference remains deferred, so the local demo uses labeled fixtures.

Evidence: providers/claim-extractor.ts. Status: IMPLEMENTED / LIVE UNVERIFIED.

## 4. Why not let rules handle everything?

**10 seconds:** Rules should handle objective invariants.

**30 seconds:** Free-form language can benefit from a model, while identifiers, amounts, approvals and evidence states need deterministic checks.

Evidence: docs/ARCHITECTURE.md. Status: DESIGN DECISION.

## 5. Why not let the LLM judge evidence?

**10 seconds:** The model must not judge its own story.

**30 seconds:** We parse a strict output schema and provide no destructive tools. A probabilistic interpretation does not become permission to refund.

Evidence: providers/claim-extractor.ts. Status: IMPLEMENTED.

## 6. What happens when claim extraction is wrong?

**10 seconds:** Invalid references fail closed.

**30 seconds:** Missing or foreign order IDs stop creation. Semantically wrong but schema-valid claims remain possible and actual model quality is unmeasured.

Evidence: tests/provider-contracts.test.ts. Status: REPRODUCED + LIMITATION.

## 7. What about prompt injection?

**10 seconds:** Safety does not depend on detecting injection.

**30 seconds:** Customer text is untrusted. The model has no payment tools and evidence is fetched server-side. Prompt wording cannot bypass relationship or financial limits.

Evidence: docs/THREAT_MODEL.md. Status: IMPLEMENTED.

## 8. Didn't your injection detector contribute nothing?

**10 seconds:** There is no injection detector boundary.

**30 seconds:** Regex matching was not added. Tests defend concrete authority and evidence invariants instead of pretending to recognize every malicious prompt.

Evidence: docs/THREAT_MODEL.md. Status: VERIFIED CODE FACT.

## 9. Why not require humans for every refund?

**10 seconds:** Supported cases can avoid manual work.

**30 seconds:** The synthetic suite illustrates two eligible automatic resolutions. This is a small specification example, not measured staffing savings.

Evidence: docs/EVALUATION.md. Status: SYNTHETIC RESULT.

## 10. Why aren't amount limits enough?

**10 seconds:** A cheap refund can have a false premise.

**30 seconds:** The delivered case is under the cap but denied because matching records contradict non-delivery.

Evidence: tests/security.test.ts. Status: REPRODUCED.

## 11. Which data sources are authoritative?

**10 seconds:** PayPal for finance; merchant OMS for fulfillment.

**30 seconds:** PayPal capture/order reads and merchant mappings are distinct sources. Merchant fulfillment is reported evidence, not independent carrier proof.

Evidence: providers/paypal.ts. Status: IMPLEMENTED / PARTLY LIVE.

## 12. What if merchant fulfillment records are wrong?

**10 seconds:** Wrong records can produce wrong conclusions.

**30 seconds:** Freshness and linkage do not prove factual truth. Independent carrier evidence and merchant-data governance are future work.

Evidence: docs/LIMITATIONS.md. Status: KNOWN LIMITATION.

## 13. Can merchants fabricate evidence?

**10 seconds:** Yes, a malicious merchant can poison evidence.

**30 seconds:** The prototype assumes merchant records are an authorized source. It does not solve fraud by the source itself.

Evidence: docs/THREAT_MODEL.md. Status: KNOWN LIMITATION.

## 14. What does hashing actually prove?

**10 seconds:** Hashes bind bytes, not truth.

**30 seconds:** Digests bind action and evidence state to approvals. A privileged database attacker can rewrite stored records and hashes.

Evidence: core/digest.ts. Status: IMPLEMENTED + LIMITATION.

## 15. Do you guarantee dispute wins?

**10 seconds:** No dispute outcome is guaranteed.

**30 seconds:** Dispute submission is not implemented; retained evidence may inform future workflows but has no promised legal or adjudicative effect.

Evidence: docs/LIMITATIONS.md. Status: VERIFIED SCOPE.

## 16. Do you guarantee Seller Protection?

**10 seconds:** No Seller Protection guarantee.

**30 seconds:** Eligibility depends on PayPal rules and transaction circumstances; this prototype does not decide it.

Evidence: docs/RESEARCH.md. Status: SCOPE LIMITATION.

## 17. What did you actually build?

**10 seconds:** A runnable local refund guard and evidence UI.

**30 seconds:** Includes typed verification, policy, SQLite reservations, exact approvals, adapters, tests and synthetic evaluation. Live refund and model proof are outstanding.

Evidence: README.md. Status: REPRODUCED LOCAL.

## 18. Are your benchmark numbers real?

**10 seconds:** Yes, as synthetic measurements.

**30 seconds:** The evaluator emits individual decisions and exact denominators. Cases and labels are self-authored and not held out.

Evidence: artifacts/evaluation.json. Status: SYNTHETIC RESULT.

## 19. Why did the original benchmark show zero failures?

**10 seconds:** The earlier corpus was not supplied.

**30 seconds:** We cannot explain or reproduce its 129-case result. We report only the new suite and tests actually executed here.

Evidence: docs/EXECUTION_LEDGER.md. Status: VERIFIED CHECKOUT FACT.

## 20. What attacks broke the first version?

**10 seconds:** Thirteen initial regressions failed.

**30 seconds:** Failures included missing linkage, stale/untrusted evidence, incomplete digests, NaN/subcent amounts, changed approval customer and time-varying request IDs.

Evidence: docs/EXECUTION_LEDGER.md. Status: REPRODUCED.

## 21. What proves those vulnerabilities are fixed?

**10 seconds:** Runnable regressions defend the tested behaviors.

**30 seconds:** They failed before the corrections and passed afterward. Passing them is not a claim of complete security or real-world fraud accuracy.

Evidence: tests/security.test.ts. Status: REPRODUCED.

## 22. What if two orders have the same amount?

**10 seconds:** Equal amounts do not prove duplication.

**30 seconds:** Duplicate-charge automation is disabled. The current contract asks for investigation rather than treating invoice or timestamp similarity as conclusive.

Evidence: docs/CLAIMS.md. Status: IMPLEMENTED.

## 23. What happens if facts change after approval?

**10 seconds:** Fresh evidence is checked again.

**30 seconds:** Execution re-fetches provider facts and compares full evidence and policy digests for an approval. Changed bound content invalidates it.

Evidence: tests/execution.test.ts. Status: REPRODUCED.

## 24. Can approval be replayed?

**10 seconds:** A durable approval is consumed once.

**30 seconds:** Case approval markers and unique reservation constraints prevent reminting or reuse. Tests include repeated execution and separate-process approval competition.

Evidence: tests/process-race.test.ts. Status: TEST EVIDENCE; CHECK LATEST RUN.

## 25. What happens with concurrent refunds?

**10 seconds:** SQLite reserves balance before the call.

**30 seconds:** An immediate transaction enforces amount and daily capacity, with one unresolved execution per capture and one logical execution per case.

Evidence: db/execution-store.ts. Status: REPRODUCED LOCAL.

## 26. What if PayPal retries?

**10 seconds:** Logical IDs remain stable.

**30 seconds:** Client repeats return stored state. Provider writes carry a stable request ID; unknown outcomes are not automatically resubmitted.

Evidence: core/surety.ts. Status: REPRODUCED LOCAL.

## 27. What if webhooks duplicate?

**10 seconds:** Webhooks are not implemented.

**30 seconds:** No endpoint accepts or processes webhook events, so there is no claimed duplicate-webhook handling. Known refunds reconcile through GET.

Evidence: docs/LIMITATIONS.md. Status: VERIFIED SCOPE.

## 28. What if webhooks arrive out of order?

**10 seconds:** No webhook ordering claim is made.

**30 seconds:** We avoid fabricating a reconciliation pipeline. A future webhook consumer needs verified signatures, deduplication and monotonic state rules.

Evidence: docs/LIMITATIONS.md. Status: DESIGN FUTURE WORK.

## 29. What if PayPal is down?

**10 seconds:** Read failure stops; write uncertainty stays pending.

**30 seconds:** A failed fact lookup does not authorize execution. A write timeout retains the reservation until its result can be established.

Evidence: tests/execution.test.ts. Status: REPRODUCED WITH STUB.

## 30. What if the LLM is down?

**10 seconds:** Case extraction stops safely.

**30 seconds:** Existing deterministic cases still work. There is no silent model-to-fixture fallback for arbitrary customer text.

Evidence: tests/provider-contracts.test.ts. Status: REPRODUCED WITH STUB.

## 31. What if LLM JSON is invalid?

**10 seconds:** Invalid JSON is rejected.

**30 seconds:** The response envelope and strict claim schema are validated before financial evaluation. One bounded request is made, without an unbounded retry loop.

Evidence: providers/claim-extractor.ts. Status: REPRODUCED WITH STUB.

## 32. Why not give the agent raw PayPal write tools?

**10 seconds:** Raw write tools would bypass the guard.

**30 seconds:** The model receives neither PayPal credentials nor destructive tools. The server-owned orchestration is the sole application write path.

Evidence: docs/ARCHITECTURE.md. Status: IMPLEMENTED.

## 33. Which PayPal tools are actually used?

**10 seconds:** OAuth, orders, captures and refunds.

**30 seconds:** Authentication and order creation/read were live-tested. Capture/refund methods exist, but actual refund success still needs the approved sandbox transaction.

Evidence: docs/RESEARCH.md. Status: PARTLY LIVE VERIFIED.

## 34. Why PayPal specifically?

**10 seconds:** The concrete target is a PayPal merchant refund.

**30 seconds:** Capture/order linkage and refund request IDs are provider-specific, load-bearing integration points. No claim that the concept is exclusive to PayPal.

Evidence: providers/paypal.ts. Status: DESIGN + IMPLEMENTATION.

## 35. Could this work with Stripe?

**10 seconds:** Possibly, but not implemented.

**30 seconds:** The provider interface suggests portability; another processor needs verified schemas, relationship rules and integration tests rather than a renamed adapter.

Evidence: providers/paypal.ts. Status: INFERENCE.

## 36. Is this really agentic commerce?

**10 seconds:** It is merchant-side agent execution control.

**30 seconds:** The prototype focuses on support-triggered refunds, not autonomous shopping. Award fit is for judges to determine.

Evidence: docs/DEVPOST_DRAFT.md. Status: POSITIONING.

## 37. Who is the exact user?

**10 seconds:** A merchant using AI support agents.

**30 seconds:** The specific operator must decide whether a customer refund request is supported by its transaction and fulfillment records.

Evidence: README.md. Status: PRODUCT DEFINITION.

## 38. Who would pay?

**10 seconds:** Willingness to pay is unvalidated.

**30 seconds:** Merchants bearing support and erroneous-refund costs are the hypothesis. No interviews, paid users or savings figures are claimed.

Evidence: docs/RESEARCH.md. Status: HYPOTHESIS.

## 39. What metric defines success?

**10 seconds:** Safety and legitimate automation together.

**30 seconds:** Report unsupported execution, legitimate auto-resolution, false denial and review rate with denominators; measure live reliability separately.

Evidence: docs/EVALUATION.md. Status: MEASURED SYNTHETIC.

## 40. Isn't blocking all refunds safer?

**10 seconds:** Blocking everything eliminates utility.

**30 seconds:** The human-everything baseline has no automatic movement, but also no automatic resolution. We expose both sides of that tradeoff.

Evidence: docs/EVALUATION.md. Status: SYNTHETIC COMPARISON.

## 41. Which claims can actually be verified?

**10 seconds:** Fresh trusted LOST supports non-delivery.

**30 seconds:** Matching DELIVERED contradicts it. PROCESSING, conflicting evidence and subjective claims remain unresolved.

Evidence: docs/CLAIMS.md. Status: IMPLEMENTED.

## 42. Why support so few claim types?

**10 seconds:** Each automated claim needs its own evidence contract.

**30 seconds:** Breadth without authoritative data creates false certainty. Narrow non-delivery automation is easier to test honestly.

Evidence: docs/CLAIMS.md. Status: DESIGN DECISION.

## 43. What happens at scale?

**10 seconds:** Scale is unmeasured.

**30 seconds:** The local SQLite design serializes writes. No throughput, multi-region durability or multi-tenant production claim has been established.

Evidence: docs/LIMITATIONS.md. Status: UNMEASURED.

## 44. Is your audit log immutable?

**10 seconds:** No, it is not immutable.

**30 seconds:** The app appends versioned snapshots and digests. That does not defeat a privileged database writer or establish independent notarization.

Evidence: docs/FACTPACK.md. Status: VERIFIED LIMITATION.

## 45. Is this a compliance product?

**10 seconds:** It is not compliance certification.

**30 seconds:** It is a decision-evidence prototype. Legal sufficiency, regulatory compliance and protection eligibility are outside tested scope.

Evidence: docs/LIMITATIONS.md. Status: SCOPE.

## 46. Why should judges remember this?

**10 seconds:** Permission is not factual justification.

**30 seconds:** The under-cap delivered case makes the difference visible: the same action can be authorized yet unsupported by records.

Evidence: docs/DEMO_SCRIPT.md. Status: DEMO POSITIONING.

## 47. What is technically innovative?

**10 seconds:** The claim-to-exact-action evidence binding.

**30 seconds:** The implementation connects typed premises, transaction edges, full approval digests and durable execution. Novelty against every existing product is not proven.

Evidence: docs/ARCHITECTURE.md. Status: IMPLEMENTED / NOVELTY UNVERIFIED.

## 48. What is the strongest unresolved weakness?

**10 seconds:** Ground truth and live proof are incomplete.

**30 seconds:** Merchant records can be wrong; actual model quality and sandbox refund behavior have not yet been demonstrated in this run.

Evidence: docs/LIMITATIONS.md. Status: KNOWN LIMITATION.

## 49. What would you build next?

**10 seconds:** Finish the real sandbox-plus-model journey.

**30 seconds:** Then add complete refund-history reconciliation, independent evidence sources and independently authored evaluation before optional dispute features.

Evidence: docs/EXECUTION_LEDGER.md. Status: PRIORITY DECISION.

## 50. What is the project in one sentence?

**10 seconds:** Agents can move money; Surety makes them prove why.

**30 seconds:** It binds a merchant support claim to the exact PayPal transaction, evaluates records and policy, and executes, denies or escalates with persisted evidence.

Evidence: README.md. Status: PRODUCT THESIS.
