# Reject invalid simulation time controls

## Problem and scope

The Observatory accepted a step command with no duration and returned success.
In a generated 24-person world with seed 1 and a two-day limit, that request
advanced 5.5 days and produced 85 messages. It processed queued events beyond
the configured end instead of refusing the incomplete command.

The speed command had the same unchecked numeric input. A missing value or a
nonnumeric string stored `NaN` as the play-loop speed. HTTP serialized it as
`null`. Neither result is a valid application of the typed control contract
(`ControlCommand` requires numeric `ms` and `speed` fields).

This is a reproduced bug under the approved simulation-validation scope and
CONTRIBUTING 3.1. PRD 34.3 requires a virtual clock and reproducible simulations;
the time controls must not silently run a different period. No UI, copy,
matching policy, production service or World-duration configuration changes
are included.

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2 on Windows; PostgreSQL 16.15 for the required suites.
All worlds are synthetic and use the simulated reviewer. No live sends occur.

## Cause and fix

The HTTP endpoint casts parsed JSON to `ControlCommand`; that cast does not
validate values at runtime. In the game source, `Math.max` and `Math.min` coerce
missing or malformed fields to `NaN`. A step then passes `NaN` to the world and
scheduler. The comparison `next.at > until` is always false for a `NaN` limit,
so the scheduler consumes later events too.

Check `Number.isFinite` for each time-control value before any state mutation.
The existing control-error path returns HTTP 409 and a specific error. Missing,
nonnumeric and non-finite values are refused. Valid numeric inputs retain the
existing rules: step has a one-minute minimum and remains capped at the world's
end; speed is clamped between one minute and seven days. Finite zero and negative
values retain their existing minimum clamp. Fractional durations remain valid.

Alternatives:

1. Validate only at HTTP parsing. That leaves direct GameSource callers able to
   store an invalid speed or run an invalid step.
2. Replace invalid values with a default or clamp them. That silently changes
   the requested experiment. The existing clamping rules still apply to valid
   finite numbers; invalid values need an error.

## measurement

One integration case drives the real Observatory HTTP server, GameSource,
ConsentNetwork, World and scheduler. It sends 16 invalid commands, checks all
responses and the unchanged complete state, then checks valid speed and step
clamps and fractional values. No events, models or runtime components are mocked.

```powershell
bun test --conditions eliza-source packages/observatory/test/time-controls.integration.test.ts
```

The final test fails on base (0 pass, 1 fail, 1 assertion reached, 171.52 ms) and
passes after the fix (1 pass, 0 fail, 4 assertions, 36.45 ms). These times are
observations, not a performance claim.

The same HTTP measurement program below ran on both revisions, with seeds 1,
7, 11 and 23 and 24 or 80 initial personas. Each command starts from a reset
two-day world. The eight invalid values for each control are: missing, null,
the string `NaN`, a numeric string, an object, an array, a boolean and a raw JSON
exponent `1e999` (which parses to a non-finite JavaScript number).

| Check | Before | After |
|---|---:|---:|
| Invalid commands accepted | 128/128 | 0/128 |
| Invalid commands leaving state unchanged | 0/128 | 128/128 |
| Invalid steps exceeding the two-day end | 24 | 0 |
| Invalid speeds stored as non-finite values | 24 | 0 |
| Longest advance from an invalid step | 7.667 days | 0 days |
| Valid controls accepted | 80/80 | 80/80 |
| Valid control results unchanged | — | 80/80 |

Valid controls use 0, -1, one minute, 1.25 hours and eight days, for each command,
seed and population. The eight-day step is capped at the configured two-day end;
the eight-day speed is capped at seven days. All 80 valid observations have
identical response status, simulated elapsed time, speed, member and opportunity state,
counts, requests, edges, message channels and judge results before and after.
These comparisons exclude engine wall-time measurements.

This is an exact deterministic state comparison, not a matching-quality estimate.
No confidence interval or significance claim is made. The test and measurement
program are hand-written; the repository generates the personas.

## safety_gates

The valid-control comparisons preserve every recorded judge result. Canary counts
remain zero. Of the 80 observations, 79 have zero invariants and minor contacts.
The 24-person seed-7 world, stepped to its two-day end, already has one
minor-contact finding on base and retains it after the fix. This control
validation change does not resolve that baseline finding or claim all sampled
worlds are safety-clean.

Validation on the fixed revision:

- Frozen install: 50 installs across 44 packages checked; no changes.
- `bun run typecheck`: all four configurations pass.
- `bun run sim --only audit,ops --json <output>` on both revisions: 30/30
  blocking gates pass; all 31 gate records match excluding timing; no tracked
  misses. Base: 33.4 seconds. Fixed: 27.4 seconds.
- `bun run test:integration`, including all security-suite files: 676 pass,
  8 skip, 6 known failures; 13,745 assertions, 460.19 seconds. The new regression
  passes in 16.22 ms. Failure names and causes match the base: missing `/bin/bash`,
  SIGTERM exit 143 instead of 0, and four Windows site-path assertions.
