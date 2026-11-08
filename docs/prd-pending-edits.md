<!-- Pending edits for the canonical PRD (Google Doc). Edit the Google Doc, not the snapshot. https://docs.google.com/document/d/1lLQAZNAMSC_yHCkUBVbp1CCwvyR17PuvV7TnpfuY8Xc/edit -->

# PRD pending edits

The PRD Google Doc is canonical: https://docs.google.com/document/d/1lLQAZNAMSC_yHCkUBVbp1CCwvyR17PuvV7TnpfuY8Xc/edit. `docs/prd-snapshot.md` is a copy of it.

This file lists proposed PRD edits that are not yet in the PRD. Apply an edit in the Google Doc, re-snapshot `docs/prd-snapshot.md`, then delete the edit here. Mark items that need a founder decision first with **[DECIDE]**.

Earlier items were applied on 2026-10-08 (PRD 28, 31, 32, 34, 35, 36, 37, 38, 40, Appendix B, and the new Section 41); the open founder questions moved to PRD 27 and `docs/mvp-gaps.md` section 5.

## Applied October 19, 2026

All six pending items were applied in the canonical Google Doc with revision checks and verified by readback. The snapshot now includes the approved validation policy, ratings default, Eliza conversation architecture, open joins, phone bans, relay and send rules, no-photo probe policy, shadow-only waivers, line caps, daily cost alert and approved copy decisions.

These edits record founder decisions from October 9 and 11. They do not claim a release, live-send approval, legal review, real calibration, staffed operations or pilot acceptance. The owner tracker in issue #22 retains those requirements.

## Pending

**[DECIDE] Formal modeling requirement (proposed 2026-11-07, add to Section 34).** Add a subsection:

> All code in the app is modeled at two levels. High level: each flow is a Quint model of its states, transitions and invariants, across the browser and the server. Low level: each function that takes a step in a flow has LemmaScript contracts that Dafny proves, and the shipping code calls that function. A change to code updates both levels. Code that LemmaScript cannot express (the DOM, React components, `await`, SQL, regex tables, crypto) moves its decisions into an import-free core, and the rest stays a thin shell. Integration tests, end-to-end tests and `bun run sim` stay the validation layer for what the models do not cover.

The rule changes what the bounty accepts, so it needs founder confirmation. It is not yet met: most existing code has no model. On the user's request, the text is now in `docs/prd-snapshot.md` as Section 34.7, marked as not yet in the Google Doc. Copy it into the Google Doc after the founder confirms it, or remove 34.7 if the founder refuses it.

Nothing else from the six-item list. Add later decisions here only when they have not yet reached the canonical document.
