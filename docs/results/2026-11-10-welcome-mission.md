# Score newcomer missions at the meeting time

## Requirement and cause

This fixes a reproduced simulation-scoring defect under CONTRIBUTING 3.1,
PRD 34.3, and the missions in `docs/observatory.md` section 4. The existing
Welcome wagon description defines a newcomer as joined in the last 30 days.
The threshold and description do not change.

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Generated members used `joinDay > 0` as a permanent newcomer flag. A member
who joined on day zero could never qualify, even after attending in the first
week. A member who joined later could still qualify after day forty.
The synthetic dataset path compared its historical join date with the start
of the simulation, so those recent members also never aged out.

Use the historical dataset join date when present, otherwise the recorded
join event. Compare it with the meeting's time, requiring elapsed membership
of zero through thirty days. Pass the meeting time to the mission predicate.
The existing `updatedAt` fallback applies only if a held opportunity has no
meeting time. Completed missions retain the existing sticky behavior.

Alternatives:

1. Compare with the current simulation clock. A valid meeting may be read
   after the member has aged out. One measured control meets this condition.
2. Use only projected `joinedAt`. Loading historical dataset members creates
   fresh simulated join events; that would make long-standing members new.
3. Use only generated `joinDay`. This loses actual join timing and does not
   handle historical dataset tenure.

There is no UI, copy, matching, dispatch, parser, scoring-points, or threshold
change. This does not alter the engine's newcomer eligibility. No open PR in
the inspected inventory changes this mission's newcomer predicate.

## measurement

Bun 1.4.2 on Windows. Both revisions run the same program below, with seeds
1, 7, 11, and 23. Each world has a 60-day horizon and uses the supported
StubNetwork game mode with the engine off. The player selects two joined
adults, proposes through HTTP, takes over both members, and says yes to their
native proposal prompts. The real world schedules, holds, and records the
meeting and feedback. No outcomes or responses are mocked.

Forty worlds per revision:

- 24 generated 80-person NYC worlds: day-zero and later join cohorts,
  proposals on days 7, 28, and 40, for each of four seeds.
- 16 existing synthetic-dataset NYC worlds: recent historical joins (up to
  15 days before the snapshot) and old joins (at least 60 days before it),
  proposals on days 7 and 40, for each seed.

Observe the mission after the native meeting and again at day 60. Expected
eligibility comes from the native outcome timestamp and the original join
timestamp, not from the mission's result. Every selected participant attends.

| Result | Before | After |
|---|---:|---:|
| Correct mission results | 28/40 | 40/40 |
| False completions for members older than 30 days | 8 | 0 |
| Missed completions for day-zero newcomers | 4 | 0 |
| Correct control output rows unchanged | Reference | 28/28 |
| Native record, message, and persona-memory hash sets unchanged | Reference | 40/40 each |
| Other mission IDs, completion flags, and progress | Reference | All unchanged |
| Correct mission state retained at day 60 | 28/40 | 40/40 |
| Judge invariants, canary leaks, minor contacts | 0, 0, 0 | 0, 0, 0 |

The false positives split evenly between generated later joins and historical
recent joins at day forty. In the delayed-read control (generated seed 1,
proposal day 28), the members had joined 29.347 and 29.003 days before the
meeting. At the read they had joined 31.639 and 31.294 days ago. The mission
still earns credit for that earlier meeting. Old dataset members remain
ineligible despite their fresh simulated join events.

Six generated seed-7 worlds contain an oracle-unsafe player proposal and its
existing penalty. This is unchanged on both revisions and is not presented
as safe matching. All native record fields and outcomes are unchanged.
This mode has no review queue; the consent Network's review path is untouched.

The comparator requires every output field except this mission's result to
match, including native records, messages, memories, opportunities, and
scores. Record hashes omit only `run_start.runId` and `run_end.wallMs`.
Mission comparisons use ID, completion flag, and progress; polling-dependent
`doneAt` metadata is not compared. This is an exact deterministic check, not
a statistical estimate of user outcomes or matching quality.

One committed HTTP integration case covers five native worlds: the two
defects, two ordinary controls, and the delayed-read control. Before the fix
it fails on the first real meeting: 0 pass, 1 fail, 1 assertion, 127.83 ms.
After the fix it passes: 1 pass, 0 fail, 5 assertions, 545.91 ms.
An initial exploratory selector required a join exactly at world start and
found no member because real join events have a delay. It was corrected to
select joins during day zero before collecting the reported measurements.

