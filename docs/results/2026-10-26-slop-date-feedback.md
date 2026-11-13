# Keep delayed feedback attached to its own date

## Requirement and cause

This is a reproduced matching-history defect within PRD 40.5's dating scope.
The existing Slop pacing rule pauses new probes after a date the member liked.
Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

The history builder finds the latest completed interaction. It then treats any
later feedback from that member as feedback about that interaction. A late
answer about another date can therefore start or remove the wrong pause.

Keep the latest interaction's opportunity ID and participants. Apply its feedback
to the pacing signal only when the opportunity IDs match. Preserve the existing
feedback-time check and ordering. Records without opportunity IDs fall back to
the other participant. All feedback still contributes to the full history.

The service stores completed interaction IDs as `<opportunityId>:fb:<memberId>`.
Remove that known suffix when matching the opportunity. Direct opportunity IDs,
as used by the Slop world, remain unchanged. No database migration is needed.

Alternatives:

1. Match only the other participant. This confuses repeated dates with the same person when opportunity IDs exist.
2. Drop late feedback entirely. This loses valid feedback for learning, history and corrected answers.

## measurement

Same command before and after:

```sh
bun run sim --only slop --json slop-feedback.json
```

The new gate uses generated worlds with seeds 1–3, 40 people per city, three
cities and no generated minors in this specific replay. The normal conformance
worlds still include minors. An initial real engine run supplies a proposed
member. Each replay adds two completed interactions and two feedback records.
These histories are hand-written; profiles come from the repository generator.

Six cases cover late positive and negative answers, an earlier date with the
same partner, legacy feedback, valid current feedback and a corrected current
answer. Each runs with direct and service interaction IDs, in both input orders.
Each check inspects history, member eligibility and actual engine proposals.

| Check | Before | After |
|---|---:|---:|
| Correct pacing and proposal decisions, seeds 1–3 | 24/72 | 72/72 |
| Correct decisions on fresh seeds 4–6 | 24/72 | 72/72 |
| Slop blocking gates | 39/40 | 40/40 |
| Existing gate values preserved | 57 | All 57 |
| Slop block runtime | 30.7 s | 35.3 s |

For fresh-seed replay, run the same gate setup with seeds 4–6. No code or policy
was tuned on those seeds. This measures deterministic association correctness,
not a statistical increase in dating success.

Official pack evaluation: seeds 13–16, four weeks, 300 people per city in NYC,
SF and LA. It uses the existing iteration-five population and world settings,
with ratings enabled and no photos in probes. The pack/random fingerprint stays
`445afd705328fe54`.

The service-backed Slop simulation uses seeds 21–22, 30 days and 80 people.
Its reviewer approves every queued item in simulation. Its fingerprint stays
`eaeaf7bbe8c99c81`: 342 probes, 42 booked dates, 32 held dates and a 0.391 share
of adult daters booked. These existing runs do not claim delayed-check-in coverage.

### Attempts

The first implementation matched the raw interaction ID to the feedback's
opportunity ID. It passed the direct-ID replay but did not handle service IDs.
Its Slop block passed 40/40 gates, while the service simulation changed to
344 probes and 44 bookings. Its tracked long-text count rose from 4 to 10.
Inspection found the missing `:fb:` suffix handling. That version was replaced.

The final implementation handles both formats. The expanded replay passes all
72 cases, and every existing gate value and both fingerprints return unchanged.

## safety_gates

Declared-minor contacts, stated-filter violations and scammer median reach remain
zero. Rating, contact and private-fact leaks remain zero. All Slop conformance
and service invariants pass. The eight existing tracked misses remain unchanged,
including the four long probe texts. All people are synthetic; sends are dry-run.

## Validation

Windows, Bun 1.4.2, frozen lockfile, PostgreSQL 16.15 on loopback port 54339.
Database commands use `USER=postgres`, `REQUIRE_PG=1` and the local `PG_BIN_DIR`.

- `bun run sim --only slop`: 40/40 blocking gates; eight existing tracked misses.
- `bun run typecheck`: all four configurations pass.
- `bun run test:integration`, including security: 675 pass, 8 skip, 6 fail;
  13,741 assertions; 571.86 seconds.
- `bun run test:e2e`: 42 pass, one optional skip, zero failures;
  654 assertions; 75.56 seconds.

The eight integration skips require the separate cleanup-reconciliation opt-in.
The six failures reproduce the known Windows limits: absolute `/bin/bash` in
`deploy/wrangler.integration.test.ts`, SIGTERM exit 143 instead of 0 in
`deploy/backend/backend.test.ts`, and four slash-versus-backslash assertions in
`sites/test/sites.test.ts`. These files are unchanged. Integration is not claimed to pass.

AGENTS.md permits one full simulation per agent. That run was already used for
#136. Only the changed Slop block was rerun here. Linux CI must still run the
full matrix. This PR stays draft pending CI.

## llm_evidence and agent_clients

No model-backed behavior, prompt, client protocol or authentication flow changes.
Zero validation model calls and cost. No client acceptance run is claimed.
Authoring: Codex desktop 26.1021.3705.0, OpenAI `gpt-6-astra`, operator-identified.

## Reproduce and limits

Install with `bun install --frozen-lockfile`. Run the Slop command above and
expect 40/40 blocking gates. Apply only the new gate to base `a0ed7bc`; it fails
because an old positive answer incorrectly pauses new proposals.

The existing latest-interaction timestamp policy remains unchanged. Legacy
feedback without an opportunity ID cannot distinguish repeated dates with the
same person. Its participant fallback preserves compatibility with those records.
No pacing duration, review rule, UI, member copy or stored history changes.
