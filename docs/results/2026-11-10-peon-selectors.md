# Peon evaluation selectors (2026-11-10)

## Defect and scope

The Peon CLI treats every `--realism` value except `v1` as V2. A typo can run the wrong simulation profile. It also runs gates only when both the named gate arm and keyword results exist. An unknown or unselected explicit `--gate-arm` silently skips the gates. Omitting keyword from an explicitly requested gate comparison has the same effect.

This is a reproduced simulation-validation defect under the approved Slop scope, CONTRIBUTING 3.1 and PRD Sections 34.1–34.4. The documented Peon gate workflow compares the selected arm with keyword results on the same seeds. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

The fix validates the realism name against `v1` and `v2`. An explicit gate selector must name a registered arm included in `--arms`, and keyword must also be selected. Validation runs before any world or output table. Omitted realism still means V2. Without an explicit gate selector, existing automatic pack comparisons and single-arm diagnostic runs behave as before. Oracle remains optional for gate comparison, as in the current CLI.

One integration case invokes the actual CLI in child Bun processes. It checks seven invalid selections, the default and both valid profiles, and a valid explicit ablation gate. It uses generated populations, native matchers and the existing gate implementation. The same final case fails before and passes after: **0 pass / 1 fail / 1 assertion → 1 pass / 0 fail / 38 assertions**. Before, `--gate-arm pak` exits 0. Case runtime: 873.49 ms before and 2189.72 ms after; suite runtime: 888 ms and 2.20 s. The first failure stops the before case, so these times do not compare performance.

## measurement

The same program runs **128 CLI workflows per revision**. Each uses 80 candidates and 30 jobs per city in NYC and SF, for eight weeks. It covers all 17 registered arms, the default profile and explicit V1/V2, and seeds 5, 7, 13 and 16.

| Matrix | Workflows | Settings |
|---|---|---|
| Every arm and profile | 51 | 17 arms × default/V1/V2, seed 7, each arm alone |
| Additional core controls | 27 | keyword/oracle/pack × default/V1/V2 × seeds 5, 13, 16 |
| Explicit gate controls | 17 | each registered arm, plus keyword and oracle, seed 7 |
| Default-arm controls | 3 | omitted `--arms`, default/V1/V2, seed 7 |
| Invalid realism | 14 | two seeds × unknown, case mismatch, blank, whitespace, typo, missing value, following flag |
| Invalid explicit gates | 16 | two seeds × unknown, blank, whitespace, inherited object name, missing value, following flag, unselected arm, missing keyword |

The 98 valid workflows run 142 native worlds per revision. Some are repeated controls for equivalent CLI forms, not independent samples. Half of the invalid commands start with an existing report file; the rest start without one. The program retains complete JSON metrics, hashes the exact report and standard output, and normalizes only progress durations in standard error. It compares exit codes, profile names, gate presence and artifact state too. Inputs, populations, model parameters and thresholds stay fixed.

| Observed result | Before | After |
| --- | --- | --- |
| Invalid selectors that start simulation | 30 | 0 |
| Invalid selectors that exit successfully | 28 | 0 |
| Invalid selectors that create or overwrite reports | 28 | 0 |
| Valid workflow records identical across revisions | — | 98/98 |
| Valid gated workflows that fail gates and exit 1 | 20 | 20 |
| Existing report files preserved on invalid input | 1 | 15 |
| Fresh report files absent on invalid input | 1 | 15 |

### A failing evaluation reported success

At seed 7, `--arms keyword,oracle,pack --gate-arm pack` prints the official gates and exits 1 because this small comparison fails gates. Changing only `pack` to `pak` originally writes the exact same metrics, omits the gates and exits 0. After the fix, `pak` exits 1 before producing a table or report. The valid failing comparison remains unchanged.

Likewise, `--arms keyword --realism v3` originally writes exactly the V2 report at seed 7. After the fix, it fails with `--realism must be v1 or v2`. Default realism and explicit V2 still produce identical reports. V1 remains distinct.

