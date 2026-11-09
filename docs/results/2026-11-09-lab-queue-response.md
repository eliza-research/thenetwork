# Preserve the lab's capacity response under concurrent requests

Date: 2026-11-09. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2, Windows, PostgreSQL 16.15.

## Requirement and cause

This is a reproduced bug under the approved Slop scope and CONTRIBUTING 3.1.
PRD 35 and `docs/observatory.md` 9.6 cover the simulation lab. The `LAB_LIMITS`
contract in `src/lab.ts` explicitly requires HTTP 429 when the queue is full.

The HTTP handler checks capacity, then awaits an audit write. Other requests
can fill the queue during that write. `Lab.start` correctly checks again, but
its generic error reaches the route's internal-error handler and becomes
HTTP 500 with code `internal`. The caller loses the expected capacity response.

Use `LabQueueFullError` for the authoritative capacity check in `Lab.start`.
The HTTP handler catches only that type and returns its existing HTTP 429
`queue_full` response, with the same body as the early capacity check.
Other exceptions still reach the existing generic error handler.
The queue limit, concurrency, admission logic and audit-before-action order
are unchanged.

Alternatives considered:

1. Check capacity again after the audit write. The check still sits outside
   `Lab.start`, which awaits its load promise before admitting work.
2. Recognize the generic error by its text. An explicit type distinguishes
   an expected capacity refusal from storage or other operational failures.

PRs #424 and #425 separately address shutdown and run-ID reuse. This change
does not depend on either and does not include their implementation.

## measurement

The initial reproduction used the real HTTP server, file audit sink, lab,
filesystem and default experiment child. Four bursts of eight requests each
accepted four runs and returned four HTTP 500 responses. Each request asked
for five one-day consent seeds. No method, clock or child was mocked.

The committed integration case repeats that burst, checks the four capacity
responses, compares the sequential full-queue response, checks worker/queue
bounds and confirms that only accepted runs were saved. The final case fails
on base: 0 pass, 1 fail, 2 assertions, 114.66 ms. With the fix it passes:
1 pass, 0 fail, 5 assertions, 68.43 ms.

```sh
bun test --conditions eliza-source packages/observatory/test/lab-queue.integration.test.ts
```

The wider measurement below runs 24 cases per revision: seeds 1 and 7, apps
`ntwrk` and `friends`, worker limits 1 and 2, and three modes:

- Parallel: eight concurrent requests with five seeds each.
- Serial: five sequential requests with five seeds each; the last does not fit.
- Complete: one seed runs to completion through the actual experiment child.

Each case owns a server and temporary directories. Both revisions execute
112 HTTP POSTs. Admission counts, queue/worker counts, audit-attempt counts,
saved-run counts and file/read consistency checks match across all 24 cases.
The eight completed controls retain identical request, progress, status,
error and full result fields, also checked by SHA-256. Generated IDs and
timestamps are not compared between checkouts. Each saved record is compared
with its own `Lab.get` result before cleanup.

| Result across 112 requests | Before | After |
|---|---:|---:|
| Accepted requests | 72 | 72 |
| Capacity refusals reported as HTTP 500 | 32 | 0 |
| HTTP 429 capacity responses | 8 | 40 |
| Completed simulation controls | 8 | 8, identical |

These are exact protocol and persistence checks, not an estimate of matching
quality. The completed controls start with 250 synthetic NYC personas and
use PolicyPersonaAgent with the simulated reviewer (`review: "auto"`).

## safety_gates

Every completed control has zero judge invariants, canary leaks and minor
contacts. Interrupted queued runs are not counted as passing simulation results.

Fresh audit and operations blocks pass 30/30 blocking gates on both revisions,
with zero tracked gates off target. All 31 gate records match after excluding
gate execution times and the restore duration embedded in the backup-drill
label. Both drills restore 69 tables and 71 rows from a 274 KiB dump;
restore duration is 2,484 ms before and 1,890 ms after.
Total block time is 33.0 seconds before and 24.0 seconds after.
No performance improvement is claimed from those timings.

```sh
# Base checkout:
bun run sim --only audit,ops --json ../lab-queue-gates-before.json
# Changed checkout:
bun run sim --only audit,ops --json ../lab-queue-gates-after.json
```

The full simulation was not repeated: AGENTS.md permits one full run per agent,
already used for PR #355. No earlier full-run evidence is attributed to this PR.

## Validation

Provider keys and live-send/deploy flags were cleared. Integration and e2e used
an isolated local PostgreSQL cluster on port 54339 with `REQUIRE_PG=1`.

