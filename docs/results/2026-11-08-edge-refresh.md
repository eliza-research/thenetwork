# Refresh edited database graph edges

Date: 2026-11-08. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2, Windows x64, PostgreSQL 16.15 on local port 54339.

## Requirement and defect

PRD 35.2 requires current graph edges in Member 360 and the social graph explorer.
PRD 35.3 requires a read model for the console.
`docs/observatory.md` sections 2 and 3 define changed-edge updates and the edge strength, creation time and origin fields.
This fixes a reproduced database projection defect within that existing contract.

An open `RealSource` retained old values after an existing `network.edges` row changed.
A fresh reader showed the stored values immediately.
For example, a stored strength changed from 0.9 to 0.2, with a new timestamp and learned origin.
The open reader kept 0.9, the old timestamp and graph origin. Its next update contained no edge.

The reader passed each database row to `Store.addEdge`, which deliberately adds or strengthens accumulated game events.
That method cannot weaken an edge or replace its metadata.
Even when strength increased, the emitted edge retained old metadata.

## Fix and alternatives

Build the current edge projection from each database snapshot, then replace changed values in the store.
The existing `upsertIfChanged` helper suppresses unchanged updates.
Symmetric rows still share an ID and use their greatest strength within the current snapshot.
Their metadata still comes from the first row. Directed edge types remain separate.
`Store.addEdge` retains its event accumulation behavior for game mode.

Other implementations considered:

1. Change `addEdge` to replace every value. That would also change game event accumulation and symmetric-row aggregation.
2. Clear and replay every edge on every refresh. That would emit unchanged edges repeatedly and rebuild unaffected state.

An initial candidate chose metadata from the strongest symmetric row.
It was revised to preserve the existing fresh-reader behavior before the final measurements and suite runs below.
The first fixture attempt also reused globally unique member IDs across apps and failed during setup.
The final fixture uses app-prefixed IDs. Neither earlier attempt supplies the results below.

## measurement

The same final integration case runs against the base and fixed source:

```sh
bun test --conditions eliza-source packages/observatory/test/edge-refresh.integration.test.ts
```

| Result | Base | Fixed |
| --- | ---: | ---: |
| Regression | 0 pass, 1 fail | 1 pass, 0 fail |
| Assertions reached | 7 | 14 |
| Elapsed time | 4.71 seconds | 4.95 seconds |

The case creates real PostgreSQL records for `ntwrk` and `friends`.
Each app has five stored rows and four projected edges.
It keeps a reader open while changing strength, origin and creation time through SQL.
It checks the open state, member detail and state reconstructed from actual subscription updates against a fresh reader.
Explicit expected strengths also verify the fresh reader, including a reverse symmetric row and two directed rows.
Six phases cover initial state, weakening, strengthening, metadata-only edits, zero strength and an unchanged refresh.
The base fails at the first app's aggregate comparison. The fixed case completes both apps.
The committed test is one integration case, with no mocked reader or database.

### Paired measurement fixture

The complete measurement program and comparator are included below for reproduction.
The agent authored this synthetic fixture; it is not an independent or production dataset.
Both arms use the same program and configuration order.

- Four configurations: `ntwrk` and `friends`, each with normal and reversed insertion order.
- Each configuration stores both apps: 24 members and 192 edge rows.
- Each selected app projects 60 edges from 96 rows: six member pairs and eight types in both directions.
- Six types are symmetric: `knows`, `met`, `introduced`, `enjoyed`, `would_interact_again` and `group_only`.
- Two types remain directed: `invited_by` and `vouched_for`.
- Four pairs change, giving 40 edited projected edges. Two pairs remain controls, giving 20 projected edges.
- Six phases match the regression above. There are 24 snapshots and 1,440 edge observations per arm.
- Fixed timestamp: `2026-10-05T07:00:00Z`. The clock stays ten days later. No random seed applies.
- Edits use SQL against isolated synthetic records. The public `refresh` control drives the real reader and subscriptions.

