# Keep counteroffers out of Observatory acceptance metrics

Date: 2026-11-09 (Asia/Tokyo).
Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2, Windows, PostgreSQL 16.15.
Scope: reproduced simulation-validation defect under CONTRIBUTING 3.1, PRD 34.3/34.4, and AGENTS decision 11: a counter is not a yes.

## Problem and cause

In the Observatory, compose an intro and play as its first recipient.
Reply `How about next week?`.
The reply is correctly recorded as `counter`, and the participant status becomes `countered`.
The Observatory nevertheless adds one global acceptance, one member acceptance, ten points, and one scoreboard acceptance.
It also marks the opportunity `PARTIALLY_ACCEPTED` and permanently completes the First spark mission.
No member has said yes at that point.

The projector and scoring code included `countered` alongside accepted statuses.
The same mistake affected consent-state calculation, proposal quorum, acceptance counters, score totals, and acceptance-based missions.

## Fix and alternatives

Retain the distinct `countered` status without acceptance credit.
Use accepted statuses to calculate consent and quorum.
Reverse an earlier acceptance when the same participant counters, and return an empty consent state to `INVITING`.
A later `meeting_scheduled` record promotes a countered member to confirmed and adds their first acceptance credit then.
Remove `countered` from the scoring predicate used by points, scoreboards, and missions.

Alternatives considered:

1. Change the reply parser. It already identifies the counteroffer correctly; the error occurs when that result is counted.
2. Change only the points calculation. The global/member totals, consent display, and mission would remain incorrect.
3. Turn a counteroffer into a decline. That loses the member's request to discuss another time and applies the wrong penalty.

The Network and simulator continue processing the same messages and decisions.
PR #295 changes Network reply parsing; PR #271 changes the simulator judge.
PR #404 addresses member counts after a decline; PR #423 addresses repeated booking confirmation counts.
Those are separate pending changes. This branch starts from main and does not include them.

## measurement

Run the same real HTTP workflow in 32 fresh worlds on each revision.
Use generated NYC populations of 80 people, seeds 1, 7, 11, and 23, and a 14-day horizon.
Use the supported StubNetwork game mode with background matching off, so the player supplies the measured proposal.
At day seven, choose the first two or three joined adults, take control of them, and propose an intro or group.
Answer the first proposal prompt through `/api/control`, then read `/api/state`.
Release the remaining players and finish the native world.

The four reply variants are `How about next week?`, `Could we reschedule?`, `yes`, and `no`.
Thus 16 worlds exercise counters and 16 exercise yes/no controls, across pairs and groups.
These are real servers, generated personas, channel deliveries, decisions, outcomes, and judge computations; no records are injected.

| Check | Before | After |
|---|---|---|
| Counter replies incorrectly counted as accepted at the first response | 16/16 | 0/16 |
| Counter replies receiving ten acceptance points | 16/16 | 0/16 |
| Counter-only replies completing First spark | 16/16 | 0/16 |
| Counter-only consent state | `PARTIALLY_ACCEPTED` | `INVITING` |
| Yes/no control rows, including final results | Reference | 16/16 identical |
| Native records, messages, and persona memories | Reference | 32/32 identical sets of each |
| Final countered participants incorrectly retaining acceptance credit | 15 | 0 |
| Countered participant later confirmed and attended | One credit | One credit |

The source member, proposal, reply classification, and records before the reply match in all 32 pairs.
Native record hashing excludes only `run_start.runId` and `run_end.wallMs`.
Message and persona-memory hashes require exact equality.
Control rows require full deep equality, including the final opportunity, counters, score, and missions.

One seed-7 pair later receives a native booking and attends under the StubNetwork's existing behavior.
Its final acceptance count remains one for that member after this fix.
Fifteen countered participants remain unconfirmed, and all fifteen now have zero acceptance credit.
Two group runs later earn First spark from another member's actual yes; this behavior remains valid.
The measured improvement is exact status accounting; no population estimate or confidence interval applies.

The single HTTP integration case covers the counter, yes, and no workflows on seed 1.
It fails on base: 0 pass, 1 fail, at the first response (260 ms).
The corrected case passes: 1 pass, 0 fail, three assertions (356 ms).
An initial probe used `another time`, which this base reads as a decline; the paired cases use recognized counteroffers.

