# Keep refused recurring windows out of availability

Updated 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Current code: `225658ae9e89bba5f6b57882247983f9bc1b2ac2`. Local combined code: `10430fd6ee955f79f75cab4e5fbae94d3097887d`.

## Requirement, cause and result

Reproduced bug under the approved Slop scope. Experience design section 1.11
requires stated availability to inform scheduling. Refusing a time must not
raise its availability estimate.

The original parser expanded offered day groups without subtracting named
refusals. It also treated refused parts of the day as offers. Fallback defaults
could restore a refused weekday or part. The current implementation checks group
refusals, subtracts named-day exceptions, guards the fallback, and subtracts
refused parts after applying defaults.

Explicit exclusion phrases had another path to the same defect. For example,
"I'm free on weekdays other than Tuesday" persisted all five weekday evenings.
After a JSON restart, the engine scored Tuesday evening at **0.750**, above
its **0.350** unstated prior. The fix scores it at **0.210** and retains
Monday's **0.750** score. The excluded day no longer receives positive availability evidence.

## Implementation and alternatives

In availability parsing, normalize `other than`, `apart from`, `aside from`,
and `barring` to the existing `except` rule when a recognized time follows.
Reuse the parser's day vocabulary, including supported abbreviations. The rule
also handles day groups and parts of the day, including an optional `on`.

A following non-time phrase, such as "barring emergencies", is left alone.
"Nothing other than Tuesday" remains a positive Tuesday window. Token positions
are calculated after normalization. Booking consent and probe parsing are unchanged.
No message copy, schema, prompt, dependency or client contract changes.

Alternatives considered:

1. Add these cues to the shared negation rule. That changes booking consent
   and probe interpretation, which this availability repair does not require.
2. Drop the whole statement. That loses the offered days or times too.
3. Skip refused tokens only. Group expansion and defaults can restore them;
   the existing subtraction stages must receive the refusal instead.

## Review and earlier evidence

[Review 5698616517](https://github.com/eliza-research/thenetwork/pull/160#pullrequestreview-5698616517)
approved the previous head `f215836d7c9cacf89e5a9b46023786908e345113` and independently confirmed
its named-day and daypart fixes. It identified the additional exclusion phrases.
This follow-up reproduces and repairs that reported defect. The approval was for
the previous revision, not this updated head.

[The pinned previous report](https://github.com/startrack3r/thenetwork/blob/f215836d7c9cacf89e5a9b46023786908e345113/docs/results/2026-10-28-negated-recurring-availability.md) retains the original main comparisons
and the named-day/daypart follow-ups. This report's new comparison starts at
that previous published head and adds cases to the same regression gate.

## measurement

One gate: `recurring availability: refused day groups are not saved as free time`.
It now has **75 phrases x seeds 1, 2, 3 = 225 workflows**. Each case uses the real
Network inbound handler, persists state through JSON, reloads it, and feeds the
saved standing pattern through `standingFromFacets` and `availabilityProb`.
Synthetic adults, `review: "human"`, matching disabled, recording channel;
no proposal approval or live message is needed for availability capture.

The original **159 rows** remain identical. The **66 added rows** cover four
exclusion phrases, named days, groups, dayparts, multiple refused days, an
abbreviation, optional `on`, and controls for unrelated exceptions and contrast.

| Metric | Previous head plus expanded gate | Fixed |
|---|---:|---:|
| Correct workflows | 180/225 | 225/225 |
| Refused slots boosted above their prior | 45 | 0 |
| Previously correct rows preserved | 180 | 180 |
| Original rows preserved | 159 | 159 |

For "weekday mornings other than evenings", Tuesday evening moves from
**0.750 to 0.210** while Monday morning remains **0.700**. Generic evening
statements with a refused weekday retain the existing conservative rule:
no new pattern, so the refused slot stays at its prior instead of being boosted.

A supplemental parser comparison preserves **128 positive phrases**, four
scoped-refusal cases, and 12 exclusion controls. These include "barring emergencies"
and "nothing other than Tuesday". Curated deterministic cases are not population
estimates. No statistical significance or performance claim.

Same command, settings and data before and after:

```sh
bun run sim --only network --only evals --json <results.json>
```

Previous head plus expanded gate: **86/87**, 221.6 seconds.
Fixed: **87/87**, 229.4 seconds. Zero tracked misses.
All **88 other gate records** are identical, excluding runtime.

## safety_gates and combined compatibility

The affected command includes the Network's privacy, consent, minor-protection,
review and send-time policy gates, plus all parser corpora. Their values and
thresholds remain unchanged. The shared consent and probe functions are unedited.

Combined locally with the other **39 contributions**, the same command passes
**93/93** blocking gates, zero tracked misses, 243.6 seconds.
All 225 workflow rows match standalone. All **94 other records** match
the Network/evals part of the previous combined #201 run. Both code and regression
merged cleanly. The combined branch stays local; this PR targets main independently.

## Validation, llm_evidence and agent_clients

```sh
bun run typecheck
REQUIRE_PG=1 bun run test:integration
REQUIRE_PG=1 bun run test:e2e
```

- All four typecheck configurations pass on standalone and combined branches.
- Integration includes all 11 security-suite files: **675 pass, 8 skip,
  6 known Windows failures**, 13,741 assertions, 689 tests in 68 files,
  537.19 seconds. Failure names match the preceding #201 run:
  Wrangler needs `/bin/bash`, SIGTERM exits 143 instead of 0, and four site
  tests compare Windows and POSIX paths. These are not passing tests.
  Skips are opt-in retry-reconciliation cases. No fresh paired baseline
  integration run.
- E2E: **42 pass, 1 optional browser skip, 0 fail**, 654 assertions,
  43 tests in three files, 44.82 seconds.
- Windows, Bun 1.4.2, frozen dependencies, PostgreSQL 16.15 on local port 54339.
  `PG_BIN_DIR`/`PATH` select binaries; `USER=postgres` and
  `OBSERVATORY_PG_DIR`/`OBSERVATORY_PG_PORT` select the test cluster.
- The full-simulation allowance was used earlier. These are affected-block
  results, not a fresh full-suite or hosted Linux CI pass.
- Zero validation model calls/$0; deterministic parsing and scheduling.
  No external-agent client acceptance claim. Authoring client: Codex desktop,
  OpenAI `gpt-6-astra`; app version not collected. Other clients were not tested.

## Reproduction and limits

1. Check out previous head `f215836d7c9cacf89e5a9b46023786908e345113` separately.
2. Load `scripts/sim/network.ts` from `225658ae9e89bba5f6b57882247983f9bc1b2ac2`.
3. Run the affected command. Expect 86/87 and `expected 180 to be 225`.
4. Load `packages/network/src/classify.ts` from the same code commit and repeat.
5. Expect 87/87 and 225 correct `AVAILABILITY_REFUSAL_OUTCOMES` rows.

Availability remains a decaying prior, not a hard calendar refusal. No positive
window means no new pattern; historical patterns are not cleared. Named-day
exceptions retain day-level scope. Bare `but` and `bar` exclusions, parentheses
or dashes as clause separators, and the conservative generic-weekday fallback
remain unchanged. This is not a general natural-language parser.
No live sends or deployment. Draft pending review and hosted CI.
