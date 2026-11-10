# Observatory game report records (2026-11-10)

## Defect and scope

Game mode reconstructs its report queue from case events even though the simulated Network has a report store. A case event can say only `report_received`; it does not retain that report's kind, id or decision. The reconstruction can therefore turn a harassment report into `other`, assign a 24-hour deadline, invent a report id and infer an opportunity link. It also treats the case's status as every report's status, losing individual dismissals and bans.

This is a reproduced simulation and API data defect under CONTRIBUTING 3.1 and the approved Slop scope. PRD 36.3 specifies a one-hour target for urgent reports and 24 hours for others. `docs/admin-console.md` 3.7.1 defines report identity, kind, optional opportunity id, status and prior-report counts. The MVP plan includes monitoring and safety alerts. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

The change reads `ConsentNetwork.safetyReports()` in `GameSource.safety()`, projects the existing public report fields, and leaves queue ordering, urgency and deadlines to `reportQueue`. The stub Network has no report store and continues to return an empty queue. Documentation now describes this source correctly. The real-mode fallback still uses cases when its service is unavailable.

## A native report with the wrong deadline

With seed 7, 60 generated NYC personas, the consent Network, `engine-v1` and 14 simulated days, a policy persona files a harassment report without manual input. The stored report is `rp1`, from `m0001` about `m0019`, seven hours before the final read.

| Field | Stored report / expected API | API before | API after |
| --- | --- | --- | --- |
| id | `rp1` | `sc6:m0001:1792368000000` | `rp1` |
| kind | harassment | other | harassment |
| urgent | true | false | true |
| deadline after report | 1 hour | 24 hours | 1 hour |
| overdue at the read | true | false | true |
| opportunity id | absent | `nw-7-45` | absent |

The exact report time is `1792368000000`; the read is at `1792393200000`. The expected deadline is `1792371600000`, while the old API gives `1792454400000`. These are synthetic simulation timestamps, not real member data. Message reports need not identify one opportunity; the API now preserves the report store's optional link.

One integration case runs this generated world through the local HTTP server, checks the report, dismisses it through the Network's public method, and checks the next HTTP read. The case also verifies that reading the queue does not change Network state. The same final case fails before and passes after: **0 pass / 1 fail / 5 assertions → 1 pass / 0 fail / 16 assertions**. Before, the original report id is missing. Case runtime: 1404.86 ms before and 1352.39 ms after; suite runtime: 1472 ms and 1417 ms. The failure stops the before case early, so this is not a performance comparison.

## measurement

The same complete program runs **eight native worlds per revision**, seeds **5, 7, 13 and 16** with both consent and stub Networks. Each uses 60 generated NYC personas, `engine-v1`, a 20-day limit and automatic simulated review. There are **64 HTTP queue reads per revision**:

- Each consent world is read on days 7 and 14, after each of seven report kinds, after deadlines elapse, after clearing a minor signal, and after dismissal, hold and ban: 14 reads per world.
- Each stub world is read on days 7 and 14: two reads per world.

After the natural day-14 sample, each consent world uses the first native completed pair to send seven `report <name>: <kind>` messages through HTTP controls, one simulated hour apart. The kinds are harassment, lying, unsafe, scam, other, no-show and minor. Clearing the synthetic adult's minor signal uses the HTTP safety action. Dismissal, hold and the local ban notification use the Network's existing public methods; this does not add those actions to the game HTTP API or contact a platform service. All policy agents, report parsing, case creation and report decisions are repository code.

| Observed result | Before | After |
| --- | --- | --- |
| HTTP queues exactly matching stored reports | 15/64 | 64/64 |
| Wrong report kinds across repeated observations | 233 | 0 |
| Wrong urgency/deadline classifications | 161 | 0 |
| Wrong report decision statuses | 48 | 0 |
| Wrong overdue flags | 89 | 0 |

The 265 report snapshots are repeated observations of the native report store, not 265 distinct reports or people. They cover all seven kinds and open, dismissed, held and banned states. Earlier-report counts are already correct and remain unchanged.

| Report field mismatches (repeated snapshots) | Before | After |
| --- | --- | --- |
| `id` | 265 | 0 |
| `kind` | 233 | 0 |
| `opportunityId` | 265 | 0 |
| `status` | 48 | 0 |
| `urgent` | 161 | 0 |
| `dueAt` | 161 | 0 |
| `overdue` | 89 | 0 |
| `priorReports` | 0 | 0 |

Every actual queue row is checked against the Network's stored id, kind, parties, optional opportunity id, time and status. The expected urgency/deadline arithmetic is calculated independently from the documented urgent-kind list. Queue order and earlier-report counts are checked too. The comparator pairs rows by reporter, subject and timestamp to expose the old fabricated ids. All report records are produced by native message parsing and updated by public Network methods.

