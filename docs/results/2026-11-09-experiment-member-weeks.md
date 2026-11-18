# Measure proactive messages over observed membership time

Date: 2026-11-09; updated 2026-11-10 (Asia/Tokyo).
Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Previous PR head: `79c5a49ecde34e900725b370f3d4524b29ccc7b9`.
Runtime: Bun 1.4.2 on Windows; PostgreSQL 16.15 on local port 54339.

## Problem, scope and implementation

The experiment, Observatory scorecards and headless report understate proactive messages per member-week when people join during the observed period.
They multiply the final join count by the whole period, assigning time before each person's join to that person.
This is a reproduced reporting defect under approved scope, CONTRIBUTING 3.1 and PRD 34.4's member-experience metrics.
The simulator judge already uses time since each member's join for its message rates.

The experiment's 14-day seed-1 run has 263 joins and 392 delivered proactive messages.
Its old denominator is 526 member-weeks; recorded joins give 495.457316 member-weeks.
The corrected rate is 0.791, rather than 0.745.

An Observatory seven-day stub world has 80 joins and 60 delivered proactive messages.
Its native join times give 503,724 member-minutes, or 49.972619 member-weeks.
The correct rate is 1.201.
Game mode and the headless report returned 0.750; the database API returned 0.782.
The database reader starts its period at the first join, but still attributed that whole period to every member.

The experiment sums durations from its existing join-time map to the simulated observation time.
The Observatory uses one shared duration function for its scorecards and headless report.
It sums each joined, non-declined member's observed time, clipped to the reporting period.
A missing join timestamp retains the previous whole-period assumption.
The scorecard returns null when no member-time exists; the CLI keeps its existing zero convention.
Both retain their delivered-proactive numerators and three-decimal rounding.

Alternatives considered:

1. Reuse the judge's complete rate. Its proactive-message classifier differs, so that also changes the numerator.
2. Average individual member rates. That weights recent and long-tenured members equally, instead of weighting observed member-time.
3. Fix only one displayed report. The other readers would retain the same reproduced error.

No send, matching, membership, safety or review decision changes.
The cohort remains all joined members, including opted-out members; this is not a new active-member rate.
No UI markup, style or member-facing text changes.
The report selector validation in PR #437 applies cleanly alongside this change and is not a prerequisite.

## measurement: experiment

Twelve native worlds run on both revisions with the same program:

- Consent: seeds 1, 11 and 23 for 14 days; seeds 1-3 for 21 days; seed 1 for two days.
- Push baseline: seed 1 for 21 days. Push-v2: seed 11 for 14 days.
- Two generated 80-person NYC controls, seeds 1 and 11, with all joins at the start of seven days.
- An empty native world with zero people for seven days.

Default experiment arms use the existing 250-person synthetic NYC dataset.
Its manifest SHA-256 is `30a54c830194ba8f0a970d07d942d5f35438109c9f098a33b7e0d19a460ae3e9`.
Controls use the real seeded generator, simulator join actions, ConsentNetwork, simulated review and policy agent, with growth disabled.
Their common start is 2026-10-05 17:00 UTC. No outcome is inserted.
Seeds 11 and 23 were not used to select the fix.

| World | Seed | Days | Proactive messages | Before | After |
|---|---:|---:|---:|---:|---:|
| consent | 1 | 14 | 392 | 0.745 | 0.791 |
| consent | 11 | 14 | 422 | 0.808 | 0.857 |
| consent | 23 | 14 | 428 | 0.829 | 0.872 |
| consent | 1 | 21 | 622 | 0.768 | 0.818 |
| consent | 2 | 21 | 653 | 0.821 | 0.869 |
| consent | 3 | 21 | 570 | 0.717 | 0.758 |
| push_baseline | 1 | 21 | 389 | 0.519 | 0.529 |
| push_v2 | 11 | 14 | 368 | 0.736 | 0.758 |
| consent | 1 | 2 | 31 | 0.434 | 0.545 |
| 80 joins at start | 1 | 7 | 58 | 0.725 | 0.725 |
| 80 joins at start | 11 | 7 | 38 | 0.475 | 0.475 |
| empty | 1 | 7 | 0 | 0 | 0 |

