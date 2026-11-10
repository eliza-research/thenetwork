# Slop fairness groups across seeds (2026-11-10)

## Defect and scope

The Slop CLI reports fairness over multiple seeds, but enumerates the matching-gender and gender/orientation groups from only the first seed. A group present only in later generated populations disappears from the printed summary even though the native JSON contains its outcomes.

This is a reproduced simulation-reporting defect under the approved Slop scope, CONTRIBUTING 3.1 and PRD 34.3–34.4. The existing Slop world report (`docs/results/2026-10-08-slop-world.md`, fairness section) requires rates by matching gender and gender/orientation. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

For each arm, enumerate the sorted union of group names across every seed. Keep the current aggregation and formatting. This fixes both printed fairness sections without changing generated populations, matchers, safety checks, thresholds or native JSON metrics.

One integration case invokes the real CLI twice, with three and ten personas per city, seeds 1–4, four weeks and all three native arms. It compares each printed group list with the groups in the CLI's native JSON. The identical final case fails before and passes after: **0 pass / 1 fail / 2 assertions → 1 pass / 0 fail / 14 assertions**. Before, the first matching-gender assertion is missing `nonbinary`. Case runtime: 73.57 ms before and 221.89 ms after; suite runtime: 87 ms and 237 ms. The earlier failure stops the before case; these timings do not compare performance.

## measurement

Run the same **29 actual CLI commands per revision**, producing **300 native world results** and **162 printed fairness sections** per revision. The hand-written matrix uses repository-generated populations, native random/greedy/oracle matchers and native outcome metrics.

| Matrix | Commands | Settings |
|---|---:|---|
| Population and seed ranges | 20 | per-city 0, 1, 2, 3, 5, 10, 30, 50, 100, 300 × seeds 1–4 or 13–16; all three arms; four weeks |
| Single-seed controls | 4 | per-city 0, 3, 10, 300; seed 7; all three arms; four weeks |
| Individual arms | 3 | per-city 3; seeds 5–8; random, greedy or oracle; four weeks |
| CLI defaults | 1 | per-city 10; omitted seeds and arms (defaults 1–8 and all three arms); four weeks |
| Longer duration | 1 | per-city 30; seeds 1–4; all three arms; eight weeks |

The measurement saves complete native JSON metrics and hashes the exact JSON, the main output table, the complete standard output and standard error. Only progress durations are normalized in standard error. It compares every existing fairness row byte for byte and checks the complete expected rows, including numerical formatting, using the current aggregation formulas applied to native JSON.

| Observed result | Before | After |
| --- | --- | --- |
| Fairness sections with every observed group and correct values | 102/162 | 162/162 |
| Omitted matching-gender rows | 15 | 0 |
| Omitted gender/orientation rows | 84 | 0 |
| Existing fairness rows preserved exactly | — | 714/714 |
| Commands with complete standard output unchanged | — | 12/29 |
| Native world metric records identical across revisions | — | 300/300 |

All 29 commands exit 0 on both revisions. Complete native JSON metrics, main tables and normalized standard error remain identical for all 29 commands. The 12 full-output controls include zero-population, single-seed and already-complete group lists. The other 17 commands add the 99 missing rows. These are repeated seeded runs, not 300 independent experimental samples.

### Concrete omissions

With `--seeds 1-4 --per-city 3 --weeks 4 --only random,greedy,oracle`, the first seed lacks nonbinary members, while later seeds contain them. Before, all three summaries list only man and woman. After, all three include nonbinary as well.

With ten personas per city and the same seeds, both `man:gay` and `nonbinary:gay` are missing from the first population and omitted from the original group summaries. Both appear after the fix. Newly included outcomes are not all zero: at five personas per city, the random arm now prints `woman:bisexual (n≈1) 0.136`, using the existing per-seed mean.

These exact paired output comparisons prove report completeness. They do not claim improved matching or a statistically meaningful fairness outcome for tiny cohorts. Raw flow and run-record hashes were not captured; unchanged complete native metrics are the behavioral evidence measured here.

## safety_gates

The same `bun run sim --only slop --json <output>` passes **39/39 blocking gates before and after**. All **57 complete gate records** are identical after excluding execution duration. The 18 tracked records remain, including the same eight off-target results. Runtime: 32.7s before and 32.7s after. Gate definitions, thresholds and simulation parameters are unchanged.

Every safety field in all 300 native world results is identical before and after. The matrix includes unsafe comparison arms; the totals below are sums across repeated worlds, not unique members. Nonzero adversary contacts, undisclosed-minor outcomes and harms remain visible. This is not an all-safe result or a safety improvement.

| Safety field (sum across repeated worlds) | Before | After |
| --- | --- | --- |
| `minorContacts` | 0 | 0 |
| `undisclosedMinorContacts` | 181 | 181 |
| `undisclosedMinorProposals` | 1447 | 1447 |
| `adversaryProposals` | 9173 | 9173 |
| `adversaryContacts` | 1355 | 1355 |
| `harmsReported` | 413 | 413 |

