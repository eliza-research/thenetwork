# Simulator judge sample-count validation — 2026-11-10

The simulator CLI accepts `--judge 0` and reports an audit with no judge requests. On seed 1, 12 generated personas and one day, a configured client produces exit 0, `sampled: 0`, `factsAudited: 2`, `privacyLeaks: 0`, and `errors: 0`. The two facts were never submitted to a judge. Blank and malformed values can also finish successfully; fractional and negative values can be truncated by `slice` into a different sample size.

This fixes a reproduced defect in simulation validation under the approved contribution scope and PRD 34.3–34.5. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. The change is in the CLI's argument validation; matching, persona behavior, prompts, providers, transport and judge scoring are unchanged.

## Cause and change

The CLI previously passed `Number(a.judge)` to the sampler without validating it, after running the world. The sampler's arithmetic and `slice(0, k)` accept zero, non-finite and fractional values. An empty string bypassed the judge call entirely. `judgeRun` constructs a client before sampling, so the false-success reproduction needs a configured client; with no configured key it instead fails after running the world.

Parse the optional count once, require a positive safe integer when present, and reuse the validated count. Reject it before engine loading, persona generation, optional model setup or world execution. Leaving the option out retains the ordinary unjudged run. This avoids changing the sampler or introducing a second interpretation of the CLI value. Positive integer numeric notation remains supported, including `1e1` and `0x2`.

## Reproduction and measurement

Environment: Windows, Bun 1.4.2, PostgreSQL 16.15 on local port 54339, Codex desktop 26.1103.7773.0 (runtime 26.1104.2876.0). Dependencies installed with `bun install --frozen-lockfile`, with no lockfile or dependency changes. Live-send/deploy flags and real provider keys were cleared by the local test environment.

The measurement uses the real CLI, generated personas, World, channel and engine adapter. A loopback HTTP server refuses all model requests with status 400. A synthetic local-only key permits client construction; it grants no provider access. This server supplies no model responses or decisions. It makes the zero-request audit directly observable and checks that invalid input is rejected before transport. It is not evidence of model quality or a successful LLM audit.

Run the measurement program below against the clean base and candidate checkouts, then compare:

```powershell
bun judge-count-measure.ts ./friends-crew-base ./judge-count-before.json
bun judge-count-measure.ts ./thenetwork ./judge-count-after.json
bun judge-count-compare.ts
```

Each revision runs 72 CLI cases on seeds **1, 7, 13, 16**:

- 44 invalid cases: `0`, empty, whitespace, `-1`, `0.5`, `1.5`, `NaN`, `nope`, `Infinity`, `-Infinity`, and `9007199254740992`; 12 personas and one day each.
- 20 positive-count transport controls: `1`, `2`, `1e1`, `0x2`, `9007199254740991`; the same small world. The local endpoint deliberately refuses requests, so these end with reported judge errors and null privacy results on both revisions.
- Four ordinary controls with the judge option omitted, 12 personas and one day.
- Four controls with the judge option omitted and the real engine adapter enabled, 40 personas and five days. These produce 20, 29, 20 and 17 proposals respectively.

| Observation | Before | After |
| --- | --- | --- |
| Invalid cases rejected before simulation and transport | 0/44 | 44/44 |
| Invalid cases exiting successfully | 32 | 0 |
| Invalid cases reporting facts audited with zero requests, zero leaks and zero errors | 28 | 0 |
| Local HTTP requests caused by invalid counts | 426 | 0 |
| Valid controls retaining identical behavior | 28/28 | 28/28 |

Counts overlap. The 426 requests were to the deliberately refusing loopback server, not a model provider.

The comparison checks complete metrics (including invariant details), the complete judge report when present, process exit, and a hash of all local request bodies for every valid control. Only the generated run ID and wall duration are excluded. It publishes no request bodies or synthetic conversation contents. All valid controls retain zero native invariants, minor contacts, canary leaks and recorded simulator errors. The deliberate HTTP refusals are judge transport errors, separate from native simulator errors.

