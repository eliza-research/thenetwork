# App matching locks in simulations — 2026-11-10

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

### Lab runs

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`; candidate: this PR.
Date: 2026-11-10 in Asia/Tokyo, 2026-11-09 UTC.
Runtime: Windows, Bun 1.4.2, PostgreSQL 16.15 for the required database suites.

The initial real `Lab.start` reproduction used Peon, seed 1, seven days and all
three default child-process arms. Meetings were 11 (`push_baseline`),
10 (`push_v2`) and 4 (`consent`). All three reported zero judge invariants,
canary leaks and minor contacts. No mock child or model output was used.

One new integration case runs real game HTTP controls and Lab experiment
children. It checks locked Peon runs, matching-enabled Network controls,
judge counts, configuration and saved Lab results. Peon's Lab arms have zero
meetings after the fix, and every Network control arm still has meetings.

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

### Game worlds and reset controls

Game mode had a second path around the same app lock. Its ConsentNetwork
used `matchingAllowed(app)`, but its external engine and random StubNetwork
did not. Even while the state reported `matchingLocked: true`, two Peon
worlds produced 168 automatic proposals and 13 meetings. These initial
worlds used seed 1, 80 generated NYC personas and 14 days.

The game now omits the external engine when matching is locked. It passes
the app setting to StubNetwork, whose daily dispatch leaves new submissions
queued while disabled. This covers random introductions and player or
scenario proposals, not only engine output. The experiment passes its
matching flag to StubNetwork as well. Stub defaults remain enabled.
The game configuration now reports the app lock for stub worlds.

The integration case uses real HTTP reset, step and propose
commands before running its real Lab children. It checks both stub baselines,
a player submission with the engine off, the configuration and enabled controls.
On the base it sees 119 invitations where zero were expected. It passes with
the fix, with 42 assertions. There is still only one added integration case.

The paired HTTP measurement runs 64 generated worlds per revision:
seeds 1, 7, 11 and 23, 80 NYC personas, 14 days, all four app labels.
Each app gets engine-v1/stub, random/stub, engine-off/stub with a player
proposal on day 7, and a ConsentNetwork control. Every world is configured
through the HTTP reset route. Native worlds, agents and channel dispatch run
without mocks or model calls.

| Metric across the 12 affected Peon stub worlds | Before | After |
|---|---:|---:|
| Automatically generated proposals | 682 | 0 |
| Outbound proposal messages | 780 | 0 |
| Held meetings | 37 | 0 |
| Judge invariants | 0 | 0 |
| Canary leaks | 0 | 0 |
| Minor contacts | 0 | 0 |

All 52 control rows are deeply identical. This includes all reported metrics,
native record hashes, channel message hashes and persona memory hashes.
Record hashing excludes only the run identifier and final elapsed time.
All four player submissions in locked worlds remain `PROPOSED`, without
invitations or a scheduled meeting. Joins and non-matching activity continue.

The unchanged seed-23 ConsentNetwork control has one `minor_contact`
invariant under each of the Network, Slop and Friends app labels. These labels
share the same generated NYC world. Each also reports one minor contact;
canary leaks remain zero. These three pre-existing counts are not removed,
hidden or attributed to this fix. The other 61 game worlds have zero invariants
and minor contacts after the fix. A fully clean 64-world sample is not claimed.

The final candidate reproduces all 24 fixed Lab results, including the controls.

## safety_gates

The three before-fix violations belong to Peon's seed-23 push baseline:
`decliner_exposed: 3`. Matching-off removes those exposures. The other eleven
Peon results have zero invariants before and after. Enabled-app and daily-cap
controls remain unchanged. All 24 candidate Lab results have zero invariants,
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
Expect one passing case with 42 assertions.

For a direct matching-off experiment, run:

```text
bun run packages/network/harness/experiment.ts --only push_baseline,push_v2,consent --days 7 --seed 1 --matching-off
```

Expect zero proposals, invitations and meetings in every arm, and zero judge
invariants, canary leaks and minor contacts. Remove `--matching-off` to obtain
the unchanged matching-enabled control. On the base revision, Lab instead
passes `--max-new 0`, which reproduces the unwanted meetings above.

The committed case tests real game HTTP controls, Lab children and persistence, not the
browser UI or a live deployment. Existing stored Lab runs are historical
results and are not rewritten. The measurements cover seven-day Lab and 14-day game worlds over four
seeds, not every duration or seed. No secrets, raw run logs or member data
are included in this PR.

## Validation

`bun install --frozen-lockfile`: 50 installs checked, no changes.
`bun run typecheck`: all four configurations pass.

The same committed regression case, before the production fix:

```text
 0 pass
 1 fail
 1 expect() calls