| Native harm (sum across repeated worlds) | Before | After |
| --- | --- | --- |
| `deception` | 84 | 84 |
| `offplatform_move` | 216 | 216 |
| `money_ask` | 140 | 140 |
| `harassment` | 149 | 149 |
| `catfish_reveal` | 137 | 137 |
| `minor_contact` | 189 | 189 |
| `financial_loss` | 32 | 32 |

## Validation

- All four TypeScript configurations pass.
- Integration, including the security suite:

```text
 676 pass
 8 skip
 6 fail
 13755 expect() calls
Ran 690 tests across 69 files. [428.37s]
```

The six failure names and causes match the clean-base Windows reproduction: missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions. Integration is not green. The eight optional skips remain.

- E2E:

```text
 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [55.78s]
```

The one optional SDK/browser test remains skipped.

No new full `bun run sim`: AGENTS.md's one-full-run-per-agent allowance was already used earlier in this session. This head has fresh Slop-block validation. The actual CLI matrix proves the changed reporting path; official gates check the preserved native algorithms and pinned results.

## Reproduction

Use Bun 1.4.2 and PostgreSQL 16.15. Disable provider keys, live-send and deploy flags. Use local PostgreSQL on port 54339 for integration and E2E. Prepare base and candidate in separate checkouts. Save the complete programs below outside those checkouts.

```sh
bun install --frozen-lockfile
bun test --conditions eliza-source --timeout 120000 packages/sim/test/slop-fairness-groups.integration.test.ts
bun slop-fairness-measure.ts /path/to/base slop-fairness-before.json
bun slop-fairness-measure.ts /path/to/fix slop-fairness-after.json
bun slop-fairness-compare.ts slop-fairness-before.json slop-fairness-after.json comparison.json
bun run sim --only slop --json gates.json
bun run typecheck
bun run test:integration
bun run test:e2e
```

Copy the integration case into the base checkout to reproduce its failure. Run the gate command on both revisions. Expected: 162/162 fairness sections contain every observed group; all existing rows and all native JSON metrics remain identical; 39/39 blocking gates pass. The integration command includes the security suite; retain the known Windows failures in the reported result.

Direct reproduction, run on both revisions:

```sh
bun packages/sim/src/apps/slop/cli.ts --seeds 1-4 --per-city 3 --weeks 4 --only random,greedy,oracle --json fairness.json
bun packages/sim/src/apps/slop/cli.ts --seeds 1-4 --per-city 10 --weeks 4 --only random,greedy,oracle --json groups.json
```

## Design and limits

Taking the union of native metric keys includes every observed group without inventing absent categories or coupling the printer to a fixed demographic vocabulary. Sorting preserves the existing alphabetical presentation. Recomputing the metrics would unnecessarily alter the reporting contract; selecting another single seed would still omit groups.

Existing aggregation choices remain: a group absent from a seed contributes zero to its reported rate; counts are averaged across all seeds then rounded. A rare group can therefore print `n≈0` despite appearing in one seed. This patch does not implement pooled denominators or change standard-error calculations. Small cohorts demonstrate the omission, not population-level fairness. No UI, member conversation, prompt or live service changes. No secrets, `.env`, `runs/` or real member data are included.

## llm_evidence

N/A: deterministic CLI reporting; no model-backed behavior changes. Validation model calls: **0**, cost: **$0**. No real-model qualification claimed.

## agent_clients

Codex desktop **26.1103.7773.0**, primary runtime **26.1104.2876.0**, Windows, Bun **1.4.2**, PostgreSQL **16.15**. Authoring provider OpenAI; exact model identifier unavailable. GitHub connector and Git/gh used directly. No computer/browser use or other client acceptance tests. No agent-client workflow changes.

## Complete measurement programs

### slop-fairness-measure.ts

