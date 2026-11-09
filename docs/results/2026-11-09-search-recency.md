# Return the newest eligible matches from Observatory search

Date: 2026-11-10. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2, Windows, PostgreSQL 16.15.

## Requirement, cause, and fix

This fixes a reproduced bug under the approved Slop scope and CONTRIBUTING 3.1.
PRD 35.2 covers the conversation explorer; PRD 35.3 requires a shared view model
for simulated and real worlds. `docs/observatory.md` documents conversation search.

Both sources applied limits before selecting the newest eligible matches:

- Game search stopped its oldest-first message and event loops early, then sorted
  that old subset. Recent records disappeared, and message hits could crowd out events.
- Real search limited raw message matches before scrubbing them. One visible `Needle`
  message behind 100 newer email-only matches returned no hits after those emails
  were masked. Its event query also considered only the latest 5,000 rows, so one
  matching check-in behind 5,001 unrelated events returned no hits.

Collect eligible messages and events before applying the existing combined descending
sort and result limit. Remove the real source's event-loop cutoff too: once message
selection is complete, 200 older message matches must not hide newer matching events.
The HTTP response remains capped at 100. Existing app, member, direction, system,
feedback, scrubbing, literal-query escaping, and event-formatting checks remain in place.
Game search retains its stable tie ordering. Real search retains its existing ordering;
this change makes no new guarantee for messages with equal timestamps.

Alternatives considered:

1. Raise the candidate caps. This merely moves the point at which eligible results disappear.
2. Page through both ordered streams and merge their eligible results, or maintain a
   bounded heap. This could reduce temporary storage, but adds paging, tie-ordering,
   and concurrent-snapshot concerns to a small correctness fix. SQL-only matching also
   cannot directly substitute for the existing scrubbed-message and formatted-event checks.

The chosen implementation scans complete candidate histories and stores their matches
temporarily. The real source also loads all candidate database rows before filtering.
The largest measured search contains 505 game hits or 5,257 real-mode hits.
Production-scale latency and memory are not benchmarked. The existing 20-second SQL
statement timeout remains; sufficiently large histories can still time out.
PR #415 addresses event formatting separately; this change does not depend on it.

## measurement

Both paired programs ran afresh on original main and the final candidate using the
same commands, fixtures, and comparison methods. All data is synthetic and local.

### Game mode

Eight native worlds per revision use seeds 1, 7, 11, and 23; 40 and 80 personas;
14 days; the consent engine; PolicyPersonaAgent; and simulated review (`review: "auto"`).
Each searches `you`, `request_result`, `joined`, `meeting`, and an absent phrase at
limits 0, 1, 25, and 100. Limit 100 uses the actual HTTP endpoint; the others use
the public source API. The complete search with `Number.MAX_SAFE_INTEGER` supplies
the expected ordered prefix, and its full contents must remain identical across revisions.

| Result | Before | After |
|---|---:|---:|
| Correct capped searches | 94/160 | 160/160 |
| Correct HTTP responses | 30/40 | 40/40 |
| Recent hits missing from HTTP responses, summed | 828 | 0 |
| Previously correct capped controls preserved | 94 | 94 |
| Complete ordered searches preserved | 40 | 40 |

All eight worlds retain identical channel-message hashes, normalized record hashes,
and every judge field. Record comparison removes only generated `run_start.runId`
and elapsed `run_end.wallMs`. These are exact retrieval checks, not a matching-quality estimate.

### Real mode

Six real PostgreSQL fixtures each contain the following older visible `Needle` messages
and check-in events, newer email-only `Needle` matches, and newer unrelated probe events.
Each also contains 250 probe messages older than the probe events, literal-query
controls, and inbound, system, other-app, and private-feedback decoys.

| Visible messages / check-in events | Newer masked matches | Newer probe events | Correct checks before | After |
|---:|---:|---:|---:|---:|
| 1 | 0 | 0 | 40/40 | 40/40 |
| 1 | 99 | 4999 | 38/40 | 40/40 |
| 1 | 100 | 5000 | 33/40 | 40/40 |
| 1 | 101 | 5001 | 32/40 | 40/40 |
| 120 | 130 | 5007 | 32/40 | 40/40 |
| 0 | 101 | 5001 | 39/40 | 40/40 |

