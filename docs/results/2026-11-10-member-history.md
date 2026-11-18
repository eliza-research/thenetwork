# Complete member and opportunity histories in Observatory

Date: 2026-11-10 (Asia/Tokyo).
Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`, current main.
Candidate: this PR, branched from that base.
Runtime: Windows, Bun 1.4.2, PostgreSQL 16.15.

## Requirement, cause and change

This is a reproduced defect under the approved Slop scope and CONTRIBUTING 3.1.
PRD 28.5 requires the console to show a member's full experience.
`docs/admin-console.md` 3.4 requires every inbound and outbound message, in order, with the intervening system actions.
Section 3.5 requires the opportunity panel's full event history.

RealSource sorted messages oldest first, then stopped at 2,000.
Its member timeline also stopped at 5,000 matching event rows.
Opportunity detail independently stopped at 2,000 events, hiding later actions from that panel.
New records silently disappeared from these detail views after the applicable limit.
The endpoints offered no cursor or continuation link.

Remove the limits from both message queries, the member timeline event query, and the opportunity event query.
Keep the existing sort, member and app filters, event subject checks, read-only connection, and 20-second database statement timeout.
Inbound bodies remain absent from the SQL result until reveal.
The existing API continues to return arrays of messages and timeline entries.

Alternatives considered:

1. Return the newest limited subset. That still omits part of the required full experience.
2. Increase the limits. That only moves the point at which records disappear.
3. Add cursor pagination across API and UI. That is a larger interface change than this bounded defect needs.

There is no UI markup, style, copy, database schema, matching, send, or model change.
Responses now grow with the member's or opportunity's history. Very large histories can require substantial memory or exceed the existing statement timeout.
This measurement checks up to 2,407 messages and 5,037 events per member, plus 2,407 events per opportunity.
It is not a production-scale load benchmark.

## Paired PostgreSQL and HTTP measurement

The program below seeds six fictional member histories in an isolated, disposable database.
Each has a separate member in another app as a control.
It starts the real Observatory server and reads both endpoints over HTTP.
It repeats each target read before reveal, during reveal, and after revocation.
The input data, request sequence, and program are identical before and after.
There is no fake SQL client, HTTP handler, or model response.

| Stored messages / events | Base messages / events | Fixed messages / events |
|---|---|---|
| 0 / 0 | 0 / 0 | 0 / 0 |
| 1 / 1 | 1 / 1 | 1 / 1 |
| 1,999 / 4,999 | 1,999 / 4,999 | 1,999 / 4,999 |
| 2,000 / 5,000 | 2,000 / 5,000 | 2,000 / 5,000 |
| 2,001 / 5,001 | 2,000 / 5,000 | 2,001 / 5,001 |
| 2,407 / 5,037 | 2,000 / 5,000 | 2,407 / 5,037 |

Message counts agree between member detail and timeline. All three reveal phases have the counts shown above.
The two affected histories regain 408 distinct messages and 38 events.
Twelve endpoint responses improve. Forty-two control responses remain semantically identical.
The controls comprise 24 target reads below or at the limits, 12 other-app reads, and six refused or missing-member reads.
There are 54 GET requests and 12 successful reveal/revoke requests per run.

The comparator checks every message ID, timestamp, body, and hidden length.
It checks every event's subject, type, timestamp, and order.
Equal-time events still precede messages; equal-time messages retain their ID order.
Every previously returned message and event remains unchanged.
Unrelated member fields and timeline metadata also remain unchanged.

The capture removes only the response's wall-clock reveal-expiry field.
The comparator normalizes only staff-access audit timestamps when comparing runs.
It preserves audit actors, actions, count, and order.
When comparing hidden with revoked views within one run, it excludes the audit list because the intervening reads correctly add entries.
The other app's inbound body stays hidden during the target member's reveal.
Unauthenticated requests stay 401; missing members and the wrong app stay 404.

Sample size: six fixed histories, two endpoints, three reveal phases, plus the controls above.
Seed: N/A; deterministic SQL fixtures, with reverse insertion order and tied timestamps.
This is an exact data-completeness comparison, not a sampled quality estimate. No confidence interval is applicable.

## Paired opportunity-history measurement

A second real PostgreSQL and HTTP fixture covers six opportunities with 0, 1, 1,999, 2,000, 2,001, and 2,407 events.
Each has inbound and outbound messages and one adult participant.
Events are inserted in reverse order, with tied timestamps.
Decoy rows share the opportunity identifier in another app, share it with a different object type, or name another opportunity.

| Stored events | Before | After |
|---:|---:|---:|
| 0 | 0 | 0 |
| 1 | 1 | 1 |
| 1,999 | 1,999 | 1,999 |
| 2,000 | 2,000 | 2,000 |
| 2,001 | 2,000 | 2,001 |
| 2,407 | 2,000 | 2,407 |

Each opportunity is read before, during, and after a member reveal. The table applies to all three phases.
Six responses improve; 15 controls remain exactly identical. The two affected histories regain 408 distinct events.
The comparator checks every event's timestamp, type, subject, order, and all previously returned event fields.
All other opportunity fields, member records, and messages remain identical, without normalization.
The opportunity endpoint's existing behavior keeps inbound bodies hidden throughout these per-member reveal changes.
Unauthenticated access stays 401; missing and wrong-app opportunities stay 404. All decoy events remain excluded.
There are 21 GET requests and 12 successful reveal/revoke requests per revision.

Combined with the member fixture, the fresh measurements contain 75 GET requests and 24 reveal/revoke requests per revision.
Eighteen responses improve, 57 controls remain unchanged, and 408 messages plus 446 events are restored.
Counts of restored rows exclude repeated reads of the same history.

## Regression and required validation

One integration case uses real PostgreSQL and the actual HTTP server.
It stores 2,001 messages, 5,001 member events, and 2,001 events for that member's opportunity.
It checks all three endpoints, chronological order, event subjects, body hiding, reveal, revocation, another member, and another app.
Decoys also verify that opportunity events must have the correct object type and identifier.
The existing case was expanded; this PR still adds only one integration case.

```text
bun test --conditions eliza-source packages/observatory/test/member-history.integration.test.ts
Previous PR head ce63fa059568cc575bd504d00f10c1a37e1d34d2: 0 pass, 1 fail; 1 assertion; case 3232.72 ms.
Expected [2001, 2001, 7002, 2001]; received [2001, 2001, 7002, 2000].
Fixed: 1 pass, 0 fail; 36 assertions; case 3219.29 ms.
```

The four counts are member messages, timeline messages, timeline events, and opportunity events.
The previous PR head already fixed the member endpoints; this reproduction isolates its remaining opportunity truncation.
Both paired measurement programs also ran afresh on original main and the final candidate.

Fresh affected-block runs used `bun run sim --only audit,ops` on original main and the final candidate.
Both passed 30/30 blocking gates and one tracked gate. Base: 29.3s; candidate: 29.2s.

All 31 gate records match after excluding gate elapsed time and the backup restore duration in its display name.
No threshold, classification, result, or other detail changes. PostgreSQL gates ran without skips.
Only these affected blocks ran. AGENTS.md permits one full simulation per agent; that allowance was used on the earlier contribution.
No full simulation on this PR is claimed.

Fresh validation on the final code:

- Frozen install: 50 installs checked across 44 packages, unchanged.
- Typecheck: all four configurations passed.
- Integration, including security: 676 pass, 8 skip, 6 known failures; 13,777 assertions.
- The new regression passed inside the official integration command in 2356.53 ms.
- End-to-end: 42 pass, 1 skip, 0 fail; 654 assertions.
- Integration: 690 tests across 69 files, 456.81s. End-to-end: 43 tests across 3 files, 38.05s.

Integration skips (including the two distinct unnamed cases):

- isolated PostgreSQL completed cleanup reconciliation > (unnamed)
- isolated PostgreSQL completed cleanup reconciliation > V2 exact retry returns the original counts after profile removal and newer batches without any mutation
- isolated PostgreSQL completed cleanup reconciliation > V1 exact retry returns its original retention result after later edits without rerunning cleanup
- isolated PostgreSQL completed cleanup reconciliation > changed completed identity hash operation cutoff nonce and stale proof deny without touching either protocol
- isolated PostgreSQL completed cleanup reconciliation > legacy and partial completions deny while the canonical runtime receipt ACL remains SELECT INSERT only
- isolated PostgreSQL completed cleanup reconciliation > post-write owner loss rolls profile data and completion receipts back together for V1 and V2
- isolated PostgreSQL completed cleanup reconciliation > concurrent cross-app owners sharing one V1 nonce commit once and roll the losing profile back
- isolated PostgreSQL completed cleanup reconciliation > (unnamed)

End-to-end skip:

- failed security checks give recovery feedback and a later SDK success clears only that feedback

The six integration failures are the already reproduced Windows baseline failures:
one missing `/bin/bash`, one SIGTERM exit 143 versus 0, and four site-build path assertions.
The validator compares all six failure names and their causes with the saved clean-base result.
A fully green integration suite is not claimed.

## Safety and limits

Fixture member IDs are globally unique, matching the database schema.
The member comparator normalizes only the documented audit wall times. The opportunity comparator needs no normalization.
The production change removes four history query limits.

Only synthetic data and local PostgreSQL were used. No live sends or deploy flags were enabled.
The database was stopped after validation, with no client connections remaining.
The audit simulations use the repository's simulated reviewer. These history fixtures do not generate matches or send messages.
The matching algorithm and its outcome scores are not measured by this PR.

Real-LLM evidence: N/A; SQL history retrieval does not use a model. Calls: 0. Cost: $0.
Provider, model, and request settings for the tested flow: N/A.
Agent clients: N/A; this changes a staff data endpoint, not member onboarding or an agent integration.
Codex desktop 26.1103.4239.0 drove Bun and the local HTTP workflow. No other client is claimed as tested.
No browser or computer use was performed.
The assistant's exact model ID was not exposed; the attribution helper's supported `unavailable` value is used.

## Reproduce

1. Use the base commit and a local PostgreSQL 16 cluster on port 54339.
2. Set `USER` to the local test role and `REQUIRE_PG=1`; add the PostgreSQL programs to PATH.
3. Run `bun install --frozen-lockfile`.
4. Save the measurement program below as `../member-history-measure.ts`.
5. From each checkout, run `bun run --conditions eliza-source ../member-history-measure.ts ../before.json` or `../after.json`.
6. Save the comparator below as `../member-history-compare.ts`.
7. From the fixed checkout, run `bun run --conditions eliza-source ../member-history-compare.ts ../before.json ../after.json`.
8. Expect 12 improved responses, 42 unchanged responses, 408 restored messages, and 38 restored events.
9. Save and run `opportunity-history-measure.ts` from each checkout with separate output paths.
10. Compare those files with `opportunity-history-compare.ts` from the fixed checkout. Expect six improved responses, 15 unchanged responses, and 408 restored events.
11. Run the regression command above. Expect one passing case with 36 assertions.

Use disposable local test data. Leave live-send and deployment flags unset.
The programs create and drop their own process-specific test databases through the repository helper.
They do not operate on the developer's `network` database contents.

The programs and fixtures below were written by the contributor. The counts and hashes were generated by running them.

### member-history-measure.ts

```ts
import { SQL } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

