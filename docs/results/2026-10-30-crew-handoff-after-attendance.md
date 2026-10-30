# Crew handoff after attended sessions

Date: 2026-10-30 (Asia/Tokyo). Reproduced defect under the approved Slop scope and PRD 40.6.

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Fix and gate: `0265275f711af6a87054a9d333a289c9b4267fcb`.
Combined compatibility commit: `57c6550a38a8270f99cbd4a80c5a778770ae005c` (local only, includes the preceding 43 contributions).

## Problem, cause and fix

PRD 40.6 requires crews after one great plan, with handoff to their own chat after three sessions.
The Network counts proposed sessions instead of held meetings. Three rejected proposals can end scheduling before the first crew meetup.
The successful path also hands off when it proposes the third session, before that session happens.

The duplicate-date check uses plan IDs to look up opportunities. Those maps use different IDs, so it never finds the earlier date.
A rejected or declined plan can therefore be proposed again for the same date until it consumes the three-proposal limit.

The fix selects the existing opportunities belonging to the crew. It counts distinct dates with finalized attendance for at least two booked members.
That matches the Friends world's existing held-meeting rule. It shares the capital ledger's existing attendance calculation without changing that calculation.
The daily crew scheduler applies the handoff threshold after finalization. It checks previously proposed dates through the same opportunity records.

No new persisted counters or schema are needed. Existing attempts, session IDs, host rotation and counters remain attempt history.
Staff review, individual consent, attendance evidence, no-show events and outreach limits retain their existing rules.
The existing handoff state and log are used; this does not add an external chat-creation service.

Other implementations considered:

1. Count booked sessions. This still hands off before attendance and counts unknown attendance or no-shows as completed sessions.
2. Store another completed-session counter. This requires new persistence and migration logic, and can disagree with existing attendance records after restart.

Reading the stored opportunities uses the current evidence and handles JSON restoration without a new source of truth.

## measurement

One new blocking gate drives 18 isolated cases: seeds 1, 2 and 3, with six scenarios each.
The real `Mini` harness starts at 2026-10-05 17:00 UTC. Four synthetic adults share Williamsburg and running, coffee and board-game interests.
Text intake completes onboarding. The real planner proposes their founding meeting, simulated staff approves it, and all members consent.
After positive attendance feedback, the real crew offer receives four explicit opt-ins.

The crew lifecycle then runs for 56 days of five-minute scheduler ticks, plus one minute before each reply.
Weekly JSON exports/imports restart the Network. The gate does not call private scheduling methods or inject crew opportunities.
Other ordinary plans are rejected, and growth prompts are disabled, to isolate the crew workflow.
Engine-generated daily opportunities are disabled; the real plan generator and crew scheduler remain enabled.

Scenarios reject every proposal, decline every probe, attend all sessions, reject two then attend, leave attendance unknown, or confirm only one attendee.
For the one-attendee case, the other three members explicitly say they could not make it.
The gate independently counts `plan_attended` ledger events, including their timestamps at the first handoff event.
It requires at least two distinct attendees, no repeated dates, and exactly one handoff after three held sessions in successful cases.

| Result | Before | After |
|---|---:|---:|
| Correct complete cases | 0/18 | 18/18 |
| Handoff before three held sessions | 18 | 0 |
| Duplicate proposals for the same crew/date | 15 | 0 |
| Successful paths hand off after exactly three held sessions | 0/6 | 6/6 |
| Unsuccessful/unknown paths stay managed | 0/12 | 12/12 |
| Network/Friends blocking gates | 79/80 | 80/80 |
| PostgreSQL safety gates | 17/17 | 17/17 |

Seed 1 example, with the same pattern across all three seeds:

| Scenario | Held at handoff, before | Held at handoff, after | Duplicate dates | Held at end, after |
|---|---:|---:|---:|---:|
| rejected | 0 | none | 2 → 0 | 0 |
| declined | 0 | none | 1 → 0 | 0 |
| attended | 2 | 3 | 0 → 0 | 3 |
| mixed | 0 | 3 | 2 → 0 | 3 |
| unknown | 0 | none | 0 → 0 | 0 |
| one-present | 0 | none | 0 → 0 | 0 |

Exact paired rows for the rejected-proposal case:

