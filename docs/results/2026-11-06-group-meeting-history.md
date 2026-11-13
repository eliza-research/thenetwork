# Group meeting history and individual refusals — 2026-11-06

## Problem and scope

A group dinner can proceed after one invitee declines.
The simulator nevertheless reported the entire opportunity as declined, even after five people attended.
Before the meeting it omitted the booked group from open opportunities; afterwards the engine could not generate second encounters from that meeting.

This is a reproduced simulation and matching defect within the approved scope.
PRD 34.3–34.4 require final-state scenario validation and outcome measurements.
Flow F19 requires second encounters after positive feedback; the engine uses completed meetings and mutual feedback to generate them.
Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`, current main.
Runtime: Bun 1.4.2 on Windows, PostgreSQL 16.15 for service validation.
Dependencies were installed from the unchanged frozen lockfile in both checkouts.
Measurements began November 6 and final validation continued November 7, 2026 (Asia/Tokyo).

## Cause and fix

`networkStateFromRecords` gave any individual decline precedence over a booking or outcome record.
It also used the original invitation roster for scheduled and completed interactions.

Use the outcome or booking when present, retaining the original per-person replies:

- A booked meeting remains accepted and open for its booked participants.
- A held meeting is completed for the people who actually attended.
- A meeting with fewer than two attendees remains a no-show with its recorded roster.
- An unbooked declined opportunity keeps its existing behavior.

Preserve the proposal's participant order within the actual roster and append any additional recorded participants.
This avoids changing the order of otherwise-correct histories and engine inputs.

Changing only the group status loses another fact: the engine previously derived a refusing member's cooldown from the whole opportunity being declined.
The intermediate implementation proposed a refusing member again in two of the three initial affected scenarios.
The fix therefore retains each refusal's actual message time in optional `declinedAt` metadata when a booking or outcome follows it.

The engine canonicalizes those member IDs and keeps category cooldowns from the refusal time.
Its pair index represents a pair involving a refusing invitee as declined, while the actual attendees retain their completed meeting.
These are index entries, not additional top-level interactions: response estimates still count each answer once.
Only records with explicit `declinedAt` metadata split these refusal events from the meeting.
Legacy records retain their existing cancellation, pair and category behavior.
Missing individual timestamps within the optional map fall back to the interaction's `at`.

Applying the new refusal handling to all legacy records changed Slop's cancelled-date behavior.
Qualification caught worsened tracked safety values despite all blocking checks passing.
Requiring explicit separate-event metadata keeps this correction scoped to the new group histories.

Other implementations considered:

1. Only prioritize booking/outcome records. That restores meetings but loses the refusing person's cooldown, as the reproduction demonstrated.
2. Emit both the old declined interaction and a new completed interaction. That either retains the false pair cooldown among attendees or requires splitting reply counts and introducing new opportunity IDs.
3. Drop the declined reply once a group books. That erases a real refusal and permits unwanted re-proposals.

The added optional field is necessary because a meeting time and an individual refusal time are different events.
No new dependency, matching threshold or oracle parameter is introduced.

## measurement

The committed case derives its worlds from `group-flake-morning-of.json`, removing the forced-flake action.
The six original personas, their normal policy decisions and the scripted dinner proposal remain.
The built-in `StubNetwork` runs with random introductions disabled.
No response, attendance record, feedback or engine result is fabricated.

Each five-day world is advanced to day three, before its booked dinner, and inspected through `World.snapshot()`.
It then finishes normally and its final snapshot goes through the real `runEngine` pipeline.
The same snapshot is also evaluated at day ten, after the seven-day category cooldown but still within the thirty-day pair cooldown.
Both use the default engine configuration and local embeddings, with the world's seed.

Primary seeds: 4, 6, 11, 13, 2, 9 and 15.

| Seed | Decliners | Actual attendees | Scheduled history before → after | Final history before → after | Second-encounter candidates before → after | Selected second encounters before → after |
|---|---:|---:|---|---|---:|---:|
| 4 | 1 | 5 | declined → accepted | declined → completed | 0 → 10 | 0 → 2 |
| 6 | 1 | 5 | declined → accepted | declined → completed | 0 → 6 | 0 → 1 |
| 11 | 1 | 5 | declined → accepted | declined → completed | 0 → 6 | 0 → 2 |
| 13 | 2 | 4 | declined → accepted | declined → completed | 0 → 6 | 0 → 2 |
| 2, 9, 15 | 0 | 6 each | accepted, unchanged | completed, unchanged | 35 total, unchanged | 7 total, unchanged |

The four affected bookings change from zero open opportunities to one with the booked roster.
Their original acceptances and refusals remain recorded.
No selected proposal includes a refusing invitee at day five or day ten.
The case also checks individual refusal clocks against actual sent inbound messages, category cooldown clocks, and pair cooldown clocks, including the two different refusals on seed 13.

The unchanged integration case fails on base and passes on the fix:

```text
Before: 0 pass, 1 fail, 1 expect() call; case 148.88 ms; command 219 ms
After:  1 pass, 0 fail, 1 expect() call; case 164.75 ms; command 309 ms
```

This is one assertion over seven complete World/Network workflows and their engine results.
The timings describe these runs; no performance improvement is claimed.

### Additional corpus and controls

The additional group corpus uses seeds 21–32, with the same settings and no tuning on those seeds.
Seeds 27 and 32 each have one refusal and five attendees.
Both falsely declined histories become completed, restoring twenty second-encounter candidates and four selected second encounters in total.
The ten other group runs retain identical histories and engine outputs.

Three further control corpora exercise the surrounding outcomes:

| Control | Seeds and transformation | Worlds | Result at both revisions |
|---|---|---:|---|
| Nobody attends | 4, 6, 11, 2, 9, 15; add day-zero `force_flake: no_show` actions for all six personas | 6 | Six no-show outcomes; no second-encounter candidates |
| Successful pairs | 1–20; keep the first two personas, prefer size two, and propose an `intro` described as dinner for two | 20 | Completed pairs; sixteen second-encounter candidates and thirteen selected in total |
| Declined, unbooked pairs | 2, 9, 15; the same pair transformation, proposing NYC while both personas live in SF | 3 | Declined, no booking; no second-encounter candidates |

Across all 48 worlds per revision:

- Six scheduled and completed group histories are corrected.
- Forty-eight second-encounter candidates and eleven selected second encounters are restored across those six runs.
- Forty-two controls retain identical histories, open opportunities, candidate counts and selected engine proposals at days five and ten.
- All world metrics, feedback, original yes/no/no-response arrays, and SHA-256 digests of run records match exactly before and after. Only `run_end.wallMs` is excluded from record hashing.
- Refusing invitees receive no selected re-proposal at either checked time.

These are deterministic record and engine checks, not evidence of improved live-member outcomes or a statistical quality estimate.
The synthetic fixture is repository-authored; its transformations and additional measurement scripts were written for this reproduction.

## Related work

PR #341 (`086b9c4c728c0daa67014ded6135eac292dd9f62`) changes expired-response cooldowns and timestamps unbooked declined interactions.
This fix leaves those base behaviors unchanged and adds individual times only when a later group booking/outcome must coexist with a refusal.
PR #336 changes failed-delivery handling in the same snapshot helper; this fix does not change delivery eligibility.

A temporary combination of this fix and PR #341's runtime changes passed the seven-world integration case: one pass, zero failures, one assertion, 165.22 ms (210 ms command).
That combination required reconciling the shared helper and cooldown hunks; its source worktree was restored afterwards.
This is a compatibility check, not full qualification of the combined PRs.

## safety_gates

Qualification commands, run on base and the fix with the same pinned settings:

```text
bun run sim --only network,slop,safety,audit --json <output>
bun run sim --only friends,peon --json <output>
```

Base: 133/133 blocking gates with eight tracked misses in 255.7 seconds, then 45/45 with one tracked miss in 83.5 seconds.
The final Network, Slop, Safety and Audit run passes 133/133 blocking gates in 257.2 seconds, with the same eight tracked misses.
All 153 gate records match the base exactly after excluding elapsed time.
The final Friends and Peon run passes 45/45 blocking gates in 85.2 seconds, with the same one tracked miss.
All 49 of its gate records match the base exactly after excluding elapsed time.
Together, all 178 blocking gates pass and all 202 records retain their values.
Network fingerprints remain `24bb81f068060b33` and `361f8cc2648fb9a6`.
Slop fingerprints remain `445afd705328fe54` and `eaeaf7bbe8c99c81`.

## Service validation

Type checking passes all four configurations.
`bun run test:integration`, including the security files, finishes with 676 passes, eight skips and six failures.
It runs 13,742 assertions across 690 tests in 69 files, taking 532.73 seconds.
The new case passes within that command in 117.89 ms.

All six failure names and causes match the saved clean-base reproduction:

- Wrangler cannot spawn `/bin/bash` on this Windows host.
- The boot test receives SIGTERM exit status 143 instead of zero.
- Four site-build checks compare slash paths against Windows backslash paths.

The eight skips belong to the optional completed-cleanup reconciliation suite.
An all-green integration suite is not claimed.
`bun run test:e2e` finishes with 42 passes, one skip and zero failures: 654 assertions in 80.22 seconds.
The optional browser SDK case requires `PLAYWRIGHT_MODULE`; no computer control was used.
The isolated PostgreSQL cluster was stopped after validation with no remaining clients.

The full simulation is not repeated: AGENTS.md permits one full run per agent, already used on PR #355.
That earlier full run is not evidence for this revision.
Qualification uses simulated reviewers; live-send and deployment flags remain disabled.

## llm_evidence

N/A: deterministic snapshot reconstruction and engine history indexing.
The workflows use built-in policy personas and local embeddings; no model-backed behavior is claimed.
Real-model calls: zero. Cost: $0.

## agent_clients

N/A: simulator and engine internals, with no changed member-facing agent protocol.
Codex desktop 26.1029.7803.0 drove Bun 1.4.2.
Provider: OpenAI; the exact assistant model identifier was unavailable.
No other client, browser or computer control was used.

## How to test

1. Run `bun test --conditions eliza-source packages/sim/test/group-meeting-history.integration.test.ts`. Expect one passing case over seven worlds, with completed group histories and intact individual cooldowns.
2. Copy that case unchanged to clean base and run the same command. Expect a failure for the four partially declined groups.
3. Run the two qualification commands above and compare gate records, excluding elapsed time.

## Risks and limits

This changes engine-visible history when a group books or meets despite a refusal.
Consumers of serialized snapshots must preserve optional `declinedAt` metadata to retain refusal timing separately from the meeting time.
The actual meeting roster excludes non-attendees; original invitation answers remain separate metadata.
Old logs can be replayed through the corrected builder; previously serialized snapshots are not rewritten automatically.

This does not fix other open response, delivery, alias or cooldown PRs.
There is no UI, dependency, production-service protocol or live-message change.
Only repository-generated synthetic personas were used; raw messages, logs, credentials and member data are not committed.
