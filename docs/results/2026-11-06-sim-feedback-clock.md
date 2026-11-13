# Weekly planners only see feedback that has arrived

Date: 2026-11-06. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Scope: reproduced simulator defects, under PRD 34.3 and 40.5/40.6/40.8 and the
approved Slop simulation-validation scope.

**Draft for maintainer review:** all 58 affected blocking gates pass, but the
corrected Friends timing reduces measured quality and raises the simulated harm
estimate. This is not a claim that every safety value remains unchanged. The
existing thresholds and reply delays are retained.

## Problem and cause

Both weekly worlds generate post-meetup feedback 20 hours after the meetup.
Sunday feedback can therefore arrive after the next Monday planner: up to six
hours late in Friends (09:00 local planning), or three hours in Slop (12:00 UTC
planning). Their snapshots copied every feedback row, including future rows.

Friends also copied positive post-plan answers into outcomes immediately and
dated `would_interact_again` edges at the meetup, before the answer arrived.
Filtering only the feedback array would leave the same information available
through those derived signals. The planner can use those positive answers for
repeat plans and crew offers.

The fix filters both feedback projections by `at <= state.now`. Friends dates
the derived relationship edge at the answer's time and projects only edges whose
time has arrived. Its outcome projection withholds a member's positive answer
while that member's reply for the same plan remains in the future. The source
records stay queued, and the attended meetup retains its original time.

Alternatives considered:

- Filter feedback rows alone: future positive outcomes and relationship edges
  would still inform Friends plans before receipt.
- Move the planner later or shorten the 20-hour reply delay: this changes the
  model's schedule to avoid the defect. Applying the existing clock to every
  feedback-derived signal preserves the documented timing assumptions.

## measurement

One new blocking gate uses the actual Friends and Slop matchers and weekly
harnesses. It observes their snapshots without changing proposals. The Friends
run uses seed 5, 400 personas, eight weeks; Slop uses seed 13, 150 personas per
city, four weeks. These runs also inspect source records to ensure feedback is
still pending, and check snapshot views at one millisecond before a reply and
exactly at its receipt time.

| Timing regression, same seeds/settings | Before | After |
| --- | ---: | ---: |
| Pending Friends feedback records encountered | 259 | 299 |
| Pending Slop feedback records encountered | 7 | 7 |
| Future feedback rows exposed to matchers | 266 | 0 |
| Friends positive answers exposed before receipt | 50 | 0 |
| Relationship edge timestamp/visibility violations | 2,106 | 0 |
| Receipt boundaries exercised | 9 | 9 |
| Receipt boundary failures | 9 | 0 |

Edge violations count observations across weekly snapshots, not unique people or
edges. A derived edge must have a corresponding affirmative feedback record at
its creation time and cannot be exposed before that time. Pending row counts can
change because the corrected information changes subsequent match decisions.
Both apps still generate pending feedback after the fix; records and positive
answers become visible at the inclusive receipt boundary, not earlier or never.

The same full affected-block command ran before and after:

```sh
bun run sim --only slop,friends --json /tmp/sim-feedback-clock.json
```

Before: base runtime with the final new gate, **57/58 blocking gates**, nine
tracked misses, 93.1 seconds. Only the new timing gate fails.
After: **58/58 blocking gates**, nine tracked misses, 88.7 seconds.
No runtime-speed inference is made under shared machine load.

Pinned qualification uses Slop seeds 13-16, four weeks, 300 personas per city,
random and pack arms; Friends seeds 5-8, eight weeks, 400 NYC personas, pack,
random and oracle arms. Existing controls, conformance and Slop's service-world
arm also run. Populations and oracle draws are synthetic and deterministic.
There are no model calls, live messages or production people in these runs.

Of 79 gate records, 69 remain identical excluding timing fields. Only the new
gate and nine Friends records change. Slop's existing metrics and gate values
are unchanged, including fingerprints `445afd705328fe54` (pack/random) and
`eaeaf7bbe8c99c81` (service-world runs). Friends' fingerprint changes from
`e5bf70e069eaa7e9` to `f297c6c7e3d4c8c1`.

