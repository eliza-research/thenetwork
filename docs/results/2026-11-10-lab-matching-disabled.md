# Lab matching-disabled runs — 2026-11-10

## Requirement and cause

Reproduced simulation defect under the approved Slop scope and CONTRIBUTING 3.1.
PRD 34.3 covers world configuration and deterministic replay. PRD 35.2 and
`docs/admin-console.md` 3.13 require background Lab runs with judge results.
`docs/observatory.md` 9.6 promises matching-off runs for disabled apps.
The current app registry disables Peon matching and allows the other three apps.

Lab passed `--max-new 0` to express that setting. This caps the ConsentNetwork's
daily engine proposals. It does not pause requests or the planner. The push
baseline uses its own engine and ignores that cap. A seven-day Peon Lab run
therefore produced meetings in all three arms.

The fix sends `--matching-off` from Lab. The experiment maps it to the existing
`NetworkOptions.matchingEnabled: false` for both ConsentNetwork arms. It also
omits the external engine for the push baseline, whose random introductions
are already disabled. Joins, onboarding and single-player requests continue.
No matching threshold, review policy, app eligibility or production send path changes.

Two alternatives were considered:

1. Redefine `--max-new 0` as matching-off. That would change existing experiments
   which intentionally stop daily proposals but retain requests and plans.
2. Add separate Lab guards for every opportunity source. That duplicates the
   Network's existing matching switch and is easier to leave incomplete.

The explicit flag preserves the daily-cap experiment and uses the established switch.
The operational documentation and existing argument assertion follow that flag.

## measurement

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`; candidate: this PR.
Date: 2026-11-10 in Asia/Tokyo, 2026-11-09 UTC.
Runtime: Windows, Bun 1.4.2, PostgreSQL 16.15 for the required database suites.

The initial real `Lab.start` reproduction used Peon, seed 1, seven days and all
three default child-process arms. Meetings were 11 (`push_baseline`),
10 (`push_v2`) and 4 (`consent`). All three reported zero judge invariants,
canary leaks and minor contacts. No mock child or model output was used.

One new integration case runs the real Lab and experiment children. It checks
Peon's three arms, a matching-enabled Network control, judge counts and saved
results. Before the fix it fails on consent's four meetings. After the fix,
Peon has zero meetings and every Network control arm still has meetings.

The paired measurement runs the real experiment CLI with arguments produced
by each revision's `labArgs`. Each revision runs 24 arms in eight child processes:

- Peon: seeds 1, 7, 11 and 23, all three arms, seven days (12 results).
- Network, Slop and Friends: seed 1, all three arms, seven days (nine controls).
- An explicit `--max-new 0` Network experiment: seed 1 and all three arms
  (three controls). This option retains its daily-cap meaning.

Seed 1 exposed the defect. Seeds 7, 11 and 23 checked the fix without tuning.
Every app still uses the existing 250-member synthetic NYC world, not its own
matching pack. The fix does not claim per-app world or join-age fidelity.

| Metric across the 12 Peon results | Before | After |
|---|---:|---:|
| Proposals | 926 | 0 |
| Invitations | 1,243 | 0 |
| Held meetings | 114 | 0 |
| Judge invariants | 3 | 0 |
| Canary leaks | 0 | 0 |
| Minor contacts | 0 | 0 |

All 12 control results are deeply identical, including every reported metric
and judge field. Their CLI arguments are also identical. Each corrected Peon
arm still ends with at least 250 joined members. Consent-based arms continue
to record requests. The change removes simulated matching; it is not a
claim of improved matching quality.

## safety_gates

The three before-fix violations belong to Peon's seed-23 push baseline:
`decliner_exposed: 3`. Matching-off removes those exposures. The other eleven
Peon results have zero invariants before and after. Enabled-app and daily-cap
controls remain unchanged. All 24 candidate results have zero invariants,
canary leaks and minor contacts.

The ConsentNetwork arms use simulated review (`review: "auto"`). The push
baseline remains the existing StubNetwork. No review gate is bypassed or
weakened. Child processes receive Lab's existing environment allowlist.
Validation clears provider keys and live-send/deploy flags without reading them.

The affected simulation blocks are `network,audit,ops`. Gate comparison removes
elapsed milliseconds and the backup-drill elapsed value embedded in its name.
All semantic gate fields must match. A full simulation is not repeated:
AGENTS.md permits one full run per agent, already used earlier in this session.

## llm_evidence

N/A: this fixes configuration routing to existing deterministic simulation paths.
The worlds use policy persona agents. Provider/model for measured behavior:
N/A. Request settings: N/A. Real-model calls: 0. Cost: $0.

## agent_clients

Codex desktop 26.1103.4239.0 drove Bun 1.4.2 through the CLI and GitHub directly.
Provider: OpenAI. The exact assistant model identifier is unavailable.
No browser or computer use was performed. No member-facing agent workflow,
UI or member message copy changes; other agent clients are not claimed as tested.

## Reproduction and limits

Run `bun test --conditions eliza-source packages/observatory/test/lab-matching.integration.test.ts`.
Expect one passing case with 18 assertions.

For a direct matching-off experiment, run:

```text
bun run packages/network/harness/experiment.ts --only push_baseline,push_v2,consent --days 7 --seed 1 --matching-off
```

Expect zero proposals, invitations and meetings in every arm, and zero judge
invariants, canary leaks and minor contacts. Remove `--matching-off` to obtain
the unchanged matching-enabled control. On the base revision, Lab instead
passes `--max-new 0`, which reproduces the unwanted meetings above.

The committed case tests real Lab child processes and persistence, not the
browser UI or a live deployment. Existing stored Lab runs are historical
results and are not rewritten. The measurement covers seven days and four
seeds, not every duration or seed. No secrets, raw run logs or member data
are included in this PR.

## Validation

`bun install --frozen-lockfile`: 50 installs checked, no changes.
`bun run typecheck`: all four configurations pass.

The same committed regression case, before the production fix:

```text
 0 pass
 1 fail
 4 expect() calls
