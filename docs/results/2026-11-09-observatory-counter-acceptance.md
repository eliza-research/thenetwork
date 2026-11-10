# Keep counteroffers out of Observatory acceptance metrics

Date: 2026-11-10 (Asia/Tokyo).
Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2, Windows, PostgreSQL 16.15.

## Requirement, problem, and cause

This fixes a reproduced defect under the approved Slop scope and CONTRIBUTING 3.1.
PRD 34.3/34.4 cover simulation validation; PRD 35.3 requires a shared Observatory view model.
AGENTS decision 11 states that a counter is not a yes.

Compose an intro in game mode, take control of its first recipient, and reply `How about next week?`.
The parser records `counter`, and the participant becomes `countered`.
Game mode nevertheless adds an acceptance to global/member totals, adds ten points,
marks the opportunity `PARTIALLY_ACCEPTED`, and permanently completes First spark.
No member has said yes.

Persist those native game rows with the repository's database writer and read them in real mode.
The database-backed Observatory also counts the counteroffer as acceptance.
The initial counter-only fixture reports one global acceptance, one member acceptance, and a 100% opt-in rate.
The game projector, shared scoring predicate, and real source's acceptance predicate all included `countered`.
The real predicate feeds both the SQL member aggregate and the global counter used by the opt-in scorecard.

## Fix and alternatives

Keep the distinct counteroffer status without acceptance credit in either mode.
Use accepted statuses for consent and quorum. Reverse earlier credit when a participant counters,
and return an empty consent state to `INVITING`. A later recorded booking confirms that participant
and adds their first acceptance credit then. Shared scoring no longer gives counteroffers points or mission credit.
The database source excludes `countered` from its existing acceptance predicate; the queries and scorecard remain otherwise unchanged.

Alternatives considered:

1. Change the parser. It already recognizes these counteroffers; the error is in accounting.
2. Change only points. Global/member counts, consent state, missions, and the real-mode scorecard would remain wrong.
3. Treat counters as declines. That discards their meaning and applies a refusal penalty.

PR #295 changes Network parsing; #271 changes the judge; #404 addresses member counts after declines;
#423 addresses repeated booking confirmations; #439 changes experiment acceptance.
This branch starts from main and does not include those pending changes.
There are no UI, dependency, threshold, or dispatch changes.

## measurement

The program below ran afresh on original main and the final candidate, with the same method and seeds.
It creates 32 native HTTP workflows per revision: seeds 1, 7, 11, and 23; generated NYC populations
of 80 people; pairs and groups of three; and four reply variants.
The variants are `How about next week?`, `Could we reschedule?`, `yes`, and `no`.

Each world uses the supported StubNetwork mode with background matching off.
At day seven, the player selects joined adults and proposes an intro or group.
The first recipient answers through `/api/control`. The program reads `/api/state`, releases the
remaining players, and finishes the native 14-day world. There are no injected simulation records or mocked methods.

| Game-mode check | Before | After |
|---|---|---|
| Initial counter replies incorrectly given acceptance credit | 16/16 | 0/16 |
| Counter replies receiving ten acceptance points | 16/16 | 0/16 |
| Counter-only replies completing First spark | 16/16 | 0/16 |
| Counter-only consent state | `PARTIALLY_ACCEPTED` | `INVITING` |
| Yes/no control workflows, including final results | Reference | 16/16 identical |
| Native records, messages, and persona memory | Reference | 32/32 identical sets of each |
| Final unconfirmed countered participants with acceptance credit | 15 | 0 |
| Later confirmed countered participant who attended | One credit | One credit |

Native record hashes exclude only generated `run_start.runId` and elapsed `run_end.wallMs`.
Channel-message and persona-memory hashes require exact equality. The source member, proposal, reply
classification, and pre-reply records match in every pair. Yes/no workflows require full deep equality,
including final opportunities, counts, scores, missions, and database-backed observations.

The same program exports each world twice through `rowsFromGame` and `writeRows`: after the first reply
and at day fourteen. It reads a separate HTTP server initialized in real mode after each export.
This gives 64 real PostgreSQL and HTTP observations per revision. Expected counts come from the
stored participant statuses and proposal messages, independently of the Observatory aggregates.

| Real-mode check | Before | After |
|---|---:|---:|
| Correct global/member acceptance and opt-in metrics | 33/64 | 64/64 |
| Previously correct observations preserved exactly | 33 | 33 |
| Observations with false counteroffer credit | 31 | 0 |
| Reads preserving their stored participation, opportunity, and message fields | 64/64 | 64/64 |