## safety_gates and validation

All 32 paired worlds retain zero judge invariants, canary leaks, and minor contacts.
Eight seed-7 worlds retain an oracle-unsafe player proposal and its score penalty, unchanged on both revisions.
The fix changes observation and scoring; the native world hashes show unchanged simulation behavior.

`bun install --frozen-lockfile`: 50 installs checked, no changes.
`bun run typecheck`: all four configurations pass.

Run the affected audit and operations blocks on both revisions:

```sh
bun run sim --only audit,ops --json <scratch>/gates.json
```

Base and candidate each pass 30/30 blocking gates with zero tracked gates off target, in 28.0 seconds.
All 31 gate records match after removing `ms` and the elapsed restore time in the backup-drill label.
No other gate name, detail, pass state, or classification is changed.
The full simulation was not repeated: AGENTS.md permits one full run per agent, already used for PR #355.

`bun run test:integration`: 676 pass, 8 skip, 6 fail; 13,744 assertions across 69 files, 464.87 seconds.
The new regression passed inside this official suite in 225 ms.
The suite includes all security test files.
All six failure names and diagnostic causes match the recorded base failures:

- Wrangler: missing `/bin/bash` on Windows (`ENOENT`, `uv_spawn`).
- Backend shutdown: SIGTERM produces exit 143, while the test expects 0.
- Four site build assertions expect slash-separated paths; Windows returns backslash-separated paths.

The eight skipped integration cases match the previous baseline skip set.
A fully green integration suite is not claimed.

`bun run test:e2e`: 42 pass, 1 skip, 0 fail; 654 assertions across three files, 37.56 seconds.
The skipped case needs the optional browser SDK environment. Browser acceptance is not claimed.

Validation setup corrections: a synthetic local token was initially too short, and expected test states needed literal types.
The token was lengthened before measurement; `as const` corrected the fixture type without changing its runtime behavior.
Live-send and deploy flags were disabled. Tests used an isolated local PostgreSQL cluster on port 54339.
All test processes finished, and the database was stopped after verifying zero active clients.

## llm_evidence

N/A: this changes deterministic projection and scoring, with no model-backed behavior.
The worlds use policy personas. Real-model calls: 0. Cost: $0. Test provider/model: none.
The tested StubNetwork mode does not have a review queue; this change adds no review bypass to the consent Network.

## agent_clients

N/A: no member-facing agent workflow changes. The tested interface is the Observatory's real local HTTP API.
Codex desktop 26.1103.4239.0 drove Bun 1.4.2 with OpenAI assistance.
The exact assistant model identifier was not exposed; disclosure uses the helper's supported `unavailable` value.
No browser or computer use was performed. No other client is claimed as tested.

## Reproduce

```sh
bun test --conditions eliza-source packages/observatory/test/counter-acceptance.integration.test.ts
```

Expect one passing case with three assertions on the candidate.
To measure both revisions, save the scripts below outside the repository.
Run the first command from base, the second from candidate, and use separate gate output files from the command above.

```sh
bun run --conditions eliza-source <scratch>/obs-counter-measure.ts <scratch>/before.json
bun run --conditions eliza-source <scratch>/obs-counter-measure.ts <scratch>/after.json
bun run <scratch>/obs-counter-compare.ts <scratch>/before.json <scratch>/after.json <scratch>/gates-before.json <scratch>/gates-after.json
```

The following scripts are hand-written measurement code.

