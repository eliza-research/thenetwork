# Preserve lab run records across quick restarts

Date: 2026-11-09 (Asia/Tokyo).
Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2 on Windows; PostgreSQL 16.15 for the official suites.

## Problem and requirement

A lab restart within one second can reuse the previous run's ID and overwrite its saved record.
The old ID then returns the new request, and the history contains only one run.
This is a reproduced persistence defect under CONTRIBUTING 3.1 and PRD 35's simulation lab.
`docs/observatory.md` 9.6 requires saved runs to load again at startup.

The ID combines a timestamp truncated to seconds with a counter that starts at zero in each Lab instance.
Loading earlier records does not advance that counter.
The next run can therefore replace an existing map entry and its JSON file.
Both writers have stopped in the reproduction; this is not a concurrent file-write failure.

Use Node's built-in `randomUUID` for the suffix and remove the per-instance counter.
Keep the timestamp prefix. The loader still accepts existing IDs as stored, without a format parser or migration.
No dependency is added.

Alternatives considered:

1. Resume the counter from loaded files. This needs suffix parsing and does not protect independent instances that loaded the same history.
2. Include milliseconds in the timestamp. A time-based suffix can still repeat across instances or clock adjustments.

This is separate from PR #424, which stops and drains lab jobs during shutdown.
This change only allocates IDs. There is no UI, style, member-facing copy, scheduling, or matching-policy change.

## measurement

The initial native-lab probe used seed bases 1, 7, 11, and 23.
It started a real experiment child, awaited the startup status write, stopped the child, and waited for its final save.
It then opened a new Lab on the same directory and started a different seed within the same second.
The restart intervals were 16, 12, 12, and 13 ms. All four attempts reused the ID and replaced the prior file.
The filesystem and clock were real; no clock patch, fake child, or fabricated run record was used.

The single new integration case exercises that same restart with seeds 1 and 2.
It requires different IDs, byte-for-byte preservation of the prior file, two JSON files, and both original requests after reload.
It starts near a real second boundary so the regression reaches the colliding timestamp.
It retries only if machine scheduling carries the pair into different seconds, with a limit of three attempts.

Command, with the same new case copied into the base checkout:

```sh
bun test --conditions eliza-source packages/observatory/test/lab-run-ids.integration.test.ts
```

| Check | Base | Fix |
|---|---|---|
| Regression | 0 pass, 1 fail; 743.83 ms | 1 pass, 0 fail; 917.74 ms; 4 assertions |
| IDs after a same-second restart | Same | Different |
| Previous file preserved | No | Yes |
| Run records available after reload | 1 | 2 |

The paired measurement below runs 24 cases on each revision.
It uses seed bases 1, 7, 11, and 23, both `ntwrk` and `friends` request metadata, and concurrency 1.
All children use the repository's real one-day consent experiment.
Eight cases restart between seed `s` and seed `s+1` within one second.
Eight controls queue both requests in the same Lab instance before stopping it.
Eight controls let seed `s` finish, then reload its saved result.
The initial reproduction selected the fix; these controls and app variants confirm the behavior without tuning.

| Measurement | Base | Fix |
|---|---|---|
| Restart ID collisions | 8/8 | 0/8 |
| Restart cases preserving the previous file's exact bytes | 0/8 | 8/8 |
| Same-instance controls preserving both request identities | 8/8 | 8/8 |
| Completed controls preserving their full saved records on reload | 8/8 | 8/8 |
| Longest interval between paired starts | 20 ms | 16 ms |

All eight completed-result hashes match between revisions.
They include every parsed arm result: acceptance, meetings, and safety fields.
For same-instance controls, the first child's status legitimately changes when stopped.
Those controls compare request identity and author, not byte equality across an active job's final save.
The complete program below defines the comparisons exactly.

## safety_gates

The native consent experiment uses synthetic NYC data and the simulated reviewer (`review: "auto"`).
All eight completed controls have zero judge invariants, zero canary leaks, and zero minor contacts on both revisions.
Interrupted jobs do not supply completed judge results and are not counted as safety passes.
The existing child environment allowlist is unchanged; no live-send flags, credentials, or provider keys are passed to the child.

`bun run sim --only audit,ops --json <output>` passes 30/30 blocking gates on both revisions, with no tracked misses.
All 31 records match after excluding elapsed time, including the backup-drill duration in its name.
Base duration: 31 seconds. Fixed duration: 25.7 seconds.
The blocks use real isolated PostgreSQL and the repository's fixed fixtures.
The full simulation was not repeated: AGENTS.md permits one full run per agent, already used for PR #355.

## Validation

`bun install --frozen-lockfile`: 50 installs across 44 packages checked, with no changes.
`bun run typecheck`: all four configurations pass.

`bun run test:integration`: 676 pass, 8 skip, 6 fail; 13,745 assertions across 69 files; 439.02 seconds.
The new regression passes inside this suite in 1,062.52 ms. The official integration command includes the security suite.
All six failures match the previously reproduced base failures in both test names and causes:

- `deploy/wrangler.integration.test.ts`: `/bin/bash` is unavailable on Windows.
- `deploy/backend/backend.test.ts`: SIGTERM returns 143 instead of the expected 0.
- `sites/test/sites.test.ts`: four assertions expect slash-separated paths, while Windows returns backslashes.

