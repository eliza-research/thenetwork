# Keep table and partner time options inside venue opening hours

Initial measurement: 2026-10-26. Partner-path follow-up: 2026-10-29.
Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Current tested code: `a64b1d942aec3e47389b933488661b169f6dcb23`.

## Requirement and cause

PRD section 6 makes scheduling part of every opportunity, including its proposed times and venue.
This is a reproduced scheduling defect under the approved scope and CONTRIBUTING.md section 3.1.

Both Friends paths choose a venue that is open for the primary window.
They then replace the venue-filtered options from `finish()` with their earlier availability-ranked options.
Those extra options can fall outside the chosen venue's hours.
`planToProposal` forwards them to the consent simulation, where members can select one for booking.

Filter the table and activity-partner options against the selected venue before assigning them.
The partner filter runs before choosing distinct days and limiting the list to three options.
It preserves ranking among open times, activity duration, participants, and the primary window.
There is no new matching policy, dependency, or helper file.

Other implementations considered:

1. Keep `finish()`'s generic options. This loses each builder's availability choices; partner times must use both members' evidence.
2. Move venue selection before group or pair construction. This changes ranking and planning much more broadly.

### Primary-window guarantee

The table's primary slot comes from `chosen`, which also supplies `opts`.
The partner's primary slot is the first ranked slot.
In both paths, `finish()` chooses the venue only when it is open for that primary slot.
The filter therefore retains that slot. It cannot empty a placed plan's options under these paths.
The regression requires exact primary-window membership, which also proves that the list is nonempty.
This addresses the review's empty-list concern without adding an unnecessary fallback.

## measurement

Command for both stages: `bun run sim --only friends --json <output-file>`.
The fixture uses repository-generated worlds: seeds 101–103, 160 members, and three weeks of random-baseline history.
It advances to the next week and calls the actual Friends planner.
Venue locations and activities come from the existing catalog.
Hand-written hours are 18:00–23:00 on weekdays and 09:00–12:00 on weekends.
All members, venues, history, and availability are synthetic. No model or planner output is mocked.

### Original table proof

The table fixture disables crews and repeats and uses three table options.
It checks placed plans, surviving multiple choices, exact primary-window membership, and every offered time's venue hours.
The before run uses main `a0ed7bc`; the original table fix is `3672570`.
These original results remain separate from the later partner measurement.

| Table observation, seeds 101 / 102 / 103 | Before | Original table fix |
|---|---|---|
| Closed-venue options | 5 / 12 / 7 | 0 / 0 / 0 |
| Placed proposals, including partners | 8 / 15 / 10 | 8 / 15 / 10 |
| All options, including unplaced proposals | 40 / 46 / 44 | 35 / 34 / 37 |
| Friends blocking gates | 18/19 | 19/19 |

Fresh seeds 105–107 also had zero closed-venue options with one and three table options.
One-option controls on seeds 101–104 retained every proposal and option count.
The initial stock catalog did not reproduce the defect; restricted weekend hours exposed it.
An initial unsupported assertion helper was corrected before the original paired measurement.

### Partner-path proof

The existing gate now also exercises two generated pairs with prior group attendance and shared climbing interests.
Seed 101 uses `f0057` and `f0159`; seed 102 uses `f0060` and `f0102`.
Their stated windows are Tuesday evening, Saturday evening, and Sunday morning.
The input limits availability evidence to that pair and disables unrelated repeat, crew, universal, and single-slot passes.
The actual partner generator and planner still select the pair, activity, venue, and times.

The same expanded gate ran first on `3672570`, then with the partner filter.
Before, both bouldering plans offered Saturday 19:00–21:00 at venues closing at 12:00.
After, both keep Tuesday 19:00–21:00 and Sunday 10:00–12:00.
After-fix controls with weekend closing extended to 23:00 retain all three options, the same primary window, and the same participants.
A separate replay enumerates both failing pairs because the gate stops at its first invalid option.

