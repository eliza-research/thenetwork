# Grade delivered drop notifications — 2026-11-07

## Problem and requirement

The `others_notified_of_drop` scenario check counted cancellation messages that failed delivery.
With one lost notice, it reported `5/5 notified` and passed although an attendee received nothing.

Its count comparison also let a notice to a no-show substitute for an unnotified attendee.
The check compared notification count with eventual attendance count instead of requiring each remaining recipient.

This is a reproduced simulation-validation defect within the approved project scope.
PRD flow F18 requires notifying the others when someone drops.
Sections 34.3–34.4 require scenario validation and flow-integrity measurement.

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`, current main.
Runtime: Bun 1.4.2 on Windows, with PostgreSQL 16.15 for service checks.
Both worktrees use independent dependencies installed from the unchanged frozen lockfile.

## Fix

Count a cancellation notice only when its message status is `delivered`.
Require a delivered notice for every member in the existing remaining-member set.
Keep the existing requirement that this set is nonempty.

The set includes people who later do not show up, unless they also cancelled with notice.
Their later attendance does not determine whether they need the update.
The existing proposal-ID association and drop-outcome selection remain unchanged.
This changes grading only: messages, delivery behavior, bookings, attendance and metrics do not change.

Other implementations considered:

1. Add only the delivery filter. The old attendance-count comparison would still pass 13 incomplete-notification runs in this corpus.
2. Require notices for all original invitees except the dropper. That would reject 187 correctly notified runs with a smaller remaining group.

Those counts evaluate the alternative predicates against the same real run records.
The chosen check uses the existing remaining group and verifies each member's delivery.
No dependency, new runtime field, threshold or scenario parameter changes.

## measurement

The committed case runs the existing `group-flake-morning-of.json` fixture with seeds 2, 7 and 29.
Each seed runs with channel failure rates zero and 0.1, both with and without an extra no-show action for `dinner-5`.
That extra action is scheduled at day zero, 20:00; the original `dinner-4` notice action stays unchanged.
This makes twelve complete worlds: six delivery-failure cases and six successful-delivery controls.

The real World, simulated channel, policy personas, booking and attendance code all run.
The Network arm is the repository's built-in `StubNetwork`, with random introductions disabled.
No message, delivery result, attendance record or grade is fabricated.

The case checks the latest booked roster and actual delivered cancellation messages.
It verifies an actual drop, a held meeting, one unnotified attendee in each failure arm, and the resulting grade and count.
Normal persona decisions remain active; an additional scripted no-show does not force that person to accept an invitation.

| Seed | Extra no-show action | Failure rate | Remaining recipients | Delivered | Before | After |
|---|---|---:|---:|---:|---|---|
| 2 | No | 0.1 | 5 | 4 | pass, 5/5 | fail, 4/5 |
| 7 | No | 0.1 | 5 | 4 | pass, 5/5 | fail, 4/5 |
| 29 | No | 0.1 | 4 | 3 | pass, 4/4 | fail, 3/4 |
| 2, 7, 29 | Yes | 0.1 | 5 each | 4 each | pass, 5/5 | fail, 4/5 |
| All three seeds, both actions | Both | 0 | 4–5 | All | pass | pass |

The extra-no-show failure arms have four attendees and four delivered notices.
One of those notices reaches the no-show, while an attendee misses theirs.
This proves why comparing aggregate counts is insufficient.

Run the same case before and after:

```text
bun test --conditions eliza-source packages/sim/test/drop-notifications.integration.test.ts