## safety_gates

Frozen install checked 50 installs without changes. All four typecheck
configurations pass. Audit/operations pass 30/30 blocking gates with zero
tracked gates off target on both revisions: 26.9 seconds before, 26.3 after.
All 31 gate records match after excluding per-gate elapsed time and the
backup-drill label's restore time. The backup retains 69 tables, 71 rows and
a 274 KiB dump.

Official integration, including security: 676 pass, 8 skip, 6 fail; 13,746
assertions across 690 tests and 69 files in 462.72 seconds. The new regression
passes in that suite in 566.94 ms. The validator requires the exact six
baseline failure names and causes: missing `/bin/bash`, the backend SIGTERM
exit 143 rather than 0, and four Windows site-path assertions. The integration
skip names also match the previous run.

Official end-to-end: 42 pass, 1 skip, 0 fail; 654 assertions in 39.06 seconds.
The optional browser SDK recovery-feedback case is skipped. The six Windows
integration failures remain; a fully green local integration suite is not
claimed. Postgres was stopped after validation, with zero active clients.

Live-send, deploy, and provider flags were cleared. The local database uses
port 54339. The full simulation is not repeated: AGENTS.md allows one per
agent, already used for PR #355. No earlier full-run result is claimed for
this commit.

## llm_evidence

N/A: this is deterministic mission scoring over existing timestamps. Policy
personas and the native simulator produce the evidence. No model-backed
behavior changes or qualification are claimed. Real-model calls: 0; cost: $0.

## agent_clients

Codex desktop 26.1103.4239.0 drove Bun and the local HTTP API. Provider:
OpenAI. The exact assistant model identifier is unavailable in the session.
No browser or computer use was performed. There is no change to site skills,
MCP, production agent integrations, or their client flows. No other agent
client is claimed as tested.

## Replay and limits

Save the three programs below outside the checkout under their filenames.
Use clean checkouts of the base above and this PR, with frozen dependencies.
Run the measurement from each checkout; its imports use the current working
directory. The existing synthetic dataset is required.

```sh
bun run --conditions eliza-source ../welcome-mission-measure.ts ../before.json
# Same command in the candidate checkout, writing ../after.json.
bun run ../welcome-mission-compare.ts ../before.json ../after.json
bun test --conditions eliza-source packages/observatory/test/welcome-mission.integration.test.ts
bun run typecheck
bun run sim --only audit,ops --json ../gates.json
# Save each revision's gate file, then compare:
bun run ../welcome-mission-gates-compare.ts ../gates-before.json ../gates-after.json
bun run test:integration
bun run test:e2e
```

The integration command includes security. Both official suites require local
Postgres. To reproduce the regression on base, copy only the test file there,
or run it before applying the production fix, as done here.

The six known Windows integration failures are reported separately. No real
members, live messages, production service, or deployment is involved.
The scenario set is a finite proof of the specified tenure behavior, not a
claim about all possible game histories.

Measurement output SHA-256:

- Before: `51f27f45e50d755966b178e0c91e983e24316cc50f912ab5fcbba5cf41486f15`.
- After: `913605a5bbc0deb4e324198a08a9211f3121f7ddd1eda597a7b69736f052e09a`.

## Measurement program

