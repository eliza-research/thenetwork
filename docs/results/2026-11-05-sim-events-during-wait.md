# Simulation events added during a wait

## Requirement and defect

PRD 34.3 requires real-time, accelerated and discrete-event simulation modes.
`World.act()` adds an action at the current simulated time. In a paced run, a
join added while the scheduler waits for a tick was removed without running.
The tick ran twice instead. This is a reproduced simulation defect.

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Environment: Windows, Bun 1.4.2, PostgreSQL 16.15 on an isolated local cluster.

## Cause and change

`Scheduler.runUntil()` saved the queue head before `await sleep(...)`.
An action could enter the queue during that wait and become the new head.
The scheduler then removed the action but ran the saved tick. The tick stayed
in the queue and ran again on the next iteration.

Run the event returned by `queue.pop()`. Keep the simulated time covered by
the completed wait, so the displaced tick does not cause a second wait.
The queue still orders events by time and insertion sequence. The simulated
clock still moves forward only. Discrete runs use the same event order as before.

Other implementations considered:

1. Remove the tick before waiting. That preserves the new action but runs it
   after the tick, at the wrong simulated time.
2. Add a wake-up signal and cancel the timer when an earlier action arrives.
   That would also reduce response latency, but needs a new timer lifecycle.
   This fix preserves every event without changing that interface.

## measurement

The hand-written integration case uses the real `World`, `StubNetwork`,
`SimChannel`, persona policy and wall-clock timer. Nothing is mocked.
It generates one adult with seed 1 and disables automatic joining during the
run. It advances to just before the first tick, starts the paced advance, then
inserts a join while that advance is waiting. It compares the resulting join,
messages and event count with a discrete-mode control.

The case runs both modes: accelerated at speed 20 and real-time at speed 1.
Each wait is 25 ms. Action insertion is synchronous after the advance yields;
the test does not depend on winning a race between two timers.

| Observation | Base | Fix |
|---|---|---|
| Joined members, accelerated | 0 | 1 |
| Joined members, real-time | 0 | 1 |
| Processed events, each mode | 2 (the same tick twice) | 4 (action, inbound, delivery, tick) |
| New integration case | 0 pass, 1 fail | 1 pass, 0 fail; 12 assertions |

The base case fails at the first join assertion. A separate run of the same
world sequence confirms the missing join in both modes. The fixed integration
case checks both modes. Run the case with:

```sh
bun test --conditions eliza-source packages/sim/test/scheduler.integration.test.ts
```

Paired simulation command, with a separate JSON path for each run:

```sh
bun run sim --only network,safety,audit --json <result-path>
```

Both base and fix passed **94/94 blocking gates**, with no tracked gate off
target. All 96 gate records, including the two tracked fingerprints and metric
details, were identical after excluding elapsed milliseconds. The blocks were
network 61/61, safety 17/17 and audit 16/16. Base took 172.2 seconds; fix took
173.6 seconds. This is a correctness result, not a speed claim.

The network block uses seed 3 over 10 days, consent arms on seeds 1-3 over
21 days, push seed 1, the pinned NYC scenarios, every sim scenario at pass^3,
and conformance seeds 1-4. No seed or gate configuration changed.

`bun run typecheck` passed all four TypeScript configurations.

`bun run test:integration`, including the security files: **676 pass, 8 skip,
6 fail**, 13,753 assertions across 69 files in 513.54 seconds. The new scheduler
case passed. The failures are the same six Windows failures reproduced on the
base revision earlier in this session for PR #355:

- The Wrangler test uses `/bin/bash`, which is absent on Windows.
- The backend shutdown test expects exit 0 after SIGTERM; Windows returns 143.
- Four site-build assertions compare slash-separated paths with native
  Windows paths.

The base reproduction command was:

```sh
bun test --conditions eliza-source --timeout 120000 deploy/wrangler.integration.test.ts deploy/backend/backend.test.ts sites/test/sites.test.ts -t 'Wrangler OS-session|migrates on boot|the build ships the files'
```

It produced the same six failures. No fully green integration-suite claim is
made. The eight skips are the existing optional cleanup-reconciliation cases.

`bun run test:e2e`: **42 pass, 1 skip, 0 fail**, 654 assertions in 69.66 seconds.
The skipped browser SDK case requires the optional `PLAYWRIGHT_MODULE` setup.

The all-block simulation was not repeated. `AGENTS.md` permits at most one
full run per agent; that run was used earlier in this session for PR #355.
Its results predate this scheduler fix and are not claimed as validation of
this change. The paired blocks above cover the shared `World` consumers in
the simulation runner, with safety checks included.

## safety_gates

No gate threshold, matching rule, consent rule or review rule changes.
Simulation runs use the simulated reviewer where the existing harness does.
All data is synthetic. Live-send and deployment flags were disabled.
The isolated database cluster was stopped after validation.

## llm_evidence

N/A: this scheduler change is deterministic. Validation model calls: 0;
model cost: $0. No model-backed behavior is claimed.

## agent_clients

N/A: this changes simulation scheduling, not an agent-client workflow.
Codex desktop 26.1027.6604.0 ran the local commands with Bun 1.4.2.
No browser or computer use was used. The exact assistant model identifier
was not exposed, so the contribution disclosure uses `unavailable`.

## Limits

An inserted event waits until the active timer finishes before it runs.
This change preserves its simulated time and queue order; it does not add
timer cancellation or support for concurrent `advanceTo()` calls.
The new regression runs one seeded world in each paced mode and a discrete
control for each. It makes no statistical matching-quality claim.
