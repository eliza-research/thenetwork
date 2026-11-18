# Network Capital: count observed admissions (2026-11-07)

## Requirement and defect

PRD 39.2.7 requires a simulation of Network Capital dynamics before launch.
The approved Slop scope includes reproduced simulation and measurement defects.
The existing report compares bad invitees admitted under different vouch limits.
That number must count people who entered the simulated population during the run.

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

The simulator draws an invitation decision before scheduling the person's arrival two days later.
An invitation in the final two days can have `joined: true` without creating a member.
The report counted this decision as an admission.
For example, seed 4 reports 68 admissions in 90 days, but only 64 bad invitees entered the population.
Four accepted invitations fall beyond the observation period.

The fix requires the invitee to exist and their join day to precede the run's end.
It uses the population map already built by `measure()`.
It preserves arrivals that happened during the run, including people removed later and simulated sybils.

Alternatives considered:

1. Change the invitation's `joined` flag when the run ends. This changes simulation output and loses the sampled decision.
2. Subtract two days from every invitation cutoff. This assumes every invitation follows the ordinary arrival delay. Simulated sybils use a different schedule.

## measurement

All runs use the real Capital simulator, its seeded population, and the real Capital ledger.
There are no mocked functions or model responses.
The prose and measurement program are hand-written; tables summarize generated output.

One integration case runs four complete 90-day worlds.
It independently counts bad invitees and sybils in the generated population.
It also requires both pending bad invitations and admitted sybils to occur.

| Seed | Before | Observed population | After |
|---|---:|---:|---:|
| 1 | 49 | 49 | 49 |
| 2 | 61 | 60 | 60 |
| 3 | 57 | 55 | 55 |
| 4 | 68 | 64 | 64 |

```sh
bun test --conditions eliza-source packages/capital/test/admissions.integration.test.ts
```

Before: `0 pass, 1 fail, 3 expect() calls`, 1.274 seconds.
After: `1 pass, 0 fail, 3 expect() calls`, 1.402 seconds.
These timings are observations, not a performance claim.

Held-out validation uses seeds 13–32, durations of 30 and 90 days, and three existing configurations.
The configurations use default levers, the vouch lever disabled, and all levers disabled.
This produces 120 paired worlds, each with the default population size of 240 plus special personas and invitees.

| Days | Configuration | Runs | Before | After | Pending arrivals removed |
|---:|---|---:|---:|---:|---:|
| 30 | Default | 20 | 454 | 434 | 20 |
| 30 | Vouch lever off | 20 | 499 | 476 | 23 |
| 30 | All levers off | 20 | 499 | 476 | 23 |
| 90 | Default | 20 | 1,167 | 1,142 | 25 |
| 90 | Vouch lever off | 20 | 1,302 | 1,275 | 27 |
| 90 | All levers off | 20 | 1,302 | 1,275 | 27 |
| Total | | 120 | 5,223 | 5,078 | 145 |

The report overcounted in 84 worlds; all 120 counts now equal the observed population count.
The other 36 counts remain unchanged.
These totals sum separate simulated worlds; they are not unique people across runs.
Every removed count corresponds to an accepted invitation whose invitee never entered that run.

The entire returned simulation state has an identical SHA-256 digest before and after in every world.
The comparison includes personas, invitation decisions, value and participation histories, ledger state, flags, and detection results.
All other reported metrics match exactly in all 120 worlds.
The change corrects measurement; it does not improve matching, admission policy, or safety behavior.

### Repeat the paired measurement

Save this program outside the repository as `capital-admissions-measure.ts`.
Run it from the base checkout and then from the candidate checkout:

```sh
bun run /path/to/capital-admissions-measure.ts > before.jsonl
bun run /path/to/capital-admissions-measure.ts > after.jsonl
```

Each row records the expected population count and a digest of the full returned world.
Compare rows by seed, days, and configuration.
Expect equal world digests, equal metrics except `vouch.badAdmitted`, and corrected counts equal to `expected`.
The count difference must equal `pending`.

