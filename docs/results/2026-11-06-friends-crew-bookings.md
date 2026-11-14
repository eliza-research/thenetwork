# Independent crew meetups honor the weekly schedule

Date: 2026-11-06. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Scope: a reproduced simulator defect, under PRD 34.3 and 40.6/40.8 and the
approved Slop simulation-validation scope.

## Problem and cause

The Friends world promises weekly crew sessions, at most two booked meetups per
member per week, and never two bookings in one slot. Its independent-crew loop
ran after all platform proposals. A crew that completed its third session in
that round immediately became eligible for another session at the same weekly
time. The loop checked the number of platform bookings but not their slots, and
did not reserve capacity when it held an independent meetup.

For example, seed 5 put `f0096` in both `w7:0:crew_session` and
`self:crew_a4ed0370a8af:w7` at the same instant. Seed 7 put two people at their
ordinary platform plans and at `self:crew_a6d625a8b7ed:w5` in the same slot.
This creates impossible attendance and extra hours and relationship evidence.

The fix takes the list of already handed-off crews at the beginning of a week.
A crew graduating this week starts independent sessions next week. Independent
attendees then pass the existing `canBook` check, and a held session reserves
both their slot and weekly capacity in the same ledger as platform bookings.
Failed quorum does not reserve capacity. Sessions in later, free slots continue.

Alternatives considered:

- Check member slots alone: this can still record the same crew twice in its
  graduation week with disjoint attendees. The weekly crew lifecycle also needs
  to advance before independent sessions start.
- Delay the first independent session alone: that prevents graduation-week
  duplication, but later independent sessions still conflict with unrelated
  platform plans, as in seed 7. Both paths must use the same booking ledger.

This changes the local Friends world. PR #221 changes production Network crew
handoff based on attendance, in different files; it does not fix these simulator
bookings.

## measurement

One new blocking gate checks the actual platform bookings and independent
meetups from the existing pinned worlds. It checks member/slot collisions,
bookings beyond the weekly cap, and duplicate crew/week records. The full pinned
run must contain independent crew meetups, so disabling them all cannot pass.
No mock matcher or extra world is added to the gate.

The same command and final gate ran on the base runtime and the fixed runtime:

```sh
bun run sim --only friends --json /tmp/friends-crew-bookings.json
```

Settings: seeds 5, 6, 7, 8; eight weeks; 400 NYC personas; pack, random and oracle
arms. These are 12 real harness worlds with the same keyed draws and synthetic
members. The before run used an isolated checkout of the base with only this
branch's `scripts/sim/friends.ts` copied in, sharing the already installed frozen
dependencies. The runtime fix is absent from that checkout.

| Observation across 12 worlds | Before | After |
| --- | ---: | ---: |
| Independent crew meetups | 13 | 6 |
| Bookings that collide with another booking in the same slot | 9 | 0 |
| Additional sessions for a crew in the same week | 6 | 0 |
| Bookings beyond the weekly cap | 0 | 0 |
| Blocking gates | 18/19 | 19/19 |
| Runtime | 49.9 s | 51.4 s |

All 18 existing blocking gates pass before and after. Only the new gate fails on
the base. Of 22 total gate records, 18 are identical excluding timing fields;
the new gate, the fingerprint, and two quality values change. No thresholds
change. Runtime was measured under shared machine load, not as a speed claim.

| Existing quality value | Before | After |
| --- | --- | --- |
| Repeat-meetup rate | 33.7% | 33.7% |
| V14, rounded | 34.7% | 34.7% |
| V14 relative to oracle / random | 0.83x / 2.05x | 0.82x / 2.05x |
| Members with friendship forming | 9.4%, 3.9x random | 9.3%, 3.8x random |
| Median maximum group travel | 26.9 min | 26.9 min |
| Minimum eligible borough V14 ratio | 0.71 | 0.71 |

The metrics fingerprint changes from `e5bf70e069eaa7e9` to `00db135e530fef5e`.
These deterministic checks establish bookkeeping correctness; small quality
differences are not claims of statistical significance or production impact.

An independent pack-only replay with the same settings counts actual attendance
collisions (rather than every booked slot, including no-shows):

