# Friends slot selection under existing bookings

## Status and requirement

**Draft: the scheduling defect is reproduced and fixed, but qualification is
not green.** The pinned borough-value gate now fails and simulated harm
increases. Those results need maintainer evaluation; no threshold is weakened.

This is a simulation bug within the approved Slop scope and PRD 34.3. The
Friends harness promises to book an agreed slot while respecting its existing
two-meetup weekly cap and prohibition on overlapping bookings.

`bestOption` counted every yes-sayer's selected times, including people the
harness could not book in that slot. The final seating step removed those
people, found too few for quorum, and abandoned the plan. It never tried
another offered time that both people had selected and could attend.

The official friendsPack cohort reproduces this on all four pinned seeds:

| Seed | Week index | Chosen option conflicts with an earlier booking | Viable offered alternative |
| --- | ---: | --- | --- |
| 5 | 3 | Friday evening | Sunday evening |
| 6 | 4 | Tuesday evening | Thursday evening |
| 7 | 2 | Saturday morning | Sunday morning |
| 8 | 6 | Saturday morning | Sunday morning |

In each case both people actually answered yes. For example, seed 5's partner
plan `w3:79:partner` has two selected options, but one person's Friday booking
leaves only one seatable person in that option. Both can be seated on Sunday.

## Fix and alternatives

Count a selected time only when `canBook(id, slot)` also permits that person.
The same count now guides the initial quorum check, alternate invitations and
subsequent split tables. Final booking checks remain in place. The matcher,
persona choice model, seeded draws, limits and safety filters are unchanged.

Two alternatives considered:

1. Retry another slot only after seating fails. This leaves the initial quorum
   and alternate-selection counts wrong and duplicates the slot-selection rule.
2. Remove an already-booked person from the entire proposal. This discards
   their valid answers for other times, including the reproduced cases.

## measurement

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Same command before and after,
with the new gate present in both runs:

```sh
bun run sim --only friends --json ../friends-slots.json
```

This runs the existing friendsPack, random and oracle arms on seeds 5-8, 400
personas and eight weeks, plus the existing harness and conformance checks.
The new gate observes the real matcher proposals without changing them. It
reconstructs reservations from actual completed booking flows, including
no-shows, then checks mutually accepted partner plans against offered times,
hidden availability and existing reservations, including the recorded booking
time. It does not stub the matcher,
oracle, replies or booking outcomes, or add separate qualification worlds.

| New gate | Before | After |
| --- | ---: | ---: |
| Mutually accepted partner plans with a usable offered time | 72 | 65 |
| Such plans whose first offered option is unavailable | 19 | 15 |
| Feasible partner plans abandoned before reveal | 4 | 0 |
| Gate passes | no | yes |

The populations of later proposals differ because earlier booking choices
change outcomes and feedback. These counts do not claim four net new meetups:
total pack meetups change from 778 to 775 across the four seeds.

Both CLI runs report **18/19 blocking gates passed**, for different reasons.
Before, only the new regression gate fails; all 18 existing gates pass.
After, the new gate passes and the existing borough-value gate fails. Both
runs have one tracked miss. Of 22 gate records, 12 are identical after excluding
timing fields; ten change:

| Changed detail | Before | After |
| --- | --- | --- |
| Feasible partner plans lost | 4 | 0 |
| Pack/random/oracle fingerprint | `e5bf70e069eaa7e9` | `5ed8a1ca25856c87` |
| Repeat-meetup rate (floor 30%) | 33.7% | 31.7% |
| V14 | 34.7%; 0.83x oracle, 2.05x random | 35.1%; 0.83x oracle, 2.07x random |
| Friendship-forming share | 9.4% | 9.6% |
| Median group maximum travel | 26.9 min | 27.1 min |
| Worst borough's pooled V14 ratio (floor 0.70) | 0.712178, Bronx | **0.695820, Bronx: fail** |
| Total harm per seed (random: 41.5) | 17.5; 0.42x random | 19.0; 0.46x random |
| Tracked undetected-harm ratio | 1.67x random | 1.81x random |
| Tracked repeats including crew handoffs | 34.3% | 32.3% |