| Command | Result |
|---|---|
| `bun install --frozen-lockfile` | 50 installs across 44 packages checked; unchanged |
| `bun run typecheck` | All four configurations pass |
| Queue regression | 1 pass, 0 fail; 5 assertions |
| `bun run sim --only audit,ops` | 30/30 blocking gates before and after |
| `bun run test:integration` | 676 pass, 8 skip, 6 known baseline failures; 13,746 assertions; 425.91 seconds |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 33.89 seconds |

The regression passes inside the official integration command in 28.10 ms.
That command includes the security suite. All six failures match the previously
reproduced unchanged-base test identities and causes: missing `/bin/bash` for
Wrangler, SIGTERM exit 143 instead of 0, and four Windows site-path assertions.
No new failure occurred; a fully green local integration suite is not claimed.
Eight optional cleanup-reconciliation cases and one optional browser SDK case
were skipped. No browser-driven validation is claimed.

## llm_evidence

N/A: this is queue admission and HTTP error handling. The native one-day
policy-persona controls make no model calls. Calls: 0; cost: $0.
No model-backed behavior is claimed.

## agent_clients

N/A: the changed path is a staff simulation API, with no member-agent workflow.
Codex desktop 26.1103.4239.0 drove Bun 1.4.2. Provider: OpenAI; the exact
assistant model identifier was not exposed. No other client was tested.
No browser or computer use was performed.

## Limits

This preserves the existing capacity contract; it does not add queue capacity,
change the audit-before-action design, or change child execution and shutdown.
No UI copy, matching rules, live sends, production data or deployment changes.

## Reproduce the measurement

Save these two programs outside both checkouts. Use the same installed
repository dependencies and clear provider keys and live-send/deploy flags.
All tokens in the program are synthetic credentials for its own local server.

```sh
# From base:
bun run --conditions eliza-source ../lab-queue-measure.ts ../lab-queue-before.json
# From the changed checkout:
bun run --conditions eliza-source ../lab-queue-measure.ts ../lab-queue-after.json
# After the two gate runs above:
bun run ../lab-queue-compare.ts ../lab-queue-before.json ../lab-queue-after.json ../lab-queue-gates-before.json ../lab-queue-gates-after.json
```

