# Return the newest matches from Observatory game search

Date: 2026-11-09. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2, Windows, PostgreSQL 16.15.

## Requirement and cause

This is a reproduced bug under the approved Slop scope and CONTRIBUTING 3.1.
PRD 35.2 covers the conversation explorer. PRD 35.3 requires a shared view
model for simulated and real worlds. `docs/observatory.md` documents the
existing conversation search endpoint.

Game search walks messages and events from oldest to newest. It stops once
the result limit is reached, then sorts that old subset by descending time.
Recent matches disappear. Message matches can also exhaust the limit before
the event loop runs. The existing descending sort cannot correct that selection.

Collect matching messages and events, sort the combined results, then apply
the limit. This follows the existing real-source ordering and preserves
stable tie ordering. Nonpositive limits still return no hits. Matching,
message eligibility and event formatting use their existing code.

Alternatives considered:

1. Walk both streams backwards and merge their newest candidates. This adds
   ordering assumptions and separate handling for equal timestamps.
2. Maintain a bounded heap of the newest matches. This reduces temporary
   storage but adds a ranking data structure for a local simulation query.

The chosen change is small and uses the existing sort. It scans complete
histories and temporarily stores all matches. The largest measured result
contains 505 hits. Large-world latency and memory are not benchmarked.

PR #415 addresses event formatting in search. It does not fix result selection,
and this change does not depend on it.

## measurement

The initial native-world reproduction used seeds 1 and 7, 80 personas and
14 days. Query `you` found 505 and 468 matches. Each capped response omitted
all 100 newest matches. Query `request_result` omitted nine and nineteen
newest matches. Smaller mixed message/event searches provided correct controls.

The committed integration case starts the real HTTP server with FileAudit,
advances a generated seed-1 world, then searches through `/api/search`.
It compares five responses with the full ordered result, and checks the
newest message timestamp directly against the world's channel history.
There are no mocked methods, records or clocks.

```sh
bun test --conditions eliza-source packages/observatory/test/search-recency.integration.test.ts
```

On base, the case fails: 0 pass, 1 fail, 3 assertions, 1931.45 ms.
With the fix: 1 pass, 0 fail, 9 assertions, 1928.48 ms.

The program below measures eight native worlds per revision: seeds 1, 7,
11 and 23; 40 and 80 personas; 14 days; the consent engine on `ntwrk`.
Each world searches `you`, `request_result`, `joined`, `meeting` and an absent
phrase, with limits 0, 1, 25 and 100. Limit 100 uses the HTTP endpoint;
the other limits use the public source API. Personas use PolicyPersonaAgent
and the simulated reviewer (`review: "auto"`).

| Result | Before | After |
|---|---:|---:|
| Capped searches equal the newest matching prefix | 94/160 | 160/160 |
| HTTP responses equal the newest 100 matching hits | 30/40 | 40/40 |
| Recent hits missing from those HTTP responses, summed | 828 | 0 |
| Previously correct capped controls preserved | 94 | 94 |
| Full ordered search results preserved | 40 | 40 |

All eight worlds retain identical message hashes, normalized record hashes
and judge results. Only generated `run_start.runId` and elapsed `run_end.wallMs`
are removed from record comparison. Every full search has the same count,
kinds and SHA-256 hash before and after. These are exact search checks,
not a measurement of matching quality.

## safety_gates

Fresh audit and operations blocks pass 30/30 blocking gates on both revisions,
with zero tracked misses. All 31 gate records match after removing durations,
including the restore duration embedded in the backup-drill label.
Runtime: 31.2 seconds before, 25.6 seconds after. These timings are incidental.

The native worlds retain four baseline `minor_contact` findings: seed 1 with
40 personas, seed 7 with 40, and seed 23 with 40 and 80. Each has one invariant
and one minor contact. The other four worlds have zero findings. All eight
have zero canary leaks. These existing findings remain unchanged; the report
does not count them as passing safety results.

## Validation and limits

| Command | Result |
|---|---|
| `bun install --frozen-lockfile` | Passed; no dependency changes |
| `bun run typecheck` | All four configurations passed |
| Regression command above | Base fails; candidate passes, 9 assertions |
| `bun run sim --only audit,ops` | 30/30 blocking gates on both revisions |
| `bun run test:integration` | 676 pass, 8 skip, 6 fail; 13,750 assertions; 422.35 seconds |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 35.18 seconds |