Before: 0 pass, 1 fail, 1 assertion; case 74.15 ms, command 124 ms
After:  1 pass, 0 fail, 1 assertion; case 74.32 ms, command 119 ms
```

The single assertion compares all twelve completed workflows.
These timings describe this run; no performance improvement is claimed.

### Wider comparison

Run both fixture variants on seeds 1–40, then separately on seeds 41–80.
Each seed uses failure rates 0, 0.1, 0.25 and 0.5.
Each corpus therefore has 320 worlds per revision; the total is 640 per revision.
The second corpus supplies additional seeds beyond discovery and the committed case.

For each world, evaluate the normal scenario expectations after completion.
Compare the target grade with delivered notices for all remaining members.
Also compare every other grade, all metrics, and a SHA-256 digest of the entire run-record sequence.
Exclude only `run_end.wallMs` from record hashing.

| Corpus | Worlds | Runs with a drop | Incorrect passes before → after | Correct delivery-success controls | No-drop failure controls | Exactly unchanged target grades |
|---|---:|---:|---:|---:|---:|---:|
| Seeds 1–40 | 320 | 222 | 72 → 0 | 150 | 98 | 248 |
| Seeds 41–80 | 320 | 227 | 51 → 0 | 176 | 93 | 269 |
| Total | 640 | 449 | 123 → 0 | 326 | 191 | 517 |

There are zero incorrect failures before or after.
Both status and detail change in the 123 corrected cases; both remain identical in the 517 controls.
Of the corrected cases, 121 miss a notice to an attendee and two miss only a later no-show.
All metrics, run-record digests and other expectation results remain identical across all 640 paired worlds.

The fixture is repository-authored; the extra action and comparison scripts were written for this reproduction.
These are deterministic grading corrections, not evidence of improved delivery or live-member outcomes.
No statistical quality or oracle-calibration claim is made.

## safety_gates

Both revisions ran:

```text
bun run sim --only network --json <output>
```

Before: 61/61 blocking gates pass, zero tracked misses, 156.0 seconds.
After: 61/61 blocking gates pass, zero tracked misses, 156.1 seconds.
All 63 gate records match exactly after excluding elapsed time, including both fingerprints.
No gate, target or expected fingerprint changes.
The pinned runs use automatic simulation reviewers with live-send and deployment flags disabled.

The full simulation is not repeated: AGENTS.md permits one full run per agent, already used on PR #355.
That earlier full run is not evidence for this revision.
Only the affected Network block is claimed here.

## Service validation

Type checking passes all four configurations.
`bun run test:integration`, including security, finishes with 676 passes, eight skips and six failures.
It runs 13,742 assertions across 690 tests in 69 files, taking 530.70 seconds.
The new regression passes within that command in 48.49 ms.

The six failure names and causes match the saved clean-base reproduction:

- Wrangler cannot spawn `/bin/bash` on Windows.
- The boot test receives SIGTERM exit status 143 instead of zero.
- Four site-build checks compare slash paths against Windows backslash paths.

The eight skips belong to the optional completed-cleanup reconciliation suite.
An all-green integration suite is not claimed.

`bun run test:e2e` finishes with 42 passes, one skip and zero failures: 654 assertions in 76.16 seconds.
The optional browser SDK case requires `PLAYWRIGHT_MODULE`; no computer control was used.
The isolated PostgreSQL cluster was stopped after validation with no remaining clients.

## Related work

PR #375 fixes the held-meeting check in the same evaluator.
Its runtime patch at `d3f16387adac90e3a5ae720da44d0477ddba0eb3` applies cleanly alongside this fix.
Both regression cases pass together: two passes, zero failures, two assertions in 133 ms.
The temporary combined worktree was restored; broader combined-suite qualification is not claimed.

PR #362 changes simulated attendance after a delivered cancellation.
PR #347 changes production notification-cap accounting.
This fix changes neither path and does not stack those PRs.

## llm_evidence

N/A: deterministic scenario grading with built-in policy personas and seeded channel failures.
Real-model calls: zero. Cost: $0.
No prompt, generated member voice or model-backed decision changes.

## agent_clients

N/A: no changed member-facing agent workflow or protocol.
Codex desktop 26.1029.7803.0 drove Bun 1.4.2.
Authoring provider: OpenAI; the exact model identifier was unavailable.
No other agent client, browser or computer control was used.

## How to test

1. Run the integration case above. Expect one passing case over twelve worlds.
2. Copy the case unchanged to base and repeat. Expect six incorrect passing notification grades.
3. Run Network qualification on each revision. Expect identical gate records apart from elapsed time.
4. For the wider comparison, use the same fixture variants, seed ranges and channel failure rates listed above.

## Risks and limits

Scenarios with incomplete delivery now fail even if the affected member later does not attend.
This stricter result is intentional: a notification obligation does not depend on future attendance.
Previously saved grades are not rewritten automatically; rerun the scenario for corrected grades.
The change does not add retries, repair transport failures or change cancellation-event association.

There is no UI, message-copy, dependency or production-service change.
Only synthetic repository personas were used; raw messages, run logs, credentials and member data are not committed.