`welcome-mission-measure.ts`

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.cwd().replaceAll("\\", "/");
const { createServer } = await import(pathToFileURL(`${root}/packages/observatory/src/server.ts`).href);
const { FileAudit } = await import(pathToFileURL(`${root}/packages/observatory/src/staff.ts`).href);
const { DATA_DIR, readJsonl } = await import(pathToFileURL(`${root}/scripts/synthetic/common.ts`).href);
const historical = new Map((await readJsonl(`${DATA_DIR}/members.jsonl`)).map((m: any) => [m.id, m.joinedAt]));
const DAY = 86_400_000;
const hash = (x: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex");
const records = (source: any) => source.world.records.map((r: any) => {
  if (r.type === "run_start") { const { runId, ...rest } = r; return rest; }
  if (r.type === "run_end") { const { wallMs, ...rest } = r; return rest; }
  return r;
});
const variants = [
  ...[7, 28, 40].flatMap(day => ["day_zero", "later"].map(cohort => ({ dataset: "generated", day, cohort }))),
  ...[7, 40].flatMap(day => ["recent", "old"].map(cohort => ({ dataset: "synthetic", day, cohort }))),
];
const rows = [];
for (const seed of [1, 7, 11, 23]) for (const variant of variants) {
  const dir = await mkdtemp(join(tmpdir(), "welcome-mission-measure-"));
  const token = "local-welcome-mission-0000000000000000";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const server = await createServer({ port: 0, development: false, token,
    staffRolesUrl: false, peopleUrl: false, audit: new FileAudit(join(dir, "audit")), lab: { dir: join(dir, "lab") },
    game: { seed, personas: variant.dataset === "generated" ? 80 : 0, days: 60, network: "stub", engine: "off", pushMs: 3_600_000, tickMs: 3_600_000 },
    real: { url: undefined, service: false, pollMs: 3_600_000 },
  });
  const source = await server.source("game");
  const state = () => fetch(`${server.url}/api/state`, { headers }).then(r => r.json());
  const control = async (cmd: unknown) => {
    const r = await fetch(`${server.url}/api/control`, { method: "POST", headers, body: JSON.stringify(cmd) });
    const result = await r.json();
    if (r.status !== 200 || !result.ok) throw Error(`Control failed: ${JSON.stringify(result)}`);
    return result;
  };
  let step: Promise<unknown> | undefined;
  try {
    await control({ type: "step", ms: variant.day * DAY });
    const initial = await state();
    const joinedAt = (m: any): number => variant.dataset === "generated" ? m.joinedAt : historical.get(m.id) as number;
    const members = initial.members.filter((m: any) => {
      if (!m.joined || m.minor || m.declined || m.state === "opted_out") return false;
      const j = joinedAt(m);
      if (variant.cohort === "day_zero") return j < initial.clock.start + DAY;
      if (variant.cohort === "later") return j >= initial.clock.start + DAY;
      const age = (initial.clock.start - j) / DAY;
      return variant.cohort === "recent" ? age >= 0 && age <= 15 : age >= 60;
    }).slice(0, 2);
    if (members.length !== 2) throw Error(`Insufficient joined adults: ${JSON.stringify(variant)}`);
    const ids = members.map((m: any) => m.id), preRecordsHash = hash(records(source));
    for (const memberId of ids) await control({ type: "takeover", memberId, on: true });
    const pid = (await control({ type: "propose", participants: ids })).data.id;
    let done = false;
    step = control({ type: "step", ms: 5 * DAY }).finally(() => { done = true; });
    const deadline = performance.now() + 30_000;
    while (!done && performance.now() < deadline) {
      for (const prompt of (await state()).game?.prompts ?? [])
        await control({ type: "reply", promptId: prompt.id, ...(prompt.proposalId === pid ? { text: "yes" } : { auto: true }) });
      await Bun.sleep(1);
    }
    if (!done) throw Error("Step did not complete");
    await step;
    const s = await state(), o = s.opportunities.find((o: any) => o.id === pid);
    const native = source.world.records.filter((r: any) => r.type === "outcome" && r.proposalId === pid);
    if (native.length !== 1 || ids.some(id => !native[0].attendance[id]?.showed)) throw Error("Expected both participants at one native meeting");
    const ages = members.map((m: any) => ({ id: m.id, joinedAt: joinedAt(m), ageAtMeeting: (native[0].at - joinedAt(m)) / DAY,
      ageAtRead: (s.clock.now - joinedAt(m)) / DAY }));
    const expected = ages.some(m => m.ageAtMeeting >= 0 && m.ageAtMeeting <= 30);
    const missions = (s: any) => s.game.missions.map(({ id, done, progress }: any) => ({ id, done, progress }));
    const welcome = (s: any) => missions(s).find((m: any) => m.id === "welcome_wagon");
    for (const memberId of s.game.controlled) await control({ type: "takeover", memberId, on: false });
    await control({ type: "step", ms: (60 - variant.day - 5) * DAY });
    const final = await state();
    rows.push({ seed, ...variant, ids, preRecordsHash, ages, expected, atRead: welcome(s), atEnd: welcome(final),
      nativeOutcome: native[0], opportunity: o, scores: s.game.scores, missions: missions(s), finalMissions: missions(final),
      judge: final.stats.judge, recordsHash: hash(records(source)), messagesHash: hash(source.world.channel.all()),
      memoriesHash: hash([...source.world.memories]) });
    console.log(JSON.stringify({ seed, ...variant, expected, atRead: welcome(s), ages, judge: final.stats.judge }));
  } finally {
    for (const memberId of (await state()).game?.controlled ?? []) await control({ type: "takeover", memberId, on: false });
    await step;
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
}
await Bun.write(process.argv[2]!, JSON.stringify(rows, null, 2) + "\n");
```

## Paired comparison

`welcome-mission-compare.ts`

```ts
import { isDeepStrictEqual } from "node:util";
const before = await Bun.file(process.argv[2]!).json(), after = await Bun.file(process.argv[3]!).json();
const same = (a: unknown, b: unknown, why: string) => { if (!isDeepStrictEqual(a, b)) throw Error(why); };
if (before.length !== 40 || after.length !== 40) throw Error("Expected 40 native worlds per revision");
let falsePositives = 0, falseNegatives = 0, unchanged = 0, delayedReads = 0, unsafe = 0;
const nativeFields = ({ atRead, atEnd, missions, finalMissions, ...rest }: any) => rest;
const otherMissions = (ms: any[]) => ms.filter(m => m.id !== "welcome_wagon");
for (const row of after) {
  const key = `${row.seed}/${row.dataset}/${row.day}/${row.cohort}`;
  const old = before.find((r: any) => `${r.seed}/${r.dataset}/${r.day}/${r.cohort}` === key);
  if (!old) throw Error(`Missing baseline: ${key}`);
  same(nativeFields(row), nativeFields(old), `Native records, messages, memory, outcomes, or scores changed: ${key}`);
  same(otherMissions(row.missions), otherMissions(old.missions), `Other mission changed: ${key}`);
  same(otherMissions(row.finalMissions), otherMissions(old.finalMissions), `Other final mission changed: ${key}`);
  const expected = { id: "welcome_wagon", done: row.expected, progress: row.expected ? "1/1" : "0/1" };
  same(row.atRead, expected, `Mission disagrees with native meeting tenure: ${key}`);
  same(row.atEnd, expected, `Mission did not retain the correct outcome at day 60: ${key}`);
  same(old.atEnd, old.atRead, `Baseline mission changed after the measured meeting: ${key}`);
  same([row.judge.invariants, row.judge.canaryLeaks, row.judge.minorContacts], [0, 0, 0], `Nonzero safety result: ${key}`);
  if (old.atRead.done && !row.expected) falsePositives++;
  else if (!old.atRead.done && row.expected) falseNegatives++;
  else { unchanged++; same(row, old, `Correct control row changed: ${key}`); }
  if (row.expected && row.ages.every((m: any) => m.ageAtRead > 30)) delayedReads++;
  unsafe += Number(!!row.opportunity.oracle?.unsafe);
}
if (delayedReads === 0) throw Error("Missing delayed-read control past the newcomer window");
console.log(JSON.stringify({ worldsPerRevision: after.length, falsePositivesBefore: falsePositives, falseNegativesBefore: falseNegatives,
  correctBefore: unchanged, correctAfter: after.length, unchangedControlWorlds: unchanged, delayedReadControls: delayedReads,
  unchangedNativeRecordSets: after.length, unchangedMessageSets: after.length, unchangedMemorySets: after.length,
  worldsWithUnchangedUnsafeProposal: unsafe, invariants: 0, canaryLeaks: 0, minorContacts: 0 }, null, 2));
```

## Gate comparison

`welcome-mission-gates-compare.ts`

```ts
import { isDeepStrictEqual } from "node:util";
const before = await Bun.file(process.argv[2]!).json(), after = await Bun.file(process.argv[3]!).json();
const gates = (r: any) => r.gates.map(({ ms, ...rest }: any) => ({ ...rest,
  name: rest.name.startsWith("backup drill:") ? rest.name.replace(/restore \d+ ms$/, "restore <elapsed> ms") : rest.name,
}));
if (!isDeepStrictEqual(gates(before), gates(after))) throw Error("Audit/operations gate values changed");
if (after.gates.length !== 31 || after.gates.filter((g: any) => g.blocking).length !== 30 || after.gates.some((g: any) => !g.pass))
  throw Error("Expected all 30 blocking gates and one tracked gate to pass");
console.log(JSON.stringify({ identicalGateRecords: 31, blockingGatesPassed: 30, trackedOffTarget: 0 }, null, 2));
```
