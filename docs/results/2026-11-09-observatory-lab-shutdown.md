# Drain simulation jobs during server shutdown

Date: 2026-11-09 (Asia/Tokyo).
Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2 on Windows; PostgreSQL 16.15 for the official suites.

## Problem and requirement

The simulation lab can start a child process after its server has stopped.
It can also leave interrupted runs marked as running on disk, with queued seeds discarded.
This is a reproduced lifecycle defect under CONTRIBUTING 3.1 and PRD 35's simulation lab.
The lab's existing `dispose` contract is to stop children during server shutdown.
The lab also promises persisted run state across restarts (`docs/observatory.md`, section 9.6).

`Lab.exec` waits for its first status write before it spawns the experiment child.
During that wait, `dispose` sees no child to kill, then clears the queue and returns.
The pending job resumes after the write and starts the child anyway.
Already-started children are killed, but their completion and final writes are not awaited.
Discarded queued seeds prevent the run's completed-seed count from reaching its planned total.
That run stays `running` until the next Lab instance changes its status while loading it.

The fix closes the lab before clearing the queue and killing children.
It checks that closed state after the startup write, before any spawn.
It tracks active job promises and waits for their exit handling and writes.
It then marks remaining queued or running records as failed and persists them.
Repeated disposal returns the same completion promise; later starts are rejected.
The server and existing queue-cap test now await disposal.
The queue-cap test no longer needs its separate wait loop after disposal.

Alternatives considered:

1. Only check a closed flag before spawning. This stops late starts but leaves child exit handlers and writes running after shutdown returns.
2. Poll the active counter in the server. This duplicates lifecycle work in callers and leaves the lab open to new starts.

The change is separate from PR #413, which drains a GameSource step before replacing its simulated world.
There is no UI, style, member-facing copy, matching-policy, or live-send change.

## measurement

The initial base reproduction starts the real lab with one seed, then immediately disposes it.
Disposal returns with one active job. The child subsequently finishes and saves a successful result about 2.4 seconds later.
With a queued seed, the final saved record remains `running` after the active job exits.

The single new integration case starts the actual Observatory server and its native lab.
It first completes a one-day consent experiment as a control.
It then starts a two-seed experiment and stops the server while the startup write is pending.
It checks that shutdown returns with no active or queued work and a failed run with no late results.
It also checks the completed control, persisted file, restart state, rejection of later starts, and repeated disposal.
The case uses real files and the repository's real experiment subprocess, without a replacement child or mocked results.

Command, with the same new case copied into the base checkout:

```sh
bun test --conditions eliza-source packages/observatory/test/lab-shutdown.integration.test.ts
```

| Check | Base | Fix |
|---|---|---|
| Regression | 0 pass, 1 fail; 4,921.87 ms | 1 pass, 0 fail; 2,521.42 ms; 6 assertions |
| Active jobs when server stop returns | 1 | 0 |
| Results produced by interrupted run | 1 | 0 |
| Interrupted run status after draining | running | failed |

The paired measurement below runs 24 cases on each revision.
It uses concurrency limits 1 and 2, with seed bases 1, 7, 11, and 23.
Each interrupted run requests three seeds: `[s, s+1, s+2]`, one simulated day, and the consent arm.
Startup cases stop immediately after `start`, while the startup write is pending.
Child cases call `get` first, awaiting that write and allowing the child to start before disposal.
The completed controls use one seed each and finish before disposal.
The seed-1 startup reproduction selected the fix; the other seeds and concurrency limit confirm it without tuning.

| Measurement | Base | Fix |
|---|---|---|
| Interrupted cases | 16 | 16 |
| Cases with active jobs after disposal returns | 16 | 0 |
| Interrupted cases producing a result after disposal | 8 | 0 |
| Nonterminal records after jobs drain | 16 | 0 |
| Records whose state changes merely by loading them again | 16 | 0 |
| Saved records equal the final in-memory records | 24/24 | 24/24 |
| Completed control records preserved by disposal | 8/8 | 8/8 |

All eight completed-result hashes match between revisions.
They compare every parsed arm result, including acceptance, meetings, and safety fields.
This is a lifecycle measurement, not a throughput benchmark or matching-quality claim.
The base measurement waits for escaped children before deleting its temporary directories.

## safety_gates

The native experiment uses the repository's synthetic NYC data and the simulated reviewer (`review: "auto"`).
All completed control results have zero judge invariants, zero canary leaks, and zero minor contacts on both revisions.
The eight escaped base results also have zero values. Interrupted fixed runs produce no judge result; they are not counted as safety passes.
The child environment remains restricted to the existing allowlist. Provider keys, deployment flags, and database URLs are not passed to it.

`bun run sim --only audit,ops --json <output>` passes 30/30 blocking gates on both revisions, with no tracked misses.
All 31 gate records match after excluding elapsed time, including the backup-drill duration in its name.
Base duration: 32.2 seconds. Fixed duration: 28.1 seconds.
These blocks use real isolated PostgreSQL and the repository's fixed fixtures.
The full simulation was not repeated: AGENTS.md permits one full run per agent, already used for PR #355.

## Validation

`bun install --frozen-lockfile`: 50 installs across 44 packages checked, with no changes.
`bun run typecheck`: all four configurations pass.