The two inherited-name (`__proto__`) cases already exited 1, but only after running the worlds and printing their metrics. They now fail before simulation, like the other invalid selectors. The other 28 invalid commands previously exited 0 and wrote reports.

These exact paired CLI comparisons prove selector and output behavior. They do not claim better matching, statistical significance or real-world outcomes. The report-preservation check uses a hand-written sentinel file. Member populations and all evaluation outputs come from repository code.

## safety_gates

The same `bun run sim --only peon --json <output>` command passes **27/27 blocking gates before and after**. All **28 complete gate records** are identical after excluding execution duration, including the arm fingerprint. The one tracked record passes. Runtime: 32.5s before and 33.1s after. Gate definitions, thresholds and simulation parameters are unchanged.

Every safety field in all 142 valid native-world results is identical before and after. Some baseline and ablation arms intentionally expose unsafe outcomes. Their repeated-run totals below remain visible; these arms are not claimed safe. The summed reach count counts candidates per world, not distinct people across the matrix.

| Safety field (sum across repeated valid worlds) | Before | After |
| --- | --- | --- |
| `minorsMatched` | 0 | 0 |
| `minorsProposed` | 0 | 0 |
| `scamIntros` | 2250 | 2250 |
| `scamReach` | 362 | 362 |
| `unverifiedIntros` | 2909 | 2909 |
| `noRangeIntros` | 8535 | 8535 |
| `fakeReachedEmployer` | 533 | 533 |
| `fakeHires` | 0 | 0 |

## Validation

- All four TypeScript configurations pass.
- Integration, including the security suite:

```text
 676 pass
 8 skip
 6 fail
 13779 expect() calls
Ran 690 tests across 69 files. [425.40s]
```

The six failure names and causes match the clean-base Windows reproduction: missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions. Integration is not green. The eight optional skips remain.

- E2E:

```text
 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [45.18s]
```

The one optional SDK/browser test remains skipped.

No new full `bun run sim`: AGENTS.md's one-full-run-per-agent allowance was already used earlier in this session. This revision has fresh Peon-block validation. The standalone CLI matrix proves the changed command path; the official block checks the preserved native algorithms and pinned gate results.

## Reproduction

Use Bun 1.4.2 and PostgreSQL 16.15. Disable provider keys, live-send and deploy flags. Use local PostgreSQL on port 54339 for integration and E2E. Prepare the base and this PR in separate checkouts. Save the complete measurement programs below outside the checkouts.

```sh
bun install --frozen-lockfile
bun test --conditions eliza-source --timeout 120000 packages/sim/test/peon-selectors.integration.test.ts
bun peon-selectors-measure.ts /path/to/base peon-selectors-before.json
bun peon-selectors-measure.ts /path/to/fix peon-selectors-after.json
bun peon-selectors-compare.ts peon-selectors-before.json peon-selectors-after.json comparison.json
bun run sim --only peon --json gates.json
bun run typecheck
bun run test:integration
bun run test:e2e
```

Copy the integration case into the base checkout to reproduce its failure. Run the Peon gate command in both checkouts. Expected: all 98 valid CLI records remain identical; all 30 invalid commands fail before simulation; all 27 blocking gates pass. `test:integration` includes the full security suite. Retain its known Windows failures in the reported result.

For a direct native reproduction, run both commands on the same revision:

```sh
bun packages/sim/src/apps/peon/cli.ts --seeds 7 --per-city 80 --jobs 30 --weeks 8 --arms keyword,oracle,pack --gate-arm pack --json valid.json
bun packages/sim/src/apps/peon/cli.ts --seeds 7 --per-city 80 --jobs 30 --weeks 8 --arms keyword,oracle,pack --gate-arm pak --json invalid.json
```

The valid command exits 1 with gate failures on both revisions. Before, the invalid command exits 0 and writes identical metrics without gates. After, it exits 1 with a selector error, preserving any existing `invalid.json` and creating none when absent.