| Seed | Total meetups before / after | Independent meetups before / after | Attendee slot collisions before / after |
| --- | --- | --- | --- |
| 5 | 203 / 200 | 4 / 1 | 2 / 0 |
| 6 | 191 / 191 | 0 / 0 | 0 / 0 |
| 7 | 193 / 191 | 7 / 5 | 2 / 0 |
| 8 | 191 / 189 | 2 / 0 | 4 / 0 |

The same four pack seeds extended to 12 weeks have 21 attendee slot collisions
before and zero after; independent meetups remain (37 before, 19 after). This
longer replay checks collisions only, not 12-week quality qualification.

Control: seed 5, 400 personas, eight weeks, `ARMS["pack-no-crews"]`. Before and
after: zero crews, zero independent sessions and 194 meetups. SHA-256 of
`JSON.stringify({flows: r.flows, meetups: r.meetups, contacts: r.contacts,
hours: [...r.world.hours], metrics: friendsMetrics(r)})` is identical:
`1b0acbfdff88d8d30ff2a9ba041747dc2365c24d7db7bf88edac82ced2358758`.

## safety_gates

Every existing safety value is unchanged. Declared-minor proposals and contacts
remain zero; known-adversary contacts remain zero. Total harm remains 17.5 vs
41.5 per seed (0.42x random, passing). The existing tracked undetected-harm miss
also remains unchanged: 17.5 vs 10.5 (1.67x random). No claim is made that this
tracked miss is fixed. Consent, blocks, member-facing leak checks, minor-role
checks, no-romance checks and the known-adversary conformance gate all pass.

## Validation

- `bun run typecheck`: exit 0 across all four TypeScript configurations on the
  final runtime and gate.
- `bun run sim --only friends --quick`: 13/13 blocking gates, nine tracked,
  three tracked misses, 8.8 seconds. Seed 5 / 200 personas / four weeks produces
  no independent crew sessions; the full pinned run is the non-vacuous proof.
  Quick-only misses are total harm (0.54x random), undetected harm (1.75x random),
  and four-week repeat-with-handoff (0%).
- `bun run test:integration`: 675 pass, 8 skip, 6 fail, 13,741 assertions across
  68 files, 555.16 seconds. The failure names match the previously reproduced
  Windows failures on the same base: Wrangler `/bin/bash` ENOENT, backend SIGTERM
  exit code 143 vs expected 0, and four site-build path assertions using Windows
  backslashes. These remain unresolved; integration is not green. The eight
  skips are the optional cleanup-reconciliation group, enabled separately with
  `NETWORK_RETRY_RECONCILIATION_TEST`.
- `bun run test:e2e`: 42 pass, 1 skip, 0 fail, 654 assertions, 85.31 seconds on
  the final runtime. The optional browser-SDK case requires `PLAYWRIGHT_MODULE`.
- The security file list is included in `test:integration`, so it is not run
  again separately. These broader suites cover the shared services; the new
  simulation gate directly exercises the changed standalone world.
- The full default simulation was not repeated. AGENTS.md allows one full run
  per agent, already used in this contribution session. The affected Friends
  block was measured before and after; no full-suite result is claimed here.

For a reproduction, keep the final `scripts/sim/friends.ts` and use the base
version of `packages/sim/src/apps/friends/world.ts`. The command above must fail
only the new blocking gate with the before counts. Restore the fixed world and
repeat: all 19 blocking gates pass with zero booking and crew-week conflicts.

## llm_evidence

N/A: this is a deterministic local simulator with no model calls, prompts,
provider changes, judge changes or member conversations. Real-model calls: 0;
model cost: 0. No real-LLM result is claimed.

## agent_clients

Executed with Bun 1.4.2 on Windows x64 from Codex desktop 26.1029.7803.0.
Authoring provider: OpenAI; exact model identifier unavailable in this client.
No member-facing client workflow changed. Claude Code, ChatGPT, Hermes Agent,
OpenClaw, Muse, Grok bot, elizaOS and Cursor were not tested; no compatibility
claim is made. GitHub access used the connector and CLI, without computer use.

The implementation and report were authored with an AI assistant. Synthetic
populations and measurements came from the repository's real simulation harness.