## Regression

`packages/sim/test/judge-count.integration.test.ts` launches real CLI child processes. It rejects all eleven invalid values, requires empty stdout and the count diagnostic, proves rejection precedes dynamic engine loading/model setup, and verifies a normal omitted-option run still generates joined members and checked messages. Its loopback tripwire must receive zero requests.

```powershell
bun test --conditions eliza-source packages/sim/test/judge-count.integration.test.ts
```

Regression on base: **0 pass, 1 fail, 1 assertion**, failing because `--judge=0` exits 0 (78.41 ms case, 100 ms suite). After: **1 pass, 0 fail, 41 assertions** (818.40 ms case, 831 ms suite).

## safety_gates

The same `bun run sim --only evals,safety,audit --json <output>` passes **58/58 blocking gates before and after**, with local PostgreSQL and `REQUIRE_PG=1`: evals 25, safety 17, audit 16. Every complete gate record is identical after excluding execution duration. Runtime: 26.5s before and 26.2s after. No tracked gate is off target.

The full simulation was already run earlier in this agent session. `AGENTS.md` allows at most one full run per agent; this change uses fresh affected-block runs. No gate definitions or thresholds changed.

## Repository validation

All four TypeScript configurations pass. Integration includes the security suite:

```text
 676 pass
 8 skip
 6 fail
 13782 expect() calls
Ran 690 tests across 69 files. [424.28s]
```

The six failure names and causes match the clean-base Windows reproduction: missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions. Integration is not green; the eight optional skips remain.

E2E:

```text
 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [43.90s]
```

The optional SDK/browser case remains skipped.

## llm_evidence and agent_clients

Real-model evidence: N/A for this deterministic argument-validation change. No paid/live model was called, and no model quality, successful provider response, prompt behavior or production LLM qualification is claimed. The configured `openai/gpt-6-luna` label in local CLI output is the existing client configuration, not an actually served model. Valid positive-count transport behavior remains identical under the explicit local refusal.

Authoring provider: OpenAI. Exact authoring model identifier: unavailable in this session; not inferred from the CLI's configured model. Tested authoring client: Codex desktop 26.1103.7773.0 with PowerShell and Bun 1.4.2. No external agent-client workflow changed and no qualification of other clients is claimed.

Limits: the change validates the sample count only. It does not alter sampling, make a zero-eligible-message world into a model audit, repair historical reports, or change scenario judging behavior. All world data are generated and all HTTP requests are loopback. No real messages or deployments.

## Reproducible paired programs

These are hand-written measurement programs; their populations and result tables are generated by the repository's actual CLI. Save each program under its indicated filename outside both checkouts.

### judge-count-measure.ts

