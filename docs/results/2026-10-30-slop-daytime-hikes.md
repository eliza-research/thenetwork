# Slop daytime hike scheduling — 2026-10-30

## Result and scope

When both members choose a hike and say they are free on Tuesday evenings, main can offer
"a daytime hike, Tuesday 7pm" and book that evening after their mutual yes. Filter hiking
dates to the existing `sat_day` and `sun_day` slots before selecting the best options.

Reproduced defect under Slop's approved scope and PRD 40.5: the anonymous probe, mutual
consent and booked first date. The existing activity table calls hikes daytime, and the
service's activity phrase already says "a daytime hike". No copy or UI change.

- Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
- Code and the one new regression gate: `f9ee13016de213e666292d5a25cf2c875fa1af1e`.
- Combined code: `2c947bf736e25d343d3f9a54e874cde1be9e00e2`, local only.
- Installed contribution skill: `cfca47acd13527a0f74bec818bcb0d8956a9403d-r5`, registry revision 5.

## Cause and implementation

`planFirstDate` picks the activity, ranks all nine weekly slots by the two members'
availability scores, then takes three. It never checks whether those slots suit a hike.
Both the service hooks and the dating-world matcher call this planner. In the live hooks,
an evening selection can also substitute a lit market venue for the promised daytime hike.

The fix adds one filter to the common planner. Hiking keeps the same scores and tie-breaks
within the two daytime slots. Other activities keep the same candidates. This avoids
separate service/simulator policies. A score penalty could still select an evening, and
changing the activity would disregard the members' stated date idea.

## measurement

The same final gate ran before and after with `bun run sim --only slop --json <output>`.
It uses the existing `Mini` harness with the real `ConsentNetwork`, production Slop wiring,
rules-based onboarding, profile facts, shared planner, probes and booking. Proposals are
staff-composed and held for human review, then approved by a synthetic reviewer. All members
are synthetic consenting adults. The recording channel sends nothing to real people.
There is no HTTP or PostgreSQL claim for these 42 focused cases.

Seven cases × seeds 1, 2, 3 × two New York clock offsets (2026-10-05 and 2026-11-30):
hikes with mixed availability, Sunday preference, unknown availability, evening-only
availability, and a decline; coffee and climbing controls. All use explicit date-activity
language at intake. The same JSON restart path runs after onboarding, after the first
probe, and after the reply/booking. The gate checks exact planned slots, local offered
hours, local booked hours, no probe before approval, two yeses before booking and no booking
after a decline. Sunday preference still ranks Sunday first in the planner; the existing
probe composer puts concrete dates in chronological order.

| Outcome | Before | After |
|---|---:|---:|
| Correct complete cases | 12/42 | 42/42 |
| Hike cases with daytime-only options | 0/30 | 30/30 |
| Evening hike bookings | 18 | 0 |
| Completed bookings | 36 | 36 |
| Declined hikes booked | 0/6 | 0/6 |
| Unchanged coffee/climbing controls | 12/12 | 12/12 |

Example: Tuesday evening plus Saturday afternoon availability previously produced
Tuesday 7pm, Saturday 2pm and Saturday 7pm. After the fix it produces Saturday 2pm
and Sunday 2pm. Two plain yeses previously booked Tuesday 7pm; now they book Saturday 2pm.

The full affected Slop block changes **39/40 → 40/40** blocking gates
(61.6s → 73.9s). Of 58 records, **56 existing records are identical**.
The new gate passes, and the aggregate arm fingerprint changes from `445afd705328fe54`
to `18b5e29345b8747c`.

To resolve that fingerprint change, the same `runArm` calls were also saved in full on
base and fixed planner source: random and Slop, seeds 13–16, four weeks, 300 people per
city, the pinned population/world/rater options. The saved JSON hashes match the CLI
fingerprints. Only five raw numbers change, all in Slop seed 13:

| Raw metric | Before | After |
|---|---:|---:|
| Delivered probes | 1814 | 1813 |
| Probe reply rate | 0.7971334068 | 0.7981246553 |
| Probe yes rate | 0.4128996692 | 0.4125758411 |
| Top 10% probe share | 0.1867435159 | 0.1868512111 |
| Probe Gini | 0.3089737134 | 0.3093948710 |