- `bun run test:e2e`: 42 pass, 1 skip, 0 fail; 654 assertions, 36.24 seconds.
  The optional browser SDK case is skipped. The eight integration skips belong
  to the optional isolated cleanup-reconciliation group.

All test processes completed. The task-owned PostgreSQL cluster was stopped
only after confirming that no other client connections remained.

The full simulation was not repeated: AGENTS.md permits one full run per agent,
already used for PR #355. Live-send and deployment flags were disabled. The
required database suites use only the task-owned local cluster on port 54339.

## llm_evidence

N/A: this validates developer simulation controls. No model-backed behavior changes
or claims. Real-model calls: 0; cost: $0; request settings: N/A.

## agent_clients

N/A for member-facing clients: no agent-client flow changes. Codex desktop
26.1103.4239.0 drove Bun 1.4.2 on Windows for the final validation. No other client
is claimed as tested. No browser or computer use was performed. The exact
assistant model identifier is unavailable; the PR uses the disclosure helper's
supported value.

## Limits

Clients that sent numeric strings must send JSON numbers. Finite zero and
negative values still use the existing minimum clamp. This change validates
`step` and `speed`; it does not add general validation for every control field
or alter the scheduler's public API. No real member data or raw conversations
are included in this report.

## Reproduce the paired measurement

Save this program outside the checkout as `time-controls-measure.ts`, then run it
from each checkout with a separate output path:

```powershell
$env:TIME_CONTROLS_OUTPUT = '../time-controls-measure-before.json' # after.json on the fixed checkout
bun run --conditions eliza-source ../time-controls-measure.ts
```

```ts
import { pathToFileURL } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = process.cwd().replaceAll("\\", "/");
const { createServer } = await import(pathToFileURL(`${root}/packages/observatory/src/server.ts`).href);
const DAY = 86_400_000, HOUR = 3_600_000, MINUTE = 60_000;
const dir = await mkdtemp(join(tmpdir(), "time-controls-measure-"));
const token = "time-controls-measure-local-0123456789abcdef";
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const server = await createServer({ port: 0, development: false, token, peopleUrl: false, staffRolesUrl: false,
  audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
  game: { seed: 1, personas: 24, days: 2, pushMs: HOUR, tickMs: HOUR } });
const hash = (v: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(v)).digest("hex");
const state = () => fetch(`${server.url}/api/state`, { headers }).then(r => r.json());
const control = async (command: unknown) => {
  const response = await fetch(`${server.url}/api/control`, { method: "POST", headers,
    body: typeof command === "string" ? command : JSON.stringify(command) });
  return { status: response.status, body: await response.json() };
};
const results: any[] = [];
try {
  for (const personas of [24, 80]) for (const seed of [1, 7, 11, 23]) {
    for (const type of ["step", "speed"]) {
      const field = type === "step" ? "ms" : "speed";
      const bad = [undefined, null, "NaN", "60000", {}, [], true].map((value, i) => ({
        label: ["missing", "null", "NaN string", "numeric string", "object", "array", "boolean"][i], command: { type, [field]: value },
      }));
      bad.push({ label: "nonfinite exponent", command: `{"type":"${type}","${field}":1e999}` as any });
      const good = [0, -1, MINUTE, 1.25 * HOUR, 8 * DAY].map(value => ({ label: String(value), command: { type, [field]: value } }));
      for (const [valid, cases] of [[false, bad], [true, good]] as const) for (const c of cases) {
        const reset = await control({ type: "reset", seed, personas, days: 2 });
        if (!reset.body.ok) throw Error("Reset failed");
        const before = await state(), response = await control(c.command), after = await state();
        const source = await server.source() as any;
        const stable = { clock: after.clock, members: after.members, opportunities: after.opportunities,
          stats: after.stats, requests: after.requests, edges: after.edges, channel: source.world.channel.all() };
        results.push({ personas, seed, type, label: c.label, valid, status: response.status, ok: response.body.ok,
          unchanged: hash(before) === hash(after), daysAdvanced: (after.clock.now - before.clock.now) / DAY,
          pastEnd: after.clock.now > after.clock.end, speedFinite: Number.isFinite(after.clock.speed),
          messages: after.stats.messages, stateHash: hash(stable), safety: after.stats.judge });
      }
    }
  }
  await Bun.write(process.env.TIME_CONTROLS_OUTPUT!, JSON.stringify(results, null, 2));
  const invalid = results.filter(r => !r.valid), valid = results.filter(r => r.valid);
  console.log(JSON.stringify({ invalid: invalid.length, acceptedInvalid: invalid.filter(r => r.ok).length,
    unchangedInvalid: invalid.filter(r => r.unchanged).length, pastEndInvalid: invalid.filter(r => r.pastEnd).length,
    nonfiniteSpeeds: invalid.filter(r => !r.speedFinite).length, valid: valid.length,
    acceptedValid: valid.filter(r => r.ok).length, maxInvalidDays: Math.max(...invalid.map(r => r.daysAdvanced)) }));
} finally { await server.stop(); await rm(dir, { recursive: true, force: true }); }
```
