# Evidence contracts

All claims require a single linked PayPal capture, matching order, merchant/customer mapping and consistent claim references. Missing relationships cause UNKNOWN/REVIEW and cannot be bypassed by approval; mismatches cause DENY.

| Claim | VERIFIED | CONTRADICTED | UNKNOWN / human review |
|---|---|---|---|
| NOT_DELIVERED | Linked trusted fresh shipment is consistently LOST | Linked trusted fresh shipment is consistently DELIVERED | PROCESSING, IN_TRANSIT, RETURNED, CANCELLED, missing, stale, future-dated, conflicting or customer-reported evidence |
| DUPLICATE_CHARGE | Not automated in prototype | Relationship mismatch only | Shared amount, timestamp, invoice or merchant reference do not alone establish duplicate lineage |
| DAMAGED_ITEM / NOT_AS_DESCRIBED | Not automated | Relationship mismatch only | Requires human investigation |
| CANCELLATION_REFUND / ALREADY_REFUNDED / WRONG_AMOUNT / OTHER | Not automated | Relationship mismatch only | No completed evidence contract for autonomous execution |

For non-delivery, merchant OMS or carrier observation must be within 24 hours and no more than 60 seconds in the future. This is a conservative design setting, not a verified optimal threshold. Claim confidence is ignored. USD 50 is the autonomous cap; larger supported claims require exact approval. Hard balance/currency/relationship limits remain enforced after approval.