### obs-counter-measure.ts

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.cwd().replaceAll("\\", "/");
const { createServer } = await import(pathToFileURL(`${root}/packages/observatory/src/server.ts`).href);
const { FileAudit } = await import(pathToFileURL(`${root}/packages/observatory/src/staff.ts`).href);
const DAY = 86_400_000;
const hash = (x: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex");
const records = (source: any) => source.world.records.map((r: any) => {
  if (r.type === "run_start") { const { runId, ...rest } = r; return rest; }
  if (r.type === "run_end") { const { wallMs, ...rest } = r; return rest; }
  return r;
});
const variants = [
  { id: "next_week", text: "How about next week?", counter: true },
  { id: "reschedule", text: "Could we reschedule?", counter: true },
  { id: "yes", text: "yes", counter: false },
  { id: "no", text: "no", counter: false },
];
const rows = [];
for (const seed of [1, 7, 11, 23]) for (const size of [2, 3]) for (const variant of variants) {
  const dir = await mkdtemp(join(tmpdir(), "obs-counter-measure-"));
  const token = "local-counter-measure-0000000000000000";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const server = await createServer({ port: 0, development: false, token,
    staffRolesUrl: false, peopleUrl: false, audit: new FileAudit(join(dir, "audit")), lab: { dir: join(dir, "lab") },
    game: { seed, personas: 80, days: 14, network: "stub", engine: "off", pushMs: 3_600_000, tickMs: 3_600_000 },
    real: { url: undefined, service: false, pollMs: 3_600_000 },
  });
  const source = await server.source("game") as any;
  const state = () => fetch(`${server.url}/api/state`, { headers }).then(r => r.json());
  const control = async (cmd: unknown) => {
    const r = await fetch(`${server.url}/api/control`, { method: "POST", headers, body: JSON.stringify(cmd) });
    const result = await r.json();
    if (r.status !== 200 || !result.ok) throw Error(`Control failed: ${JSON.stringify(result)}`);
    return result;
  };
  const release = async () => {
    const s = await state(), waiting = new Set(s.game.prompts.map((p: any) => p.memberId));
    const order = [...s.game.controlled].sort((a, b) => Number(waiting.has(a)) - Number(waiting.has(b)));
    for (const memberId of order) await control({ type: "takeover", memberId, on: false });
  };
  let step: Promise<unknown> | undefined;
  try {
    await control({ type: "step", ms: 7 * DAY });
    const ids = (await state()).members.filter((m: any) => m.joined && !m.minor && !m.declined && m.state !== "opted_out")
      .slice(0, size).map((m: any) => m.id);
    for (const memberId of ids) await control({ type: "takeover", memberId, on: true });
    const pid = (await control({ type: "propose", participants: ids })).data.id;
    let done = false, selected: any;
    step = control({ type: "step", ms: 2 * DAY }).finally(() => { done = true; });
    const deadline = performance.now() + 30_000;
    while (!done && !selected && performance.now() < deadline) {
      const prompt = (await state()).game?.prompts[0];
      if (prompt) {
        if (prompt.proposalId === pid) {
          const preRecordsHash = hash(records(source));
          const reply = await control({ type: "reply", promptId: prompt.id, text: variant.text });
          while (!done && !(await state()).game?.prompts.length && performance.now() < deadline) await Bun.sleep(1);
          const s = await state(), o = s.opportunities.find((o: any) => o.id === pid);
          const score = s.game.scores.find((x: any) => x.source === "player");
          selected = { memberId: prompt.memberId, proposalId: pid, preRecordsHash, reply,
            status: o.status[prompt.memberId], state: o.state, accepts: s.stats.accepts,
            memberAccepted: s.members.find((m: any) => m.id === prompt.memberId).counters.accepted,
            scoreAccepted: score.accepted, points: score.points,
            firstSpark: s.game.missions.find((m: any) => m.id === "first_spark").done };
          break;
        }
        await control({ type: "reply", promptId: prompt.id, auto: true });
      }
      await Bun.sleep(1);
    }
    if (!selected) throw Error(`No target prompt: ${seed}/${size}/${variant.id}`);
    await release();
    await step;
    await control({ type: "step", ms: 5 * DAY });
    const final = await state();
    const row = { seed, size, ...variant, selected, recordsHash: hash(records(source)),
      messagesHash: hash(source.world.channel.all()), memoriesHash: hash([...source.world.memories]),
      judge: final.stats.judge,
      final: { accepts: final.stats.accepts, scores: final.game.scores, missions: final.game.missions,
        opp: final.opportunities.find((o: any) => o.id === pid),
        members: final.members.filter((m: any) => ids.includes(m.id)).map((m: any) => ({ id: m.id, counters: m.counters })) } };
    rows.push(row);
    console.log(JSON.stringify({ seed, size, id: variant.id, selected, judge: row.judge }));
  } finally {
    await release();
    await step;
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
}
await Bun.write(process.argv[2]!, JSON.stringify(rows, null, 2) + "\n");
```

### obs-counter-compare.ts

```ts
import { strict as assert } from "node:assert";
const before = await Bun.file(process.argv[2]).json();
const after = await Bun.file(process.argv[3]).json();
assert.equal(before.length, 32);
assert.equal(after.length, 32);
let counters = 0, controls = 0, stillCountered = 0, laterConfirmed = 0, unsafeControls = 0;
for (let i = 0; i < before.length; i++) {
  const b = before[i], a = after[i];
  const key = `${a.seed}/${a.size}/${a.id}`;
  assert.deepEqual([a.seed, a.size, a.id, a.text], [b.seed, b.size, b.id, b.text]);
  assert.deepEqual([a.selected.memberId, a.selected.proposalId], [b.selected.memberId, b.selected.proposalId], key);
  for (const field of ["recordsHash", "messagesHash", "memoriesHash"]) assert.equal(a[field], b[field], `${key}/${field}`);
  assert.equal(a.selected.preRecordsHash, b.selected.preRecordsHash, key);
  assert.deepEqual(a.selected.reply, b.selected.reply, key);
  assert.deepEqual(a.judge, b.judge, key);
  assert.deepEqual([a.judge.invariants, a.judge.canaryLeaks, a.judge.minorContacts], [0, 0, 0], key);
  if (a.final.scores.find((s: any) => s.source === "player").unsafe) unsafeControls++;
  if (!a.counter) {
    assert.deepEqual(a, b, key);
    controls++;
    continue;
  }
  counters++;
  assert.deepEqual([b.selected.status, b.selected.accepts, b.selected.memberAccepted, b.selected.scoreAccepted,
    b.selected.firstSpark, b.selected.state], ["countered", 1, 1, 1, true, "PARTIALLY_ACCEPTED"], key);
  assert.deepEqual([a.selected.status, a.selected.accepts, a.selected.memberAccepted, a.selected.scoreAccepted,
    a.selected.firstSpark, a.selected.state], ["countered", 0, 0, 0, false, "INVITING"], key);
  assert.equal(a.selected.points, b.selected.points - 10, key);
  const member = (r: any) => r.final.members.find((m: any) => m.id === r.selected.memberId);
  if (a.final.opp.status[a.selected.memberId] === "countered") {
    assert.equal(member(a).counters.accepted, 0, key);
    assert.equal(member(b).counters.accepted, 1, key);
    assert.equal(a.final.accepts, b.final.accepts - 1, key);
    stillCountered++;
  } else {
    assert.equal(a.final.opp.status[a.selected.memberId], "attended", key);
    assert.equal(member(a).counters.accepted, 1, key);
    assert.equal(a.final.accepts, b.final.accepts, key);
    laterConfirmed++;
  }
}
assert.deepEqual([counters, controls, stillCountered, laterConfirmed], [16, 16, 15, 1]);
const bGates = await Bun.file(process.argv[4]).json();
const aGates = await Bun.file(process.argv[5]).json();
const gates = (r: any) => r.gates.map(({ ms, ...rest }: any) => ({ ...rest,
  name: rest.name.startsWith("backup drill:") ? rest.name.replace(/restore \d+ ms$/, "restore <elapsed> ms") : rest.name,
}));
assert.deepEqual(gates(aGates), gates(bGates));
assert.equal(aGates.gates.length, 31);
assert.equal(aGates.gates.filter((g: any) => g.blocking).length, 30);
assert.ok(aGates.gates.every((g: any) => g.pass));
console.log(JSON.stringify({ worldsPerRevision: after.length, falseInitialCounterCreditsBefore: counters,
  falseInitialCounterCreditsAfter: 0, unchangedControlWorlds: controls, unchangedNativeRecordSets: after.length,
  unchangedMessageSets: after.length, unchangedMemorySets: after.length,
  remainingCounterStatusesWithoutCredit: stillCountered, laterConfirmedWithOneCredit: laterConfirmed,
  judgeInvariants: 0, canaryLeaks: 0, minorContacts: 0,
  worldsWithUnchangedUnsafeProposal: unsafeControls, identicalGateRecords: aGates.gates.length,
  blockingGatesPassed: 30, trackedOffTarget: 0 }, null, 2));
```