```jsonl
{"seed":1,"scenario":"rejected","attempts":3,"sessions":3,"duplicateWindows":2,"held":0,"heldAtHandoff":0,"handedOff":true,"correct":false}
{"seed":1,"scenario":"rejected","attempts":9,"sessions":9,"duplicateWindows":0,"held":0,"heldAtHandoff":null,"handedOff":false,"correct":true}
```

All 84 existing Network/Friends records match before and after, excluding runtime.

- fingerprint: invariant run (seed 3, 10 days) records: `24bb81f068060b33`.
- fingerprint: consent vs push arms: `361f8cc2648fb9a6`.
- fingerprint: pack, random and oracle arms: `e5bf70e069eaa7e9`.

The existing tracked Friends harm metric remains off target: 17.5 versus 10.5 per seed, ratio 1.67, target at most 0.5.
This result is unchanged; the PR does not claim to improve it. Paired runs took 217.5s before and 249s after.
These deterministic cases prove state transitions, not population-level retention or a statistical quality gain.

The first fixture draft used instantaneous replies. The attention ledger requires reply time strictly after send time.
The final fixture advances one minute before replies and uses five-minute ticks to observe learned send windows.
Both reported columns use that same final fixture; discarded diagnostic runs do not supply the results above.
Interrupted after/combined/integration runs were restarted after their processes stopped. Only completed reruns count as evidence.

## safety_gates

All 17 safety records match before and after, including PostgreSQL cases. No safety threshold or expected value changed.
The attendance helper extraction retains the ledger's existing attendance, no-show and host check-in rules.
All messages stay in the recording channel. No real member data, live messages, deployment or external chat creation.

## Validation

Standalone typecheck passes all four configurations before and after. Combined typecheck also passes.
The combined Network/Friends run passes 94/94 blocking gates, with exactly the same 18 new rows as standalone.
All 98 prior combined Network/Friends records remain identical, excluding runtime.
The production change merged cleanly. The simulation import/insertion conflict retained all earlier gates plus the new gate.

Integration, including the security subset, on the combined branch with PostgreSQL 16.15:

```text
684 pass
8 skip
6 fail
14439 expect() calls
Ran 698 tests across 70 files. [543.04s]
```

The six failures have exactly the same names as #212: Windows absolute `/bin/bash`, SIGTERM exit status, and four site path-separator comparisons.
Eight skips require the separate retry-reconciliation opt-in. Integration is not claimed green; hosted Linux CI remains pending.

E2E ran afterward on the same combined branch:

```text
42 pass
1 skip
0 fail
654 expect() calls
Ran 43 tests across 3 files. [36.01s]
```

The optional browser case requires `PLAYWRIGHT_MODULE`. PostgreSQL suites ran sequentially on port 54339.

## Reproduce

```powershell
bun install --frozen-lockfile
bun run sim --only network,friends --json crew-handoff.json
bun run typecheck
# With the repository's dev PostgreSQL configured and running:
bun run sim --only safety --json safety.json
bun run test:integration
bun run test:e2e
```

Expect 80/80 Network/Friends blocking gates and 18/18 crew rows on this branch.
Apply only the new simulation gate to the base revision: expect 79/80 gates, 0/18 correct crew rows and 18 early handoffs.
The one-full-simulation-per-agent allowance was used for #136. This work reruns affected blocks and makes no new full-run claim.
Local paired artifacts are `work/crew-handoff-{before,after,combined,safety-before,safety-after}.json` and their logs.

## llm_evidence

Deterministic scheduling and attendance accounting; no model-backed behavior changed. Zero validation model calls and $0 model cost.
The real text-intake path uses its rules mode. Existing safety fixtures are not real-model evidence.

## agent_clients

No external-client acceptance run is claimed for Claude Code, Codex/ChatGPT, Hermes, OpenClaw, Muse, Grok bot, elizaOS or Cursor.
The actual Network lifecycle runs directly in the recording harness. The service suites above are separate evidence.
Authoring: installed Codex desktop 26.1023.6621.0 on Windows; OpenAI `gpt-6-astra`, operator-identified; client `codex`.

## Limits

Previously handed-off crews remain handed off; this does not reopen legacy crews automatically.
A date already proposed is not retried, even after rejection. A later date can still be proposed.
Handoff waits for attendance finalization and the daily crew scheduler. Unknown attendance does not count as a held session.
Existing member erasure can remove attendance records and delay a future handoff.
No schema, dependency, UI, member-copy or external integration changes. Draft pending maintainer review and hosted CI.