Eight queries (`needle`, `checkin_sent`, `probe`, `feedback_given`, an absent phrase,
`100%`, `field_name`, and `\path`) use limits 0, 1, 25, 100, and
`Number.MAX_SAFE_INTEGER`. Limit 100 uses HTTP; other limits call `RealSource.search`.
The expected result is constructed from the fixture contract, independently of search.
Every returned field, timestamp, snippet, member name, and result order is compared.

| Result | Before | After |
|---|---:|---:|
| Correct searches | 214/240 | 240/240 |
| Correct HTTP responses | 42/48 | 48/48 |
| Missing HTTP hits, summed | 204 | 0 |
| Previously correct controls preserved | 214 | 214 |

All six database fingerprints remain identical before and after queries and across
revisions. They include the explicit message and event fields; incidental event row IDs
and database-generated wall-time defaults are not hashed. Anonymous access stays 401,
a too-short query stays 400, and an explicit `app=slop` query still returns only its
own member. No synthetic email address, inbound text, or private feedback appears in
the measured search results. Percent, underscore, and backslash retain literal matching.

## safety_gates

Fresh audit and operations blocks pass 30/30 blocking gates on both revisions, with
one passing tracked gate and zero tracked misses. All 31 gate records are unchanged.
Runtime: 26.7 seconds before, 25.9 seconds after; these timings are incidental.

Every gate record remains identical after excluding elapsed `ms` values and the restore
duration embedded in the backup-drill label. No gate threshold, matching rule, or model
configuration changes.

The game worlds retain four baseline `minor_contact` findings: seed/personas 1/40,
7/40, 23/40, and 23/80. Each has one invariant finding and one minor contact. The other
four worlds have zero findings, and all eight have zero canary leaks. These existing
findings remain unchanged; they are not counted as passing safety results.

## Regression and required validation

The PR adds one integration case, expanded to exercise both modes through their actual
HTTP servers. Its game portion uses a native generated world and compares five capped
queries, also checking the newest timestamp directly against channel history. Its real
portion uses PostgreSQL with one visible message, 100 masked matches, 250 probe messages,
one matching check-in, 5,001 newer probe events, and excluded-row controls.

```sh
bun test --conditions eliza-source packages/observatory/test/search-recency.integration.test.ts
```

The expanded case fails on previous PR head `f890221c82aa192ee14d02750507401e6fc5f174`:
0 pass, 1 fail, 10 assertions, case 5149.38 ms. The nine game assertions pass, then
the visible message is missing. With the final fix: 1 pass, 0 fail, 14 assertions,
case 5218.72 ms. This isolates the remaining real-source defect; the paired programs
above independently compare original main with the final fix in both modes.

| Command | Result |
|---|---|
| `bun install --frozen-lockfile` | Passed during checkout setup; dependencies are unchanged |
| `bun run typecheck` | All four configurations passed |
| Regression command above | Previous PR head fails; final candidate passes, 14 assertions |
| `bun run sim --only audit,ops` | 30/30 blocking gates on both revisions |
| `bun run test:integration` | 676 pass, 8 skip, 6 fail; 13,755 assertions; 447.15 seconds |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 37.13 seconds |

The integration command includes every security-suite file. Its six failures match
the previously reproduced Windows baseline by name and cause: Wrangler cannot spawn
`/bin/bash`; the backend SIGTERM case returns 143 instead of 0; four site builds fail
slash-sensitive asset assertions. No new failure appears. The expanded regression passes in the full suite, 4708.94 ms.
The eight optional reconciliation skips match the baseline; the end-to-end skip
requires the optional SDK/Playwright setup. PostgreSQL was required and available.

The full simulation suite was not repeated for this update. Fresh measurements cover
the affected audit and operations blocks. The native server, SQL, and HTTP paths are real; there are no mocked
methods, records, or clocks. Only synthetic local data was used; live sends and deployment
flags were disabled. The isolated PostgreSQL cluster was stopped after validation.

## llm_evidence

N/A: this read path selects already-generated records and changes no model-backed
behavior. Game worlds use PolicyPersonaAgent and simulated review. Test-call provider
and exact model: N/A. Model calls: 0. Cost: 0.

## agent_clients

Codex desktop 26.1103.4239.0 ran the commands on Windows with Bun 1.4.2 and PostgreSQL 16.15.
Authoring provider: OpenAI. Exact authoring model: unavailable to this session.
No signup, MCP, or messaging flow changes. Other agent clients were not tested.

