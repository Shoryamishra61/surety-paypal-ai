# Visual brief and verification

Audience: merchant support operators and technical judges. Job: determine whether one proposed refund is supported by linked records, then act or investigate. Brand traits: precise, restrained, inspectable. Primary content: claim → evidence → verdict → exact action → durable outcome. Technical limit: dependency-free browser UI served locally by Express.

Visual thesis: **the evidence docket**. Three signature choices: numbered three-column claim/record/decision progression; visible linked capture/order/shipment chain with provenance; typographic verdict and persistent simulation/sandbox label. Warm paper, dark green ink, restrained red/ochre decision accents; no stock imagery, decorative charts or continuous motion.

Semantic tokens live in `public/style.css`. Layout stacks at small widths and places the decision below two columns at intermediate widths. Native labels, keyboard controls, focus ring, status announcements and reduced-motion CSS are present. No imported visual component licenses are needed.

Verified in the in-app browser at http://127.0.0.1:3100:
- Delivered → CONTRADICTED / DENY; no execution button.
- Lost → VERIFIED / EXECUTE → simulated SUCCEEDED with SIM-prefixed ID.
- Damaged → UNKNOWN / REVIEW → exact amount approval → simulated SUCCEEDED.
- Widths 360/768/1024/1440: document scroll width equaled client width, no horizontal overflow.
- Console errors/warnings: none during these journeys.
- UI audit script: zero heuristic findings.

Remaining checks are recorded in FINAL_AUDIT.md. Automated heuristics do not establish full accessibility or device performance.

Additional browser evidence: keyboard focus advanced from the customer message to amount, AI checkbox and Verify; the focused Verify control had a solid outline and Enter triggered evaluation. Text token contrast ratios against paper were 13.31 (ink), 6.03 (muted), 7.04 (accent), 7.13 (deny), 6.40 (review). The desktop screenshot is artifacts/surety-desktop.jpg. FactPack download was invoked, but the automation download event timed out; HTTP export attachment behavior is tested separately.
