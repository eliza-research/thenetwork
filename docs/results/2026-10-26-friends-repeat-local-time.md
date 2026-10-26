# Friends repeat plans keep local time across daylight saving changes

Date: 2026-10-26. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Requirement: PRD 28.3 scheduling and 40.6 repeat meetups near home.

## Problem and fix

A Sunday 19:30 meetup repeats at 18:30 after New York's fall clock change.
It repeats at 20:30 after the spring change.
Near the minimum notice cutoff, the fall error also drops a valid repeat from the planning horizon.

`nextSameSlot` added seven 24-hour days until the timestamp met the notice requirement.
The fix advances calendar weeks in the planner's time zone, using the existing `localParts` and `fromLocal` helpers.
It retains the original hour, minute and sub-minute remainder, then checks the minimum notice against the resulting timestamp.
The exported helper defaults to New York for existing three-argument calls.

The same local-calendar approach already exists in `crewSessionPlan`.
No package, UI, copy, consent rule or safety policy changes.

Other implementations considered:

1. Adjust UTC weeks by the difference between time-zone offsets. This repeats conversion logic already in core.
2. Extract a shared recurrence abstraction and refactor crew scheduling. This expands the change beyond the faulty repeat path.

## measurement

One new gate calls the real `planFriendsWeek` on a snapshot from the seeded friends world.
The fixture uses seed 101, 160 generated personas and three weeks, with planner seed 1.
It replays a positive outcome with two attendees at four hand-written dates.
Crews and extra time options are disabled for this replay, so the repeat timestamp can be inspected directly.
No planner output is mocked. The gate also checks the invited members and the 30-hour minimum notice.

All times below are in `America/New_York`.

| Previous meetup | Planning time | Before | After |
|---|---|---|---|
| Oct 18, 2026, 19:30 | Oct 19, 09:00 | Oct 25, 19:30 | Oct 25, 19:30 |
| Oct 25, 2026, 19:30 | Oct 26, 09:00 | Nov 1, 18:30 | Nov 1, 19:30 |
| Mar 7, 2027, 19:30 | Mar 8, 09:00 | Mar 14, 20:30 | Mar 14, 19:30 |
| Oct 25, 2026, 19:30 | Oct 31, 14:00 | No repeat | Nov 1, 19:30 |

In the last row, the correct start has 30.5 hours of notice.
The old start has only 29.5 hours, so the loop advances another week and the horizon check rejects it.

Same command before and after: `bun run sim --only friends --json <output.json>`.
Before: base production code with the new gate. After: the same gate with the fix.
No scheduling parameters or scoring weights were tuned.

| Check | Before | After |
|---|---|---|
| Four replay cases at the expected time | 1/4 | 4/4 |
| Blocking friends gates | 18/19 | 19/19 |
| Repeat-meetup rate | 33.7% | 33.7% |
| V14 | 34.7% | 34.7% |
| Friendship forming | 9.4% | 9.4% |
| Pack/random/oracle fingerprint | `e5bf70e069eaa7e9` | `e5bf70e069eaa7e9` |

The standard comparison uses seeds 5–8, 400 personas per world and eight weeks for each of three arms.
All 21 pre-existing gate records are identical, excluding timing.
These are exact timestamp checks, not an estimate of a small quality gain; no significance test applies.
The existing world rounds timestamps into weekly slot indices, so aggregate scores alone did not expose the clock error.

## safety_gates

Declared-minor proposals and contacts remain zero on every pinned seed.
Known-adversary contacts remain zero on every pinned seed.
The blocks, consent-before-reveal, leak, age and friends conformance gates pass before and after.
The tracked undetected-adversary harm ratio remains 1.67x random, above its 0.5x target.
The change does not claim to fix that existing metric.
All data is synthetic. Simulation review is simulated where the harness uses a reviewer; no real member receives a message.

## Validation

Environment: Windows, Bun 1.4.2, PostgreSQL 16.15 on local port 54339.
The clone uses LF line endings. The database-backed commands use `REQUIRE_PG=1`, `USER=postgres`, and PostgreSQL tools on PATH.
Git Bash is on PATH for the full simulation.

| Command | Result |
|---|---|
| `bun run sim --only friends` before the fix | FAIL: 18/19 blocking gates, 44.4 seconds |
| `bun run sim --only friends` after the fix | PASS: 19/19 blocking gates, 44.7 seconds |
| `bun run sim --json <output.json>` | PASS: 331/331 blocking gates, 14 tracked off target, 342.3 seconds; no PostgreSQL skips |
| `bun run typecheck` | Exit 0 for all four TypeScript configurations |
| `bun run test:integration` | 592 pass, 8 skip, 9 fail; 12,785 assertions; 870.29 seconds |
| Affected integration files after environment correction, command below | 141 pass, 6 fail; 1,468 assertions; 17.53 seconds |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 82.25 seconds |

The first integration run used Git's automatic CRLF checkout and lacked the Unix `USER` variable.
This broke skill frontmatter parsing, two byte-pinned mirrors, and one database setup.
Restoring unchanged files to their exact Git-index bytes and setting the local database user cleared those failures.
The corrected run reached additional site assertions that the first run's failed setup had prevented.

```sh
bun test --conditions eliza-source --timeout 120000 \
  deploy/router.test.ts deploy/wrangler.integration.test.ts deploy/backend/backend.test.ts \
  packages/core/test/contract-mirror.test.ts packages/mcp/test/cloud-authority.pg.test.ts \
  packages/network/test/staging-authority.integration.test.ts sites/test/sites.test.ts
```

Six failures remain in unchanged files:

- `deploy/wrangler.integration.test.ts`: its absolute `/bin/bash` path does not exist on Windows.
- `deploy/backend/backend.test.ts`: the SIGTERM shutdown assertion expects exit 0; Windows returns 143.
- `sites/test/sites.test.ts`: four site checks compare Windows backslash paths with forward-slash paths.

The integration suite is not reported as passing. The security suite is included in that run; it was not run separately.
The eight integration skips are the optional isolated-cluster cleanup suite.
The one e2e skip is the optional browser security-feedback test.
No Linux run or full integration rerun after the environment correction is claimed.

## llm_evidence and agent_clients

Real-LLM evidence: N/A for this deterministic calendar path. It calls no model; no model behavior, prompt or parser changed.
Provider/model, request settings and cost for the validation: none; zero calls and zero model cost.
No live provider credentials were available, and no real-LLM qualification is claimed.

Agent-client workflow tests: N/A. This changes an internal planner timestamp, with no client protocol, signup or tool-flow change.
No client acceptance run is claimed.
Authoring tool: Codex desktop 26.1021.3705.0; OpenAI `gpt-6-astra`, as identified by the operator.

## Reproduce and limits

1. Install dependencies with `bun install --frozen-lockfile`.
2. Run `bun run sim --only friends`. Expect 19/19 blocking gates and the DST gate to pass.
3. In a clean base checkout, apply only the new gate and run the same command. Expect 18/19 and the timestamp mismatch above.
4. Run the full simulation and repository validation commands listed above.

The core helper's existing policy for ambiguous or missing local times stays unchanged.
The regression exercises evening meetups on both sides of the clock change, not nonexistent overnight times.
Repeat plan IDs can change because their hash includes the corrected start time.
This change does not migrate stored plans. Friends matching remains local-only under the current project policy.