| Partner observation | Before | After |
|---|---|---|
| Placed partner plans | 2 | 2 |
| Closed-venue options | 2 | 0 |
| Open options retained | 4 | 4 |
| Friends blocking gates | 18/19 | 19/19 |
| Other gate records | 21 | All 21 unchanged |
| Block runtime | 58.7s | 47.8s |

The separate exploratory replay also found two pairs that produced no proposal; those are not counted as successful fixtures.
The committed case uses the two pairs that actually produced placed plans before and after.
The existing gate was extended; no additional case was added for this follow-up.
There was one partner production implementation, with no threshold or corpus changes.

The official comparison uses seeds 5–8, eight weeks, 400 personas, and default pack/random/oracle arms.
Its fingerprint stays `e5bf70e069eaa7e9`; the repeat-meetup rate stays 33.7%.
This is an exact scheduling constraint check, not an estimated gain in friendship quality or performance.
The synthetic configurations are deterministic reproductions; no confidence interval applies.

## safety_gates

Declared-minor proposals and contacts, known-adversary contacts, blocks, consent, and leak conformance retain their passing values.
All 21 other isolated gate records are identical after excluding elapsed milliseconds.
Simulated staff approval and dry-run sends remain in use. No real messages are sent.
No safety gates, thresholds, live-send settings, production configuration, or member data changed.

## Validation

Windows, Bun 1.4.2, TypeScript 5.9.3, PostgreSQL 16.15 on loopback port 54339.
Database suites use `USER=postgres`, `REQUIRE_PG=1`, and the task's private `OBSERVATORY_PG_DIR`.
PostgreSQL programs are on PATH and `PG_BIN_DIR` is set. Port 54329 was not used.

- `bun run sim --only friends`: 19/19 blocking gates, one existing tracked miss; 47.8s.
- `bun run typecheck`: all four configurations pass.
- `bun run test:integration`, including all eleven security files: 675 pass, 8 skip, 6 fail; 13741 assertions; 689 tests, 68 files; 532.88s.
- `bun run test:e2e`: 42 pass, 1 optional skip, 0 fail; 654 assertions; 82.15s.
- Combined with the other seventeen contributions: 22/22 Friends blocking gates; 58.4s. Typecheck passes.

Combined code is `46410ae3f4b04a93568fbbc176d66fdf39ff5d71`.
Its 24 other Friends gate records equal the earlier combined Friends run, excluding elapsed milliseconds.
The cherry-pick needed import-list conflict resolution only. All earlier regression cases remain present.
This is affected-path combined validation, not a new full combined integration run.

The six integration failures match the established Windows baseline: absolute `/bin/bash`, SIGTERM exit status, and four site path comparisons.
Eight integration cases require the separate reconciliation opt-in. One end-to-end case requires external origins.
No new full baseline integration run was performed for this follow-up. The full integration suite is not green on Windows.
Keep the PR draft pending maintainer-approved Linux CI.
The session's one-full-simulation allowance was used for #136; this change reruns its affected Friends block.

## llm_evidence

N/A: deterministic scheduling has no model-backed behavior. Validation model calls: 0. Model API cost: $0.
No mocked model output is used as proof. Authorship: OpenAI / `gpt-6-astra`, client `codex`.

## agent_clients

N/A: this changes the local planner, not an agent connector or protocol.
No external agent-client acceptance or other operating-system result is claimed.

## Reproduce and limits

Run `bun install --frozen-lockfile`, then `bun run sim --only friends`.
Expect 19/19 blocking gates.
Apply only the expanded gate to `3672570` to reproduce the partner's 21:00 versus 12:00 failure.
Apply it to `a0ed7bc` to reproduce the original table failure.

The table policy defaults to one option; the fixture exercises its supported three-option mode.
Activity-partner options use the default three-time selection path.
Filtering may reduce choices; it does not rebuild groups or claim better completion rates.
Plans without a selected venue and changed hours for historical crews remain outside this correction.
The catalog is synthetic; no live venue-hours accuracy is claimed. No UI or message-copy change is included.