Ran 1 test across 1 file. [1228.00ms]
```

After the production fix:

```text
 1 pass
 0 fail
 42 expect() calls
Ran 1 test across 1 file. [27.76s]
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
PASS: 91/91 blocking gates, 0 tracked off target, 254.3s (network 225.5s, audit 21.4s, ops 7.4s)
```

All 94 gate records match after elapsed-time normalization. This includes
91 blocking gates and three passing tracked gates.

`bun run test:integration`, including the security suite on isolated Postgres:

```text
 676 pass
 8 skip
 6 fail
 13783 expect() calls
Ran 690 tests across 69 files. [474.62s]
```

```text
(pass) game and lab runs honor app matching locks before dispatch [28455.99ms]
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
Ran 43 tests across 3 files. [37.42s]
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

For the game measurement, run this from each checkout, changing the output
name to before or after. Keep the program in their common parent directory:

```text
bun run --conditions eliza-source ../game-matching-measure.ts ../game-before.json
bun run ../game-matching-compare.ts ../game-before.json ../game-after.json
```

Game measurement JSON SHA-256:

- before: `d8c96d192e7b0eb7499ea3abf207d6afa3db0b21bb67a7acdf9759e84ac2e0dd`
- after: `9b7f1e3936f5e227d7be3c8780c7cf09e25afcc14c7c292929714f1125fd1de1`

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

