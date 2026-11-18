# Reject invalid simulation CLI seeds (2026-11-07)

## Requirement and defect

PRD 34.3 requires deterministic, replayable runs with a recorded seed and configuration.
The approved contribution scope includes reproduced simulation-validation defects.

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

The world CLI converts `--seed` with `Number()` but does not validate the result.
Text such as `not-a-number` becomes `NaN`; `Infinity` and overflowing exponent notation become infinite numbers.
The simulation still exits successfully. JSON serializes these seed values as `null`.
An empty or whitespace-only seed silently becomes zero.

Reproduction:

```sh
bun run packages/sim/src/cli.ts --personas 4 --days 1 --seed=not-a-number --no-log --json
```

Before: exit 0, `run.seed: null`, and `errors: 0`.
After: exit 1 with `--seed must be a finite number`, without a simulation result.

The fix validates the converted value and rejects blank input immediately after parsing the seed.
It runs before loading an optional engine or constructing a model client.
It preserves every finite numeric value, including zero, negative values, fractions, and supported numeric notation.

Alternatives considered:

1. Replace invalid values with the default seed. This silently changes the requested experiment.
2. Change the shared random-number generator. This changes unrelated API callers, including supported string seeds, and leaves the CLI's blank-to-zero conversion intact.

PR #381 separately fixes scenario seed overrides.
This change does not alter scenario seed selection or repetition behavior.

## measurement

One integration case invokes the real CLI in child processes.
It uses real generated worlds and the existing `band-week-apart` scenario, without mocked functions.

Invalid values: `not-a-number`, `NaN`, `Infinity`, `-Infinity`, `1e309`, empty text, and whitespace-only text.
Each runs in both random-world and scenario mode: 14 invocations.

| Observation | Before | After |
|---|---:|---:|
| Invalid-seed invocations exiting successfully | 14 | 0 |
| Random-world reports with `seed: null` | 5 | 0 |
| Blank seeds silently becoming zero | 2 | 0 |
| Scenario PASS summaries with invalid CLI seeds | 7 | 0 |
| Invalid invocations rejected before result output | 0 | 14 |

Valid controls omit the seed or use `0`, `7`, `-3`, `1.25`, `2e2`, and `0xff`.
All seven produce real joined members and preserve the expected numeric seed.

```sh
bun test --conditions eliza-source packages/sim/test/cli-seed-validation.integration.test.ts
```

Before: `0 pass, 1 fail, 1 expect() call`, 1.246 seconds.
After: `1 pass, 0 fail, 22 expect() calls`, 1.181 seconds.
The before case runs all 14 invalid invocations before its assertion fails.

A separate paired measurement runs 61 CLI invocations on each revision:

- The 14 invalid cases above.
- Forty held-out worlds: seeds 13–32, 40 adults, 14 days, with the built-in Stub and the real engine adapter.
- The seven finite/default controls above.

All 47 valid outputs match exactly after removing only the generated run ID.
Every metric, seed, population count, outcome, error count, and invariant result remains identical.
These are comparisons of reported metrics, not complete trace comparisons or matching-quality improvement claims.

All 47 valid runs have zero errors, minor contacts, and canary leaks.
Two held-out engine runs retain six existing invariant findings:
seed 29 has three `decliner_exposed`; seed 31 has two `decliner_exposed` and one `over_budget`.
They occur identically before and after. The other 45 runs have zero invariant findings.

### Repeat the paired measurement

Save the following program outside the repository as `finite-seed-measure.ts`.
Run it from the base checkout and then the candidate checkout.

```sh
bun run /path/to/finite-seed-measure.ts > before.jsonl
bun run /path/to/finite-seed-measure.ts > after.jsonl
```

Compare rows by case kind, seed, and mode or arm.
Expect all 47 valid rows to be identical.
Expect the 14 invalid rows to change from exit zero to nonzero with `seedError: true` and `stdoutEmpty: true`.
The program removes only the run ID from random-world metrics.