```ts
import { mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root = resolve(process.argv[2]!), out = resolve(process.argv[3]!);
const specs: { id: string; perCity: number; seeds?: string; only?: string; weeks: number }[] = [];
for (const perCity of [0, 1, 2, 3, 5, 10, 30, 50, 100, 300]) for (const seeds of ["1-4", "13-16"]) specs.push({ id: `matrix:${perCity}:${seeds}`, perCity, seeds, only: "random,greedy,oracle", weeks: 4 });
for (const perCity of [0, 3, 10, 300]) specs.push({ id: `single:${perCity}`, perCity, seeds: "7", only: "random,greedy,oracle", weeks: 4 });
for (const only of ["random", "greedy", "oracle"]) specs.push({ id: `arm:${only}`, perCity: 3, seeds: "5-8", only, weeks: 4 });
specs.push({ id: "defaults", perCity: 10, weeks: 4 }, { id: "eight-weeks", perCity: 30, seeds: "1-4", only: "random,greedy,oracle", weeks: 8 });
const dir = await mkdtemp(join(tmpdir(), "slop-fairness-measure-")), files: string[] = [], rows: any[] = [];
const hash = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
const mean = (xs: number[]) => xs.reduce((a,b)=>a+b,0)/xs.length;
const fmt = (xs: number[], pct=false, digits=2) => {
  const m=mean(xs), se=Math.sqrt(xs.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,xs.length-1)/xs.length);
  return pct ? `${(m*100).toFixed(1)}% ± ${(se*100).toFixed(1)}` : `${m.toFixed(digits)} ± ${se.toFixed(digits)}`;
};
try {
  for (const spec of specs) {
    const file = join(dir, `${rows.length}.json`); files.push(file);
    const args = ["--per-city", String(spec.perCity), "--weeks", String(spec.weeks), ...(spec.seeds ? ["--seeds", spec.seeds] : []), ...(spec.only ? ["--only", spec.only] : []), "--json", file];
    const p = Bun.spawn([process.execPath, join(root,"packages/sim/src/apps/slop/cli.ts"), ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [exit, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
    if (exit !== 0) throw Error(`CLI failed ${spec.id}`);
    const raw = await Bun.file(file).text(), metrics = JSON.parse(raw), sections: any[] = [];
    for (const [arm, ms] of Object.entries(metrics) as [string, any[]][]) {
      for (const [key, title] of [["byGender", "Fairness by matching gender"], ["byGroup", "Fairness by group"]] as const) {
        const tail = stdout.split(title)[1]!, prefix = `  ${arm}: `;
        const content = tail.split("\n").find(line=>line.startsWith(prefix))!.slice(prefix.length).trim();
        const actual = content ? content.split("; ") : [];
        const keys = [...new Set(ms.flatMap(m=>Object.keys(m.fairness[key])))].sort();
        const expected = keys.map(k => key === "byGender"
          ? `${k} ${fmt(ms.map(m=>m.fairness.byGender[k]?.datesPerMemberMonth ?? 0),false,3)} / ${fmt(ms.map(m=>m.fairness.byGender[k]?.shareWithDate ?? 0),true)}`
          : `${k} (n≈${Math.round(mean(ms.map(m=>m.fairness.byGroup[k]?.n ?? 0)))}) ${mean(ms.map(m=>m.fairness.byGroup[k]?.datesPerMemberMonth ?? 0)).toFixed(3)}`);
        sections.push({ arm, key, actual, expected, missing: expected.filter(row=>!actual.some(a=>a.split(" ")[0]===row.split(" ")[0])), exact: JSON.stringify(actual)===JSON.stringify(expected) });
      }
    }
    rows.push({ spec, exit, reportHash: hash(raw), tableHash: hash(stdout.split("Fairness by matching gender")[0]!), stdoutHash: hash(stdout), stderrHash: hash(stderr.replace(/\([0-9.]+s\)/g,"(<time>s)")), sections, metrics });
    console.log(JSON.stringify({ spec: spec.id, sections: sections.length, missing: sections.reduce((n,s)=>n+s.missing.length,0) }));
  }
  await Bun.write(out, JSON.stringify(rows,null,2));
} finally {
  for (const file of files) if (await Bun.file(file).exists()) await Bun.file(file).delete();
  await rmdir(dir);
}
```

### slop-fairness-compare.ts

```ts
const before=await Bun.file(process.argv[2]!).json(), after=await Bun.file(process.argv[3]!).json();
const eq=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
if(before.length!==29 || after.length!==29) throw Error("Unexpected CLI count");
const sum={workflows:29, worlds:0, sections:0, correctBefore:0, correctAfter:0, missingGenders:0, missingGroups:0, fullOutputControls:0, existingRowsPreserved:0, newRows:0};
const safety:Record<string,number>={}, harms:Record<string,number>={}, changes:any[]=[];
for(let i=0;i<before.length;i++){
  const a=before[i],b=after[i];
  for(const k of ["spec","exit","reportHash","tableHash","stderrHash","metrics"]) if(!eq(a[k],b[k]))throw Error(`${k} changed at ${i}`);
  if(a.stdoutHash===b.stdoutHash)sum.fullOutputControls++;
  if(a.sections.length!==b.sections.length)throw Error("Section count changed");
  for(let j=0;j<a.sections.length;j++){
    const x=a.sections[j],y=b.sections[j];
    if(x.arm!==y.arm||x.key!==y.key||!eq(x.expected,y.expected)||!y.exact||y.missing.length)throw Error(`Bad summary ${i}/${j}`);
    sum.sections++;sum.correctBefore+=+x.exact;sum.correctAfter+=+y.exact;
    for(const row of x.actual){if(!y.actual.includes(row))throw Error("Existing row changed");sum.existingRowsPreserved++;}
    sum.newRows+=x.missing.length;
    if(x.key==="byGender")sum.missingGenders+=x.missing.length;else sum.missingGroups+=x.missing.length;
    if(x.missing.length)changes.push({spec:a.spec,arm:x.arm,key:x.key,added:x.missing});
  }
  for(const ms of Object.values(b.metrics) as any[][])for(const m of ms){
    sum.worlds++;
    for(const [k,v]of Object.entries(m.safety))if(typeof v==="number")safety[k]=(safety[k]??0)+v;
    for(const [k,v]of Object.entries(m.safety.harms))harms[k]=(harms[k]??0)+(v as number);
  }
}
const result={...sum,safety,harms,changes};
await Bun.write(process.argv[4]!,JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,changes:undefined}));
```