## Design and limits

Validation after simulation would spend work before rejecting the command. Requiring comparison arms for every command would break existing single-arm diagnostics. Early selector validation enforces explicit gate requests while preserving implicit diagnostic behavior. It uses the existing arm registry and adds no parser dependency or new option.

This validates only realism and explicit gate selection. It does not change population, duration or seed parsing, registered arms, profiles, gate thresholds, empty-cohort metrics, or output schemas. The pending population and duration fixes remain separate. A valid evaluation can still fail its gates; this patch preserves those failures. Existing report files remain untouched on validation errors, so callers must check the process exit code.

No UI or member-facing text changes. No production service, actual member workflow, prompt, live send or deployment changes. No secrets, `.env`, `runs/` or real member data are included.

## llm_evidence

N/A: deterministic CLI validation; no model-backed behavior changes. Validation model calls: **0**, cost: **$0**. No real-model qualification is claimed.

## agent_clients

Codex desktop **26.1103.7773.0**, primary runtime **26.1104.2876.0**, Windows, Bun **1.4.2**, PostgreSQL **16.15**. Authoring provider: OpenAI; exact model identifier unavailable. GitHub connector and Git/gh used directly. No computer/browser use or other client acceptance tests. No agent-client workflow changes.

## Complete measurement programs

### peon-selectors-measure.ts

```ts
import { mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(process.argv[2]!), out = resolve(process.argv[3]!);
const { ARMS } = await import(pathToFileURL(join(root, "packages/sim/src/apps/peon/arms.ts")).href);
const specs: any[] = [];
const add = (id: string, seed: number, arms: string | undefined, args: string[], valid: boolean) => specs.push({ id, seed, arms, args, valid });
for (const arm of Object.keys(ARMS)) for (const profile of [undefined, "v1", "v2"]) add(`single:${arm}:${profile ?? "default"}`, 7, arm, profile ? ["--realism", profile] : [], true);
for (const seed of [5, 13, 16]) for (const arm of ["keyword", "oracle", "pack"]) for (const profile of [undefined, "v1", "v2"]) add(`core:${arm}:${profile ?? "default"}`, seed, arm, profile ? ["--realism", profile] : [], true);
for (const arm of Object.keys(ARMS)) add(`gate:${arm}`, 7, [...new Set(["keyword", "oracle", arm])].join(","), ["--gate-arm", arm], true);
for (const profile of [undefined, "v1", "v2"]) add(`default-arms:${profile ?? "default"}`, 7, undefined, profile ? ["--realism", profile] : [], true);
for (const seed of [5, 7]) {
  for (const value of ["v3", "V1", "", " ", "v2x"]) add(`bad-realism:${JSON.stringify(value)}`, seed, "keyword", ["--realism", value], false);
  add("missing-realism", seed, "keyword", ["--realism"], false);
  add("realism-before-flag", seed, "keyword", ["--realism", "--impact"], false);
  for (const value of ["pak", "", " ", "__proto__"]) add(`bad-gate:${JSON.stringify(value)}`, seed, "keyword,oracle,pack", ["--gate-arm", value], false);
  add("missing-gate", seed, "keyword,oracle,pack", ["--gate-arm"], false);
  add("gate-before-flag", seed, "keyword,oracle,pack", ["--gate-arm", "--impact"], false);
  add("unselected-gate", seed, "keyword,oracle", ["--gate-arm", "pack"], false);
  add("missing-keyword", seed, "pack", ["--gate-arm", "pack"], false);
}
const dir = await mkdtemp(join(tmpdir(), "peon-selectors-measure-")), files: string[] = [], rows = [];
const hash = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
try {
  for (const spec of specs) {
    const file = join(dir, `${rows.length}.json`); files.push(file);
    const existing = !spec.valid && rows.length % 2 === 0, sentinel = "existing report: preserve on invalid selection\n";
    if (existing) await Bun.write(file, sentinel);
    const args = ["--seeds", String(spec.seed), "--per-city", "80", "--jobs", "30", "--weeks", "8", ...(spec.arms === undefined ? [] : ["--arms", spec.arms]), "--json", file, ...spec.args];
    const p = Bun.spawn([process.execPath, join(root, "packages/sim/src/apps/peon/cli.ts"), ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [exit, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
    const raw = await Bun.file(file).exists() ? await Bun.file(file).text() : undefined;
    const newReport = raw !== undefined && raw !== sentinel;
    const row = { spec, existing, exit, printed: stdout.includes("| Metric"), progressed: / seed \d+: hires /.test(stderr), gates: stdout.includes("Official gate (adopted"), world: stdout.match(/; world (v[12])\)/)?.[1], stdoutHash: hash(stdout), stderrHash: hash(stderr.replace(/\([0-9.]+s\)/g, "(<time>s)")), diagnostic: /--(realism|gate-arm)/.test(stderr), artifact: newReport ? existing ? "overwritten" : "created" : raw === sentinel ? "preserved" : "absent", ...(newReport ? { reportHash: hash(raw!), metrics: JSON.parse(raw!) } : {}) };
    rows.push(row);
    console.log(JSON.stringify({ done: rows.length, spec, exit, printed: row.printed, gates: row.gates, artifact: row.artifact }));
  }
  await Bun.write(out, JSON.stringify(rows, null, 2));
} finally {
  for (const file of files) if (await Bun.file(file).exists()) await Bun.file(file).delete();
  await rmdir(dir);
}
```