| Result across all configurations | Base | Fixed |
| --- | ---: | ---: |
| Incorrect complete edge observations | 800 | 0 |
| Incorrect subscription-client observations | 800 | 0 |
| Incorrect strength observations | 480 | 0 |
| Incorrect metadata observations | 800 | 0 |
| Missing or incorrect changed-edge updates | 640 | 0 |
| Extra edge updates | 0 | 0 |
| Expected changed-edge updates | 640 | 640 |
| Emitted edge updates | 160 | 640 |
| Unchanged control observations | 480 | 480 |

These are repeated observations, not 800 distinct edges.
There are 160 edited projected edges across four configurations.
The base emitted 160 updates with incorrect metadata and omitted 480 expected updates.
The final unchanged refresh correctly emits no updates in both arms, although the base still retains stale state.

Each configuration has the following complete-edge mismatch counts:

| Phase | Base | Fixed | Expected updates |
| --- | ---: | ---: | ---: |
| Initial | 0 | 0 | 0 |
| Weakened | 40 | 0 | 40 |
| Strengthened | 40 | 0 | 40 |
| Metadata only | 40 | 0 | 40 |
| Zero strength | 40 | 0 | 40 |
| Unchanged refresh | 40 | 0 | 0 |

All fresh-reader graphs, database rows, other statistics and untouched controls match between arms.
The comparator checks exact values and hashes, including graph orientation under each insertion order.
Measurement duration was 18.76 seconds before and 19.74 seconds after. This is not a performance claim.

### Reproduce the measurement

Use separate clean worktrees at the base and this PR. Install with `bun install --frozen-lockfile`.
Use only a disposable local PostgreSQL instance. Set `REQUIRE_PG=1`, `OBSERVATORY_PG_PORT=54339` and the local `PG_BIN_DIR`.
Keep all live-send, deployment and model credentials unset.
Save the programs below beside both worktrees, with the shown filenames.
Run each command from the named worktree:

```powershell
# Base worktree
$env:EDGE_REFRESH_OUTPUT = '../edge-refresh-before.jsonl'
bun test --conditions eliza-source ../edge-refresh-measure.test.ts
# Fixed worktree
$env:EDGE_REFRESH_OUTPUT = '../edge-refresh-after.jsonl'
bun test --conditions eliza-source ../edge-refresh-measure.test.ts
bun ../edge-refresh-compare.ts
```

Expect four complete configuration records per arm and an empty `changes` array.
All fixed mismatch counts must be zero, and emitted updates must equal expected updates.
Copy the committed regression into the base worktree to reproduce its failure, then remove that copy.
The base worktree used here was restored to a clean state.

## safety_gates

Paired command: `bun run sim --only audit,ops --json <output>`.
Both arms pass **30/30 blocking gates**, with zero tracked misses.
All 31 gate records match after excluding elapsed time and the backup restore duration embedded in one label.
Durations: 36.7 seconds before and 36.4 seconds after.
These blocks use their repository fixtures and default settings; no seed override was used.
No threshold or classification changed.

The database reader remains read-only. Only the synthetic fixture writes records.
The patch changes edge projection, not matching, review decisions, access controls, database schemas or message delivery.
No real messages were sent and no deployment occurred.
The full default simulation was not repeated: AGENTS.md limits each agent to one full run, already used earlier in this session.
No full-world matching quality or invariant result is claimed for this patch.

## Validation

Typecheck passed all four configurations with the final source and regression.

| Command | Final result |
| --- | --- |
| `bun run typecheck` | All four configurations pass |
| `bun run test:integration` | 676 pass, 8 skip, 6 fail; 13,755 assertions; 578.62 seconds |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 72.93 seconds |

The official integration command includes the security suite.
The new regression also passes inside that command, in 4.70 seconds.
All six failures match the previously reproduced base failures by name and cause:

- The Wrangler OS-session check cannot launch `/bin/bash` on Windows (`ENOENT`).
- The boot test receives SIGTERM exit code 143 instead of 0.
- Four site-build checks fail at `.well-known/agent-skills/index.json` because of Windows path handling.

Integration is not green. These existing failures were not changed or hidden.
Eight integration skips require optional isolated cleanup-reconciliation setup.
The E2E skip requires the optional browser SDK setup through `PLAYWRIGHT_MODULE`; it was not run.
The owned local PostgreSQL instance was stopped after validation, with no other clients connected.

## llm_evidence

N/A: database row projection and change detection do not use an LLM.
Real-model calls: 0. Cost: 0. Provider, model and request settings for runtime evidence: N/A.
No model-backed behavior is claimed.

## agent_clients

Codex desktop 26.1103.3517.0 drove Bun 1.4.2 and PostgreSQL 16.15 on Windows x64.
Authoring provider: OpenAI. Exact authoring model identifier: unavailable.
No member agent flow changed.
Claude Code, Claude, ChatGPT member flows, Hermes Agent, OpenClaw, Muse, Grok bot, elizaOS and Cursor were not tested.
No browser or computer automation was used.

## Limits

This proves refresh behavior for controlled edits to existing stored rows.
It does not qualify the service's graph-learning writers, negative-feedback lifecycle, edge deletion or concurrent snapshot consistency.
The fixture uses two apps; it does not establish a new security isolation guarantee.
The subscription callback is real; WebSocket delivery and browser rendering were not separately exercised by this fixture.
No UI, style, copy, dependency or wire-shape change is included.
The measurements demonstrate correction of stale state, not better production matching or a frequency estimate.
Maintainers decide whether these applicability limits meet the project's evidence requirements.

## Measurement program: `edge-refresh-measure.test.ts`