Ran 1 test across 1 file. [18.04s]
```

After the production fix:

```text
 1 pass
 0 fail
 18 expect() calls
Ran 1 test across 1 file. [26.13s]
```

The affected blocks use their fixed seeds, including 21-day push seed 1,
consent seeds 1–3 and the existing scenario corpus at pass^3.
Command in each checkout: `bun run sim --only network,audit,ops --json gates.json`.

before:

```text
PASS: 91/91 blocking gates, 0 tracked off target, 249.6s (network 220.7s, audit 22.2s, ops 6.7s)
```

after:

```text
PASS: 91/91 blocking gates, 0 tracked off target, 245.8s (network 217s, audit 21.9s, ops 6.9s)
```

All 94 gate records match after elapsed-time normalization. This includes
91 blocking gates and three passing tracked gates.

`bun run test:integration`, including the security suite on isolated Postgres:

```text
 676 pass
 8 skip
 6 fail
 13759 expect() calls
Ran 690 tests across 69 files. [478.15s]
```

```text
(pass) real lab arms keep matching-disabled apps free of meetings [25247.07ms]
```

All six failure names and causes match the recorded base failures: missing
`/bin/bash`, SIGTERM exit 143 versus 0, and four Windows path assertions.
All eight skip names also match the baseline. A green integration suite is not claimed.

`bun run test:e2e`:

```text
 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [34.83s]