| Friends value | Before | After |
| --- | --- | --- |
| Repeat rate, floor 30% | 33.7% | 30.1% |
| V14 | 34.7% | 33.4% |
| V14 vs oracle / random | 0.83x / 2.05x | 0.79x / 1.97x |
| Friendship forming vs random | 9.4%, 3.9x | 8.0%, 3.3x |
| Median maximum group travel | 26.9 min | 27.5 min |
| Minimum eligible borough V14 ratio | 0.71 | 0.88 |
| Repeat rate including crew handoffs | 34.3% | 30.7% |

These changes demonstrate dependence on premature information in the old model;
they do not establish production effects or statistical significance. Weekly
planning means an answer arriving just after Monday's run is used at the next
weekly run. Changing that cadence is outside this correction.

## safety_gates

The declared-minor, known-adversary, consent, block, leak, hard-filter and other
existing blocking checks pass. Slop's safety values are unchanged. Friends'
declared-minor proposals/contacts and known-adversary contacts remain zero.

**Friends harm values increase.** Total harm moves from 17.5 to 19.3 events per
seed against the same random baseline of 41.5: 0.42x to 0.46x, still below the
blocking 0.5x ceiling. The already-failing tracked undetected-harm comparison
worsens from 1.67x to 1.83x random (random baseline 10.5). No threshold was changed
to accommodate these results. Maintainers need to assess these model changes
before accepting the draft.

## Validation and limits

- `bun run typecheck`: exit 0 across all four configurations.
- `bun run test:integration`: 675 pass, 8 skip, 6 fail, 13,741 assertions across
  68 files, 562.01 seconds. Failure names match the previously reproduced Windows
  failures on the same base: Wrangler `/bin/bash` ENOENT, backend SIGTERM exit
  code 143 vs expected 0, and four site-build path assertions with Windows
  backslashes. These remain unresolved; integration is not green. The optional
  cleanup-reconciliation group requires `NETWORK_RETRY_RECONCILIATION_TEST` and
  accounts for the eight skips.
- `bun run test:e2e`: 42 pass, 1 skip, 0 fail, 654 assertions, 102.06 seconds.
  The optional browser-SDK case requires `PLAYWRIGHT_MODULE`.
- The security file list runs in `test:integration`; it is not repeated.
- The full default simulation is not repeated: AGENTS.md permits one full run
  per agent, already used in this contribution session. Only the affected Slop
  and Friends blocks are claimed for this change.
- Combined check with PR #364 (crew bookings, `a5ebca70a000740f85570e353642f739cf814dbb`):
  the same affected-block command passes 59/59 blocking gates, nine tracked
  misses, 89.4 seconds. Both regression gates pass; five independent crew
  meetups remain, with zero booking or crew-week conflicts. Relative to this fix
  alone, rounded V14 is 33.3% and friendship-forming share is 7.8% (3.2x random);
  repeat rate and harm values are unchanged. The Friends fingerprint is
  `5bac72efbd29f2b5`. This was an isolated local combination; this PR stays based
  directly on main and does not include PR #364's changes.

To reproduce, use this branch's `scripts/sim/slop.ts` with the base versions of
the three changed runtime files (`friends/world.ts`, `friends/snapshot.ts`, and
`slop/snapshot.ts` under `packages/sim/src/apps`). Run the command above and
expect only the new blocking gate to fail. Restore the fixed runtime and repeat:
the gate passes, while the quality and harm changes above remain visible.

## llm_evidence

N/A: this is local simulator clock/projection logic. It changes no prompt,
provider, language-model judge or member conversation. Real-model calls: 0;
cost: 0. No real-LLM qualification is claimed.

## agent_clients

Bun 1.4.2 on Windows x64, driven from Codex desktop 26.1029.7803.0. Authoring
provider OpenAI; exact model identifier unavailable in this client. No client
onboarding or member flow changed. Claude Code, ChatGPT, Hermes Agent, OpenClaw,
Muse, Grok bot, elizaOS and Cursor were not tested; no client compatibility claim
is made. GitHub operations used the connector and CLI, without computer use.

The implementation and report were authored with AI assistance. The repository's
real harness generated the synthetic populations and recorded measurements.