### game-matching-measure.ts

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.cwd().replaceAll("\\", "/");
const { createServer } = await import(pathToFileURL(`${root}/packages/observatory/src/server.ts`).href);
const DAY = 86_400_000;
const hash = (x: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex");
const records = (source: any) => source.world.records.map((r: any) => {
  if (r.type === "run_start") { const { runId, ...rest } = r; return rest; }
  if (r.type === "run_end") { const { wallMs, ...rest } = r; return rest; }
  return r;
});
const variants = [
  { network: "stub", engine: "engine-v1", manual: false },
  { network: "stub", engine: "random", manual: false },
  { network: "stub", engine: "off", manual: true },
  { network: "consent", engine: "engine-v1", manual: false },
];
const rows = [];
for (const seed of [1, 7, 11, 23]) {
  const dir = await mkdtemp(join(tmpdir(), "game-matching-measure-"));
  const token = "local-game-matching-0000000000000000";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const server = await createServer({ port: 0, development: false, token, staffRolesUrl: false, peopleUrl: false,
    audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
    game: { seed, personas: 80, days: 14, network: "stub", engine: "off", pushMs: 3_600_000, tickMs: 3_600_000 },
    real: { url: undefined, service: false, pollMs: 3_600_000 },
  });
  try {
    for (const app of ["peon", "ntwrk", "slop", "friends"]) for (const variant of variants) {
      const source = await server.source("game", app);
      const state = () => fetch(`${server.url}/api/state?app=${app}`, { headers }).then(r => r.json());
      const control = async (body: unknown) => {
        const res = await fetch(`${server.url}/api/control?app=${app}`, { method: "POST", headers, body: JSON.stringify(body) });
        const result = await res.json();
        if (res.status !== 200 || !result.ok) throw Error(`Control failed: ${JSON.stringify(result)}`);
        return result;
      };
      await control({ type: "reset", network: variant.network, engine: variant.engine });
      await control({ type: "step", ms: (variant.manual ? 7 : 14) * DAY });
      let proposalId: string | undefined;
      if (variant.manual) {
        const pair = (await state()).members.filter((m: any) => m.joined && !m.minor && !m.declined && m.state !== "opted_out").slice(0, 2);
        if (pair.length !== 2) throw Error("No eligible pair");
        proposalId = (await control({ type: "propose", participants: pair.map((m: any) => m.id) })).data.id;
        await control({ type: "step", ms: 7 * DAY });
      }
      const s = await state(), native = records(source);
      const raw = source as any;
      const config = await source.config();
      const row = { seed, app, ...variant, locked: !!s.env.matchingLocked, matchingEnabled: config.matchingEnabled,
        stats: s.stats, generatedProposals: native.filter((r: any) => r.type === "proposal" && r.source !== "player").length,
        proposalMessages: native.filter((r: any) => r.type === "message" && r.msg.direction === "outbound" && r.msg.meta?.type === "proposal").length,
        scheduled: native.filter((r: any) => r.type === "meeting_scheduled").length,
        held: native.filter((r: any) => r.type === "outcome" && Object.values(r.attendance).filter((a: any) => a.showed).length >= 2).length,
        manualState: proposalId ? s.opportunities.find((o: any) => o.id === proposalId)?.state : null,
        recordsHash: hash(native), messagesHash: hash(raw.world.channel.all()), memoriesHash: hash([...raw.world.memories]),
      };
      rows.push(row);
      process.stderr.write(`${seed}/${app}/${variant.network}/${variant.engine}: generated=${row.generatedProposals} invites=${row.proposalMessages} held=${row.held} invariant=${s.stats.judge.invariants}\n`);
    }
  } finally { await server.stop(); await rm(dir, { recursive: true, force: true }); }
}
await Bun.write(process.argv[2]!, JSON.stringify(rows, null, 2) + "\n");
```

### game-matching-compare.ts

```ts
import assert from "node:assert/strict";
const before = await Bun.file(process.argv[2]!).json(), after = await Bun.file(process.argv[3]!).json();
assert.equal(before.length, 64);
assert.equal(after.length, 64);
const summary = { worlds: 64, changedWorlds: 0, identicalControls: 0, generatedBefore: 0, generatedAfter: 0,
  invitationsBefore: 0, invitationsAfter: 0, heldBefore: 0, heldAfter: 0, queuedPlayerProposals: 0,
  unchangedControlInvariants: 0, changedWorldInvariantsBefore: 0, changedWorldInvariantsAfter: 0 };
for (let i = 0; i < before.length; i++) {
  const b = before[i], a = after[i];
  const id = (x: any) => `${x.seed}/${x.app}/${x.network}/${x.engine}`;
  assert.equal(id(a), id(b));
  if (a.app !== "peon" || a.network !== "stub") {
    assert.deepEqual(a, b, `${id(a)} changed`);
    summary.identicalControls++;
    summary.unchangedControlInvariants += a.stats.judge.invariants;
    continue;
  }
  summary.changedWorlds++;
  assert.equal(a.locked, true);
  assert.equal(a.matchingEnabled, false);
  assert.equal(a.generatedProposals, 0);
  assert.equal(a.proposalMessages, 0);
  assert.equal(a.stats.invites, 0);
  assert.equal(a.scheduled, 0);
  assert.equal(a.held, 0);
  assert.equal(a.stats.judge.invariants, 0);
  assert.equal(a.stats.judge.canaryLeaks, 0);
  assert.equal(a.stats.judge.minorContacts, 0);
  assert.ok(a.stats.joined > 0);
  if (a.manual) { assert.equal(a.manualState, "PROPOSED"); summary.queuedPlayerProposals++; }
  summary.generatedBefore += b.generatedProposals;
  summary.generatedAfter += a.generatedProposals;
  summary.invitationsBefore += b.proposalMessages;
  summary.invitationsAfter += a.proposalMessages;
  summary.heldBefore += b.held;
  summary.heldAfter += a.held;
  summary.changedWorldInvariantsBefore += b.stats.judge.invariants;
  summary.changedWorldInvariantsAfter += a.stats.judge.invariants;
}
assert.equal(summary.changedWorlds, 12);
assert.equal(summary.identicalControls, 52);
console.log(JSON.stringify(summary, null, 2));
```