## safety_gates

The same `bun run sim --only audit,ops --json <output>` command passes **30/30 blocking gates before and after**. All **31 complete gate records** are identical after excluding execution and restore duration. The one tracked backup record passes: 69 tables, 71 rows and a 274 KiB dump on both sides; restore takes 2105 ms before and 2357 ms after. Overall runtime: 32.4s before and 26.7s after. Gate definitions, thresholds and simulation parameters are unchanged.

All **64 Network-state hashes and 64 complete native run-record hashes match across revisions**. Each read also leaves its own Network state and run records unchanged. Only the report queue changes: every other safety API section (cases, watches, holds, minors and action availability) is byte-identical across revisions. All 15 empty-queue observations remain identical, including all eight stub controls. This proves reporting fidelity; it does not claim that the simulation's outcomes improved or that every comparison world is safe.

Native run records omit only the random `run_start.runId` and `run_end.wallMs` fields from comparison. Report objects retain their complete native metadata in the measurement artifact; the public API projects only its existing report fields. No matching, consent, hold, ban, report-classification or authorization logic changes.

## Validation

- All four TypeScript configurations pass.
- Integration, including the security suite:

```text
 676 pass
 8 skip
 6 fail
 13757 expect() calls
Ran 690 tests across 69 files. [419.91s]
```

The six failure names and causes match the clean-base Windows reproduction: missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions. Integration is not green. The eight optional skips remain.

- E2E:

```text
 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [38.00s]
```

The one optional SDK/browser test remains skipped.

No new full `bun run sim`: AGENTS.md's one-full-run-per-agent allowance was already used earlier in this session. This revision has fresh affected-block validation. The HTTP matrix exercises the changed source; the audit/ops blocks check the surrounding simulation and operational gates.

## Reproduction

Use Bun 1.4.2 and PostgreSQL 16.15. Disable provider keys, live-send and deploy flags. Use local PostgreSQL on port 54339 for the full integration and E2E suites. The focused case and HTTP measurement need no database or external service. Prepare the base and this PR in separate checkouts; save the complete programs below outside both checkouts.

```sh
bun install --frozen-lockfile
bun test --conditions eliza-source --timeout 120000 packages/observatory/test/game-reports.integration.test.ts
bun game-reports-measure.ts /path/to/base game-reports-before.json
bun game-reports-measure.ts /path/to/fix game-reports-after.json
bun game-reports-compare.ts game-reports-before.json game-reports-after.json comparison.json
bun run sim --only audit,ops --json gates.json
bun run typecheck
bun run test:integration
bun run test:e2e
```

Copy the integration case into the base checkout to reproduce its failure. Run the gate command in both checkouts. Expected: 64/64 queue snapshots agree with stored reports after the fix, 15/64 before; all native state and run-record hashes match; the existing blocking gates pass. `test:integration` includes the full security suite. Its known Windows failures are disclosed above.

## Design and limits

Extending inference from case events cannot recover report ids or individual decisions that the events do not store. Reclassifying message text would duplicate the Network's parser and require reading words that the report API intentionally excludes. Reading the existing report store keeps the original facts and uses the same source as the service's report endpoint.

This changes the game-mode read path. Real-mode service reads and its cases-only fallback are unchanged; the fallback remains limited by its available data. The game now exposes the actual filed reports, including reports without an opportunity id. All measured reports come from messages and omit that id; a nonempty opportunity id is directly projected but is not exercised by this matrix. Stub mode remains empty. Report ids change from fabricated case-based ids to native ids. No game hold/ban/dismiss endpoint is added; existing action permissions remain in force. The public queue contains no report text or staff decision text.

No UI or member-facing text changes. No live sends, deployments, secrets, `.env`, `runs/` or real member data are included.

## llm_evidence

N/A: deterministic report projection; no prompt or model-backed behavior changes. Validation model calls: **0**, cost: **$0**. Policy persona agents generate the native simulation. No real-model qualification is claimed.

## agent_clients

Codex desktop **26.1103.7773.0**, primary runtime **26.1104.2876.0**, Windows, Bun **1.4.2**, PostgreSQL **16.15**. Authoring provider: OpenAI; exact model identifier unavailable. GitHub connector and Git/gh used directly. No computer/browser use or other client acceptance tests. No agent-client workflow changes.

## Complete measurement programs

