# Count reported meeting enjoyment samples

Date: 2026-11-08. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2, Windows x64, PostgreSQL 16.15 on local port 54339.

## Requirement and defect

PRD 35.2 and 35.3 require the member view and its database read model.
`docs/observatory.md` section 3 defines member activity counters, including mean enjoyment.
This fixes a reproduced error in those existing counters.

The member aggregate counted every attended participation in a held meeting as an enjoyment sample.
Its sum ignored SQL `NULL`, but its count included `NULL`.
Missing feedback therefore appeared as zero enjoyment, or reduced the mean of the ratings that were present.
The global aggregate already excluded missing scores, so member and global views disagreed.

The native reproduction on base uses the real `ConsentNetwork` through the repository's `Mini` harness.
Two synthetic adults complete onboarding, receive a reviewed proposal, answer its probes and reach a completed booking.
`PgStore.save` writes their actual exported state to PostgreSQL.
Both stored participation scores are `NULL`; the native console writer currently supplies no numeric enjoyment value.
Each member nevertheless has `enjoymentN=1`, so the existing client formula computes a mean of zero.
The global count is correctly zero.

## Fix and alternatives

Count `p.enjoyment` instead of `*` in the existing member enjoyment aggregate.
SQL then excludes absent scores and includes genuine numeric zero scores.
The sum and all participant, attendance, held-state and app filters keep their existing meaning.
No stored value changes.

Other implementations considered:

1. Hide zero means in the client. This also hides real zero ratings and leaves incorrect API counts.
2. Replace missing scores with a default. This invents feedback and changes the measured experience.
3. Recalculate the counters in TypeScript. The existing SQL aggregate already reads the required rows.

The only production edit changes this aggregate's count argument.

## measurement

The same final integration case runs against base and the fixed source:

```sh
bun test --conditions eliza-source packages/observatory/test/enjoyment-samples.integration.test.ts
```

| Result | Base | Fixed |
| --- | ---: | ---: |
| Integration case | 0 pass, 1 fail | 1 pass, 0 fail |
| Assertions reached | 4 | 4 |
| Duration | 2.64 seconds | 2.35 seconds |

The case first proves the native saved-state reproduction above.
It then reads actual HTTP state and member-detail routes through the Observatory server.
Controlled SQL updates add partial feedback, an unrated completed meeting, a real zero score and a fully rated control.
Both completed and feedback-collected meeting states are included.
All four phases compare member counters, member details and global totals with explicit expected values.
The test uses a real Network, PostgreSQL and HTTP server. No reader, store or HTTP response is mocked.
The local harness uses its recording channel and simulated automatic reviewer; it sends no real messages.

An initial typecheck found an untyped callback in the new test.
The callback was typed before the final base/fixed regression, typecheck and suite runs reported here.

### Paired measurement

The full program and comparator are included below.
The agent authored the synthetic cases; these are not independent production observations.

- One native Network booking on `ntwrk`, with the same default Mini seed of 1 in both arms.
- Four database app selections: `ntwrk`, `slop`, `peon` and `friends`.
- Five rating cohorts per app: no scores, one score, zero score, mixed scores and complete scores.
- Four exclusion controls per cohort: an alternate, a no-show, a scheduled meeting and an abandoned meeting.
- Each synthetic opportunity also has an unrated peer participant.
- Twenty cohort members, four peer members and two native members: 26 distinct members.
- Thirteen snapshots produce 80 member observations: the native snapshot, then three phases across four apps.
- The phases are partial ratings, controlled score arrivals and an unchanged refresh.
- The Mini clock starts at `2026-10-05T17:00:00Z`. Measurement wall time is fixed fifteen days later.
- Cohort scores and updates are explicit; no additional random seed applies.

The comparison reads the stored participation rows independently and selects present scores from eligible held meetings.
For each member, it checks the state API and audited member-detail API against that sample.
Each snapshot also verifies that the global sum and count already agree with the stored scores.

| Result across all observations | Base | Fixed |
| --- | ---: | ---: |
| Incorrect member sample counts | 52 | 0 |
| Incorrect member means | 40 | 0 |
| Absent ratings misrepresented as a zero mean | 24 | 0 |
| Incorrect member-detail samples | 52 | 0 |

The counts include repeated observations of the same members. They are not counts of distinct people.
All stored-row hashes, expected samples, other member counters and complete global statistics match between arms.
The fully rated cohort stays at sum 1, count 3 and mean 1/3 in every app and phase.
Real zero scores remain samples. They are never treated as missing values.

Examples from the partial-rating phase, repeated in each app:

| Stored eligible scores | Base count and mean | Fixed count and mean |
| --- | --- | --- |
| `NULL, NULL` | 2; 0 | 0; no mean |
| `0.75, NULL` | 2; 0.375 | 1; 0.75 |
| `0, NULL` | 2; 0 | 1; 0 |
| `0.75, NULL, 0.25, NULL` | 4; 0.25 | 2; 0.5 |
| `0.75, 0, 0.25` | 3; 1/3 | 3; 1/3 |

Measurement durations were 2.80 seconds before and 2.62 seconds after. No performance improvement is claimed.

### Reproduce

Use separate worktrees at base and this PR. Install dependencies with `bun install --frozen-lockfile`.
Use a disposable local PostgreSQL instance, with `REQUIRE_PG=1`, `OBSERVATORY_PG_PORT=54339` and the local `PG_BIN_DIR`.
Keep live-send, deployment and model credentials unset.
Save the programs below beside both worktrees, using their shown filenames.
Run from each named worktree:

```powershell
# Base worktree
$env:ENJOYMENT_OUTPUT = '../member-enjoyment-before.json'
bun test --conditions eliza-source ../member-enjoyment-measure.test.ts
# Fixed worktree
$env:ENJOYMENT_OUTPUT = '../member-enjoyment-after.json'
bun test --conditions eliza-source ../member-enjoyment-measure.test.ts
bun ../member-enjoyment-compare.ts
```

Expect 13 snapshots, 80 observations, identical controls and zero fixed mismatches.
Copy only the committed regression into the base worktree to reproduce its failure, then remove that copy.
The base worktree used here was restored to a clean state.

## safety_gates

Paired command: `bun run sim --only audit,ops --json <output>`.
Both arms pass **30/30 blocking gates**, with zero tracked misses.
All 31 records match after excluding elapsed times and the restore duration embedded in one backup label.
Durations: 24.2 seconds before and 24.1 seconds after.
These blocks use the repository defaults and fixtures, with no seed override.

No matching, review, age, consent, access, delivery or threshold logic changed.
The database reader remains read-only. Only the synthetic fixtures write test records.
The full default simulation was not repeated because AGENTS.md allows one full run per agent, already used earlier in this session.
No full-world matching-quality or safety qualification is claimed for this counter correction.

## Validation

Typecheck passes all four configurations on the final code and regression.

| Command | Final result |
| --- | --- |
| `bun run typecheck` | All four configurations pass |
| `bun run test:integration` | 676 pass, 8 skip, 6 fail; 13,745 assertions; 415.76 seconds |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 43.55 seconds |

The official integration command includes the security suite.
The new regression also passes inside that command, in 2.25 seconds.
All six failures match the previously reproduced base failures by name and cause:

- The Wrangler OS-session check cannot launch `/bin/bash` on Windows (`ENOENT`).
- The boot test receives SIGTERM exit code 143 instead of 0.
- Four site-build checks fail at `.well-known/agent-skills/index.json` because of Windows path handling.

Integration is not green. These existing failures were not changed or hidden.
Eight integration skips require optional isolated cleanup-reconciliation setup.
The E2E skip requires the optional browser SDK setup through `PLAYWRIGHT_MODULE`; it was not run.
The owned local PostgreSQL instance was stopped after validation, with no other clients connected.

## llm_evidence

N/A: the affected database aggregation does not call a model.
Real-model calls: 0. Cost: 0. Runtime provider, model and request settings: N/A.
The test drives deterministic Network behavior with scripted member inputs.
It does not claim real-LLM qualification.

## agent_clients

Codex desktop 26.1103.3517.0 drove Bun 1.4.2 on Windows x64 with PostgreSQL 16.15.
Authoring provider: OpenAI. Exact authoring model identifier: unavailable.
No member agent flow changed.
Claude Code, Claude, ChatGPT member flows, Hermes Agent, OpenClaw, Muse, Grok bot, elizaOS and Cursor were not tested.
No browser or computer automation was used.

## Limits

The native flow proves that the existing writer can produce completed participations with absent enjoyment scores.
The partial and arriving scores are controlled SQL fixtures, not proof of the service's feedback collection or scoring lifecycle.
This patch does not infer new scores or change the native writer.
The four-app cases validate the existing aggregate in each app; they do not establish a new isolation guarantee.
HTTP state and member detail were tested. Browser rendering and WebSocket delivery were not separately exercised.
No UI, style, copy, dependency, schema or wire-shape change is included.
The results correct a missing-value error, not a production matching score or a prevalence estimate.
Maintainers decide whether the documented evidence limits meet the project requirements.

## Measurement program: `member-enjoyment-measure.test.ts`