The eight skips are existing optional cleanup-reconciliation cases.
`bun run test:e2e`: 42 pass, 1 skip, 0 fail; 654 assertions; 34.82 seconds.
The skipped case requires the optional browser SDK environment. Browser acceptance is not claimed.
All test and measurement processes finished; the isolated database had no other clients and was stopped afterwards.
A fully green local integration suite is not claimed.

## llm_evidence

N/A: this changes run identity and persistence, not model-backed behavior.
Real-model calls: 0. Cost: $0. No provider request settings apply.

## agent_clients

Codex desktop 26.1103.4239.0 drove Bun 1.4.2, with OpenAI assistance.
The exact assistant model identifier was not exposed; disclosure uses the helper's supported `unavailable` value.
N/A for other agent clients: this changes the local simulation lab's records, not a member-facing agent integration.
No browser or computer use was performed. No other client is claimed as tested.

## Limits

New IDs are longer and have UUID suffixes; callers must continue treating them as opaque strings.
The timestamp remains readable. Existing files keep their IDs and are loaded through the unchanged reader.
This prevents the reproduced collision; it cannot recover a record that was already overwritten.
It does not add filesystem locking, repair corrupted files, or change shutdown handling.
No secrets, real member data, or raw conversations are included.

## Reproduce the paired measurement

Save the program below outside each checkout as `../lab-run-ids-measure.ts`.
Run it from the base and fixed repository roots with the same program.
Use the repository's synthetic data and clear provider keys and live-send flags.

```powershell
$env:LAB_RUN_IDS_OUTPUT = '../lab-run-ids-before.json' # use lab-run-ids-after.json on the fixed branch
bun run --conditions eliza-source ../lab-run-ids-measure.ts
```

Compare rows by seed, app, and mode.
After the fix, every restart row must have `distinct: true`, `preserved: true`, two files, and both original requests.
The same-instance controls must preserve both request identities on both revisions.
Compare `resultsHash` between revisions for each completed control, and require its full record to survive reload unchanged.

```ts
import { pathToFileURL } from "node:url";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = process.cwd().replaceAll("\\", "/");
const { Lab } = await import(pathToFileURL(`${root}/packages/observatory/src/lab.ts`).href);
const results = [];
const hash = (v: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(v)).digest("hex");
const drain = async (lab: InstanceType<typeof Lab>) => {
  const deadline = performance.now() + 30_000;
  while (lab.running && performance.now() < deadline) await Bun.sleep(1);
  if (lab.running) throw Error("Native child still active");
};
const stop = async (lab: InstanceType<typeof Lab>) => { await lab.dispose(); await drain(lab); };
for (const seed of [1, 7, 11, 23]) for (const app of ["ntwrk", "friends"] as const) for (const mode of ["restart", "same-instance", "complete"]) {
  const dir = await mkdtemp(join(tmpdir(), "lab-run-ids-measure-")), labs: InstanceType<typeof Lab>[] = [];
  const first = new Lab({ dir, concurrency: 1 }); labs.push(first);
  try {
    await first.list();
    if (mode !== "complete") await Bun.sleep(1000 - Date.now() % 1000 + 5);
    const a = await first.start({ arms: ["consent"], seeds: [seed], days: 1, app }, "first-instance");
    await first.get(a.id);
    if (mode === "complete") {
      await drain(first);
      const completed = await first.get(a.id);
      await stop(first);
      const next = new Lab({ dir }); labs.push(next);
      const reloaded = await next.get(a.id);
      results.push({ seed, app, mode, status: completed.status, preserved: JSON.stringify(completed) === JSON.stringify(reloaded),
        results: completed.results, resultsHash: hash(completed.results) });
      continue;
    }
    // Restart only after the old child has exited. The same-instance control queues another run
    // while the first child is active, using the normal public start/stop methods.
    if (mode === "restart") await stop(first);
    const saved = mode === "restart" ? await readFile(a.file, "utf8") : undefined;
    const second = mode === "restart" ? new Lab({ dir, concurrency: 1 }) : first;
    if (second !== first) labs.push(second);
    const b = await second.start({ arms: ["consent"], seeds: [seed + 1], days: 1, app }, "second-instance");
    await second.get(b.id);
    await stop(second);
    if (Math.floor(a.createdAt / 1000) !== Math.floor(b.createdAt / 1000)) throw Error("Pair crossed a second boundary");
    const third = new Lab({ dir }); labs.push(third);
    const loaded = await third.list();
    const old = await third.get(a.id);
    results.push({ seed, app, mode, distinct: a.id !== b.id, elapsedMs: b.createdAt - a.createdAt,
      preserved: saved !== undefined ? saved === await readFile(a.file, "utf8") :
        JSON.stringify(old?.request) === JSON.stringify(a.request) && old?.requestedBy === a.requestedBy,
      files: (await readdir(dir)).filter(f => f.endsWith(".json")).length,
      loadedRequests: loaded.map(r => ({ seed: r.request.seeds[0], by: r.requestedBy, app: r.request.app })).sort((x, y) => x.seed! - y.seed!),
      oldRequest: old?.request, newRequest: (await third.get(b.id))?.request });
  } finally { for (const lab of labs) await stop(lab); await rm(dir, { recursive: true, force: true }); }
}
await Bun.write(process.env.LAB_RUN_IDS_OUTPUT!, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map(({ seed, app, mode, distinct, elapsedMs, preserved, files, status }) =>
  ({ seed, app, mode, distinct, elapsedMs, preserved, files, status }))));
```