```

The optional browser SDK case is skipped, as on the baseline.

## Reproduce the paired measurement

Install dependencies in both checkouts. Save the following programs outside
them, then run:

```text
bun run --conditions eliza-source lab-matching-measure.ts BASE before.json
bun run --conditions eliza-source lab-matching-measure.ts CANDIDATE after.json
bun run lab-matching-compare.ts before.json after.json
bun run lab-matching-gates-compare.ts before-gates.json after-gates.json
```

Measurement JSON SHA-256 (kept locally, not committed as run data):

- before: `7bb4ed2a96d841964e9e44dadb21a8efb8ed7e8b5b014e8a8a1a1cf309d0ed1f`
- after: `9bf5ac77bb0c66d5745f1843d71c5ae77fa80089886b8c37e198b48c385edb14`

### lab-matching-measure.ts

```ts
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [rootArg, output] = process.argv.slice(2);
if (!rootArg || !output) throw new Error("usage: measure.ts REPO OUTPUT");
const root = resolve(rootArg);
const { labArgs, labEnv, LAB_ARMS } = await import(pathToFileURL(resolve(root, "packages/observatory/src/lab.ts")).href);
const cases = [
  ...[1, 7, 11, 23].map(seed => ({ id: `peon-${seed}`, app: "peon", seed, dailyCap: false })),
  ...["ntwrk", "slop", "friends"].map(app => ({ id: `${app}-1`, app, seed: 1, dailyCap: false })),
  { id: "daily-cap-zero-1", app: "ntwrk", seed: 1, dailyCap: true },
];
const rows = [];
for (const c of cases) {
  const args = labArgs({ app: c.app, arms: [...LAB_ARMS], seeds: [c.seed], days: 7 }, c.seed);
  if (c.dailyCap) args.push("--max-new", "0");
  const child = Bun.spawn([process.execPath, "run", resolve(root, "packages/network/harness/experiment.ts"), ...args], {
    cwd: root, env: labEnv(), stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill(), 120_000);
  let stdout: string, stderr: string, code: number;
  try {
    [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  } finally { clearTimeout(timer); }
  if (code !== 0) throw new Error(`${c.id}: exit ${code}: ${stderr}`);
  const result = JSON.parse(stdout);
  if (result.results.length !== LAB_ARMS.length) throw new Error(`${c.id}: incomplete arms`);
  rows.push({ ...c, days: 7, args, result });
  process.stderr.write(`${c.id}: ${result.results.map((r: any) => `${r.arm} proposals=${r.proposals} meetings=${r.meetingsHeld} invariants=${r.judge.invariants}`).join("; ")}\n`);
}
await Bun.write(output, JSON.stringify(rows, null, 2) + "\n");
```

### lab-matching-compare.ts

```ts
import assert from "node:assert/strict";
const before = await Bun.file(process.argv[2]!).json();
const after = await Bun.file(process.argv[3]!).json();
assert.equal(before.length, 8);
assert.equal(after.length, before.length);
const sum = { runs: 8, armResults: 24, disabledAppResults: 0, unchangedControlResults: 0,
  proposalsBefore: 0, proposalsAfter: 0, invitationsBefore: 0, invitationsAfter: 0,
  meetingsBefore: 0, meetingsAfter: 0, disabledInvariantsBefore: 0, disabledInvariantsAfter: 0,
  canaryLeaks: 0, minorContacts: 0 };
for (let i = 0; i < before.length; i++) {
  const b = before[i], a = after[i];
  assert.equal(a.id, b.id);
  assert.equal(a.seed, b.seed);
  assert.equal(a.days, b.days);
  assert.equal(a.result.results.length, 3);
  if (a.app !== "peon") {
    assert.deepEqual(a, b, `${a.id}: enabled app or daily-cap control changed`);
    sum.unchangedControlResults += a.result.results.length;
    continue;
  }
  assert.ok(a.args.includes("--matching-off"));
  assert.ok(b.args.includes("--max-new"));
  for (let j = 0; j < a.result.results.length; j++) {
    const old = b.result.results[j], next = a.result.results[j];
    assert.equal(next.arm, old.arm);
    assert.ok(next.joinedEnd > 0, `${a.id}/${next.arm}: joins still run`);
    assert.equal(next.proposals, 0);
    assert.equal(next.invitations, 0);
    assert.equal(next.inviteYes, 0);
    assert.equal(next.meetingsHeld, 0);
    assert.equal(next.judge.invariants, 0);
    assert.equal(next.judge.canaryLeaks, 0);
    assert.equal(next.judge.minorContacts, 0);
    assert.equal(old.judge.canaryLeaks, 0);
    assert.equal(old.judge.minorContacts, 0);
    sum.disabledAppResults++;
    sum.proposalsBefore += old.proposals;
    sum.proposalsAfter += next.proposals;
    sum.invitationsBefore += old.invitations;
    sum.invitationsAfter += next.invitations;
    sum.meetingsBefore += old.meetingsHeld;
    sum.meetingsAfter += next.meetingsHeld;
    sum.disabledInvariantsBefore += old.judge.invariants;
    sum.disabledInvariantsAfter += next.judge.invariants;
  }
}
console.log(JSON.stringify(sum, null, 2));
```

### lab-matching-gates-compare.ts

```ts
import { isDeepStrictEqual } from "node:util";
const before = await Bun.file(process.argv[2]!).json(), after = await Bun.file(process.argv[3]!).json();
const gates = (r: any) => r.gates.map(({ ms, ...rest }: any) => ({ ...rest,
  name: rest.name.startsWith("backup drill:") ? rest.name.replace(/restore \d+ ms$/, "restore <elapsed> ms") : rest.name,
}));
if (!isDeepStrictEqual(gates(before), gates(after))) throw Error("Gate values changed");
if (after.gates.length !== 94 || after.gates.filter((g: any) => g.blocking).length !== 91 || after.gates.some((g: any) => !g.pass))
  throw Error("Expected all 91 blocking gates and three tracked gates to pass");
console.log(JSON.stringify({ identicalGateRecords: 94, blockingGatesPassed: 91, trackedOffTarget: 0 }, null, 2));
```