Correct rates improve from 3/12 to 12/12.
All twelve native record hashes, message counts, membership durations and other result fields remain identical.
All three controls retain their complete results.
The final extension re-ran these twelve worlds and reproduced every row from the previously measured fixed experiment.

## measurement: Observatory

The same program runs 21 HTTP-driven worlds per revision and replays each through PostgreSQL and the real-mode HTTP API.
Twenty configurations also run through the actual headless CLI as separate processes.
These repeated views validate reporting paths; they are not independent population samples.

- Sixteen affected configurations: seeds 1, 7, 11 and 23; fixed synthetic NYC or 80 generated personas; consent or stub network.
- Each affected world uses `engine-v1`, seven days and simulated review.
- Four zero-message controls: the same four seeds, 80 generated personas, stub network and engine off for seven days.
- One not-yet-joined control: seed 1, 80 generated personas, consent network, observed immediately after initialization. No CLI repeat.
- Seeds 7, 11 and 23 were not used to select the fix.

| Seed | Population | Network / engine | Before: game / database / CLI | After: each applicable reader |
|---:|---|---|---|---:|
| 1 | fixed synthetic NYC | consent / engine-v1 | 0.749 / 0.749 / 0.749 | 0.809 |
| 1 | fixed synthetic NYC | stub / engine-v1 | 0.568 / 0.568 / 0.568 | 0.603 |
| 1 | 80 generated | consent / engine-v1 | 0.675 / 0.703 / 0.675 | 1.081 |
| 1 | 80 generated | stub / engine-v1 | 0.75 / 0.782 / 0.75 | 1.201 |
| 7 | fixed synthetic NYC | consent / engine-v1 | 0.84 / 0.84 / 0.84 | 0.903 |
| 7 | fixed synthetic NYC | stub / engine-v1 | 0.532 / 0.532 / 0.532 | 0.561 |
| 7 | 80 generated | consent / engine-v1 | 0.763 / 0.794 / 0.763 | 1.165 |
| 7 | 80 generated | stub / engine-v1 | 0.763 / 0.794 / 0.763 | 1.165 |
| 11 | fixed synthetic NYC | consent / engine-v1 | 0.723 / 0.723 / 0.723 | 0.775 |
| 11 | fixed synthetic NYC | stub / engine-v1 | 0.572 / 0.572 / 0.572 | 0.608 |
| 11 | 80 generated | consent / engine-v1 | 0.688 / 0.716 / 0.688 | 0.983 |
| 11 | 80 generated | stub / engine-v1 | 0.813 / 0.846 / 0.813 | 1.162 |
| 23 | fixed synthetic NYC | consent / engine-v1 | 0.746 / 0.746 / 0.746 | 0.801 |
| 23 | fixed synthetic NYC | stub / engine-v1 | 0.544 / 0.544 / 0.544 | 0.58 |
| 23 | 80 generated | consent / engine-v1 | 0.679 / 0.715 / 0.679 | 1.117 |
| 23 | 80 generated | stub / engine-v1 | 0.6 / 0.632 / 0.6 | 0.977 |
| 1 | 80 generated | stub / off | 0 / 0 / 0 | 0 |
| 7 | 80 generated | stub / off | 0 / 0 / 0 | 0 |
| 11 | 80 generated | stub / off | 0 / 0 / 0 | 0 |
| 23 | 80 generated | stub / off | 0 / 0 / 0 | 0 |
| 1 | 80 generated; before joins | consent / engine-v1 | null / null / not run | null |

All 48 affected rate values now match their independently computed reference.
The fourteen control values remain unchanged, including null for an unobserved membership period.
All 21 native record and channel-message hashes remain identical.
All other game and database API state fields match after the explicit normalizations below.
All other fields in the twenty CLI reports match.