The integration command includes every file selected by `bun run security`.
Its six failures match the previously reproduced Windows baseline by name
and cause: Wrangler cannot spawn `/bin/bash`; the backend SIGTERM test returns
143 instead of 0; four site builds fail slash-sensitive asset assertions.
No new failure appears. The new regression passes in the full run, 2117.04 ms.
Eight optional reconciliation cases are skipped. The end-to-end skip requires
the optional SDK/Playwright setup. Local PostgreSQL was required and available.

The full simulation suite was already run during this agent's earlier work.
AGENTS.md permits at most one full run per agent. These fresh results cover
the affected audit and operations blocks, not a second full-suite claim.

## llm_evidence

N/A: search selects already-generated records. The change does not alter
model-backed behavior. The worlds use PolicyPersonaAgent; no LLM calls occur.
Provider/model for test calls: N/A. Calls: 0. Cost: 0.

## agent_clients

Codex desktop 26.1103.4239.0 ran the commands on Windows with Bun 1.4.2.
Authoring provider: OpenAI. Exact authoring model: unavailable to this session.
No agent signup, MCP or messaging flow changes. Other clients were not tested.
All requests use synthetic local data and an isolated local server.

## Reproduce the measurement

Save the first program outside the repository as `../search-recency-measure.ts`.
Run it from clean base and candidate checkouts, using separate output paths.
Use local test configuration without provider credentials or live-send flags.

