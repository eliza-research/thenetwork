# Keep missing venue listings from consuming friends tables

## Requirement and cause

PRD 40.6 requires friends groups at public venues. This fixes a reproduced
planner defect within that scope. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

The activity-first builder reserves people for an activity with no listed venue.
The resulting plan has no area, so `planToProposal` drops it. Those reservations
prevent some people from joining another activity that does have a venue.

Require a NYC venue listing for an activity before building its table. This
uses the supplied catalog, before reservations. It adds no venues or policy settings.

Alternatives:

1. Remove invalid plans after building every table. The reservations still hide valid alternatives.
2. Reject every plan without a selected venue in `finish`. This broader attempt failed three gates, as reported below.

## measurement

Same command before and after:

```sh
bun run sim --only friends --json friends-venue.json
```

The new gate uses 160 generated people, seed 101, and three weeks of random-baseline
history. It reads the next weekly snapshot. Crews, repeats and partner introductions
are disabled for this fixture only. All other planner settings keep their defaults.
Compare empty, dinner-only and complete venue catalogs. These are hand-written
catalog variants, with generated people and identical history before and after.

| Catalog, seed 101 | Before | After |
|---|---:|---:|
| Empty: plans without venues | 17 | 0 |
| Dinner-only: plans without venues | 11 | 0 |
| Dinner-only: usable dinner proposals | 7 | 11 |
| Complete: usable proposals | 16 | 16 |
| Blocking gates | 18/19 | 19/19 |

The same replay on fresh seeds 102–104 confirms the dinner improvement:

| Seed | Before | After |
|---|---:|---:|
| 102 | 10 | 15 |
| 103 | 11 | 14 |
| 104 | 9 | 14 |

For fresh-seed replay, use the gate's setup with seeds 102–104. Record the proposal
counts without the seed-101-specific assertions. Complete catalogs retain 16 usable proposals per seed.
Empty catalogs produce no plans after the fix. This is deterministic replay,
not a statistical claim about attendance or production outcomes.

Official evaluation: seeds 5–8, eight weeks, 400 people, pack/random/oracle arms.
All 21 existing gate records retain their values, excluding runtime. The fingerprint
stays `e5bf70e069eaa7e9`. Repeat rate stays 33.7%; V14 stays 34.7%; median maximum
travel stays 26.9 minutes. Runtime: 43.9 seconds before, 43.1 seconds after.

### Attempts

The first attempt rejected every plan without a selected venue inside `finish`.
It recovered the fixture proposals but changed ordinary full-catalog planning.
Repeat rate fell to 26.2%. The borough ratio failed at 0.70, with a worst seed
of 0.50. Harm events rose to 22.0 versus 41.5 per seed, failing the 0.5x gate.
Only 16/19 blocking gates passed. That attempt was removed.

The final change checks only missing activity listings before table construction.
It preserves every official gate value. No floors or safety thresholds were changed.

## safety_gates

Declared-minor contacts and known-adversary contacts remain zero. Blocks, consent,
leaks, romance exclusion and minor-role conformance pass. Harm events remain
17.5 versus 41.5 per seed, or 0.42x. The existing tracked undetected-adversary
metric remains off target at 1.67x. Review is simulated; all people are synthetic.

## Validation

Windows, Bun 1.4.2, frozen lockfile, PostgreSQL 16.15 on loopback port 54339.
Database commands use `USER=postgres`, `REQUIRE_PG=1` and the local `PG_BIN_DIR`.

- `bun run sim --only friends`: 19/19 blocking gates pass; one existing tracked miss.
- `bun run typecheck`: all four configurations pass.
- `bun run test:integration`, including security: 675 pass, 8 skip, 6 fail;
  13,741 assertions; 566.27 seconds.
- `bun run test:e2e`: 42 pass, one optional skip, zero failures;
  654 assertions; 78.64 seconds.

The eight integration skips require the separate cleanup-reconciliation opt-in.
The six failures reproduce the known Windows limits: absolute `/bin/bash` in
`deploy/wrangler.integration.test.ts`, SIGTERM exit 143 instead of 0 in
`deploy/backend/backend.test.ts`, and four slash-versus-backslash assertions in
`sites/test/sites.test.ts`. These files are unchanged. Integration is not claimed to pass.

AGENTS.md permits one full simulation per agent. That run was already used for
#136. Only the changed friends block was rerun here. Linux CI must still run
the full matrix. The PR stays draft pending CI.

## llm_evidence and agent_clients

This deterministic planner change does not change model-backed behavior, prompts,
client protocols or authentication. Zero validation model calls and cost.
No client acceptance run is claimed. Authoring: Codex desktop 26.1021.3705.0,
OpenAI `gpt-6-astra`, operator-identified.

## Reproduce and limits

Install with `bun install --frozen-lockfile`. Run the friends command above.
Expect 19/19 blocking gates. Apply only the new gate to base `a0ed7bc`; it fails
with seven usable dinner proposals instead of more than seven.

This corrects missing activity listings. It does not resolve opening-hours or
travel failures for listed venues. For example, complete-catalog seed 102 still
has one unplaced plan before and after. No stored data, UI or member copy changes.