```ts
import { resolve } from 'node:path';
const cli = resolve('packages/sim/src/cli.ts');
const invoke = (args: string[]) => {
 const p=Bun.spawnSync([process.execPath,'run','--conditions','eliza-source',cli,'--no-log','--json',...args],{timeout:30000});
 const stdout=p.stdout.toString(),stderr=p.stderr.toString();
 let metrics;try{metrics=JSON.parse(stdout);delete metrics.run.runId;}catch{}
 return {code:p.exitCode,seedError:stderr.includes('--seed must be a finite number'),metrics,scenarioPass:/pass\^1: PASS/.test(stdout),stdoutEmpty:stdout.trim()==='',nonfiniteLog:/s(?:NaN|Infinity|-Infinity)-/.test(stdout)};
};
for (const seed of ['not-a-number','NaN','Infinity','-Infinity','1e309','','   ']) for (const mode of ['world','scenario']) {
 const args=mode==='world'?['--personas','4','--days','1']:['--scenario','packages/sim/scenarios/band-week-apart.json'];
 console.log(JSON.stringify({kind:'invalid',seed,mode,...invoke([...args,`--seed=${seed}`])}));
}
for (let seed=13;seed<=32;seed++) for (const arm of ['stub','engine']) {
 const args=['--personas','40','--days','14','--adversarial-rate','0','--minor-share','0',`--seed=${seed}`];
 if(arm==='engine') args.push('--engine','./packages/sim/src/engineAdapter.ts');
 console.log(JSON.stringify({kind:'valid',seed,arm,...invoke(args)}));
}
for (const seed of [undefined,'0','7','-3','1.25','2e2','0xff']) {
 console.log(JSON.stringify({kind:'control',seed:seed??'default',...invoke(['--personas','4','--days','1',...(seed===undefined?[]:[`--seed=${seed}`])])}));
}
```

## llm_evidence

N/A: numeric CLI argument validation, before any engine or model-backed run starts.
No model calls or prompts changed. Zero external model calls, $0, no request settings.
No mocked model output was used.

## agent_clients

| Client | Version | Provider | Exact model | Exercise |
|---|---|---|---|---|
| Codex desktop | 26.1103.3517.0 | OpenAI | Unavailable to this runtime | PowerShell, Bun CLI subprocesses, direct GitHub access |

Bun 1.4.2; PowerShell 7.6.9; PostgreSQL 16.15 on the task-owned local port 54339.
No computer use or member-client interaction occurred. No member-client acceptance claim is made.

## Limits and trade-offs

This rejects invalid CLI seed text that previously produced successful runs.
The shared RNG and World APIs retain their existing contracts, including string seeds where supported.
Other numeric CLI options and scenario file contents are outside this fix.
The comparison uses deterministic policy agents and the real engine adapter, without model-backed personas or judges.
There are no dependency, production service, UI, or member-message changes.

## safety_gates and validation

```sh
bun run sim --only network --json /path/to/gates.json
```

The same full Network block passes before and after: 61/61 blocking gates, two tracked records, zero tracked misses.
All 63 gate records match exactly after excluding their execution-time `ms` fields.
Gate values and deterministic fingerprints remain unchanged.
Runtime: 142.8 seconds before, 143.0 seconds after.
No gate thresholds change.

The repository permits one full simulation run per agent; that allowance was used earlier in this contribution session.
This change has fresh affected-block evidence, not a new full-suite simulation claim.

| Command | Result |
|---|---|
| `bun install --frozen-lockfile` | Pass |
| `bun run typecheck` | Pass, all four configurations |
| Targeted CLI regression | 1 pass, 0 fail, 22 assertions |
| `bun run sim --only network` | 61/61 blocking gates pass; zero tracked misses |
| `bun run test:integration` | 676 pass, 8 skip, 6 known baseline failures; 13,763 assertions; 401.86 seconds |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 42.48 seconds |

The integration suite includes the security suite.
Its failures match the recorded current-main Windows baseline by test name and underlying error:

- Wrangler cannot find `/bin/bash`.
- The boot test receives SIGTERM exit status 143 instead of zero.
- Four site assertions use paths incompatible with native Windows `.well-known` files.

The eight integration skips are optional cleanup reconciliations.
The end-to-end skip needs an optional browser SDK.
There are no new failures or required Postgres skips.
The task-owned local database was stopped after the test process finished and no client sessions remained.
