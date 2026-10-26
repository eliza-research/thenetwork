# Keep table time options inside venue opening hours

## Requirement and cause

PRD section 6 makes scheduling a first-class part of every opportunity, including
the proposed times and venue. On base `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`,
the Friends table builder chooses a venue that is open for the primary window.
It then replaces the venue-filtered options from `finish()` with the table's
earlier availability-ranked options. Those extra options can fall outside the
chosen venue's opening hours. `planToProposal` forwards them to the consent
simulation, where members can select one for booking.

Filter those ranked options against the chosen venue before assigning them to
the finished table. Preserve their order, duration and primary window. This is
a reproduced scheduling defect, not a change to the matching policy.

Alternatives considered: keep the generic options from `finish()`, which loses
the table builder's group-availability selection; or move venue selection before
group construction, which changes the planner and its ranking much more broadly.

## measurement

Same command before and after:

```sh
bun run sim --only friends --json friends-hours.json
```

The new gate uses seeded repository-generated worlds: seeds 101–103, 160 members
and three weeks of random-baseline history each. Advance to the next week and
run the actual Friends planner with three table options. The hand-written venue
fixture uses the existing catalog and locations, with weekday hours 18:00–23:00
and weekend hours 09:00–12:00. Crews and repeats are disabled for this fixture so
it measures new tables; all other policy settings stay at their defaults.

Check that there are placed plans, that multiple choices survive, that each
primary window remains offered, and that every option of each placed plan fits
its venue. The baseline gate fails on a weekend option ending at 21:00 for a
venue closing at 12:00. A separate replay enumerates all seeds because the gate
stops at the first failure.

| Check | Before | After |
|---|---|---|
| Closed-venue options, seeds 101 / 102 / 103 | 5 / 12 / 7 | 0 / 0 / 0 |
| Placed proposals, including partner proposals, same seeds | 8 / 15 / 10 | 8 / 15 / 10 |
| All offered options, including unplaced proposals, same seeds | 40 / 46 / 44 | 35 / 34 / 37 |
| Friends blocking gates | 18/19 | 19/19 |
| Existing gate records | 21 | All 21 unchanged |
| Official pack/random/oracle fingerprint | `e5bf70e069eaa7e9` | `e5bf70e069eaa7e9` |
| Block runtime | 40.7 s | 44.7 s |

The extra seed 104 replay removes seven closed-venue options and keeps all ten
placed proposals. Fresh seeds 105–107 also have zero closed-venue options with
both one and three table options. The one-option controls for seeds 101–104
retain every proposal and option count. This is an exact constraint check, not
an estimated improvement in aggregate friendship quality.

The official comparison still uses seeds 5–8, eight weeks, 400 personas, all
default settings, and the pack/random/oracle arms. All its values remain the
same, including the repeat-meetup rate of 33.7% and all safety gates.

### Attempts

1. The stock venue catalog did not reproduce closed-venue options in seeds
   101–104. The reduced weekend hours fixture exposes the overwritten filtering.
2. The first gate run used `toContainEqual`, which the simulation assertion
   helper does not support. Replace it with an explicit window-membership check;
   rerun against unchanged production code to obtain the meaningful baseline.
3. Apply the venue-hours filter once. The corrected gate passes without any
   ranking or threshold changes.

## safety_gates

Declared-minor proposals and contacts, known-adversary contacts, blocks, consent
and leak conformance retain their passing values. The 21 existing gate records
are byte-equivalent after excluding assertion runtime. All members and venues
are synthetic; all sends are dry-run.

## Validation

Windows, Bun 1.4.2, TypeScript 5.9.3 from the frozen lockfile, PostgreSQL 16.15
on loopback port 54339. Database commands use `USER=postgres`, `REQUIRE_PG=1`
and the local `PG_BIN_DIR`.

- `bun run sim --only friends`: 19/19 blocking gates, one existing tracked miss.
- `bun run typecheck`: all four configurations pass.
- `bun run test:integration`, including security: 675 pass, eight skip, six fail,
  13,741 assertions, 573.58 s.
- `bun run test:e2e`: 42 pass, one optional skip, zero failures,
  654 assertions, 75.07 s.

The six failures are the same Windows failures observed before this change:
an absolute `/bin/bash` requirement in the Wrangler integration, SIGTERM exit
143 rather than the backend test's expected zero, and four site-build path
separator comparisons. The eight skips require the separate cleanup opt-in.
The integration suite is not claimed to pass.

The repository's one-full-simulation-per-agent allowance was already used for
#136. This change reruns its affected Friends block. Linux CI still needs to
run the full matrix; the PR remains draft until then.

## llm_evidence and agent_clients

No model-backed behavior, prompt, authentication or client protocol changes.
Zero validation model calls and cost. No real-client acceptance run is claimed.
Authoring: Codex desktop 26.1021.3705.0, OpenAI `gpt-6-astra`, operator-identified.

## Reproduce and limits

Install with `bun install --frozen-lockfile`, then run the Friends command above.
Expect 19/19 blocking gates. Apply only the regression to `a0ed7bc` to reproduce
the 21:00 versus 12:00 failure.

This fixes the activity-first table options. Existing plans without a selected
venue, changed opening hours for historical crews, and separately generated
one-to-one partner options are outside this correction. Default `tableOptions`
is one, so the regression explicitly exercises the supported multi-option mode.
Filtering can reduce an invitee's available choices; it does not rebuild the
group or claim better completion rates. The catalog remains synthetic and no
live venue-hours accuracy is claimed.