All other raw results, including dates, safety counts, fairness outcomes and the random
arm, are identical. This is a scheduling correction, not a claim of improved match quality.
One production implementation was tested; no threshold or fixture expectation was tuned
after the paired reproduction.

## safety_gates and compatibility

`REQUIRE_PG=1 bun run sim --only safety --json <output>` passes **17/17** on both sides,
with all 17 records identical (15.2s / 16.3s).
All existing Slop safety and quality gate values remain unchanged. Eight existing tracked
misses remain: age-liar contact cut 76.5%, adversary contact cut 45.4%, second-date ratios
1.733/1.676, lowest-group ratios 0.506/0.603, back-outs 0.122, and four overlong probes
out of 342. The source policy and gate levels are unchanged.

Combined locally with the existing **41 contribution PRs**: **46/46** Slop blocking gates,
seven existing tracked misses, 56.6s, and all 42 focused outcomes identical
to standalone. All **62 non-fingerprint records** from the preceding saved combined Slop
run (`other-absence-combined.json`) remain identical. Production code merged cleanly;
test import/insertion conflicts were resolved by retaining every earlier gate and adding
this gate. The combined branch is never pushed.

All four typecheck configurations pass standalone and combined. Full service suites ran
sequentially on the combined branch against PostgreSQL. Integration includes all 11 security-suite files:

```text
684 pass
8 skip
6 fail
14439 expect() calls
Ran 698 tests across 70 files. [818.38s]
```

The same six failure names occur in the preceding #208 run: absent `/bin/bash`, SIGTERM
exiting 143 rather than 0, and four Windows/POSIX site-path comparisons. They remain
failures. This run includes nine passing cases from two existing combined-branch files
absent from the preceding log: `feedback-order.integration.test.ts` and
`dev-pg.integration.test.ts`; no test was added there in this change. The eight skips need
the separate retry-reconciliation opt-in. No fresh paired main integration run was made.

`REQUIRE_PG=1 bun run test:e2e`:

```text
42 pass
1 skip
0 fail
654 expect() calls
Ran 43 tests across 3 files. [40.05s]
```

The optional browser case needs `PLAYWRIGHT_MODULE`. Environment: Windows, Bun 1.4.2,
frozen dependencies, PostgreSQL 16.15 on port 54339. `PG_BIN_DIR`/`PATH` select local
binaries; `USER=postgres` and `OBSERVATORY_PG_DIR`/`OBSERVATORY_PG_PORT` select the cluster.

## llm_evidence and agent_clients

Zero validation model calls/$0. The changed path and intake fixture are deterministic.
No real-LLM or external-client acceptance claim. Authoring: Codex desktop, OpenAI
`gpt-6-astra`; app version not collected. Claude Code, ChatGPT, Hermes, OpenClaw, Muse,
Grok, elizaOS and Cursor were not tested as clients.

## Reproduce and limits

1. Check out base `a0ed7bc6495d9e524afc3d500738212a28dc7bc2` separately and run `bun install --frozen-lockfile`.
2. Copy `scripts/sim/slop-live.ts` from code `f9ee13016de213e666292d5a25cf2c875fa1af1e`.
3. Run `bun run sim --only slop --json before.json`: expect 39/40 and 12/42 correct
   `daytime hike outcomes` rows.
4. Copy `packages/engine/src/packs/slop/plan.ts` from the same code commit and repeat:
   expect 40/40 and 42/42 correct rows, with zero evening hike bookings.

Availability remains a soft scheduling prior; a person who states only evening availability
can still receive daytime hike options and decline them. Both members must consent before
a date is booked. The existing slot model has daytime slots only at weekends. This does not
add weekday daytime options, assess weather/sunset/trail suitability, or rewrite already
offered or booked dates. It changes no existing gate threshold, age, review, consent, privacy or venue rule.
These are affected-block and local-service results, not a fresh full simulation or hosted CI pass.
