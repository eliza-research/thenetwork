# Keep Friends crew hosts among the invited members

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Tested code: `12323d76139ab998e4f63242f2b47369218566b6`. Combined code: `20ca4359600b211310401260dbf1176d9ef85322`.

## Requirement, cause and choice

PRD 41.6 requires recurring crews with a rotating host. PRD 40.6 requires repeat
Friends meetups near home. The existing planner can assign hosting to someone
who is absent from the invitation list. Pausing the next host reproduces this
for an existing crew session. A travel limit reproduces it for sessions and
first-session offers. The proposal then gives every invited member the guest
role, and no invitation receives the host's contribution effort category.

The session path filters eligible members but retains the original host order.
Both paths later filter invitees by travel tolerance without updating the host.
Choose the host after those filters. Start at the current position in the
original rotation, then take the first retained invitee. If no designated host
remains, rotate among retained invitees, matching the existing crew fallback.
Keep an already-valid current host. Leave the stored crew and its rotation intact.

Alternatives considered:

1. Drop a viable plan when its original host cannot attend. This loses a meetup
   that can use the existing fallback host policy.
2. Shorten the rotation before applying its session index. This can change a
   current host who remains invited, because earlier removals shift the index.
3. Repair only the early eligibility filter. This misses hosts removed later
   by their travel limit.

## measurement

One new blocking Friends gate runs **60 cases** on seeds **7, 13 and 17**.
Each case uses six synthetic adults, with hosting skills on the first three.
It builds the real engine snapshot, round-trips it through JSON, and invokes
the Friends weekly planner. It round-trips the resulting plan before calling
the real proposal and attention-item builders. Policy outputs are not mocked.

Each seed covers three existing-session rotation positions and a first-session
offer. Each position has five cases: no change, one paused host, one host with
a one-minute travel limit, all designated hosts paused, or all with that limit.
The fixture uses `v_restaurant_dinner_financial_district`, the normal NYC zone,
and the real eligibility and travel filters. The prior slot is
`2026-10-02T23:00:00Z`; planning runs at `2026-10-05T17:00:00Z`.
Unrelated new-table, repeat and partner paths are disabled for this focused case.

Every case checks the retained invitees, expected host, one proposal host role,
one contribution effort item, pending human review and unchanged source crew.
The all-hosts-excluded cases verify fallback rotation over the remaining members.

| Observation | Main plus identical gate | Fixed |
|---|---:|---:|
| Correct planner/proposal/effort cases | 30/60 | 60/60 |
| Plans whose host is absent from the invitees | 30 | 0 |
| Plans with no host role or contribution effort item | 30 | 0 |
| Already-correct outcome rows preserved | 30 | 30 |
| Invitee lists preserved | 60 | 60 |

These are hand-written deterministic cases, not population estimates.
They measure host assignment and effort accounting, not meetup success.

Same command and settings before and after:

```sh
bun run sim --only friends --json <results.json>
```

The existing population run uses seeds 5-8, eight weeks and 400 personas per
seed, with the pack, random and oracle arms. Its simulated reviewer remains
unchanged. Main passes **18/19** blocking gates in 51.8 seconds.
The fix passes **19/19** in 58.1 seconds. All **21 pre-existing
records are identical**, excluding runtime. The new gate is the only change.
Timings are not a performance claim.

## safety_gates and combined compatibility

Every pre-existing safety/conformance record retains its value. The existing
tracked harm miss also remains: undetected-adversary harm is **17.5 versus 10.5
per seed (1.67x)**, above the 0.5x target. This change does not claim to fix it.
The new case leaves every generated attention item pending human review.

Combined locally with the other **38 contributions**, Friends passes
**24/24** blocking gates in 62.5 seconds, with that same tracked miss.
All 60 new outcome rows match the standalone fix. All **26 prior combined
Friends records** retain their values against the #199 combined run.
Production merged cleanly; the simulation insertion conflict retained all
existing gates and aliased the engine proposal helper. The combined branch
stays local. This PR independently targets main.

## Validation, llm_evidence and agent_clients

```sh
bun run typecheck
REQUIRE_PG=1 bun run test:integration
REQUIRE_PG=1 bun run test:e2e
```

- All four typecheck configurations pass on standalone and combined branches.
- Integration includes all 11 files from `bun run security`: **675 pass,
  8 skip, 6 known Windows failures**, 13,741 assertions, 689 tests in 68 files,
  485.34 seconds. Failure names match the prior run: Wrangler requires
  `/bin/bash`, SIGTERM exits 143 instead of 0, and four site tests compare
  native and POSIX paths. The eight retry-reconciliation cases are opt-in.
- E2E: **42 pass, 1 optional browser skip, 0 fail**, 654 assertions,
  43 tests in three files, 45.78 seconds.
- Environment: Windows, Bun 1.4.2, frozen dependencies, local PostgreSQL 16.15
  on port 54339. `PG_BIN_DIR`/`PATH` select its binaries; `USER=postgres` and
  `OBSERVATORY_PG_DIR`/`OBSERVATORY_PG_PORT` select the test cluster.
- The full-simulation allowance was used earlier. These are affected-block
  results, not a fresh full-suite or hosted Linux CI pass.
- Zero validation model calls/$0. Host selection is deterministic, with no
  model-backed behavior or external-client acceptance claim. Authoring client:
  Codex desktop, OpenAI `gpt-6-astra`; app version not collected. Other clients
  were not tested.

## Reproduction and limits

Run the affected command and inspect `CREW_HOST_OUTCOMES`. All 60 rows must have
`correct: true`; main with the identical gate has 30 correct rows. The focused
planner/proposal case requires no database. Integration and E2E use PostgreSQL.

This fixes host selection when Friends generates crew sessions and offers.
It does not reassign hosts after later invitation replies or rewrite stored
plans. It does not change who is invited, venue choice, times, copy, budgets,
schemas or review policy. If all designated hosts are absent, the existing
fallback policy permits another retained member to host. No live sends or
deployment. Draft pending maintainer review and hosted CI.