```typescript
import { test, setSystemTime } from "bun:test";
import { SQL } from "bun";
import { pathToFileURL } from "node:url";
const root = process.cwd().replaceAll("\\", "/");
const mod = (p: string) => import(pathToFileURL(`${root}/${p}`).href);
const { Mini, START } = await mod("packages/network/test/mini.ts");
const { PgStore } = await mod("packages/network/src/store.ts");
const { createServer } = await mod("packages/observatory/src/server.ts");
const { testDb, dropTestDb } = await mod("packages/observatory/test/pg.ts");
const apps = ["ntwrk", "slop", "peon", "friends"];
const cohorts: [string, (number | null)[]][] = [["unrated", [null, null]], ["single", [0.75, null]], ["zero", [0, null]], ["mixed", [0.75, null, 0.25, null]], ["complete", [0.75, 0, 0.25]]];
const sample = (sum: number, n: number) => ({ sum, n, mean: n ? sum / n : null });
const hash = (x: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex");
test("paired member enjoyment samples through PostgreSQL and HTTP", async () => {
  const url = await testDb(), sql = new SQL(url), observations: any[] = [];
  let server: any;
  try {
    const w = new Mini([{ id: "native:a", name: "Alex Example", age: 30, interests: ["climbing"] }, { id: "native:b", name: "Blair Example", age: 32, interests: ["climbing"] }]);
    await w.onboard("native:a", "native:b");
    const nativeOpp = w.propose(["native:a", "native:b"]);
    await w.answerProbes(["native:a", "native:b"]);
    if (w.meetings.length !== 1 || !await w.runUntil(() => w.net.exportState().opps.find((o: any) => o.id === nativeOpp)?.stage === "done", 10 * 86_400_000)) throw Error("Native booking did not complete");
    for (const m of w.members) await sql`insert into network.members (id, name, home_city, age, account_status, joined_at) values (${m.id}, ${m.name}, 'nyc', ${m.age}, 'active', ${new Date(m.joinedAt)})`;
    await new PgStore(sql).save(w.net.exportState());
    setSystemTime(new Date(START + 15 * 86_400_000));
    const token = "enjoyment-measurement-synthetic-token";
    server = await createServer({ port: 0, development: false, mode: "real", platformEnv: "dev", token, staffRolesUrl: false, peopleUrl: false, audit: { url }, real: { url, service: false, pollMs: 3_600_000, pushMs: 3_600_000 } });
    const req = async (path: string, body?: unknown) => {
      const r = await fetch(server.url + path, { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) });
      if (!r.ok) throw Error(`HTTP ${r.status}: ${path}`);
      return r.json() as Promise<any>;
    };
    const snapshot = async (phase: string, selected: string[]) => {
      for (const app of selected) {
        if (!(await req(`/api/control?app=${app}`, { type: "refresh" })).ok) throw Error("Refresh failed");
        const s = await req(`/api/state?app=${app}`);
        if (s.env.error) throw Error(s.env.error);
        const rows = await sql`select p.member_id, p.role, p.status, p.enjoyment::text::float8 as enjoyment, o.id, o.state from network.participations p join network.opportunities o on o.app_id = p.app_id and o.id = p.opportunity_id where p.app_id = ${app} order by p.member_id, o.id`;
        const members = [];
        for (const m of [...s.members].sort((a: any, b: any) => a.id.localeCompare(b.id))) {
          const ratings = rows.filter((p: any) => p.member_id === m.id && p.role === "participant" && p.status === "attended" && ["COMPLETED", "FEEDBACK_COLLECTED"].includes(p.state) && p.enjoyment !== null).map((p: any) => p.enjoyment);
          const expected = sample(ratings.reduce((n: number, x: number) => n + x, 0), ratings.length);
          const d = await req(`/api/member/${encodeURIComponent(m.id)}?app=${app}`);
          const actual = sample(m.counters.enjoymentSum, m.counters.enjoymentN), detail = sample(d.member.counters.enjoymentSum, d.member.counters.enjoymentN);
          const { enjoymentN, ...otherCounters } = m.counters;
          members.push({ id: m.id, ratings, expected, actual, detail, otherCounters, wrongCount: actual.n !== expected.n, wrongMean: actual.mean !== expected.mean, falseZero: expected.mean === null && actual.mean === 0 });
        }
        const expectedGlobal = sample(members.reduce((n, m) => n + m.expected.sum, 0), members.reduce((n, m) => n + m.expected.n, 0));
        const actualGlobal = sample(s.stats.enjoymentSum, s.stats.enjoymentN);
        if (JSON.stringify(actualGlobal) !== JSON.stringify(expectedGlobal)) throw Error("Global control differs from stored ratings");
        observations.push({ app, phase, members, global: actualGlobal, databaseHash: hash(rows), statsHash: hash(s.stats) });
      }
    };
    await snapshot("native saved state", ["ntwrk"]);
    for (const app of apps) {
      for (const id of ["peer", ...cohorts.map(c => c[0])]) await sql`insert into network.members (app_id, id, name, home_city, age, account_status, joined_at) values (${app}, ${`${app}:${id}`}, 'Synthetic Member', 'nyc', 30, 'active', ${new Date(START)})`;
      for (const [cohort, values] of cohorts) {
        const controls = [{ role: "alternate", status: "attended", state: "COMPLETED" }, { role: "participant", status: "no_show", state: "COMPLETED" }, { role: "participant", status: "attended", state: "SCHEDULED" }, { role: "participant", status: "attended", state: "ABANDONED" }];
        const specs = [...values.map((rating, i) => ({ rating, role: "participant", status: "attended", state: i % 2 ? "FEEDBACK_COLLECTED" : "COMPLETED" })), ...controls.map(c => ({ ...c, rating: 1 }))];
        for (const [i, p] of specs.entries()) {
          const id = `${app}:${cohort}:${i}`;
          await sql`insert into network.opportunities (app_id, id, kind, state, source, city, objective, created_at, updated_at) values (${app}, ${id}, 'intro', ${p.state}, 'network', 'nyc', 'A synthetic meeting', ${new Date(START)}, ${new Date(START)})`;
          await sql`insert into network.participations (app_id, opportunity_id, member_id, role, status, enjoyment) values (${app}, ${id}, ${`${app}:${cohort}`}, ${p.role}, ${p.status}, ${p.rating}), (${app}, ${id}, ${`${app}:peer`}, 'participant', 'attended', null)`;
        }
      }
    }
    await snapshot("partial ratings", apps);
    for (const app of apps) {
      await sql`update network.participations set enjoyment = 0 where app_id = ${app} and member_id = ${`${app}:unrated`} and enjoyment is null`;
      await sql`update network.participations set enjoyment = 0.5 where app_id = ${app} and member_id = ${`${app}:mixed`} and enjoyment is null`;
    }
    await snapshot("ratings arrived", apps);
    await snapshot("unchanged", apps);
    await Bun.write(process.env.ENJOYMENT_OUTPUT!, JSON.stringify({ observations }, null, 2));
    console.log(JSON.stringify({ snapshots: observations.length, members: observations.flatMap(s => s.members).length, wrongCounts: observations.flatMap(s => s.members).filter(m => m.wrongCount).length, wrongMeans: observations.flatMap(s => s.members).filter(m => m.wrongMean).length, falseZeros: observations.flatMap(s => s.members).filter(m => m.falseZero).length }));
  } finally { await server?.stop(); setSystemTime(); await sql.close(); await dropTestDb(); }
}, 120_000);
```

