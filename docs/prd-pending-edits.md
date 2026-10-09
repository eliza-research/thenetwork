<!-- Pending edits for the canonical PRD (Google Doc). Edit the Google Doc, not the snapshot. https://docs.google.com/document/d/1lLQAZNAMSC_yHCkUBVbp1CCwvyR17PuvV7TnpfuY8Xc/edit -->

# PRD pending edits

The PRD Google Doc is canonical: https://docs.google.com/document/d/1lLQAZNAMSC_yHCkUBVbp1CCwvyR17PuvV7TnpfuY8Xc/edit. `docs/prd-snapshot.md` is a copy of it.

This file lists proposed PRD edits that are not yet in the PRD. Apply an edit in the Google Doc, re-snapshot `docs/prd-snapshot.md`, then delete the edit here. Mark items that need a founder decision first with **[DECIDE]**.

Earlier items were applied on 2026-10-08 (PRD 28, 31, 32, 34, 35, 36, 37, 38, 40, Appendix B, and the new Section 41); the open founder questions moved to PRD 27 and `docs/mvp-gaps.md` section 5.

## Pending

1. **PRD 34 (and the summary rows in 28, 27 and the decision log): validation is simulations + integration + e2e** (founder, after 2026-10-08). Retitle 34 "Validation: simulations, integration and e2e". Unit and smoke tests are not kept; integration tests (real Postgres, real HTTP servers, several packages together, the full service) and e2e tests (`tests/e2e`) are. The security suite is kept as part of the integration suite (CI job "integration"), so the "Keep the security suite?" row in 27 is closed. Classification and the restored files: `docs/tests-policy.md`.
2. **PRD 27 "Clef weight fitting" row: ratings are ON** (founder). Appearance ratings feed slop matching from launch (never shared), on the placeholder weights until P2's fitted weights pass the decision rule; remove "keep ratings off until fitted weights exist".