```typescript
import { test, setSystemTime } from "bun:test";
import { SQL } from "bun";
import { pathToFileURL } from "node:url";
import { writeFileSync, appendFileSync } from "node:fs";
const root = process.cwd().replaceAll("\\", "/");
const mod = (p: string) => import(pathToFileURL(`${root}/${p}`).href);
const { RealSource } = await mod("packages/observatory/src/sources/real.ts");
const { testDb, dropTestDb } = await mod("packages/observatory/test/pg.ts");
const START = Date.parse("2026-10-05T07:00:00Z"), DAY = 86_400_000, HOUR = 3_600_000;
const output = process.env.EDGE_REFRESH_OUTPUT!;
const types = ["knows", "met", "introduced", "enjoyed", "would_interact_again", "group_only", "invited_by", "vouched_for"];
const sort = (es: any[]) => [...es].sort((a, b) => a.id.localeCompare(b.id));
const hash = (x: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex");
const configs = ["ntwrk", "friends"].flatMap(app => [false, true].map(reverse => ({ app, reverse })));
test("paired database graph refresh measurements", async () => {
  writeFileSync(output, "");
  try {
    for (const config of configs) {
      const url = await testDb(), sql = new SQL(url);
      const warm = new RealSource({ url, app: config.app, service: false, pollMs: HOUR, pushMs: HOUR });
      try {
        const members: any[] = [], edges: any[] = [];
        for (const app of ["ntwrk", "friends"]) for (let i = 0; i < 6; i++) {
          const a = `${app}:${i}:a`, b = `${app}:${i}:b`;
          for (const [id, name] of [[a, `Alex ${i}`], [b, `Blair ${i}`]]) members.push({ app_id: app, id, name, home_city: "nyc", account_status: "active", age: 30, joined_at: new Date(START) });
          for (const type of types) {
            edges.push({ app_id: app, from_id: a, to_id: b, type, strength: 0.9, explicit: true, created_at: new Date(START) });
            edges.push({ app_id: app, from_id: b, to_id: a, type, strength: 0.4, explicit: true, created_at: new Date(START) });
          }
        }
        await sql`insert into network.members ${sql(members)}`;
        await sql`insert into network.edges ${sql(config.reverse ? edges.reverse() : edges)}`;
        setSystemTime(new Date(START + 10 * DAY));
        await warm.init(); await warm.control({ type: "refresh" });
        if (warm.state().env.error) throw Error(warm.state().env.error);
        const client = new Map(sort(warm.state().edges).map((e: any) => [e.id, structuredClone(e)]));
        let updates: any[] = [];
        warm.subscribe((d: any) => { for (const e of d.edges ?? []) { updates.push(structuredClone(e)); client.set(e.id, structuredClone(e)); } });
        let previous = structuredClone(sort(warm.state().edges));
        const snapshots: any[] = [];
        const snapshot = async (phase: string) => {
          updates = [];
          const result = await warm.control({ type: "refresh" });
          if (!result.ok || warm.state().env.error) throw Error(result.error ?? warm.state().env.error);
          const cold = new RealSource({ url, app: config.app, service: false, pollMs: HOUR, pushMs: HOUR });
          try {
            await cold.init();
            if (cold.state().env.error) throw Error(cold.state().env.error);
            const expected = sort(cold.state().edges), actual = sort(warm.state().edges), streamed = sort([...client.values()]);
            const changed = expected.filter(e => JSON.stringify(previous.find((p: any) => p.id === e.id)) !== JSON.stringify(e));
            const ids = expected.map(e => e.id);
            const mismatches = (value: any[]) => expected.filter(e => JSON.stringify(value.find(a => a.id === e.id)) !== JSON.stringify(e)).map(e => e.id);
            const wrongStrengths = expected.filter(e => actual.find(a => a.id === e.id)?.strength !== e.strength).map(e => e.id);
            const wrongMetadata = expected.filter(e => { const a = actual.find(a => a.id === e.id); return !a || a.origin !== e.origin || a.createdAt !== e.createdAt || a.from !== e.from || a.to !== e.to; }).map(e => e.id);
            const rows = await sql`select app_id, from_id, to_id, type, strength::text::float8 as strength, explicit, created_at from network.edges order by app_id, from_id, to_id, type`;
            snapshots.push({ phase, edges: ids.length, expected, actual, streamed, changes: changed.map(e => e.id), updates: sort(updates),
              wrongState: mismatches(actual), wrongClient: mismatches(streamed), wrongStrengths, wrongMetadata,
              missingDelta: changed.filter(e => !updates.some(u => u.id === e.id && JSON.stringify(u) === JSON.stringify(e))).map(e => e.id),
              extraDelta: updates.filter(e => !changed.some(c => c.id === e.id)).map(e => e.id),
              coldHash: hash(expected), databaseHash: hash(rows), otherStatsHash: hash(warm.state().stats), coldStatsHash: hash(cold.state().stats),
            });
            previous = structuredClone(expected);
          } finally { await cold.dispose(); }
        };
        const targets = Array.from({ length: 4 }, (_, i) => [`${config.app}:${i}:a`, `${config.app}:${i}:b`]).flat();
        await snapshot("initial");
        await sql`update network.edges set strength = case when right(from_id, 1) = 'a' then 0.2 else 0.3 end,
          explicit = false, created_at = ${new Date(START + DAY)} where app_id = ${config.app} and from_id in ${sql(targets)}`;
        await snapshot("weakened");
        await sql`update network.edges set strength = case when right(from_id, 1) = 'a' then 1.0 else 0.5 end
          where app_id = ${config.app} and from_id in ${sql(targets)}`;
        await snapshot("strengthened");
        await sql`update network.edges set explicit = true, created_at = ${new Date(START + 2 * DAY)} where app_id = ${config.app} and from_id in ${sql(targets)}`;
        await snapshot("metadata only");
        await sql`update network.edges set strength = 0 where app_id = ${config.app} and from_id in ${sql(targets)}`;
        await snapshot("zero strength");
        await snapshot("unchanged");
        appendFileSync(output, JSON.stringify({ ...config, storedRows: edges.length, projectedEdges: previous.length, snapshots }) + "\n");
        console.log(JSON.stringify({ ...config, snapshots: snapshots.length, edgeObservations: snapshots.reduce((n, s) => n + s.edges, 0), wrongState: snapshots.reduce((n, s) => n + s.wrongState.length, 0), wrongClient: snapshots.reduce((n, s) => n + s.wrongClient.length, 0), missingDelta: snapshots.reduce((n, s) => n + s.missingDelta.length, 0) }));
      } finally { setSystemTime(); await warm.dispose(); await sql.close(); await dropTestDb(); }
    }
  } finally { setSystemTime(); }
}, 300_000);
```