## Comparator: `member-enjoyment-compare.ts`

```typescript
const before = await Bun.file("../member-enjoyment-before.json").json();
const after = await Bun.file("../member-enjoyment-after.json").json();
const summarize = (x: any) => {
  const members = x.observations.flatMap((s: any) => s.members);
  return { snapshots: x.observations.length, memberObservations: members.length,
    wrongCounts: members.filter((m: any) => m.wrongCount).length,
    wrongMeans: members.filter((m: any) => m.wrongMean).length,
    falseZeros: members.filter((m: any) => m.falseZero).length,
    wrongDetails: members.filter((m: any) => JSON.stringify(m.detail) !== JSON.stringify(m.expected)).length,
  };
};
const control = (x: any) => x.observations.map((s: any) => ({ ...s, members: s.members.map(({ actual, detail, wrongCount, wrongMean, falseZero, ...m }: any) => m) }));
if (JSON.stringify(control(before)) !== JSON.stringify(control(after))) throw Error("Database, expected samples, other counters or global stats changed");
const result = { before: summarize(before), after: summarize(after), controlsIdentical: true,
  phases: after.observations.map((s: any, i: number) => ({ app: s.app, phase: s.phase, before: before.observations[i].members.filter((m: any) => m.wrongCount).length, after: s.members.filter((m: any) => m.wrongCount).length })),
};
await Bun.write("../member-enjoyment-comparison.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (result.after.snapshots !== 13 || result.after.memberObservations !== 80 || result.after.wrongCounts || result.after.wrongMeans || result.after.falseZeros || result.after.wrongDetails) throw Error("Member enjoyment measurement failed");
```