```ts
import { resolve } from "node:path";
const [rootArg, output] = process.argv.slice(2), root = resolve(rootArg!);
const hash = (x: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex");
const rows: any[] = [];
let requests: string[] = [];
// Refuse every local request; no provider, model, or model response is used.
const trap = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(r) {
  requests.push(await r.text());
  return new Response("No model is available in this measurement", { status: 400 });
} });
const env = { ...process.env, SURPLUS_API_KEY: "", OPENAI_API_KEY: "synthetic-no-provider-access",
  OPENAI_BASE_URL: `${trap.url}v1`, JUDGE_PROVIDER: "openai", JUDGE_MODEL: "gpt-6-luna" };
async function run(seed: number, kind: string, args: string[], n = 12, days = 1) {
  requests = [];
  const start = performance.now();
  const p = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source", "packages/sim/src/cli.ts",
    "--personas", String(n), "--days", String(days), "--seed", String(seed), "--no-log", "--json", ...args],
  { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  const [out, err, exit] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  const marker = out.indexOf('\n{\n  "llmJudges"');
  let metrics: any, audit: any;
  if (out.trim()) {
    metrics = JSON.parse(marker < 0 ? out : out.slice(0, marker));
    delete metrics.run.runId;
    if (marker >= 0) audit = JSON.parse(out.slice(marker)).llmJudges;
  }
  rows.push({ seed, kind, args, n, days, exit, empty: out === "", diagnostic: err.includes("--judge must be a positive safe integer"),
    metrics, audit, requests: requests.length, requestHash: hash(requests.sort()), wallMs: Math.round(performance.now() - start) });
}
try {
  for (const seed of [1, 7, 13, 16]) {
    for (const value of ["0", "", " ", "-1", "0.5", "1.5", "NaN", "nope", "Infinity", "-Infinity", "9007199254740992"])
      await run(seed, "invalid", [`--judge=${value}`]);
    for (const value of ["1", "2", "1e1", "0x2", "9007199254740991"])
      await run(seed, "valid-transport", [`--judge=${value}`]);
    await run(seed, "omitted", []);
    await run(seed, "omitted-engine", ["--engine", "packages/sim/src/engineAdapter.ts"], 40, 5);
    console.log(JSON.stringify({ seed, rows: rows.length }));
  }
  await Bun.write(output!, JSON.stringify(rows, null, 2));
  console.log(JSON.stringify({ rows: rows.length, falseCleanAudits: rows.filter(r => r.kind === "invalid" && r.audit?.errors === 0 && r.audit?.privacyLeaks === 0 && r.audit?.factsAudited > 0 && !r.requests).length,
    earlyRejected: rows.filter(r => r.kind === "invalid" && r.exit !== 0 && r.empty && r.diagnostic && !r.requests).length }));
} finally { trap.stop(true); }
```

### judge-count-compare.ts

```ts
import { strict as assert } from "node:assert";
const b = await Bun.file(new URL("judge-count-before.json", import.meta.url)).json();
const a = await Bun.file(new URL("judge-count-after.json", import.meta.url)).json();
assert.equal(b.length, 72); assert.equal(a.length, 72);
let rejected = 0, unchanged = 0;
for (let i = 0; i < a.length; i++) {
  const before = b[i], after = a[i];
  assert.deepEqual([after.seed, after.kind, after.args, after.n, after.days], [before.seed, before.kind, before.args, before.n, before.days]);
  assert(before.metrics.run.joined > 0);
  if (after.kind === "invalid") {
    assert.equal(after.exit, 1); assert.equal(after.empty, true); assert.equal(after.diagnostic, true); assert.equal(after.requests, 0);
    assert.equal(after.metrics, undefined); assert.equal(after.audit, undefined); rejected++;
  } else {
    const { wallMs: bw, ...x } = before, { wallMs: aw, ...y } = after;
    assert.deepEqual(y, x); unchanged++;
    if (after.kind === "valid-transport") { assert(after.requests > 0); assert.equal(after.exit, 1); assert(after.audit.errors > 0); assert.equal(after.audit.privacyLeaks, null); }
    else { assert.equal(after.exit, 0); assert.equal(after.requests, 0); }
  }
}
const invalid = b.filter((r: any) => r.kind === "invalid"), controls = a.filter((r: any) => r.kind !== "invalid");
const result = { rows: a.length, rejected, unchanged,
  invalidExitZeroBefore: invalid.filter((r: any) => r.exit === 0).length,
  falseCleanAuditsBefore: invalid.filter((r: any) => r.audit?.errors === 0 && r.audit?.privacyLeaks === 0 && r.audit?.factsAudited > 0 && !r.requests).length,
  invalidLocalRequestsBefore: invalid.reduce((n: number, r: any) => n + r.requests, 0), invalidLocalRequestsAfter: 0,
  validControls: controls.map((r: any) => ({ seed: r.seed, kind: r.kind, args: r.args, joined: r.metrics.run.joined, proposals: r.metrics.proposals.total,
    invariants: r.metrics.invariants.total, minorContacts: r.metrics.safety.minorContacts, canaryLeaks: r.metrics.privacy.canaryLeaks, errors: r.metrics.errors })) };
await Bun.write(new URL("judge-count-comparison.json", import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
```