```sh
bun install --frozen-lockfile
bun run --conditions eliza-source ../search-recency-measure.ts ../search-recency-before.json
bun run sim --only audit,ops --json ../search-recency-gates-before.json
# In the candidate checkout:
bun run --conditions eliza-source ../search-recency-measure.ts ../search-recency-after.json
bun run sim --only audit,ops --json ../search-recency-gates-after.json
```

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.cwd().replaceAll("\\", "/");
const { createServer } = await import(pathToFileURL(`${root}/packages/observatory/src/server.ts`).href);
const { FileAudit } = await import(pathToFileURL(`${root}/packages/observatory/src/staff.ts`).href);
const token = "local-search-recency-measure-00000000";
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const hash = (value: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex");
const rows = [];
for (const seed of [1, 7, 11, 23]) for (const personas of [40, 80]) {
  const dir = await mkdtemp(join(tmpdir(), "search-recency-measure-"));
  const server = await createServer({ port: 0, development: false, token,
    staffRolesUrl: false, peopleUrl: false, audit: new FileAudit(join(dir, "audit")), lab: { dir: join(dir, "lab") },
    game: { seed, personas, days: 14, network: "consent", pushMs: 3_600_000, tickMs: 3_600_000 },
    real: { url: undefined, service: false, pollMs: 3_600_000 },
  });
  try {
    const response = await fetch(`${server.url}/api/control`, { method: "POST", headers,
      body: JSON.stringify({ type: "step", ms: 14 * 86_400_000 }),
    });
    if (response.status !== 200 || !(await response.json()).ok) throw Error("World did not advance");
    const source = await server.source("game");
    const queries = [];
    for (const query of ["you", "request_result", "joined", "meeting", "no-such-search-phrase"]) {
      const all = await source.search(query, Number.MAX_SAFE_INTEGER);
      const checks = [];
      for (const limit of [0, 1, 25, 100]) {
        const result = limit === 100
          ? await fetch(`${server.url}/api/search?q=${encodeURIComponent(query)}`, { headers }).then(async r => {
            if (r.status !== 200) throw Error(`Search HTTP ${r.status}`);
            return await r.json();
          }) : await source.search(query, limit);
        const expected = all.slice(0, limit);
        const identities = new Set(result.map((r: unknown) => JSON.stringify(r)));
        checks.push({ limit, count: result.length, expectedHash: hash(expected), actualHash: hash(result),
          exact: JSON.stringify(result) === JSON.stringify(expected),
          missedRecent: expected.filter((r: unknown) => !identities.has(JSON.stringify(r))).length,
          newest: result[0]?.t ?? null, expectedNewest: expected[0]?.t ?? null });
      }
      queries.push({ query, total: all.length, allHash: hash(all), kinds: [...new Set(all.map((h: any) => h.kind))], checks });
    }
    const records = source.world.records.map((r: any) => {
      if (r.type === "run_start") { const { runId, ...rest } = r; return rest; }
      if (r.type === "run_end") { const { wallMs, ...rest } = r; return rest; }
      return r;
    });
    rows.push({ seed, personas, queries, recordsHash: hash(records),
      messagesHash: hash(source.world.channel.all()), judge: source.state().stats.judge });
    console.log(JSON.stringify({ seed, personas, queries: queries.map(q => ({ query: q.query,
      total: q.total, exact: q.checks.filter(c => c.exact).length, checks: q.checks.length })) }));
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
}
await Bun.write(process.argv[2]!, JSON.stringify(rows, null, 2) + "\n");
```

Save the next program as `../search-recency-compare.ts`. Run:

```sh
bun run ../search-recency-compare.ts ../search-recency-before.json ../search-recency-after.json ../search-recency-gates-before.json ../search-recency-gates-after.json
```

It checks every recorded case, unchanged full results, unchanged world hashes
and judge values, and all audit/operations gate fields apart from durations.
Expect 160 correct candidate searches and zero missing recent HTTP hits.

```ts
import { isDeepStrictEqual } from "node:util";
const before = await Bun.file(process.argv[2]!).json();
const after = await Bun.file(process.argv[3]!).json();
if (before.length !== 8 || after.length !== 8) throw Error("Expected eight worlds per revision");
let cases = 0, correctBefore = 0, correctAfter = 0, controls = 0, httpCases = 0, httpCorrectBefore = 0;
let missingBefore = 0, missingAfter = 0, fullSearches = 0, maxMatches = 0;
for (const row of after) {
  const old = before.find((r: any) => r.seed === row.seed && r.personas === row.personas);
  if (!old || !isDeepStrictEqual([row.recordsHash, row.messagesHash, row.judge],
    [old.recordsHash, old.messagesHash, old.judge])) throw Error("World records, messages or judge changed");
  for (const query of row.queries) {
    const previous = old.queries.find((q: any) => q.query === query.query);
    if (!previous || !isDeepStrictEqual([query.total, query.allHash, query.kinds],
      [previous.total, previous.allHash, previous.kinds])) throw Error("Full search changed");
    fullSearches++;
    maxMatches = Math.max(maxMatches, query.total);
    for (const result of query.checks) {
      const prior = previous.checks.find((c: any) => c.limit === result.limit);
      if (!prior || prior.expectedHash !== result.expectedHash) throw Error("Expected results changed");
      if (!result.exact || result.actualHash !== result.expectedHash || result.missedRecent !== 0) throw Error("Search still omits recent matches");
      cases++; correctBefore += Number(prior.exact); correctAfter += Number(result.exact);
      if (prior.exact) { controls++; if (prior.actualHash !== result.actualHash) throw Error("Correct control changed"); }
      if (result.limit === 100) { httpCases++; httpCorrectBefore += Number(prior.exact);
        missingBefore += prior.missedRecent; missingAfter += result.missedRecent; }
    }
  }
}
const b = await Bun.file(process.argv[4]!).json(), a = await Bun.file(process.argv[5]!).json();
const gates = (r: any) => r.gates.map(({ ms, ...rest }: any) => ({ ...rest,
  name: rest.name.startsWith("backup drill:") ? rest.name.replace(/restore \d+ ms$/, "restore <elapsed> ms") : rest.name,
}));
if (!isDeepStrictEqual(gates(b), gates(a))) throw Error("Gate values changed");
console.log(JSON.stringify({ worlds: after.length, fullSearches, maxMatches, cases, correctBefore, correctAfter,
  unchangedControls: controls, httpCases, httpCorrectBefore, httpCorrectAfter: httpCases,
  missingRecentHttpBefore: missingBefore, missingRecentHttpAfter: missingAfter,
  unchangedSafety: after.map(({ seed, personas, judge }: any) => ({ seed, personas, judge })),
  gateRecords: a.gates.length, blockingGates: a.gates.filter((g: any) => g.blocking).length,
  failingGates: a.gates.filter((g: any) => !g.pass).length }, null, 2));
```