## Reproduce the measurements

1. Prepare clean base and candidate checkouts with `bun install --frozen-lockfile`.
2. Start isolated local PostgreSQL on port 54339. Set `REQUIRE_PG=1`,
   `OBSERVATORY_PG_PORT=54339`, and the PostgreSQL client executable path as needed.
   Keep live-send and deployment flags unset; no model credentials are needed.
3. Save the four programs below outside the checkouts, under the given filenames.
4. From each checkout, run `bun run --conditions eliza-source ../search-game-measure.ts <game-output.json>`
   and `bun run --conditions eliza-source ../search-real-measure.ts <real-output.json>`.
   Use separate absolute output paths for each revision. The real-mode program creates
   and drops its own disposable database using the repository's test helper.
5. From each checkout, run `bun run sim --only audit,ops --json <gates-output.json>`.
6. Run `bun run ../search-recency-compare.ts <game-before.json> <game-after.json> <gates-before.json> <gates-after.json>`.
   Expect 160 correct candidate searches, 40 unchanged full-search hashes, unchanged
   native world and judge data, zero missing recent HTTP hits, and 31 unchanged gates.
7. Run `bun run ../search-real-compare.ts <real-before.json> <real-after.json>`.
   Expect 240 correct candidate searches, 214 unchanged controls, six unchanged database
   fixtures, three unchanged access controls, and zero missing HTTP hits.
8. Run the regression and validation commands above. Expect one passing regression case
   with 14 assertions. Check platform failures and optional skips against the base.