The 31 corrected observations are 16 initial counter replies and 15 final unconfirmed counter replies.
The later confirmed participant remains correctly counted once. Measured statuses include accepted,
attended, countered, declined, expired, invited, and pending. This is not an exhaustive status-transition test.
The existing confirmed, no-show, and cancellation-after-consent predicate entries remain in place.

Database fingerprints compare stored fields before and after each read. They do not assert that every
exported projection field is identical across revisions: the corrected game consent state is intentionally exported.
Native record/message/memory comparisons and expected acceptance counts do match across revisions.
The measured result is exact accounting, not an estimate of matching quality or a population effect.

## safety_gates

All 32 paired worlds retain zero judge invariants, canary leaks, and minor contacts.
Eight seed-7 workflows retain an oracle-unsafe player proposal and its penalty.
The exposed final oracle assessments and every player's unsafe count remain identical.
These oracle findings are not claimed as safe proposals. Native-world hashes show unchanged simulation behavior.

Fresh audit and operations blocks pass 30/30 blocking gates on both revisions, with one passing tracked gate and zero tracked misses.
Runtime: 22.6 seconds before, 23.7 seconds after; these timings are incidental.

All 31 gate records match after excluding elapsed `ms` and the restore duration embedded in the backup-drill label.
No other gate name, detail, pass state, or classification changes. The full simulation suite was not repeated for this update.

## Regression and required validation

The single integration case now exercises the counter, yes, and no replies in both game and real modes.
It uses generated worlds, the native database writer, PostgreSQL, and actual HTTP servers.

```sh
bun test --conditions eliza-source packages/observatory/test/counter-acceptance.integration.test.ts
```

On previous PR head `ebc3e6c7370a9821258050daddc36b79fb345d8f`, the expanded case fails:
0 pass, 1 fail, 2 assertions, case 2965.69 ms. The game assertion passes, then the database response
reports one acceptance and 100% opt-in for the unaccepted counter. The final candidate passes:
1 pass, 0 fail, 6 assertions, case 18512.00 ms. The paired measurements separately compare original main and the final candidate.

| Command | Result |
|---|---|
| `bun install --frozen-lockfile` | Passed during checkout setup; no dependency changes |
| `bun run typecheck` | All four configurations pass |
| Expanded regression | Previous PR head fails; final candidate passes, 6 assertions |
| `bun run sim --only audit,ops` | 30/30 blocking gates before and after |
| `bun run test:integration` | 676 pass, 8 skip, 6 fail; 13,747 assertions; 429.61 seconds |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 41.35 seconds |

Integration includes every security-suite file. Its six failures match the Windows baseline by name and cause:
Wrangler cannot spawn `/bin/bash`; the backend SIGTERM case returns 143 instead of 0;
four site builds fail slash-sensitive path assertions. No new failure appears. The expanded regression passes in the full suite, 3998.31 ms.
The eight optional reconciliation skips match the baseline. The end-to-end skip needs the optional SDK/Playwright environment.

The first full integration attempt was interrupted when the local PostgreSQL process exited.
Its incomplete log ends with connection-refused errors and is not used as a completed validation result.
After confirming the test and database processes had stopped, the owned cluster was restarted and recovered normally.
Integration and end-to-end tests were then run again; the table records the completed rerun.

An initial harness attempt used an unsupported mode query parameter and still read game mode.
Those results were discarded. The reported program uses a separate real-mode server and asserts its returned mode.
No product change was made to route requests differently.
All data is synthetic and local. PostgreSQL was required and available on port 54339.
Live-send and deployment flags were disabled. After validation, zero client connections were verified and the owned database cluster was stopped.

## llm_evidence

N/A: deterministic projection, aggregation, and scoring change no model-backed behavior.
The worlds use policy personas. Real-model calls: 0. Cost: $0. Test provider/model: none.
StubNetwork has no review queue; this change adds no review bypass to the consent Network.

## agent_clients

The tested interface is the Observatory's local HTTP API.
Codex desktop drove Bun 1.4.2 on Windows with PostgreSQL 16.15.
The client version verified at resumed validation was 26.1103.7773.0; the earlier recorded client version was 26.1103.4239.0.
Authoring provider: OpenAI. Exact authoring model: unavailable to this session.
No member-facing signup, MCP, or messaging workflow changes. Other clients were not tested.
No browser or computer use was performed.

## Reproduce

1. Prepare clean base and candidate checkouts with `bun install --frozen-lockfile`.
2. Start isolated local PostgreSQL on port 54339, set `REQUIRE_PG=1` and `OBSERVATORY_PG_PORT=54339`,
   and make the PostgreSQL client programs available. Keep live-send and deployment flags unset.