```ts
import { resolve } from 'node:path';
const { simulate } = await import(resolve('packages/capital/experiments/world.ts'));
const { measure } = await import(resolve('packages/capital/experiments/run.ts'));
const arms = {
  default: {},
  vouchOff: {vouchLever:false},
  allOff: {effortLever:false,vouchLever:false,reachLever:false},
};
const stable = (x: unknown) => JSON.stringify(x, (_k, v) => v instanceof Map ? [...v] : v instanceof Set ? [...v] : v);
for (let seed = 13; seed <= 32; seed++) for (const days of [30,90]) for (const [arm, options] of Object.entries(arms)) {
  const run = simulate({seed, days, ...options});
  const expected = run.personas.filter((p: any) => p.joinDay < days && (p.type === 'invitee_bad' || p.type === 'sybil')).length;
  const worldHash = new Bun.CryptoHasher('sha256').update(stable(run)).digest('hex');
  const present = new Set(run.personas.map((p: any) => p.id));
  const pending = run.invites.filter((i: any) => i.joined && i.quality === 'bad' && !present.has(i.invitee));
  console.log(JSON.stringify({seed,days,arm,worldHash,expected,pending:pending.length,metrics:measure(run)}));
}
```

## safety_gates

The affected block uses 32 paired seeds, 1–32, for the default and all-levers-off configurations.
Both blocking gates pass before and after. All three gate records are identical, including their reported values.

```sh
bun run sim --only capital --json /path/to/gates.json
```

| Check | Before | After |
|---|---|---|
| Fairness | Pass: change 0.015, lower confidence bound -0.004 | Same |
| Gaming gains | Pass: vouch ring -52%, staged meetings -57%, help farming -55% | Same |
| Tracked health ratio | 0.704; below the 0.80 target | Same |
| Blocking gates | 2/2 | 2/2 |
| Runtime | 17.1 seconds | 17.2 seconds |

No gate threshold changes.
All simulated events and ledger state match exactly across the separate 120-world comparison.
The repository permits one full simulation run per agent; that allowance was used earlier in this contribution session.
This change has fresh affected-block evidence, not a new full-suite simulation claim.

## llm_evidence

N/A: the affected path is deterministic accounting in an offline simulation report.
It neither calls a model nor changes a prompt or model-backed workflow.
No external model calls: zero calls, $0, no request settings.
This does not establish real-model or member-client acceptance.

## agent_clients

| Client | Version | Provider | Exact model | Exercise |
|---|---|---|---|---|
| Codex desktop | 26.1103.3517.0 | OpenAI | Unavailable to this runtime | Local PowerShell commands, Bun simulation, and direct GitHub access |

Bun 1.4.2; PowerShell 7.6.9; PostgreSQL 16.15 on the task-owned local port 54339.
No computer use or member-client interaction occurred.
The change has no UI, message copy, client integration, dependency, or production code changes.

## Limits and trade-offs

`badAdmitted` now means observed admissions within the run, rather than positive future join decisions.
Historical reports may contain the old count and are not rewritten here.
The paired evidence shows an exact accounting correction, not a statistical improvement in policy.
The population remains the simulator's source of truth for whether an invitee arrived.

## Validation

| Command | Result |
|---|---|
| `bun install --frozen-lockfile` | Pass |
| `bun run typecheck` | Pass, all four configurations |
| Targeted regression | 1 pass, 0 fail, 3 assertions |
| `bun run sim --only capital` | 2/2 blocking gates pass; one unchanged tracked miss |
| `bun run test:integration` | 676 pass, 8 skip, 6 known baseline failures; 13,744 assertions; 385.72 seconds |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 34.27 seconds |

The integration suite includes the security suite.
Its six failures match the recorded current-main Windows baseline by test name and underlying error:

- Wrangler's missing `/bin/bash` executable.
- The boot test receives exit 143 for SIGTERM instead of zero.
- Four site assertions use paths incompatible with native Windows `.well-known` files.

The eight integration skips are optional cleanup reconciliations.
The end-to-end skip requires an optional browser SDK.
There were no new test failures or required Postgres skips.
The task-owned Postgres cluster was stopped after the test process finished and no client sessions remained.