// Run from either pinned checkout. Only fictional rows in the repository's disposable test DB.
const root = process.cwd();
const { testDb, dropTestDb } = await import(join(root, "packages/observatory/test/pg.ts"));
const { createServer } = await import(join(root, "packages/observatory/src/server.ts"));
const url = await testDb();
const sql = new SQL(url);
const token = "synthetic-history-admin".padEnd(40, "x");
const dir = await mkdtemp(join(tmpdir(), "obs-history-measure-"));
const start = new Date("2026-01-01T12:00:00.000Z");
const cases = [[0, 0], [1, 1], [1999, 4999], [2000, 5000], [2001, 5001], [2407, 5037]];
let obs: Awaited<ReturnType<typeof createServer>> | undefined;
const result: any = { cases: [], controls: [] };
try {
  for (let k = 0; k < cases.length; k++) {
    const id = `history-${k}`, [messages, events] = cases[k]!;
    await sql`insert into network.members (app_id, id, name, home_city, age, joined_at)
      values ('ntwrk', ${id}, 'Synthetic Member', 'nyc', 30, ${start}),
             ('slop', ${id} || '-other', 'Other App', 'nyc', 30, ${start})`;
    await sql`insert into network.messages (app_id, id, member_id, direction, body, ts)
      select 'ntwrk', ${id} || '-' || lpad(i::text, 6, '0'), ${id},
        case when i % 2 = 1 then 'inbound' else 'outbound' end,
        'Synthetic history ' || i, ${start}::timestamptz + (i / 2) * interval '1 second'
      from generate_series(1, ${messages}::int) i order by i desc`;
    await sql`insert into network.events (app_id, at, actor_type, actor_id, type, object_type, object_id)
      select 'ntwrk', ${start}::timestamptz + (i / 2) * interval '1 second', 'agent', ${id}, 'checkin_sent', 'member', ${id}
      from generate_series(1, ${events}::int) i order by i desc`;
    await sql`insert into network.messages (app_id, id, member_id, direction, body, ts)
      values ('slop', ${id} || '-other-app', ${id} || '-other', 'inbound', 'OTHER_APP_HISTORY', ${start})`;
    await sql`insert into network.events (app_id, at, actor_type, actor_id, type, object_type, object_id)
      values ('slop', ${start}, 'member', ${id} || '-other', 'member_joined', 'member', ${id} || '-other')`;
  }
  obs = await createServer({ port: 0, development: false, mode: "real", token,
    staffRolesUrl: false, peopleUrl: false, audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
    real: { url, service: false, pollMs: 3_600_000, pushMs: 3_600_000 } });
  const req = async (path: string, method = "GET", body?: object, auth = true) => {
    const response = await fetch(new URL(path, obs!.server.url), { method,
      headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const read = async (id: string, app = "ntwrk") => {
    const member = await req(`/api/member/${id}?app=${app}`);
    const timeline = await req(`/api/member/${id}/timeline?app=${app}`);
    if (member.status !== 200 || timeline.status !== 200) throw new Error(JSON.stringify({ member, timeline }));
    delete member.body.revealed; delete timeline.body.revealed;
    return { member: member.body, timeline: timeline.body };
  };
  for (let k = 0; k < cases.length; k++) {
    const id = `history-${k}`, [messages, events] = cases[k]!;
    const hidden = await read(id);
    const grant = await req("/api/reveal", "POST", { memberId: id, reason: "Synthetic history verification" });
    if (grant.status !== 200) throw new Error(JSON.stringify(grant));
    const revealed = await read(id);
    const otherApp = await read(id + "-other", "slop");
    const revoke = await req(`/api/reveal?memberId=${id}`, "DELETE");
    if (revoke.status !== 200) throw new Error(JSON.stringify(revoke));
    const revoked = await read(id);
    const counts = (v: any) => [v.member.messages.length, v.timeline.entries.filter((x: any) => x.kind === "message").length, v.timeline.entries.filter((x: any) => x.kind === "event").length];
    result.cases.push({ id, expected: { messages, events }, hidden, revealed, revoked, otherApp });
    console.log(JSON.stringify({ id, expected: [messages, messages, events], hidden: counts(hidden), revealed: counts(revealed), revoked: counts(revoked) }));
  }
  for (const path of ["/api/member/history-5", "/api/member/history-5/timeline"]) {
    result.controls.push({ path, unauthorized: await req(path, "GET", undefined, false) });
  }
  for (const path of ["/api/member/missing", "/api/member/missing/timeline"]) result.controls.push({ path, missing: await req(path) });
  for (const path of ["/api/member/history-5?app=slop", "/api/member/history-5/timeline?app=slop"]) result.controls.push({ path, wrongApp: await req(path) });
  await Bun.write(process.argv[2]!, JSON.stringify(result));
} finally {
  await obs?.stop();
  await sql.close();
  await dropTestDb();
  const target = resolve(dir), parent = resolve(tmpdir());
  if (!target.startsWith(parent + sep) || !target.slice(parent.length + 1).startsWith("obs-history-measure-")) throw new Error("Unsafe cleanup path");
  await rm(target, { recursive: true, force: true });
}
```

### member-history-compare.ts

```ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const before = await Bun.file(process.argv[2]!).json();
const after = await Bun.file(process.argv[3]!).json();
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
for (const run of [before, after]) for (const c of run.cases) for (const phase of ["hidden", "revealed", "revoked", "otherApp"])
  for (const entry of c[phase].member.staffAccess ?? []) entry.at = 0;
// Read the actual shared redaction constant; all other expected values come from the fixture contract.
const { HIDDEN_MESSAGE } = await import(`${process.cwd().replaceAll("\\", "/")}/packages/observatory/src/sources/real.ts`);
const summary: any = { histories: after.cases.length, improvedResponses: 0, unchangedResponses: 0, restoredMessages: 0, restoredEvents: 0, cases: [] };
for (let k = 0; k < after.cases.length; k++) {
  const b = before.cases[k], a = after.cases[k];
  assert.equal(a.id, b.id);
  assert.deepEqual(a.expected, b.expected);
  const oldCounts = [b.hidden.member.messages.length, b.hidden.timeline.entries.filter((x: any) => x.kind === "event").length];
  summary.restoredMessages += a.expected.messages - oldCounts[0];
  summary.restoredEvents += a.expected.events - oldCounts[1];
  for (const phase of ["hidden", "revealed", "revoked"]) {
    const bv = b[phase], av = a[phase];
    const bm = bv.member.messages, am = av.member.messages;
    const be = bv.timeline.entries.filter((e: any) => e.kind === "event");
    const ae = av.timeline.entries.filter((e: any) => e.kind === "event");
    const tm = av.timeline.entries.flatMap((e: any) => e.kind === "message" ? [e.message] : []);
    assert.equal(am.length, a.expected.messages);
    assert.equal(ae.length, a.expected.events);
    assert.deepEqual(am.slice(0, bm.length), bm);
    assert.deepEqual(ae.slice(0, be.length), be);
    assert.deepEqual(tm, am);
    assert.deepEqual({ ...av.member, messages: [] }, { ...bv.member, messages: [] });
    assert.deepEqual({ ...av.timeline, entries: [] }, { ...bv.timeline, entries: [] });
    assert(am.every((m: any, i: number) => m.id === `${a.id}-${String(i + 1).padStart(6, "0")}`));
    assert(am.every((m: any, i: number) => m.ts === Date.parse("2026-01-01T12:00:00Z") + Math.floor((i + 1) / 2) * 1000));
    assert(ae.every((e: any, i: number) => e.event.memberId === a.id && e.event.type === "checkin_sent" && e.t === Date.parse("2026-01-01T12:00:00Z") + Math.floor((i + 1) / 2) * 1000));
    assert(av.timeline.entries.every((e: any, i: number, all: any[]) => !i || all[i - 1].t < e.t ||
      (all[i - 1].t === e.t && !(all[i - 1].kind === "message" && e.kind === "event"))));
    for (let i = 0; i < am.length; i++) {
      const m = am[i], hidden = phase !== "revealed" && m.direction === "inbound";
      assert.equal(m.body, hidden ? HIDDEN_MESSAGE : `Synthetic history ${i + 1}`);
      assert.equal(m.hiddenLength, hidden ? `Synthetic history ${i + 1}`.length : undefined);
    }
    for (const endpoint of ["member", "timeline"]) {
      if (hash(av[endpoint]) === hash(bv[endpoint])) summary.unchangedResponses++;
      else summary.improvedResponses++;
    }
  }
  assert.deepEqual(a.hidden.timeline, a.revoked.timeline);
  assert.deepEqual({ ...a.hidden.member, staffAccess: [] }, { ...a.revoked.member, staffAccess: [] });
  assert.deepEqual(a.otherApp, b.otherApp);
  assert.deepEqual([a.otherApp.member.messages.length, a.otherApp.member.messages[0].body], [1, HIDDEN_MESSAGE]);
  summary.unchangedResponses += 2;
  summary.cases.push({ id: a.id, before: oldCounts, after: [a.expected.messages, a.expected.events], hiddenHash: hash(a.hidden), revealedHash: hash(a.revealed) });
}
assert.deepEqual(after.controls, before.controls);
assert.deepEqual(after.controls.map((c: any) => (c.unauthorized ?? c.missing ?? c.wrongApp).status), [401, 401, 404, 404, 404, 404]);
summary.unchangedResponses += after.controls.length;
assert.deepEqual([summary.improvedResponses, summary.unchangedResponses, summary.restoredMessages, summary.restoredEvents], [12, 42, 408, 38]);
console.log(JSON.stringify(summary, null, 2));
```

### opportunity-history-measure.ts

```ts
import { SQL } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
const root = process.cwd();
const { testDb, dropTestDb } = await import(join(root, "packages/observatory/test/pg.ts"));
const { createServer } = await import(join(root, "packages/observatory/src/server.ts"));
const url = await testDb(), sql = new SQL(url);
const token = "synthetic-opportunity-history-admin".padEnd(40, "x");
const dir = await mkdtemp(join(tmpdir(), "obs-opportunity-history-"));
const start = new Date("2026-01-01T12:00:00.000Z"), counts = [0, 1, 1999, 2000, 2001, 2407];
let obs: Awaited<ReturnType<typeof createServer>> | undefined;
const result: any = { cases: [], controls: [] };
try {
  for (let k = 0; k < counts.length; k++) {
    const id = `opp-history-${k}`, member = `opp-member-${k}`;
    await sql`insert into network.members (app_id, id, name, home_city, age, joined_at)
      values ('ntwrk', ${member}, 'Synthetic Member', 'nyc', 30, ${start})`;
    await sql`insert into network.opportunities (app_id, id, kind, state, city, objective, created_at, updated_at)
      values ('ntwrk', ${id}, 'pair', 'PROPOSED', 'nyc', 'Synthetic history', ${start}, ${start})`;
    await sql`insert into network.participations (app_id, opportunity_id, member_id, status) values ('ntwrk', ${id}, ${member}, 'proposed')`;
    await sql`insert into network.messages (app_id, id, member_id, direction, body, ts, opportunity_id) values
      ('ntwrk', ${id} || '-in', ${member}, 'inbound', 'Synthetic private reply', ${start}, ${id}),
      ('ntwrk', ${id} || '-out', ${member}, 'outbound', 'Synthetic outgoing message', ${start}, ${id})`;
    await sql`insert into network.events (app_id, at, actor_type, actor_id, type, object_type, object_id, payload)
      select 'ntwrk', ${start}::timestamptz + (i / 2) * interval '1 second', 'agent', null, 'probe_sent', 'opportunity', ${id},
        jsonb_build_object('memberId', ${member}::text) from generate_series(1, ${counts[k]}::int) i order by i desc`;
    // These share the identifier or app but are not events for the requested opportunity.
    await sql`insert into network.events (app_id, at, actor_type, actor_id, type, object_type, object_id) values
      ('ntwrk', ${start}, 'agent', null, 'checkin_sent', 'member', ${id}),
      ('ntwrk', ${start}, 'agent', null, 'probe_sent', 'opportunity', ${id} || '-other'),
      ('slop', ${start}, 'agent', null, 'probe_sent', 'opportunity', ${id})`;
  }
  obs = await createServer({ port: 0, development: false, mode: "real", token,
    staffRolesUrl: false, peopleUrl: false, audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
    real: { url, service: false, pollMs: 3_600_000, pushMs: 3_600_000 } });
  const req = async (path: string, method = "GET", body?: object, auth = true) => {
    const r = await fetch(new URL(path, obs!.server.url), { method,
      headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json() };
  };
  for (let k = 0; k < counts.length; k++) {
    const id = `opp-history-${k}`, member = `opp-member-${k}`;
    const hidden = await req(`/api/opportunity/${id}`);
    const grant = await req("/api/reveal", "POST", { memberId: member, reason: "Synthetic opportunity history verification" });
    if (grant.status !== 200) throw new Error(JSON.stringify(grant));
    const revealed = await req(`/api/opportunity/${id}`);
    const revoke = await req(`/api/reveal?memberId=${member}`, "DELETE");
    if (revoke.status !== 200) throw new Error(JSON.stringify(revoke));
    const revoked = await req(`/api/opportunity/${id}`);
    for (const r of [hidden, revealed, revoked]) if (r.status !== 200) throw new Error(JSON.stringify(r));
    result.cases.push({ id, member, expected: counts[k], hidden, revealed, revoked });
    console.log(JSON.stringify({ id, expected: counts[k], counts: [hidden, revealed, revoked].map(r => r.body.events.length) }));
  }
  result.controls.push(await req("/api/opportunity/opp-history-5", "GET", undefined, false));
  result.controls.push(await req("/api/opportunity/missing"));
  result.controls.push(await req("/api/opportunity/opp-history-5?app=slop"));
  await Bun.write(process.argv[2]!, JSON.stringify(result));
} finally {
  await obs?.stop(); await sql.close(); await dropTestDb();
  const target = resolve(dir), parent = resolve(tmpdir());
  if (!target.startsWith(parent + sep) || !target.slice(parent.length + 1).startsWith("obs-opportunity-history-")) throw new Error("Unsafe cleanup path");
  await rm(target, { recursive: true, force: true });
}
```

### opportunity-history-compare.ts

```ts
import assert from "node:assert/strict";
const before = await Bun.file(process.argv[2]!).json(), after = await Bun.file(process.argv[3]!).json();
const { HIDDEN_MESSAGE } = await import(`${process.cwd().replaceAll("\\", "/")}/packages/observatory/src/sources/real.ts`);
let improved = 0, unchanged = 0, restoredEvents = 0;
const cases = [];
assert.equal(before.cases.length, 6); assert.equal(after.cases.length, 6);
for (let k = 0; k < after.cases.length; k++) {
  const b = before.cases[k], a = after.cases[k];
  assert.deepEqual([a.id, a.member, a.expected], [b.id, b.member, b.expected]);
  restoredEvents += a.expected - b.hidden.body.events.length;
  for (const phase of ["hidden", "revealed", "revoked"]) {
    const bv = b[phase], av = a[phase];
    assert.equal(av.status, 200); assert.equal(bv.status, 200);
    const be = bv.body.events, ae = av.body.events;
    assert.equal(be.length, Math.min(2000, a.expected));
    assert.equal(ae.length, a.expected);
    assert.deepEqual(ae.slice(0, be.length), be);
    assert.deepEqual({ ...av.body, events: [] }, { ...bv.body, events: [] });
    assert(ae.every((e: any, i: number) => e.opportunityId === a.id && e.memberId === a.member && e.type === "probe_sent"
      && e.t === Date.parse("2026-01-01T12:00:00Z") + Math.floor((i + 1) / 2) * 1000));
    assert.deepEqual(av.body.messages.map((m: any) => [m.id, m.body, m.hiddenLength]), [
      [`${a.id}-in`, HIDDEN_MESSAGE, "Synthetic private reply".length], [`${a.id}-out`, "Synthetic outgoing message", undefined],
    ]);
    if (ae.length === be.length) { assert.deepEqual(av, bv); unchanged++; } else improved++;
  }
  assert.deepEqual(a.hidden, a.revealed); assert.deepEqual(a.hidden, a.revoked);
  cases.push({ id: a.id, before: b.hidden.body.events.length, after: a.hidden.body.events.length });
}
assert.deepEqual(after.controls, before.controls);
assert.deepEqual(after.controls.map((r: any) => r.status), [401, 404, 404]);
unchanged += after.controls.length;
assert.deepEqual([improved, unchanged, restoredEvents], [6, 15, 408]);
console.log(JSON.stringify({ cases, improvedResponses: improved, unchangedResponses: unchanged, restoredEvents }, null, 2));
```

### member-history-gates-compare.ts

```ts
import assert from "node:assert/strict";
const before = await Bun.file(process.argv[2]!).json(), after = await Bun.file(process.argv[3]!).json();
const normalize = ({ ms, ...rest }: any) => ({ ...rest,
  name: rest.name.startsWith("backup drill:") ? rest.name.replace(/restore \d+ ms$/, "restore <elapsed> ms") : rest.name });
assert.equal(before.gates.length, 31); assert.equal(after.gates.length, 31);
assert.equal(after.gates.filter((g: any) => g.blocking).length, 30);
assert(before.gates.every((g: any) => g.pass) && after.gates.every((g: any) => g.pass));
assert.deepEqual(after.gates.map(normalize), before.gates.map(normalize));
console.log(JSON.stringify({ gates: 31, blocking: 30, tracked: 1, failed: 0, unchanged: 31,
  baseSeconds: before.total, candidateSeconds: after.total }, null, 2));
```

## Raw artifact SHA-256

Only aggregate hashes are published; the capture files remain local.

- detail-member-before.json: `4f6b82c6a018e1dd7f3978cc59091e3a1d183f530233d4f73f87e15f03b61a61`
- detail-member-after.json: `dd7c0cc00b3341d79f07c3c232247ff9e258f2448cdac2393ceebc40deed0dc2`
- opportunity-history-before.json: `e0420334d35b7946d7955ac1b41e645044e31abb14404480821eb2dc1be92a99`
- opportunity-history-after.json: `4923f1a9147ef97d71440db18168fb45376beda52fd9cfcef67137336fa94786`
- detail-history-gates-before.json: `d4e36efbf7b7f6ea397a73f04ded99cc3b7b1ac7b110ab2bb584319fa2cf7c1e`
- detail-history-gates-after.json: `0a347ff47bcc308d78edffd431314b8a26c8a80eec563c82476c1e8ea0582c3e`
