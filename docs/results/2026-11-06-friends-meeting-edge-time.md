# Friends relationship timestamps follow the meetup

## Requirement and defect

Reproduced simulation bug under the approved Slop scope and PRD 34.3's virtual
time and replay requirements. A `met` relationship's creation time should
describe the meetup that produced it.

The Friends harness always wrote `createdAt: slotTime(week, 0)` when people
met. Slot zero is Monday evening. The rest of the meetup used its selected
time, so a weekend meetup could produce an interaction dated on the weekend
and a relationship dated days earlier. Independent crew gatherings used the
same helper and had the same defect. The incorrect timestamps were copied
into the public Friends snapshot.

Pass the actual slot into the common `held` helper from both booking paths.
Derive the day and timestamp from that slot and stamp the relationship with
the resulting instant. The day recorded in meetup metrics stays the same.

Alternatives considered:

1. Use the planner's current clock. That is Monday morning for a weekly batch,
   not the time of each meetup, and would preserve the chronology error.
2. Repair timestamps when building the snapshot. A relationship lacks the
   originating meetup ID, and repeated pairs make inference ambiguous. The
   booking path already knows the exact slot; fix the source record instead.

## measurement

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Same command before and after,
with the new gate present in both runs:

```sh
bun run sim --only friends --json ../friends-edge.json
```

The new gate reuses the official friendsPack, random and oracle worlds: seeds
5-8, 400 personas and eight weeks. It derives expected pair events from the
actual held meetups, using recorded interaction times for Network bookings
and the agreed weekly slot for independent crews. It compares that multiset
with `met` edges in the published snapshot, preserving repeated meetings.
No matcher, persona, reply, oracle or outcome is mocked; no extra worlds are
added to the qualification command.

| Result across the 12 official worlds | Before | After |
| --- | ---: | ---: |
| Published `met` events | 7,972 | 7,972 |
| Events unmatched at the actual meetup time | 7,734 | 0 |
| Actual meetup events missing at their correct time | 7,734 | 0 |
| Independent-crew events included | 32 | 32 |
| Blocking gates passed | 18/19 | 19/19 |

The two mismatch rows describe the same incorrectly timed records, not twice
as many defects. Before, 238 records already match a real meetup time. The
fix preserves all 7,972 events and matches every one to its actual time.

Before, only the new regression gate fails. After, it passes. All **21
pre-existing gate records are identical**, excluding execution-duration `ms` fields, including
the `e5bf70e069eaa7e9` pack/random/oracle fingerprint. One existing tracked
metric remains off target. Runtime is 49.7 seconds before and 50.1 seconds
after; no speed improvement is claimed under shared machine load.

An additional paired friendsPack probe uses seeds 9-12, 400 personas and
eight weeks. All **2,701** relationship timestamps are wrong before, including
27 independent-crew events, and none are wrong after. The largest early
timestamp error is **145 hours**, falling to zero. This run spans the local
daylight-saving transition; the existing slot-time helper supplies the actual
instants.

For each of those four seeds, a SHA-256 digest of the full flow, meetup,
contact, value-day and metric records is identical before and after. The
comparison deliberately excludes relationship timestamps, which are the
field being corrected. This is deterministic synthetic evidence, not an
estimate of production frequency or a claim of improved matching quality.

## safety_gates

Every existing gate retains its value, including minor exclusion,
known-adversary contacts, harm, booking caps and conformance. The unchanged
quality figures include repeat rate 33.7%, V14 34.7%, friendship share 9.4%,
borough ratio 0.712178, and total harm 17.5 per seed versus random's 41.5.
The existing tracked undetected-harm miss remains unchanged at 1.67x random.

This changes simulator relationship metadata. It does not change production
matching, consent, delivery, access controls, prompts or member records. It
does not alter when the weekly batch exposes records or fix feedback
availability; those are separate concerns. No live messages were sent.

## Validation and companion work

- Typecheck: all four configurations pass.
- Integration, including the security suite: 675 passed, eight skipped and six
  failed; 13,741 assertions across 68 files in 540.20 seconds. The six failure
  names match the clean-base Windows failures: Wrangler's `/bin/bash`, boot's
  SIGTERM exit status, and four site-build path-separator checks. The eight
  skips require the optional cleanup-reconciliation flag. This suite is not green.
- E2E: 42 passed, one skipped and zero failed; 654 assertions in 70.58 seconds.
  The skipped browser SDK recovery case requires `PLAYWRIGHT_MODULE`.
- Isolated runtime combination with PR #364: **19/19** gates pass; all 7,955
  met events, including 15 independent-crew events, match their meetup times.
  The fingerprint is `00db135e530fef5e`, matching that earlier change. This
  uses this PR's qualification script, not #364's separate added gate.
  When merging, retain both gates and resolve the overlapping self-crew call
  by keeping #364's booking checks/reservations and passing `slot` to `held`.
- Full default simulation was not repeated: AGENTS.md permits one full run
  per agent, already consumed earlier in this contribution session. Only the
  affected Friends block is claimed for this revision.

Environment: Windows x64, Bun 1.4.2, PostgreSQL 16.15 on isolated local port
54339. Dependencies and hooks were audited; the frozen install is unchanged
on this base. Provider keys and live-send/deploy flags are absent from the
test processes.

To reproduce, add the new gate on the base and run the command above. Expect
7,734 incorrect timestamps. Apply the runtime fix and repeat: expect zero
incorrect or missing events and 19/19 blocking gates passing. Then run
typecheck, integration and E2E with local Postgres. The gate covers the
existing booking path and independent crews through real matcher workflows.

## llm_evidence

Real-model calls: 0; cost: 0. This is deterministic simulator event metadata;
no model-backed decision, generated voice, classifier or prompt change. No
real-LLM qualification is claimed.

## agent_clients

Codex desktop 26.1029.7803.0 drove the commands and GitHub connector/CLI directly,
without computer use. Authoring provider: OpenAI; exact model identifier:
unavailable. Claude Code/Claude, ChatGPT member flow, Hermes Agent, OpenClaw,
Muse, Grok bot, elizaOS and Cursor were not tested. Member-facing connectors
are unchanged; no untested client result is claimed.