The reference sums raw member-minutes from native join events to the observation time.
It then computes `deliveredProactive * 10080 / memberMinutes`, rounded to three decimals.
Database observations use the same simulated observation time, via the repository's existing test-clock facility.
No join, message, decision, outcome or model response is mocked.

The comparisons exclude only:

- The separately measured rate field.
- `run_start.runId` and `run_end.wallMs` from native run hashes.
- `engineRuns[].wallMs` and `engineRuns[].timingsMs` from API state hashes.
- The isolated test database name from the real-mode environment descriptor.
- `world.wallMs` from CLI reports.

Every remaining field stays in the comparison, including all other scorecard metrics, members, opportunities, graph edges and safety values.
No timing improvement or statistical matching-quality improvement is claimed.

Artifact SHA-256 values:

- member-weeks-before.json: `820203406b006d0adf3f4071e3d5e1c7b15d8e26b43d65209bbeccf4fc7eac3d`.
- obs-attention-experiment-after.json: `8fad7cbef164c438620a35b0418c9e5ce5c9e028c3174464ba0478d17cb0c92e`.
- obs-attention-before.json: `bbfeb4b61613537ae4e458159c2aebefd9d23c54bf5e88ca6635f4eeb499983a`.
- obs-attention-after.json: `97b2ebcf29a8a25b325b6d71a71ee84dcbf2e0363bb0f8288b273bb4ab171475`.
- lab-matching-gates-before.json: `3f270a8380a1ba214b2351acaa9d877c1ad25464c8171fb295edd582cb63043c`.
- obs-attention-gates-after.json: `8dc85321a4794a0307ce0c2f256edddc3c700d32f18facfd8a7c61a41fb06aec`.

## Regression and attempts

One expanded integration case runs the original experiment, a real Observatory HTTP server, PostgreSQL replay and the headless CLI.
The original experiment assertions check 263 joins, 392 messages and 4,994,210 rounded member-minutes.
The Observatory assertions check 80 joins, 60 messages and 503,724 rounded member-minutes before comparing the three rates.

- Original case on main: fails on 0.745 versus 0.791. The original fix passed its two assertions.
- Expanded case on the previous PR head: 0 pass, 1 fail, eight assertions, 18.76 seconds.
- Its three Observatory values were 0.750, 0.782 and 0.750 instead of 1.201.
- Final expanded case: 1 pass, 0 fail, eight assertions, 18.27 seconds.
- The case also passed inside the official integration command: 24014.34ms.

The first broad API-state comparison included engine execution times and failed.
A diagnostic pair showed only the intended rate, those execution times and the temporary database name differed.
Both revisions were re-measured with the documented normalization; no production change was needed for that correction.
The production implementation passed its first expanded regression run.

## safety_gates

All 21 Observatory judge results remain unchanged.
The fixed synthetic stub world at seed 11 retains three existing `decliner_exposed` violations.
The other twenty Observatory worlds have zero violations; all 21 have zero canary leaks and minor contacts.
Their native records and message logs are unchanged. CLI judge fields remain in the unchanged-report comparison.
All twelve experiment judge results remain unchanged.
One existing push-baseline experiment control retains nine violations: six `over_budget` and three `decliner_exposed`.
Its leaks and minor contacts remain zero; the other eleven experiment worlds have zero violations, leaks and minor contacts.
No clean safety result is claimed for either of those baseline worlds.

Final command: `bun run sim --only network,audit,ops --json <output>`.
The unchanged main baseline passed 91/91 blocking gates and all three tracked gates in 249.6 seconds.
The final candidate passed 91/91 blocking gates and all three tracked gates in 237.4 seconds.
Ninety-three of 94 semantic gate records are identical after elapsed times are removed.
The consent-versus-push fingerprint changes only because it includes the corrected experiment rate.
The comparator reconstructs both fingerprints from the four pinned arm results and verifies every other field is unchanged.
The Observatory extension introduces no further fingerprint change.