## Comparator: `edge-refresh-compare.ts`

```typescript
import { readFileSync, writeFileSync } from "node:fs";
const read = (arm: string) => readFileSync(`../edge-refresh-${arm}.jsonl`, "utf8").trim().split("\n").map(s => JSON.parse(s));
const before = read("before"), after = read("after");
const changes: unknown[] = [];
const summary = (cases: any[]) => {
  const snapshots = cases.flatMap(c => c.snapshots);
  const sum = (key: string) => snapshots.reduce((n, s) => n + s[key].length, 0);
  return { cases: cases.length, snapshots: snapshots.length, edgeObservations: snapshots.reduce((n, s) => n + s.edges, 0),
    wrongState: sum("wrongState"), wrongClient: sum("wrongClient"), wrongStrengths: sum("wrongStrengths"), wrongMetadata: sum("wrongMetadata"),
    missingDelta: sum("missingDelta"), extraDelta: sum("extraDelta"),
    expectedUpdates: sum("changes"), actualUpdates: sum("updates"),
    unchangedControls: snapshots.reduce((n, s) => n + s.actual.filter((e: any) => /:[45]:[ab]/.test(e.from)).length, 0),
  };
};
if (before.length !== 4 || after.length !== 4) throw Error("Incomplete graph refresh cases");
for (let i = 0; i < before.length; i++) {
  const a = before[i], b = after[i];
  for (const key of ["app", "reverse", "storedRows", "projectedEdges"]) if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) changes.push({ i, key });
  if (a.snapshots.length !== 6 || b.snapshots.length !== 6) throw Error("Incomplete snapshots");
  for (let j = 0; j < a.snapshots.length; j++) {
    const p = a.snapshots[j], q = b.snapshots[j];
    for (const key of ["phase", "edges", "expected", "changes", "coldHash", "databaseHash", "otherStatsHash", "coldStatsHash"]) {
      if (JSON.stringify(p[key]) !== JSON.stringify(q[key])) changes.push({ i, phase: q.phase, key, before: p[key], after: q[key] });
    }
    const controls = (s: any) => s.actual.filter((e: any) => /:[45]:[ab]/.test(e.from));
    if (JSON.stringify(controls(p)) !== JSON.stringify(controls(q))) changes.push({ i, phase: q.phase, key: "untouched controls" });
  }
}
const result = { before: summary(before), after: summary(after), changes,
  byPhase: after[0].snapshots.map((s: any, i: number) => ({ phase: s.phase,
    before: { wrongState: before[0].snapshots[i].wrongState.length, wrongClient: before[0].snapshots[i].wrongClient.length, missingDelta: before[0].snapshots[i].missingDelta.length },
    after: { wrongState: s.wrongState.length, wrongClient: s.wrongClient.length, missingDelta: s.missingDelta.length },
    expectedUpdates: s.changes.length,
  })),
};
writeFileSync("../edge-refresh-comparison.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (changes.length || result.after.wrongState || result.after.wrongClient || result.after.missingDelta || result.after.extraDelta || result.after.actualUpdates !== result.after.expectedUpdates) throw Error("Graph refresh comparison failed");
```
