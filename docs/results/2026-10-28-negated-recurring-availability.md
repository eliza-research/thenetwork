# Keep refused recurring windows out of availability

Date: 2026-10-28; updated 2026-10-29. Repository: eliza-research/thenetwork.
PR base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Latest paired baseline: published PR head `4607cbb6d20e51cfe37323eebf20bf72a735be10`.
Tested code: `1cdb56ee529c4d21678b38f7da2cf6012baf3806`. Combined code: `e429ac726d2cc083e2f9749249c35f0c2637b408`.

This report describes the current implementation. The [previous report](https://github.com/startrack3r/thenetwork/blob/4607cbb6d20e51cfe37323eebf20bf72a735be10/docs/results/2026-10-28-negated-recurring-availability.md)
preserves the original main comparison and each earlier review follow-up.

## Requirement, cause and implementation

The approved scope permits reproduced bug fixes. The availability design in
`docs/design/2026-10-07-experience-design.md` section 1.11 uses stated windows
when selecting meeting times.

Main saves refused day groups as availability. For example, "Tuesday evenings,
not weekends" adds weekend windows. An offered group also restores a refused
named day: "weekdays except Tuesday" still adds Tuesday. The generic evening
fallback can restore refused weekdays. Earlier commits in this PR repair those
paths using the existing refusal detector and conservative fallback guards.

The latest follow-up fixes times of day. "Weekday mornings, not evenings" saves
both mornings and evenings. "Weekends, not mornings" saves only mornings. These
values survive JSON reload and cause the scheduler to favor the refused time.
The part-of-day loop treated every matching word as a positive offer.

Keep each part's refusal flag while associating it with the existing day group.
Collect offered parts and defaults, then subtract refused parts from those days.
A leading refusal applies to the eventual windows. A part immediately after
a refused named day retains the existing named-day exception interpretation;
"weekends except Sunday mornings" does not refuse every morning.
Keep the earlier group guards, named-day subtraction and generic fallback policy.

Alternatives considered:

1. Skip refused part tokens. This lets day defaults restore the same time and
   can lose a leading offered part, such as "mornings on weekdays, not evenings".
2. Remove a refused part from every day. This would also remove an evening
   explicitly offered for another day. Keep refusals attached to their day group.
3. Drop the whole statement. This loses useful offered mornings or afternoons.

No new schema, dependency, message copy, model prompt or client contract.
Stored historical patterns are not rewritten.

## measurement

The single existing blocking gate now has **53 phrases x three seeds = 159
workflows**. It retains the previous 35 phrases and adds 18 daypart cases:
13 failures and five controls at the previous head. Seeds are **1, 2 and 3**.

Each case uses the real `ConsentNetwork.onInbound` handler, an adult selected
from a 120-member generated world, and a synthetic channel and clock. It sends
the availability statement, JSON-round-trips the Network into a fresh instance,
reads saved tags through `standingFromFacets`, and scores slots with
`availabilityProb`. Matching is disabled in this fixture; review remains human.
Policy outputs are not mocked. No live messages are sent.

Cases cover refused groups, named-day exceptions, explicit and default dayparts,
leading offered parts, a refusal after the part, and night/after-work synonyms.
The statement clock is `2026-10-05T16:00:00Z`. Checked slots are October 10-13,
2026, at 10:00, 14:00 or 19:00 New York time. These are scheduler probabilities,
not measured attendance rates or population estimates.

| Observation | Previous published head | Fixed |
|---|---:|---:|
| Correct complete workflows | 120/159 | 159/159 |
| Refused slots scored above their unstated prior | 39 | 0 |
| Earlier regression rows preserved exactly | 105 | 105 |
| Already-correct rows preserved exactly | 120 | 120 |
| Offered slots measured | 69 | 69 |

Of the 69 offered-slot scores, **60 are identical and nine improve**. None falls.

| Statement and scored slot | Before | After | Unstated prior |
|---|---:|---:|---:|
| Weekday mornings, not evenings: Tuesday 19:00 | 0.750 | 0.210 | 0.350 |
| Same statement: Monday 10:00 | 0.700 | 0.700 | 0.100 |
| Weekends, not mornings: Sunday 10:00 | 0.770 | 0.270 | 0.450 |
| Same statement: Saturday 14:00 | 0.270 | 0.770 | 0.450 |
| Weekdays, not evenings: Tuesday 19:00 | 0.750 | 0.350 | 0.350 |

The last case leaves no positive pattern. It does not create a hard refusal
record or lower the score below the prior. "Most evenings, not after work"
likewise creates no new pattern.

Same command on the previous head plus expanded gate and on the fixed code:

```sh
bun run sim --only network --only evals --json <results.json>
```

Before: **86/87** blocking gates, 241.6 seconds. After:
**87/87**, 240.6 seconds. Both have zero tracked misses.
The before gate fails with `expected 120 to be 159`. All **88 other
gate records are identical**, excluding runtime. No threshold or invariant was
weakened. This fresh comparison starts from the previous published PR head;
the historical report contains the earlier main comparisons.

A supplemental parser check preserves 128 generated positive phrases and
passes four scoped-refusal checks. The positive phrases combine eight day
expressions with four part expressions, before/after the day and followed by
another day. This is a compatibility check, not the workflow evidence above.

## safety_gates and combined compatibility

Combined locally with the other **38 contributions**, the affected command
passes **92/92** blocking gates, zero tracked misses, in 263.7 seconds.
All 159 outcome rows match the standalone fix. All **93 other combined
records** retain their values against the preceding availability follow-up.
Both production and the existing regression gate merged cleanly. The combined
branch stays local; this PR independently targets main.

```sh
bun run typecheck
REQUIRE_PG=1 bun run test:integration
REQUIRE_PG=1 bun run test:e2e
```

- All four typecheck configurations pass on standalone and combined branches.
- Integration includes all 11 files from `bun run security`: **675 pass,
  8 skip, 6 known Windows failures**, 13,741 assertions, 689 tests in 68 files,
  508.65 seconds. Failure names match the latest isolated run (#200):
  Wrangler requires `/bin/bash`, SIGTERM exits 143 instead of 0, and four site
  tests compare Windows and POSIX paths. These are not passing tests.
- E2E: **42 pass, 1 optional browser skip, 0 fail**, 654 assertions,
  43 tests in three files, 46.42 seconds. The integration skips are
  opt-in retry-reconciliation tests; the browser skip lacks its optional module.
- Windows, Bun 1.4.2, frozen dependencies, PostgreSQL 16.15 on local port 54339.
  `PG_BIN_DIR`/`PATH` select binaries; `USER=postgres` and
  `OBSERVATORY_PG_DIR`/`OBSERVATORY_PG_PORT` select the test cluster.
- No fresh paired baseline integration run. All security files ran within
  integration. The full-simulation allowance was used earlier; this is not a
  fresh full-suite or hosted Linux CI pass.

## llm_evidence and agent_clients

Zero validation model calls/$0; this is deterministic parsing and scheduling.
No external-agent client acceptance claim. Authoring client: Codex desktop,
OpenAI `gpt-6-astra`; app version not collected. Other clients were not tested.

## Reproduction and limits

1. Check out `4607cbb6d20e51cfe37323eebf20bf72a735be10` separately.
2. Load `scripts/sim/network.ts` from `1cdb56ee529c4d21678b38f7da2cf6012baf3806`.
3. Run the affected command. Expect 86/87 and `expected 120 to be 159`.
4. Load `packages/network/src/classify.ts` from the same code commit and repeat.
5. Expect 87/87; `AVAILABILITY_REFUSAL_OUTCOMES` has 159 correct rows.

This retains the existing clause grammar and conservative named-day policy.
"Most evenings, not Tuesday" still records no new pattern. Named-day exceptions
operate at day granularity, not arbitrary partial-day natural-language scope.
Standing availability remains a decaying prior, not a calendar ban. A statement
with no positive window does not clear a historical pattern. No migration,
live sends or deployment. Draft pending maintainer review and hosted CI.