Pinned checks include the seed-3 invariant world for ten days, consent seeds 1-3 and push seed 1 for 21 days,
all NYC scenarios, simulator scenarios at pass^3 and pack conformance seeds 1-4.
Base evidence is reused from the same clean main commit and unchanged dependency environment.
Candidate gates run afresh. AGENTS.md's one-full-simulation-per-agent limit was already used earlier; no new full-run result is claimed.
All people are synthetic; automatic review is simulated.
Provider, live-send and deployment flags were cleared.
The isolated database was stopped after all tests, with zero other clients.

## Required validation

- Frozen install: 50 installs across 44 packages checked; no changes.
- `bun run typecheck`: all four configurations passed.
- Integration, including the security files: 676 pass, 8 skip, 6 fail; 13749 assertions; 690 tests in 69 files, 467.39s.
- Six failures match the reproduced Windows base by name and cause: missing `/bin/bash`, SIGTERM exit 143 versus 0, four path-separator assertions.
- Eight integration skips match the previous full validation, including repeated unnamed entries.
- End-to-end: 42 pass, 1 skip, 0 fail; 654 assertions; 43 tests in 3 files, 36.52s. The optional browser SDK case remains skipped.
- `git diff --check`: passed.

The local integration suite is not fully green. No failure is suppressed or converted to a pass.

## llm_evidence and agent_clients

N/A: elapsed-time reporting consumes simulator state and makes no model calls.
Real-model calls: 0; model API cost: $0; model request settings: N/A.
No member-facing agent flow changes.
Codex desktop 26.1103.4239.0 drove Bun 1.4.2 on Windows.
Provider: OpenAI; the exact assistant model identifier was unavailable and is not inferred.
No other client, browser or computer-use workflow is claimed as tested.

## Reproduce

1. Run `bun install --frozen-lockfile` and start isolated PostgreSQL on port 54339.
2. Put PostgreSQL binaries on `PATH`; set `USER=postgres`, `OBSERVATORY_PG_PORT=54339`, and `OBSERVATORY_PG_DIR` to that isolated cluster.
3. Set `REQUIRE_PG=1` and run `bun test --conditions eliza-source packages/network/test/experiment-exposure.integration.test.ts`.
4. Expect one passing case with eight assertions.
5. Run `bun run --conditions eliza-source packages/observatory/src/report.ts --days 7 --seed 1 --personas 80 --network stub`.
6. Expect `people.proactivePerMemberPerWeek` to equal 1.201.
7. Save the programs below outside separate base and candidate checkouts and run them from each checkout.

```sh
bun run --conditions eliza-source ../member-weeks-measure.ts ../experiment-before.json
bun run --conditions eliza-source ../obs-attention-measure.ts ../observatory-before.json
bun run sim --only network,audit,ops --json ../all-gates-before.json
# Repeat in the candidate checkout, writing the corresponding after files.
bun -e 'for (const side of ["before", "after"]) { const x = await Bun.file("../all-gates-" + side + ".json").json(); await Bun.write("../network-" + side + ".json", JSON.stringify({ gates: x.gates.filter(g => g.block === "network") })); }'
bun ../obs-attention-compare.ts ../observatory-before.json ../observatory-after.json
bun ../member-weeks-compare.ts ../experiment-before.json ../experiment-after.json ../network-before.json ../network-after.json
bun ../obs-attention-gates-compare.ts ../all-gates-before.json ../all-gates-after.json
```

### member-weeks-measure.ts

