# Store attendance from post-meeting evidence

Date: 2026-11-06 (Asia/Tokyo).
Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Environment: Windows, Bun 1.4.2, isolated PostgreSQL 16.15 on port 54339.

## Problem and requirement

PRD 28.2 measures mutually accepted opportunities that actually happen.
The stored rows also supply the completion and first-outcome measures in `docs/admin-console.md` section 3.10.

The Network sets an opportunity's internal stage to `done` when it requests feedback, three hours after the meeting time.
Attendance is finalized later, when everyone answers or four days pass.
The storage projection treated `done` as a completed meeting and every accepting participant as attended.
It ignored both missing attendance evidence and explicit no-show reports.

A real booking between two synthetic adults reproduces both errors.
Before any feedback, PostgreSQL stores `COMPLETED` and two `attended` participants.
After one participant reports attending and the other says they could not make it, those rows still claim two attendees.
The Network's own finalization log correctly reports one attendee.

## Fix and alternatives

Share the existing attendance calculation between finalization and storage through `attendanceOf` in the Network module.
It accepts both live opportunities and their JSON representation. No extra stored field or schema is needed.
Finalization retains its existing attendance, host check-in, no-show and ghosting decisions.

Storage keeps feedback-pending opportunities `SCHEDULED`, with delivered bookings `confirmed`.
After finalization, at least two known attendees produce `COMPLETED`; otherwise the opportunity becomes `ABANDONED`.
This matches the simulator console's existing two-attendee rule.
Known attendees become `attended`, known absences become `no_show`, and unknown attendance retains the booking status.
A group report does not infer a no-show for every silent member.

Two alternatives:

1. Duplicate attendance rules inside storage. That can diverge from the Network's finalization and host check-in rules.
2. Persist another attendance field. That adds a second source of truth and requires legacy-state handling.

Existing normalized rows are corrected on the next state save. This does not run a separate database backfill.
The nearby PR #221 changes crew handoff, a separate consumer of attendance evidence; it does not correct stored console rows.
It also extracts the finalizer calculation. A read-only patch check confirms an overlapping hunk in `network.ts`.
When both changes are merged, its crew attendance calls should reuse `attendanceOf` instead of retaining a second calculation.
No combined runtime qualification with that PR is claimed here.

## measurement

One integration case drives the real Network through onboarding, simulated staff review, consent, booking, feedback and finalization.
It writes through `PgStore`, reads the actual opportunity and participation tables, and reloads stored state across restarts.
The transport records messages locally. It does not replace the matcher, attendance calculation, database or saved rows.

The final case runs six deterministic flows on seed 1, starting at 2026-10-05 17:00 UTC:

- An attendee and a self-reported no-show.
- An attendee reporting the absent second person, who stays silent.
- A three-person group with one attendee and ambiguous attendance for the silent members.
- Two attendees who both answer positively.
- No attendance feedback from either participant.
- One positive answer confirming both participants under the existing counterpart rule.

The same test and command ran on the base implementation and the fixed implementation:

```sh
bun test --conditions eliza-source packages/network/test/store.test.ts -t 'save/load round trip|saved attendance'
```

The first selected case creates the test database and checks the existing store contract.
It is followed by the new attendance case.

| Check | Before | After |
|---|---|---|
| Feedback requested; neither person answered | `COMPLETED`; two `attended` | `SCHEDULED`; two `confirmed` |
| Finalized meeting with one attendee and one self-reported absence | `COMPLETED`; two `attended` | `ABANDONED`; one `attended`, one `no_show` |
| Targeted PostgreSQL command | 1 pass, 1 fail; 15 assertions | 2 pass, 0 fail; 70 assertions |

The new case fails on the first incorrect stored attendance result before the fix.
All six complete flows pass after the fix, including saved-state restarts and the two successful-meeting controls.
The standalone booking reproduction also shows the missed meeting changing from two stored attendees to one.

## safety_gates

```sh
bun run sim --only network,safety,audit --json <output>
bun run typecheck
```

| Block | Before | After |
|---|---|---|
| Network | 61/61 | 61/61 |
| Safety, including PostgreSQL scenarios | 17/17 | 17/17 |
| Audit, including PostgreSQL scenarios | 16/16 | 16/16 |
| Total blocking gates | 94/94 | 94/94 |

All 96 gate records match in name, pass state, classification and detail, excluding elapsed time.
There are zero off-target tracked gates in these runs.
The default Network cases use seed 3 over ten days, consent seeds 1-3 over 21 days, and push seed 1.
Pinned scenarios run at pass^3; network-pack conformance uses seeds 1-4.
The before run took 218.8 seconds; the after run took 242.2 seconds. No speed improvement is claimed.
The runs use the repository's simulated reviewer, unchanged corpora and no model calls.
No gate threshold or classification changes.

All four typecheck configurations pass after the final test changes.
The full all-block simulation is not repeated because AGENTS.md permits at most one full run per agent.
That allowance was already used for PR #355. This contribution claims only the paired blocks above.

## Integration validation

The first full integration run exposed an older assertion that assumed a feedback request meant a completed meeting.
Its scripted week has no finalized attendance. The assertion now requires a scheduled opportunity and no attended participants.
The corrected assertion, database setup, and new regression pass together: 3 pass, 0 fail, 77 assertions.

A fresh `bun run test:integration` then reports 676 pass, 8 skip, 6 fail across 68 files.
It runs 13,803 assertions in 529.06 seconds, including the security suite.
The corrected console case and the new attendance case both pass inside this official command.

The six remaining failures are the previously base-reproduced Windows failures:

- `deploy/wrangler.integration.test.ts`: missing `/bin/bash`.
- `deploy/backend/backend.test.ts`: SIGTERM exit 143 where the test expects 0.
- `sites/test/sites.test.ts`: four slash-versus-backslash artifact assertions.

Their [base reproduction is recorded on PR #355](https://github.com/startrack3r/thenetwork/blob/3945bba314050802299b168f442ca9f139ccd1f5/docs/results/2026-11-05-sim-block-selection.md).
No deployment or site source was changed for these failures.

`bun run test:e2e`: 42 pass, 1 skip, 0 fail; 654 assertions, 72.93 seconds.
The optional browser SDK case was skipped. The isolated PostgreSQL cluster was stopped after validation.

## llm_evidence

N/A: this changes deterministic attendance accounting and persistence. No model-backed behavior changes.
The text-intake path uses existing rules. Real-model calls: 0; model cost: $0; validation provider/model: none.

## agent_clients

N/A: this corrects backend stored state, with no change to an external agent protocol or member conversation.
No external-client acceptance run is claimed.
Installed client: Codex desktop 26.1029.7803.0, verified from the Windows package.
Runtime: Bun 1.4.2. Authoring provider: OpenAI.
The exact assistant model identifier is not exposed; the disclosure helper's supported `unavailable` value is used.
No browser or computer use was performed.

## Limits

Attendance remains evidence-based. The Network cannot directly observe whether a real meeting happened.
An abandoned outcome means finalization did not establish a held meeting; it does not assign absences to unknown participants.
The existing counterpart and host confirmation rules are preserved, including their limits for ambiguous group reports.
Feedback received after finalization can update stored evidence; this does not rewrite previously emitted capital-ledger events.
There is no schema, dependency, UI, member-copy or deployment change.