Measurement program, authored for this report:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.cwd().replaceAll("\\", "/");
const { createServer } = await import(pathToFileURL(`${root}/packages/observatory/src/server.ts`).href);
const { FileAudit } = await import(pathToFileURL(`${root}/packages/observatory/src/staff.ts`).href);
const token = "local-lab-queue-measure-00000000000000";
const rows = [];
const hash = (value: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex");
for (const seed of [1, 7]) for (const app of ["ntwrk", "friends"]) for (const concurrency of [1, 2]) {
  for (const mode of ["parallel", "serial", "complete"]) {
    const dir = await mkdtemp(join(tmpdir(), "lab-queue-measure-"));
    const server = await createServer({ port: 0, development: false, token,
      staffRolesUrl: false, peopleUrl: false,
      audit: new FileAudit(join(dir, "audit")), lab: { dir: join(dir, "lab"), concurrency },
      game: { personas: 12, days: 2, engine: "off", network: "stub", pushMs: 3_600_000, tickMs: 3_600_000 },
      real: { url: undefined, service: false, pollMs: 3_600_000 },
    });
    const drain = async () => {
      const deadline = performance.now() + 60_000;
      while (server.lab.running && performance.now() < deadline) await Bun.sleep(10);
      if (server.lab.running) throw Error("Lab child did not finish");
    };
    const post = async (seeds: number[]) => {
      const response = await fetch(`${server.url}/api/lab/run?app=${app}`, { method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ arms: ["consent"], seeds, days: 1, app }),
      });
      return { status: response.status, body: await response.json() };
    };
    try {
      const groups = Array.from({ length: mode === "parallel" ? 8 : mode === "serial" ? 5 : 1 }, (_, i) =>
        mode === "complete" ? [seed] : [0, 1, 2, 3, 4].map(s => seed + i * 5 + s));
      const responses = mode === "parallel" ? await Promise.all(groups.map(post)) : [];
      if (mode !== "parallel") for (const group of groups) responses.push(await post(group));
      const runs = await server.lab.list();
      await Promise.all(runs.map(r => server.lab.get(r.id)));
      if (mode === "complete") await drain();
      const state = { running: server.lab.running, queued: server.lab.queued };
      let savedSame = true;
      const completed = [];
      for (const run of runs) {
        const current = await server.lab.get(run.id);
        const persisted = JSON.parse(await readFile(run.file, "utf8"));
        savedSame &&= JSON.stringify(current) === JSON.stringify(persisted);
        if (mode === "complete") completed.push({ status: current.status, progress: current.progress,
          request: current.request, results: current.results, error: current.error ?? null });
      }
      const audit = await server.audit.list({ actions: ["lab_run"], apps: [app] });
      const row = { seed, app, concurrency, mode,
        statuses: responses.map(r => r.status), errorCodes: responses.filter(r => r.status !== 200).map(r => r.body.code),
        accepted: responses.filter(r => r.status === 200).length, savedRuns: runs.length,
        auditAttempts: audit.length, state, savedSame, completed, completedHash: hash(completed) };
      rows.push(row);
      console.log(JSON.stringify({ seed, app, concurrency, mode, statuses: row.statuses, state, savedSame }));
    } finally {
      for (const run of await server.lab.list()) await server.lab.get(run.id);
      await server.stop();
      await drain();
      for (const run of await server.lab.list()) await server.lab.get(run.id);
      await rm(dir, { recursive: true, force: true });
    }
  }
}
await Bun.write(process.argv[2]!, JSON.stringify(rows, null, 2) + "\n");
```

Comparison program:

```ts
import { isDeepStrictEqual } from "node:util";
const before = await Bun.file(process.argv[2]!).json();
const after = await Bun.file(process.argv[3]!).json();
if (before.length !== 24 || after.length !== 24) throw Error("Expected 24 cases per revision");
const key = (r: any) => `${r.seed}/${r.app}/${r.concurrency}/${r.mode}`;
for (const row of after) {
  const old = before.find((r: any) => key(r) === key(row));
  if (!old) throw Error(`Missing base case ${key(row)}`);
  const { statuses, errorCodes, ...rest } = row;
  const { statuses: oldStatuses, errorCodes: oldErrors, ...oldRest } = old;
  if (!isDeepStrictEqual(rest, oldRest)) throw Error(`Admission, persistence or results changed: ${key(row)}`);
  if (!row.savedSame || row.state.queued > 20 || row.state.running > row.concurrency) throw Error(`Invalid state: ${key(row)}`);
  if (row.mode === "parallel") {
    if (!isDeepStrictEqual(statuses, [200, 200, 200, 200, 429, 429, 429, 429]) ||
        errorCodes.some((code: string) => code !== "queue_full")) throw Error(`Wrong capacity response: ${key(row)}`);
  } else if (!isDeepStrictEqual([statuses, errorCodes], [oldStatuses, oldErrors])) {
    throw Error(`Control response changed: ${key(row)}`);
  }
}
const beforeGates = await Bun.file(process.argv[4]!).json();
const afterGates = await Bun.file(process.argv[5]!).json();
const gates = (r: any) => r.gates.map(({ ms, ...rest }: any) => ({ ...rest,
  name: rest.name.startsWith("backup drill:") ? rest.name.replace(/restore \d+ ms$/, "restore <elapsed> ms") : rest.name,
}));
if (!isDeepStrictEqual(gates(beforeGates), gates(afterGates))) throw Error("Gate results changed");
const count = (rows: any[], status: number) => rows.flatMap(r => r.statuses).filter(s => s === status).length;
const completed = after.filter((r: any) => r.mode === "complete").flatMap((r: any) => r.completed);
if (completed.some((r: any) => r.status !== "done" || r.error || r.progress.done !== 1)) throw Error("Incomplete control");
console.log(JSON.stringify({ casesPerRevision: after.length,
  postsPerRevision: after.flatMap((r: any) => r.statuses).length,
  before500: count(before, 500), after500: count(after, 500),
  before429: count(before, 429), after429: count(after, 429),
  acceptedBefore: count(before, 200), acceptedAfter: count(after, 200),
  unchangedAdmissionAndPersistenceCases: after.length,
  unchangedCompletedControls: completed.length,
  safety: completed.flatMap((r: any) => r.results).map((r: any) => ({ seed: r.seed,
    invariants: r.judgeInvariants, canaryLeaks: r.canaryLeaks, minorContacts: r.minorContacts })),
  gateRecords: afterGates.gates.length,
  blockingGates: afterGates.gates.filter((g: any) => g.blocking).length,
  failingGates: afterGates.gates.filter((g: any) => !g.pass).length,
}, null, 2));
```