```ts
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const { runArm, summarize } = await import(pathToFileURL(`${root}/packages/network/harness/experiment.ts`).href);
const { generatePersonas, World, PolicyPersonaAgent } = await import(pathToFileURL(`${root}/packages/sim/src/index.ts`).href);
const { ConsentNetwork } = await import(pathToFileURL(`${root}/packages/network/src/network.ts`).href);
const output = process.argv[2];
if (!output) throw new Error("Pass an output JSON path");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const cases = [
  ...[1, 11, 23].map(seed => ({ kind: "arm", arm: "consent", seed, days: 14 })),
  ...[1, 2, 3].map(seed => ({ kind: "arm", arm: "consent", seed, days: 21 })),
  { kind: "arm", arm: "push_baseline", seed: 1, days: 21 },
  { kind: "arm", arm: "push_v2", seed: 11, days: 14 },
  { kind: "arm", arm: "consent", seed: 1, days: 2 },
  ...[1, 11].map(seed => ({ kind: "fixed-joins", arm: "consent", seed, days: 7, n: 80 })),
  { kind: "fixed-joins", arm: "consent", seed: 1, days: 7, n: 0 },
];
const rows = [];
for (const c of cases) {
  let records: any[] = [];
  let result;
  if (c.kind === "arm") {
    result = await runArm(c.arm, { days: c.days, seed: c.seed, onRecords: (r: any[]) => records = r });
  } else {
    const start = Date.UTC(2026, 9, 5, 17);
    const personas = generatePersonas({ n: c.n, seed: c.seed, cityWeights: { nyc: 1 } });
    const network = new ConsentNetwork({ seed: c.seed, review: "auto", growth: false });
    const w = new World({ seed: c.seed, days: c.days, start, personas, network, writeLog: false, plans: true,
      agent: new PolicyPersonaAgent(start, { plans: true }),
      actions: personas.map((p: any) => ({ at: start, action: { do: "join", persona: p.id } })),
      onRecord: (r: any) => records.push(r) });
    await w.begin(); await w.advanceTo(w.end); await w.complete();
    result = summarize(c.arm, c.days, records, w, network);
  }
  const start = records.find(r => r.type === "run_start").start;
  const end = records.find(r => r.type === "run_end").simEnd;
  const joins = records.filter(r => r.type === "join");
  const proactive = records.filter(r => r.type === "message" && r.msg.direction === "outbound" && r.msg.meta?.proactive && r.msg.status === "delivered").length;
  const memberMinutes = joins.reduce((sum, r) => sum + (end - r.t) / 60_000, 0);
  const expected = memberMinutes ? Math.round(proactive * 10_080 / memberMinutes * 1000) / 1000 : 0;
  const normalized = records.map(r => {
    if (r.type === "run_start") { const { runId, ...rest } = r; return rest; }
    if (r.type === "run_end") { const { wallMs, ...rest } = r; return rest; }
    return r;
  });
  rows.push({ ...c, joined: joins.length, laterJoins: joins.filter(r => r.t > start).length,
    proactive, memberMinutes, expected, records: records.length, recordHash: hash(normalized), result });
  console.error(JSON.stringify({ ...c, proactive, memberMinutes, expected, actual: result.proactivePerMemberWeek }));
}
const git = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
const [revision, exit] = await Promise.all([new Response(git.stdout).text(), git.exited]);
if (exit !== 0) throw new Error("Cannot read revision");
await Bun.write(output, JSON.stringify({ revision: revision.trim(), rows }, null, 2) + "\n");
```

### member-weeks-compare.ts

```ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const [beforePath, afterPath, beforeGatesPath, afterGatesPath] = process.argv.slice(2);
if (!beforePath || !afterPath || !beforeGatesPath || !afterGatesPath) throw new Error("Pass before/after measurement and gate paths");
const before = await Bun.file(beforePath).json(), after = await Bun.file(afterPath).json();
assert.equal(before.rows.length, 12); assert.equal(after.rows.length, 12);
let beforeCorrect = 0, afterCorrect = 0, controls = 0;
const changes = [];
for (let i = 0; i < before.rows.length; i++) {
  const a = before.rows[i], b = after.rows[i];
  const { proactivePerMemberWeek: oldRate, ...oldRest } = a.result;
  const { proactivePerMemberWeek: newRate, ...newRest } = b.result;
  assert.deepEqual({ ...a, result: oldRest }, { ...b, result: newRest });
  assert.equal(newRate, b.expected);
  if (oldRate === a.expected) beforeCorrect++;
  if (newRate === b.expected) afterCorrect++;
  if (a.kind === "fixed-joins") {
    assert.equal(a.laterJoins, 0);
    assert.equal(a.memberMinutes, a.n * a.days * 1440);
    assert.deepEqual(a, b); controls++;
  } else {
    assert.ok(a.laterJoins > 0);
    assert.ok(newRate > oldRate);
    changes.push({ arm: a.arm, seed: a.seed, days: a.days, joined: a.joined,
      proactive: a.proactive, memberMinutes: a.memberMinutes, before: oldRate, after: newRate });
  }
}
assert.equal(beforeCorrect, 3); assert.equal(afterCorrect, 12); assert.equal(controls, 3);
const oldGates = (await Bun.file(beforeGatesPath).json()).gates;
const newGates = (await Bun.file(afterGatesPath).json()).gates;
const fingerprint = "fingerprint: consent vs push arms";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
const pinned = (data: any) => [
  data.rows.find((r: any) => r.arm === "push_baseline" && r.days === 21).result,
  ...[1, 2, 3].map(seed => data.rows.find((r: any) => r.kind === "arm" && r.arm === "consent" && r.days === 21 && r.seed === seed).result),
];
assert.equal(oldGates.find((g: any) => g.name === fingerprint).detail, digest(pinned(before)));
assert.equal(newGates.find((g: any) => g.name === fingerprint).detail, digest(pinned(after)));
const normalized = (gates: any[]) => gates.filter(g => g.name !== fingerprint).map(({ ms, ...rest }) => rest);
assert.equal(newGates.length, 63);
assert.equal(newGates.filter((g: any) => g.blocking).length, 61);
assert.ok(newGates.every((g: any) => g.pass));
assert.deepEqual(normalized(oldGates), normalized(newGates));
assert.deepEqual(oldGates.map((g: any) => ({ name: g.name, pass: g.pass, blocking: g.blocking })),
  newGates.map((g: any) => ({ name: g.name, pass: g.pass, blocking: g.blocking })));
console.log(JSON.stringify({ runs: 12, beforeCorrect, afterCorrect, controls, changes,
  identicalRecordHashes: 12, identicalOtherResultFields: 12,
  judges: after.rows.map((r: any) => ({ kind: r.kind, arm: r.arm, seed: r.seed, days: r.days, n: r.n, ...r.result.judge })),
  gates: { records: 63, blocking: 61, failed: 0, identicalRecords: 62,
    fingerprintBefore: digest(pinned(before)), fingerprintAfter: digest(pinned(after)),
    fingerprintChangeAccountedFor: true } }, null, 2));
```

### obs-attention-measure.ts