`bun run test:integration`: 676 pass, 8 skip, 6 fail; 13,747 assertions across 69 files; 439.23 seconds.
The new regression passes inside this suite in 2,412.47 ms. The official integration command includes the security suite.
All six failures match the previously reproduced base failures in both test names and causes:

- `deploy/wrangler.integration.test.ts`: `/bin/bash` is unavailable on Windows.
- `deploy/backend/backend.test.ts`: SIGTERM returns 143 instead of the expected 0.
- `sites/test/sites.test.ts`: four assertions expect slash-separated paths, while Windows returns backslashes.

The eight skips are existing optional cleanup-reconciliation cases.
`bun run test:e2e`: 42 pass, 1 skip, 0 fail; 654 assertions; 36.75 seconds.
The skipped case requires the optional browser SDK environment. Browser acceptance is not claimed.
All test and measurement processes finished; the isolated database had no other clients and was stopped afterwards.
A fully green local integration suite is not claimed.

## llm_evidence

N/A: this changes process lifecycle and persistence, not model-backed behavior.
Real-model calls: 0. Cost: $0. No provider request settings apply.

## agent_clients

Codex desktop 26.1103.4239.0 drove Bun 1.4.2 and the local server, with OpenAI assistance.
The exact assistant model identifier was not exposed; disclosure uses the helper's supported `unavailable` value.
N/A for other agent clients: this changes the local simulation lab's lifecycle, not a member-facing agent integration.
No browser or computer use was performed. No other client is claimed as tested.

## Limits

Shutdown now waits for child exit and filesystem writes, so disk or process failures can delay or reject shutdown.
This does not add a shutdown deadline or change the child-kill signal.
Interrupted runs retain their actual completed-seed count, partial results, and existing errors; queued seeds are not reported as completed.
Already-terminal runs remain unchanged. Historical files are not rewritten unless their active work is stopped by this instance.
No secrets, real member data, or raw conversation logs are included.

## Reproduce the paired measurement

Save the following program outside each checkout as `../lab-shutdown-measure.ts`.
Run it from the base and fixed repository roots with the same program.
Use synthetic local data and clear live-send flags and provider keys.

```powershell
$env:LAB_SHUTDOWN_OUTPUT = '../lab-shutdown-before.json' # use lab-shutdown-after.json on the fixed branch
bun run --conditions eliza-source ../lab-shutdown-measure.ts
```

Compare rows by seed, concurrency, and phase.
Expect zero active and queued jobs at return, terminal statuses, identical disk and restart records, and preserved completed controls.
Compare `completedResultsHash` across revisions for every `complete` row.

```ts
import { pathToFileURL } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = process.cwd().replaceAll("\\", "/");
const { Lab } = await import(pathToFileURL(`${root}/packages/observatory/src/lab.ts`).href);
const results = [];
const hash = (v: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(v)).digest("hex");
for (const seed of [1, 7, 11, 23]) for (const concurrency of [1, 2]) for (const phase of ["startup", "child", "complete"]) {
  const dir = await mkdtemp(join(tmpdir(), "lab-shutdown-measure-"));
  const lab = new Lab({ dir, concurrency });
  const drain = async () => {
    const deadline = performance.now() + 30_000;
    while (lab.running && performance.now() < deadline) await Bun.sleep(10);
    if (lab.running) throw Error("Native lab did not finish");
  };
  try {
    const run = await lab.start({ arms: ["consent"], seeds: phase === "complete" ? [seed] : [seed, seed + 1, seed + 2], days: 1 }, "local-measure");
    // get() drains the startup status save; exec resumes and spawns before that read resolves.
    if (phase === "child") await lab.get(run.id);
    if (phase === "complete") await drain();
    const before = await (phase === "complete" ? lab.get(run.id) : Promise.resolve(undefined));
    await lab.dispose();
    const atReturn = { running: lab.running, queued: lab.queued };
    await drain(); // Keep the base run's directory until its escaped child has finished.
    const stopped = await lab.get(run.id);
    const persisted = JSON.parse(await readFile(run.file, "utf8"));
    const reloaded = new Lab({ dir, concurrency });
    let restartSame: boolean;
    try { restartSame = JSON.stringify(await reloaded.get(run.id)) === JSON.stringify(stopped); }
    finally { await reloaded.dispose(); }
    results.push({ seed, concurrency, phase, atReturn, status: stopped.status, progress: stopped.progress,
      results: stopped.results, error: stopped.error ?? null, savedSame: JSON.stringify(persisted) === JSON.stringify(stopped),
      restartSame, completedSame: before ? JSON.stringify(before) === JSON.stringify(stopped) : null,
      completedResultsHash: phase === "complete" ? hash(stopped.results) : null });
  } finally {
    await lab.dispose();
    await drain();
    await rm(dir, { recursive: true, force: true });
  }
}
await Bun.write(process.env.LAB_SHUTDOWN_OUTPUT!, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map(({ seed, concurrency, phase, atReturn, status, progress, restartSame, completedSame, results }) =>
  ({ seed, concurrency, phase, atReturn, status, progress, restartSame, completedSame, results: results.length }))));
```