The CLI rounds the failing borough ratio to `0.70`; the unrounded value is
below the floor. Its worst-seed ratio changes from 0.564180 to 0.471520.
Runtime is 49.8 seconds before and 49.6 seconds after, with no speed claim
under shared machine load.

An additional paired run uses seeds 9-12, the same 400-person/eight-week
configuration and all three arms, without tuning the fix. Lost feasible
partner plans change from **2 to 0** (58 feasible pairs before, 57 after).
Pack meetups change from 712 to 720. Repeat rate changes from 29.3% to 29.7%,
below the 30% floor in both runs. Total harm changes from 19.3 to 20.5 events
per seed versus random's 35.8: the harm gate fails both before and after.
V14 remains 31.6% at displayed precision, friendship share changes from 10.1%
to 10.6%, travel from 26.7 to 26.8 minutes, and the borough ratio from 0.787798
to 0.776631 (both pass). These are additional observations, not a green
held-out qualification or an estimate of production performance.

Across seeds 5-12, the recorded random and oracle control rows, including
their full metrics, are identical before and after in all 16 control worlds.

## safety_gates

Declared-minor proposals/contacts and known-adversary contacts remain zero on
every measured seed. Existing conformance checks pass. The pinned total-harm
gate still passes its 0.5x-random threshold, but its value is worse; the extra
seeds fail that gate in both runs. **Not every safety value is preserved.**
No claim of an overall matching or safety improvement is made.

This is simulator code. No production matching, consent, access, delivery,
model prompt or member data changes. No live messages were sent. The
simulation's matching and choice rules are concrete implementations, not
human-review or live-agent evidence.

## Validation and companion work

- Typecheck: exit 0 across all four configurations.
- Integration, including security: **675 pass, 8 skip, 6 fail**, 13,741
  assertions across 68 files, 549.88 seconds. The six failure names exactly
  match the previously reproduced failures on the same base: Windows
  `/bin/bash`, SIGTERM exit status and four site-build path-separator cases.
  The eight skips require optional `NETWORK_RETRY_RECONCILIATION_TEST` setup.
  The suite is not green; no new failure name appears.
- E2E: **42 pass, 1 skip, 0 fail**, 654 assertions, 74.46 seconds. The skipped
  browser-SDK recovery case requires `PLAYWRIGHT_MODULE`; it was not run.
- Isolated combination with PR #364's crew-booking runtime: the new partner
  gate passes (65 feasible pairs, zero lost), and the block remains 18/19 with
  the same borough failure. Compared with this fix alone, only the fingerprint
  and displayed friendship share change (9.6% to 9.4%). This used this PR's
  qualification script, not #364's separate added gate. Both PRs extend the
  same qualification loop; retain both gates when merging. This is not a
  claim that the combined changes have green qualification.
- Full default simulation was not repeated: AGENTS.md allows one full run per
  agent, already consumed earlier in this contribution session. Only the
  affected Friends block is claimed for this revision.

Environment: Windows x64, Bun 1.4.2, PostgreSQL 16.15 on isolated local port
54339. The audited frozen dependency install is unchanged on this base.
Provider keys and live-send/deploy flags are absent from the test processes.

To reproduce, add the new gate on the base and run the command above: it lists
the four lost partner plans. Apply the runtime fix and repeat: that gate
passes, while the borough gate fails as documented. Run typecheck,
integration and E2E with the local Postgres setup. The draft must not be
treated as passing every merge gate.

## llm_evidence and agent_clients

Real-model calls: 0; cost: 0. This is deterministic simulator booking logic
using the real friendsPack planner and persona oracle. No LLM-generated voice,
model-backed classifier or prompt changes; no real-LLM qualification claimed.

Codex desktop 26.1029.7803.0 drove commands and GitHub connector/CLI directly,
without computer use. Authoring provider: OpenAI; exact model identifier:
unavailable. Claude Code/Claude, ChatGPT member flow, Hermes Agent, OpenClaw,
Muse, Grok bot, elizaOS and Cursor were not tested. Member-facing client
connectors are unchanged; no untested client result is claimed.