```ts
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setSystemTime } from "bun:test";
import { SQL } from "bun";
const root = process.cwd(), output = process.argv[2];
if (!output) throw new Error("Pass an output JSON path");
const from = (path: string) => import(pathToFileURL(join(root, path)).href);
const { createServer } = await from("packages/observatory/src/server.ts");
const { rowsFromGame, writeRows } = await from("packages/observatory/db/writer.ts");
const { testDb, dropTestDb } = await from("packages/observatory/test/pg.ts");
const DAY = 86_400_000;
const hash = (x: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex");
const cases = [
  ...[1, 7, 11, 23].flatMap(seed => [0, 80].flatMap(personas => ["consent", "stub"].map(network =>
    ({ seed, personas, network, engine: "engine-v1", days: 7, stepDays: 7, cli: true })))),
  ...[1, 7, 11, 23].map(seed => ({ seed, personas: 80, network: "stub", engine: "off", days: 7, stepDays: 7, cli: true })),
  { seed: 1, personas: 80, network: "consent", engine: "engine-v1", days: 7, stepDays: 0, cli: false },
];
const debug = process.argv[3] === "--one";
if (debug) cases.splice(1);
const rows: unknown[] = [];
const url = await testDb(), sql = new SQL(url);
try {
  for (const [index, c] of cases.entries()) {
    const dir = resolve(root, "..", "obs-attention-measure", `${process.pid}-${index}`);
    const token = "local-observed-member-time-000000000";
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const server = await createServer({ port: 0, development: false, token, staffRolesUrl: false, peopleUrl: false,
      audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
      game: { ...c, review: "auto", pushMs: 3_600_000, tickMs: 3_600_000 },
      real: { url, service: false, pollMs: 3_600_000, pushMs: 3_600_000 },
    });
    try {
      const source = await server.source("game", "ntwrk");
      if (c.stepDays) {
        const step = await fetch(`${server.url}/api/control`, { method: "POST", headers, body: JSON.stringify({ type: "step", ms: c.stepDays * DAY }) });
        assert.ok(step.ok && (await step.json()).ok);
      }
      const state = () => fetch(`${server.url}/api/state`, { headers }).then(r => r.json());
      const gs = await state();
      const native = source.world.records.map((r: any) => {
        if (r.type === "run_start") { const { runId, ...rest } = r; return rest; }
        if (r.type === "run_end") { const { wallMs, ...rest } = r; return rest; }
        return r;
      });
      const joins = native.filter((r: any) => r.type === "join");
      const memberMinutes = joins.reduce((sum: number, r: any) => sum + (gs.clock.now - r.t) / 60_000, 0);
      const proactive = source.world.channel.all().filter((m: any) => !m.system && m.direction === "outbound" && m.meta?.proactive && m.status === "delivered").length;
      const expected = memberMinutes ? Math.round(proactive * 10_080 / memberMinutes * 1000) / 1000 : null;
      const rawRows = rowsFromGame(source);
      await writeRows(sql, rawRows, { truncate: true });
      setSystemTime(new Date(gs.clock.now));
      const switched = await fetch(`${server.url}/api/mode`, { method: "POST", headers, body: JSON.stringify({ mode: "real" }) });
      assert.ok(switched.ok && (await switched.json()).ok);
      const rs = await state();
      assert.equal(rs.env.error, undefined);
      if (debug) {
        await Bun.write(output + ".game.json", JSON.stringify(gs, null, 2));
        await Bun.write(output + ".real.json", JSON.stringify(rs, null, 2));
      }
      let report: any = null;
      if (c.cli) {
        const p = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source", "packages/observatory/src/report.ts",
          "--days", String(c.days), "--seed", String(c.seed), "--personas", String(c.personas), "--network", c.network, "--engine", c.engine],
          { cwd: root, stdout: "pipe", stderr: "pipe" });
        const [exit, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
        if (exit !== 0) throw new Error(stderr);
        report = JSON.parse(stdout);
        delete report.world.wallMs;
      }
      const metric = (s: any) => s.stats.scorecard.find((m: any) => m.key === "attention_burden");
      assert.equal(metric(gs).n, proactive); assert.equal(metric(rs).n, proactive);
      const rates = { game: metric(gs).value, database: metric(rs).value, report: report?.people.proactivePerMemberPerWeek ?? null };
      const stateHash = (s: any) => {
        const copy = structuredClone(s);
        metric(copy).value = "<measured separately>";
        if (copy.env.database) copy.env.database = "<isolated local database>";
        for (const run of copy.engineRuns) { delete run.wallMs; delete run.timingsMs; }
        return hash(copy);
      };
      const reportCopy = structuredClone(report);
      if (reportCopy) reportCopy.people.proactivePerMemberPerWeek = "<measured separately>";
      rows.push({ ...c, joined: joins.length, proactive, memberMinutes, expected, rates, judge: gs.stats.judge,
        nativeHash: hash(native), messageHash: hash(source.world.channel.all()),
        gameStateHash: stateHash(gs), databaseStateHash: stateHash(rs), reportHash: hash(reportCopy) });
      console.error(JSON.stringify({ ...c, expected, rates, judge: gs.stats.judge }));
    } finally { await server.stop(); setSystemTime(); }
  }
} finally { await sql.close(); await dropTestDb(); setSystemTime(); }
await Bun.write(output, JSON.stringify(rows, null, 2) + "\n");
```