### search-game-measure.ts

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
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
    const target = resolve(dir), parent = resolve(tmpdir());
    if (!target.startsWith(parent + sep) || !target.slice(parent.length + 1).startsWith("search-recency-measure-")) throw new Error("Unsafe cleanup path");
    await rm(target, { recursive: true, force: true });
  }
}
await Bun.write(process.argv[2]!, JSON.stringify(rows, null, 2) + "\n");
```

### search-recency-compare.ts

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

### search-real-measure.ts

```ts
import assert from "node:assert/strict";
import { SQL } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
const root = process.cwd();
const { testDb, dropTestDb } = await import(join(root, "packages/observatory/test/pg.ts"));
const { createServer } = await import(join(root, "packages/observatory/src/server.ts"));
const url = await testDb(), sql = new SQL(url), start = new Date("2026-01-01T12:00:00Z");
const dir = await mkdtemp(join(tmpdir(), "search-real-measure-"));
const token = "synthetic-search-measure-admin".padEnd(40, "x"), headers = { authorization: `Bearer ${token}` };
const hash = (v: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(v)).digest("hex");
const fixtures = [[1, 0, 0], [1, 99, 4999], [1, 100, 5000], [1, 101, 5001], [120, 130, 5007], [0, 101, 5001]];
const queries = ["needle", "checkin_sent", "probe", "feedback_given", "no-such-search-phrase", "100%", "field_name", "\\path"];
const result: any = { fixtures: [], controls: [] };
let server: Awaited<ReturnType<typeof createServer>> | undefined;
try {
  await sql`insert into network.members (app_id, id, name, home_city, age, joined_at) values
    ('ntwrk', 'search-member', 'Synthetic Member', 'nyc', 30, ${start}), ('slop', 'search-other', 'Other App', 'nyc', 30, ${start})`;
  await sql`insert into network.messages (app_id, id, member_id, direction, body, ts)
    values ('slop', 'other-app', 'search-other', 'outbound', 'Needle other app text', ${start})`;
  server = await createServer({ port: 0, development: false, mode: "real", token,
    staffRolesUrl: false, peopleUrl: false, audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
    real: { url, service: false, pollMs: 3_600_000, pushMs: 3_600_000 } });
  const source = await server.source("real");
  const fingerprint = async () => hash(await Promise.all([
    sql`select app_id, id, member_id, direction, body, ts, system, type from network.messages order by app_id, id`,
    sql`select app_id, at, actor_type, actor_id, type, object_type, object_id, payload from network.events order by app_id, at, id`,
  ]));
  for (const [visible, scrubbed, newerEvents] of fixtures) {
    await sql`delete from network.messages where app_id = 'ntwrk'`;
    await sql`delete from network.events`;
    await sql`insert into network.messages (app_id, id, member_id, direction, body, ts)
      select 'ntwrk', 'visible-' || i, 'search-member', 'outbound', 'Needle visible message ' || i,
        ${start}::timestamptz + i * interval '1 second' from generate_series(1, ${visible}::int) i`;
    await sql`insert into network.messages (app_id, id, member_id, direction, body, ts)
      select 'ntwrk', 'scrubbed-' || i, 'search-member', 'outbound', 'needle' || i || '@example.test',
        ${start}::timestamptz + (100000 + i) * interval '1 second' from generate_series(1, ${scrubbed}::int) i`;
    await sql`insert into network.messages (app_id, id, member_id, direction, body, ts)
      select 'ntwrk', 'probe-' || i, 'search-member', 'outbound', 'Probe message control ' || i,
        ${start}::timestamptz + (2000 + i) * interval '1 second' from generate_series(1, 250) i`;
    const literals = [["100%", "Escaped marker 100% literal"], ["field_name", "Escaped field_name literal"], ["\\path", "Escaped \\path literal"]];
    for (let k = 0; k < literals.length; k++) await sql`insert into network.messages (app_id, id, member_id, direction, body, ts)
      values ('ntwrk', ${`literal-${k}`}, 'search-member', 'outbound', ${literals[k]![1]}, ${new Date(start.getTime() + (1000 + k) * 1000)})`;
    await sql`insert into network.messages (app_id, id, member_id, direction, body, ts, system) values
      ('ntwrk', 'inbound', 'search-member', 'inbound', 'Needle private member text', ${start}, false),
      ('ntwrk', 'system', 'search-member', 'outbound', 'Needle system text', ${start}, true),
      ('ntwrk', 'literal-decoy', 'search-member', 'outbound', '1000 fieldXname unrelated', ${start}, false)`;
    await sql`insert into network.events (app_id, at, actor_type, actor_id, type, object_type, object_id)
      select 'ntwrk', ${start}::timestamptz + i * interval '1 second', 'agent', null, 'checkin_sent', 'member', 'search-member'
      from generate_series(1, ${visible}::int) i`;
    await sql`insert into network.events (app_id, at, actor_type, actor_id, type, object_type, object_id)
      select 'ntwrk', ${start}::timestamptz + (3000 + i) * interval '1 second', 'agent', null, 'probe_sent', 'member', 'search-member'
      from generate_series(1, ${newerEvents}::int) i`;
    await sql`insert into network.events (app_id, at, actor_type, actor_id, type, object_type, object_id, payload) values
      ('ntwrk', ${start}, 'member', 'search-member', 'feedback_given', 'member', 'search-member', '{"text":"Needle private feedback"}'::jsonb),
      ('slop', ${start}, 'member', 'search-other', 'checkin_sent', 'member', 'search-other', '{}'::jsonb)`;
    const dataBefore = await fingerprint(), checks = [];
    const hit = (kind: string, seconds: number, snippet: string, type?: string) => ({ memberId: "search-member", memberName: "Synthetic M.",
      t: start.getTime() + seconds * 1000, kind, snippet, ...(type ? { type } : {}) });
    for (const query of queries) {
      let expected: any[] = [];
      if (query === "needle") expected = Array.from({ length: visible! }, (_, i) => hit("message", i + 1, `Needle visible message ${i + 1}`));
      if (query === "checkin_sent") expected = Array.from({ length: visible! }, (_, i) => hit("event", i + 1, 'Weekly check-in sent ("What\'s your week like?")', "checkin_sent"));
      if (query === "probe") expected = [...Array.from({ length: 250 }, (_, i) => hit("message", 2001 + i, `Probe message control ${i + 1}`)),
        ...Array.from({ length: newerEvents! }, (_, i) => hit("event", 3001 + i, "Probe sent", "probe_sent"))];
      const literal = literals.findIndex(([q]) => q === query);
      if (literal >= 0) expected = [hit("message", 1000 + literal, literals[literal]![1]!)];
      expected.sort((a, b) => b.t - a.t);
      for (const limit of [0, 1, 25, 100, Number.MAX_SAFE_INTEGER]) {
        const actual = limit === 100 ? await fetch(`${server.url}/api/search?q=${encodeURIComponent(query)}`, { headers }).then(async r => {
          assert.equal(r.status, 200); return r.json();
        }) : await source.search(query, limit);
        const wanted = expected.slice(0, limit);
        checks.push({ query, limit, expected: wanted, actual, exact: JSON.stringify(actual) === JSON.stringify(wanted) });
      }
    }
    const dataAfter = await fingerprint(); assert.equal(dataAfter, dataBefore, "Search mutated fixture data");
    result.fixtures.push({ visible, scrubbed, newerEvents, dataBefore, dataAfter, checks });
    console.log(JSON.stringify({ visible, scrubbed, newerEvents, correct: checks.filter(c => c.exact).length, total: checks.length }));
  }
  for (const [path, auth] of [["/api/search?q=needle", false], ["/api/search?q=x", true], ["/api/search?q=needle&app=slop", true]] as const) {
    const r = await fetch(`${server.url}${path}`, { headers: auth ? headers : {} });
    result.controls.push({ path, status: r.status, body: await r.json() });
  }
  await Bun.write(process.argv[2]!, JSON.stringify(result));
} finally {
  await server?.stop(); await sql.close(); await dropTestDb();
  const target = resolve(dir), parent = resolve(tmpdir());
  if (!target.startsWith(parent + sep) || !target.slice(parent.length + 1).startsWith("search-real-measure-")) throw new Error("Unsafe cleanup path");
  await rm(target, { recursive: true, force: true });
}
```

### search-real-compare.ts

```ts
import assert from "node:assert/strict";
const before = await Bun.file(process.argv[2]!).json(), after = await Bun.file(process.argv[3]!).json();
assert.equal(before.fixtures.length, 6); assert.equal(after.fixtures.length, 6);
let correctBefore = 0, correctAfter = 0, controls = 0, httpBefore = 0, httpAfter = 0, missingBefore = 0, total = 0;
const fixtures = [];
for (let i = 0; i < after.fixtures.length; i++) {
  const a = after.fixtures[i], b = before.fixtures[i];
  assert.deepEqual([a.visible, a.scrubbed, a.newerEvents, a.dataBefore, a.dataAfter], [b.visible, b.scrubbed, b.newerEvents, b.dataBefore, b.dataAfter]);
  assert.equal(a.checks.length, 40); assert.equal(b.checks.length, 40);
  for (let j = 0; j < a.checks.length; j++) {
    const ac = a.checks[j], bc = b.checks[j];
    assert.deepEqual([ac.query, ac.limit, ac.expected], [bc.query, bc.limit, bc.expected]);
    assert.deepEqual(ac.actual, ac.expected, `${i} ${ac.query} ${ac.limit}`);
    correctBefore += Number(bc.exact); correctAfter++; total++;
    if (bc.exact) { assert.deepEqual(ac.actual, bc.actual); controls++; }
    if (ac.limit === 100) {
      httpBefore += Number(bc.exact); httpAfter++;
      const actual = new Set(bc.actual.map((h: any) => JSON.stringify(h)));
      missingBefore += ac.expected.filter((h: any) => !actual.has(JSON.stringify(h))).length;
    }
    assert(!JSON.stringify(ac.actual).includes("@example.test"));
    assert(!JSON.stringify(ac.actual).includes("private member text"));
    assert(!JSON.stringify(ac.actual).includes("private feedback"));
    assert(ac.actual.every((h: any) => h.memberId === "search-member"));
  }
  fixtures.push({ visible: a.visible, scrubbed: a.scrubbed, newerEvents: a.newerEvents, correctBefore: b.checks.filter((c: any) => c.exact).length, correctAfter: 40 });
}
assert.deepEqual(after.controls, before.controls);
assert.deepEqual(after.controls.map((c: any) => c.status), [401, 400, 200]);
assert.deepEqual(after.controls[2].body.map((h: any) => h.memberId), ["search-other"]);
assert.equal(total, 240); assert.equal(httpAfter, 48);
console.log(JSON.stringify({ fixtures, cases: total, correctBefore, correctAfter, unchangedControls: controls,
  httpCases: httpAfter, httpCorrectBefore: httpBefore, httpCorrectAfter: httpAfter, missingHttpHitsBefore: missingBefore,
  missingHttpHitsAfter: 0, unchangedAccessControls: 3, unchangedDatabaseFixtures: 6 }, null, 2));
```