### peon-selectors-compare.ts

```ts
const a = await Bun.file(process.argv[2]!).json(), b = await Bun.file(process.argv[3]!).json();
const eq = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
if (a.length !== 128 || b.length !== 128) throw new Error("Unexpected workflow count");
const controls = [], invalid = [];
for (let i = 0; i < a.length; i++) {
  const x = a[i], y = b[i];
  if (!eq(x.spec, y.spec) || x.existing !== y.existing) throw new Error(`Input changed ${i}`);
  if (y.spec.valid) {
    if (!eq(x, y)) throw new Error(`Valid output changed ${i}`);
    controls.push(y);
  } else {
    if (y.exit === 0 || y.printed || y.progressed || y.gates || !y.diagnostic || y.artifact !== (y.existing ? "preserved" : "absent")) throw new Error(`Invalid selection accepted ${i}`);
    invalid.push({ spec: y.spec, existing: y.existing, before: { exit: x.exit, printed: x.printed, progressed: x.progressed, artifact: x.artifact }, after: { exit: y.exit, printed: y.printed, progressed: y.progressed, artifact: y.artifact } });
  }
}
const sum = (rows: any[], f: (x: any) => number) => rows.reduce((n, r) => n + f(r), 0);
const safety: Record<string, number> = {};
for (const r of controls) for (const ms of Object.values(r.metrics) as any[][]) for (const m of ms) for (const [k, v] of Object.entries(m.safety)) if (typeof v === "number") safety[k] = (safety[k] ?? 0) + v;
const result = { workflows: b.length, controls: controls.length, validGated: controls.filter(x => x.gates).length, validExitOne: controls.filter(x => x.exit === 1).length, validWorlds: sum(controls, r => Object.values(r.metrics).reduce((n: number, ms: any) => n + ms.length, 0) as number), invalid: invalid.length, beforeStarted: invalid.filter(x => x.before.progressed).length, beforeReports: invalid.filter(x => ["created", "overwritten"].includes(x.before.artifact)).length, beforeExitZero: invalid.filter(x => x.before.exit === 0).length, preserved: invalid.filter(x => x.after.artifact === "preserved").length, absent: invalid.filter(x => x.after.artifact === "absent").length, safety, cases: invalid };
await Bun.write(process.argv[4]!, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, cases: undefined }));
```