### obs-attention-compare.ts

```ts
import assert from "node:assert/strict";
const [before, after] = await Promise.all(process.argv.slice(2).map(path => Bun.file(path).json()));
assert.equal(before.length, 21); assert.equal(after.length, 21);
const changes: unknown[] = [];
let corrected = 0, unchanged = 0;
for (let i = 0; i < before.length; i++) {
  const { rates: a, ...oldRest } = before[i], { rates: b, ...newRest } = after[i];
  assert.deepEqual(newRest, oldRest, `Native records, API state or report fields changed in case ${i}`);
  for (const key of ["game", "database", ...(after[i].cli ? ["report"] : [])]) {
    assert.equal(b[key], after[i].expected);
    if (a[key] === b[key]) unchanged++;
    else { assert.ok(b[key] > a[key]); corrected++; }
  }
  if (i >= 16) assert.deepEqual(before[i], after[i]);
  changes.push({ seed: after[i].seed, personas: after[i].personas, network: after[i].network,
    engine: after[i].engine, stepDays: after[i].stepDays, joined: after[i].joined,
    proactive: after[i].proactive, memberMinutes: after[i].memberMinutes, expected: after[i].expected,
    before: a, after: b });
}
assert.equal(corrected, 48); assert.equal(unchanged, 14);
console.log(JSON.stringify({ worlds: 21, cliRepeats: 20, correctedRates: corrected, unchangedControlRates: unchanged,
  unchangedNativeRecords: 21, unchangedOtherGameAndDatabaseState: 21, unchangedOtherReports: 20,
  nonzeroJudges: after.filter((r: any) => r.judge && (r.judge.invariants || r.judge.canaryLeaks || r.judge.minorContacts))
    .map((r: any) => ({ seed: r.seed, personas: r.personas, network: r.network, ...r.judge })), changes }, null, 2));
```

### obs-attention-gates-compare.ts

```ts
import assert from "node:assert/strict";
const [before, after] = await Promise.all(process.argv.slice(2).map(path => Bun.file(path).json()));
const fingerprint = "fingerprint: consent vs push arms";
const normalize = (gates: any[]) => gates.filter(g => g.name !== fingerprint).map(({ ms, ...rest }) => ({ ...rest,
  name: rest.name.startsWith("backup drill:") ? rest.name.replace(/restore \d+ ms$/, "restore <elapsed> ms") : rest.name,
}));
assert.equal(before.gates.length, 94); assert.equal(after.gates.length, 94);
assert.equal(after.gates.filter((g: any) => g.blocking).length, 91);
assert.ok(after.gates.every((g: any) => g.pass));
assert.deepEqual(normalize(after.gates), normalize(before.gates));
assert.deepEqual(after.gates.map((g: any) => [g.block, g.name.startsWith("backup drill:") ? "backup drill" : g.name, g.pass, g.blocking]),
  before.gates.map((g: any) => [g.block, g.name.startsWith("backup drill:") ? "backup drill" : g.name, g.pass, g.blocking]));
await Bun.write("../obs-attention-network-after.json", JSON.stringify({ gates: after.gates.filter((g: any) => g.block === "network") }, null, 2) + "\n");
console.log(JSON.stringify({ records: 94, blocking: 91, failed: 0, identicalRecords: 93,
  fingerprintBefore: before.gates.find((g: any) => g.name === fingerprint).detail,
  fingerprintAfter: after.gates.find((g: any) => g.name === fingerprint).detail }, null, 2));
```