3. Save the two programs below outside the checkouts, under their given filenames.
4. In each checkout, run `bun run --conditions eliza-source ../obs-counter-dual-measure.ts <output.json>`.
   Use separate absolute output paths. The program creates and drops its own process-specific database.
5. In each checkout, run `bun run sim --only audit,ops --json <gates.json>`, with separate output paths.
6. Run `bun run ../obs-counter-dual-compare.ts <before.json> <after.json> <gates-before.json> <gates-after.json>`.
   Expect 16 corrected initial game counters, 16 unchanged yes/no workflows, 31 corrected database observations,
   33 unchanged database controls, 32 unchanged native record/message/memory sets, and 31 unchanged gate records.
7. Run the expanded regression and validation commands above. Expect one passing case with six assertions.
   Compare platform failures and optional skips with the baseline.

### obs-counter-dual-measure.ts

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { SQL } from "bun";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const root = process.cwd().replaceAll("\\", "/");
const { createServer } = await import(pathToFileURL(`${root}/packages/observatory/src/server.ts`).href);
const { FileAudit } = await import(pathToFileURL(`${root}/packages/observatory/src/staff.ts`).href);
const { testDb, dropTestDb } = await import(pathToFileURL(root + "/packages/observatory/test/pg.ts").href);
const { rowsFromGame, writeRows } = await import(pathToFileURL(root + "/packages/observatory/db/writer.ts").href);
const dbUrl = await testDb(), sql = new SQL(dbUrl);
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
try {
for (const seed of [1, 7, 11, 23]) for (const size of [2, 3]) for (const variant of variants) {
  const dir = await mkdtemp(join(tmpdir(), "obs-counter-measure-"));
  const token = "local-counter-measure-0000000000000000";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const server = await createServer({ port: 0, development: false, token,
    staffRolesUrl: false, peopleUrl: false, audit: new FileAudit(join(dir, "audit")), lab: { dir: join(dir, "lab") },
    game: { seed, personas: 80, days: 14, network: "stub", engine: "off", pushMs: 3_600_000, tickMs: 3_600_000 },
    real: { url: dbUrl, service: false, pollMs: 3_600_000, pushMs: 3_600_000 },
  });
  const source = await server.source("game") as any;
  let realServer: Awaited<ReturnType<typeof createServer>> | undefined;
  const state = () => fetch(`${server.url}/api/state`, { headers }).then(r => r.json());
  const control = async (cmd: unknown) => {
    const r = await fetch(`${server.url}/api/control`, { method: "POST", headers, body: JSON.stringify(cmd) });
    const result = await r.json();
    if (r.status !== 200 || !result.ok) throw Error(`Control failed: ${JSON.stringify(result)}`);
    return result;
  };
  const readReal = async () => {
    await writeRows(sql, rowsFromGame(source), { truncate: true });
    const fingerprint = async () => hash(await Promise.all([
      sql`select app_id, opportunity_id, member_id, role, status, enjoyment from network.participations order by app_id, opportunity_id, member_id`,
      sql`select app_id, id, state, meeting_at, created_at, updated_at from network.opportunities order by app_id, id`,
      sql`select app_id, id, member_id, direction, body, ts from network.messages order by app_id, id`,
    ]));
    const dataBefore = await fingerprint();
    realServer ??= await createServer({ port: 0, development: false, mode: "real", token,
      staffRolesUrl: false, peopleUrl: false, audit: new FileAudit(join(dir, "real-audit")), lab: { dir: join(dir, "real-lab") },
      real: { url: dbUrl, service: false, pollMs: 3_600_000, pushMs: 3_600_000 } });
    const real = await realServer.source("real");
    assert((await real.control({ type: "refresh" })).ok);
    const response = await fetch(realServer.url + "/api/state", { headers });
    assert.equal(response.status, 200);
    const s = await response.json();
    assert.equal(s.env.mode, "real");
    const parts = await sql`select member_id, status from network.participations where app_id = 'ntwrk' and role = 'participant' order by member_id, opportunity_id`;
    const yes = parts.filter((p: any) => ["accepted", "confirmed", "attended", "no_show", "cancelled_with_notice"].includes(p.status));
    const invites = (await sql`select count(*)::int as n from network.messages where app_id = 'ntwrk' and direction = 'outbound' and type = 'proposal'`)[0].n;
    const expectedValue = invites ? Math.round(yes.length / invites * 1000) / 1000 : null;
    const actual = { accepts: s.stats.accepts, invites: s.stats.invites,
      members: s.members.map((m: any) => ({ id: m.id, accepted: m.counters.accepted })).sort((a: any, b: any) => a.id.localeCompare(b.id)),
      optIn: s.stats.scorecard.find((m: any) => m.key === "opt_in") };
    const expected = { accepts: yes.length, invites,
      members: actual.members.map((m: any) => ({ id: m.id, accepted: yes.filter((p: any) => p.member_id === m.id).length })),
      optIn: { ...actual.optIn, value: expectedValue, n: invites, ...(invites ? { met: yes.length / invites >= 0.4 } : {}) } };
    assert.equal(await fingerprint(), dataBefore, "Real-source reads mutated database rows");
    return { actual, expected, exact: JSON.stringify(actual) === JSON.stringify(expected),
      countered: parts.filter((p: any) => p.status === "countered").length,
      statuses: [...new Set(parts.map((p: any) => p.status))].sort(), dataUnchanged: true };
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
            firstSpark: s.game.missions.find((m: any) => m.id === "first_spark").done, real: await readReal() };
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
    const row = { seed, size, ...variant, selected, realFinal: await readReal(), recordsHash: hash(records(source)),
      messagesHash: hash(source.world.channel.all()), memoriesHash: hash([...source.world.memories]),
      judge: final.stats.judge,
      final: { accepts: final.stats.accepts, scores: final.game.scores, missions: final.game.missions,
        opp: final.opportunities.find((o: any) => o.id === pid),
        members: final.members.filter((m: any) => ids.includes(m.id)).map((m: any) => ({ id: m.id, counters: m.counters })) } };
    rows.push(row);
    console.log(JSON.stringify({ seed, size, id: variant.id, gameStatus: selected.status, realInitialCorrect: selected.real.exact, realFinalCorrect: row.realFinal.exact }));
  } finally {
    await release();
    await step;
    await realServer?.stop();
    await server.stop();
    const target = resolve(dir), parent = resolve(tmpdir());
    if (!target.startsWith(parent + sep) || !target.slice(parent.length + 1).startsWith("obs-counter-measure-")) throw new Error("Unsafe cleanup path");
    await rm(target, { recursive: true, force: true });
  }
}
await Bun.write(process.argv[2]!, JSON.stringify(rows, null, 2) + "\n");
} finally { await sql.close(); await dropTestDb(); }
```

### obs-counter-dual-compare.ts

```ts
import { strict as assert } from "node:assert";
const before = await Bun.file(process.argv[2]).json();
const after = await Bun.file(process.argv[3]).json();
assert.equal(before.length, 32);
assert.equal(after.length, 32);
let counters = 0, controls = 0, stillCountered = 0, laterConfirmed = 0, unsafeControls = 0;
let realCases = 0, realCorrectBefore = 0, realControls = 0;
const realStatuses = new Set<string>();
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
  assert.deepEqual(a.final.opp.oracle, b.final.opp.oracle, key + "/oracle");
  assert.equal(a.final.scores.find((s: any) => s.source === "player").unsafe, b.final.scores.find((s: any) => s.source === "player").unsafe);
  if (a.final.scores.find((s: any) => s.source === "player").unsafe) unsafeControls++;
  for (const [name, ar, br] of [["initial", a.selected.real, b.selected.real], ["final", a.realFinal, b.realFinal]] as const) {
    assert.deepEqual(ar.expected, br.expected, key + "/" + name + "/expected");
    assert.deepEqual(ar.actual, ar.expected, key + "/" + name + "/actual");
    assert.deepEqual([ar.countered, ar.statuses, ar.dataUnchanged], [br.countered, br.statuses, true]);
    assert.equal(br.dataUnchanged, true);
    for (const status of ar.statuses) realStatuses.add(status);
    realCases++;
    if (br.exact) { realCorrectBefore++; realControls++; assert.deepEqual(ar.actual, br.actual); }
    else {
      assert.equal(br.actual.accepts - ar.actual.accepts, ar.countered);
      assert(ar.countered > 0);
      for (const m of ar.actual.members) {
        const bm = br.actual.members.find((x: any) => x.id === m.id);
        assert(bm && bm.accepted >= m.accepted);
      }
    }
  }
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
assert.deepEqual([realCases, realCorrectBefore, realControls], [64, 33, 33]);
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
  blockingGatesPassed: 30, trackedOffTarget: 0, realHttpReads: realCases, realCorrectBefore, realCorrectAfter: realCases,
  realUnchangedControls: realControls, realChanged: realCases - realCorrectBefore, databaseReadsWithoutMutation: realCases,
  realStatuses: [...realStatuses].sort() }, null, 2));
```