### game-reports-measure.ts

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(process.argv[2]!), out = resolve(process.argv[3]!);
const { createServer } = await import(pathToFileURL(join(root, "packages/observatory/src/server.ts")).href);
const DAY = 86_400_000, HOUR = 3_600_000, urgentKinds = new Set(["harassment", "unsafe", "scam", "minor"]);
const hash = (v: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(v)).digest("hex");
const variants = [["harassment", "harassment"], ["lying", "lied"], ["unsafe", "unsafe"], ["scam", "scam"], ["other", "other concern"], ["no_show", "never showed"], ["minor", "a minor"]] as const;
const rows: any[] = [];
for (const seed of [5, 7, 13, 16]) for (const network of ["consent", "stub"]) {
  const dir = await mkdtemp(join(tmpdir(), "game-reports-measure-"));
  const token = "local-game-reports-measure-0000000000", headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const server = await createServer({ port: 0, development: false, token, staffRolesUrl: false, peopleUrl: false,
    audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
    game: { seed, days: 20, personas: 60, city: "nyc", network, engine: "engine-v1", pushMs: HOUR, tickMs: HOUR },
  });
  const source = await server.source("game") as any;
  const control = async (command: unknown) => {
    const r = await fetch(`${server.url}/api/control`, { method: "POST", headers, body: JSON.stringify(command) }), data = await r.json();
    if (r.status !== 200 || !data.ok) throw Error(`Control failed: ${JSON.stringify(data)}`);
  };
  const normalizedRecords = () => source.world.records.map((r: any) => {
    if (r.type === "run_start") { const { runId, ...rest } = r; return rest; }
    if (r.type === "run_end") { const { wallMs, ...rest } = r; return rest; }
    return r;
  });
  const frames: any[] = [];
  const capture = async (phase: string) => {
    const now = source.world.clock.now(), native = source.consent?.safetyReports() ?? [];
    const stateBefore = hash(source.consent?.exportState() ?? null), recordsBefore = hash(normalizedRecords());
    const response = await fetch(`${server.url}/api/safety`, { headers });
    if (response.status !== 200) throw Error(`Safety HTTP ${response.status}`);
    const { reports: actual, ...rest } = await response.json();
    if (hash(source.consent?.exportState() ?? null) !== stateBefore || hash(normalizedRecords()) !== recordsBefore) throw Error("Report read mutated native state");
    const expected = native.map(({ id, kind, reporterId, subjectId, opportunityId, at, status }: any) => ({
      id, kind, reporterId, subjectId, ...(opportunityId === undefined ? {} : { opportunityId }), at, status,
      urgent: urgentKinds.has(kind), dueAt: at + (urgentKinds.has(kind) ? HOUR : DAY), overdue: status === "open" && now > at + (urgentKinds.has(kind) ? HOUR : DAY),
      priorReports: native.filter((r: any) => r.subjectId === subjectId && r.id !== id && r.at < at).length,
    })).sort((a: any, b: any) => (a.status !== "open" ? 2 : a.urgent ? 0 : 1) - (b.status !== "open" ? 2 : b.urgent ? 0 : 1) || a.at - b.at);
    const sorted = (x: any) => JSON.stringify(x, Object.keys(expected[0] ?? {}).sort());
    const exact = actual.length === expected.length && actual.every((r: any, i: number) => sorted(r) === sorted(expected[i]));
    frames.push({ phase, now, native, actual, expected, exact, otherSafetyHash: hash(rest), networkHash: stateBefore, recordsHash: recordsBefore, recordCount: source.world.records.length, readonly: true });
  };
  try {
    await control({ type: "step", ms: 7 * DAY });
    await capture("day7");
    await control({ type: "step", ms: 7 * DAY });
    await capture("day14");
    if (network === "consent") {
      const st = source.state(), now = source.world.clock.now();
      const opp = st.opportunities.find((o: any) => ["COMPLETED", "FEEDBACK_COLLECTED"].includes(o.state) && o.meetingAt <= now && o.participants.length === 2);
      if (!opp) throw Error(`No native meeting, seed ${seed}`);
      const [reporterId, subjectId] = opp.participants, name = st.members.find((m: any) => m.id === subjectId).name;
      const filed = new Map<string, string>();
      for (const [kind, words] of variants) {
        await control({ type: "say", memberId: reporterId, text: `report ${name}: ${words}` });
        const report = source.consent.safetyReports().find((r: any) => r.at === source.world.clock.now() && r.reporterId === reporterId && r.subjectId === subjectId && r.kind === kind);
        if (!report) throw Error(`Native report not filed: seed ${seed}, ${kind}`);
        filed.set(kind, report.id);
        await capture(`file:${kind}`);
        await control({ type: "step", ms: HOUR });
      }
      await control({ type: "step", ms: HOUR });
      await capture("due");
      const clear = await fetch(`${server.url}/api/safety`, { method: "POST", headers, body: JSON.stringify({ action: "clear_minor", memberId: subjectId, note: "Synthetic adult record verified" }) });
      const clearResult = await clear.json();
      if (clear.status !== 200 || !clearResult.ok) throw Error(`Clear failed: ${JSON.stringify(clearResult)}`);
      await capture("clear_minor");
      if (!source.consent.dismissReport(filed.get("harassment"), "test-reviewer", "reviewed synthetic report").ok) throw Error("Dismiss failed");
      await capture("dismiss");
      if (!source.consent.holdMember(subjectId, "test-reviewer", "synthetic hold").ok) throw Error("Hold failed");
      await capture("hold");
      if (!source.consent.markBanned(subjectId, "test-reviewer", "synthetic platform ban").ok) throw Error("Ban failed");
      await capture("ban");
    }
    rows.push({ spec: { seed, network, personas: 60, days: 20, engine: "engine-v1" }, frames });
    console.log(JSON.stringify({ seed, network, frames: frames.length, exact: frames.filter(f => f.exact).length, reports: frames.map(f => f.actual.length), native: frames.map(f => f.native.length) }));
  } finally {
    await server.stop();
    const owned = resolve(dir);
    if (!owned.startsWith(resolve(tmpdir()) + sep) || !owned.split(sep).pop()!.startsWith("game-reports-measure-")) throw Error("Unexpected temporary path");
    await rm(owned, { recursive: true, force: true });
  }
}
await Bun.write(out, JSON.stringify(rows, null, 2));
```

### game-reports-compare.ts

```ts
const before = await Bun.file(process.argv[2]!).json(), after = await Bun.file(process.argv[3]!).json();
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
if (before.length !== 8 || after.length !== 8) throw Error("Unexpected world count");
const sums = { worlds: 8, frames: 0, exactBefore: 0, exactAfter: 0, reportSnapshots: 0, unchangedEmpty: 0, nativeStateSame: 0, nativeRecordsSame: 0, otherSafetySame: 0 };
const fields = ["id", "kind", "opportunityId", "status", "urgent", "dueAt", "overdue", "priorReports"];
const mismatch = Object.fromEntries(fields.map(k => [k, [0, 0]])) as Record<string, number[]>;
const observations: any[] = [];
const kinds: Record<string, number> = {}, statuses: Record<string, number> = {};
for (let w = 0; w < before.length; w++) {
  const a = before[w], b = after[w];
  if (!eq(a.spec, b.spec) || a.frames.length !== b.frames.length) throw Error(`World changed ${w}`);
  for (let f = 0; f < a.frames.length; f++) {
    const x = a.frames[f], y = b.frames[f];
    if (x.phase !== y.phase || x.now !== y.now || !eq(x.native, y.native) || !eq(x.expected, y.expected)) throw Error(`Input changed ${w}/${f}`);
    for (const key of ["networkHash", "recordsHash", "otherSafetyHash"]) if (x[key] !== y[key]) throw Error(`${key} changed ${w}/${f}`);
    if (!y.exact || !x.readonly || !y.readonly) throw Error(`Incorrect or mutating output ${w}/${f}`);
    sums.frames++; sums.nativeStateSame++; sums.nativeRecordsSame++; sums.otherSafetySame++;
    sums.exactBefore += +x.exact; sums.exactAfter += +y.exact; sums.reportSnapshots += y.expected.length;
    if (!y.expected.length) { if (!eq(x.actual, y.actual)) throw Error("Empty control changed"); sums.unchangedEmpty++; }
    for (const r of y.expected) {
      kinds[r.kind] = (kinds[r.kind] ?? 0) + 1; statuses[r.status] = (statuses[r.status] ?? 0) + 1;
      for (const [i, z] of [x, y].entries()) {
        const shown = z.actual.find((q: any) => q.at === r.at && q.reporterId === r.reporterId && q.subjectId === r.subjectId);
        for (const k of fields) if (shown?.[k] !== r[k]) mismatch[k]![i]!++;
      }
    }
    observations.push({ spec: a.spec, phase: x.phase, reports: y.expected.length, exact: [x.exact, y.exact] });
  }
}
if (sums.frames !== 64 || sums.exactAfter !== 64) throw Error("Unexpected frame count");
const example = before.find((r: any) => r.spec.seed === 7 && r.spec.network === "consent").frames.find((f: any) => f.phase === "day14");
const result = { ...sums, mismatch, kinds, statuses, example: { native: example.native, before: example.actual, after: example.expected }, observations };
await Bun.write(process.argv[4]!, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, observations: undefined }));
```
