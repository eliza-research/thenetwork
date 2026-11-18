# Booked-plan receipt records

Date: 2026-11-08. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2, Windows, PostgreSQL 16.15.

## Requirement and defect

PRD 35.2 requires the member perspective and opportunity history.
PRD 35.3 requires one view model for the simulator and database.
`docs/observatory.md` section 3 defines `booked.told` as when the plan reached each member.
`BookedPlan` uses that timestamp for the displayed 48-hour opt-out window.

Both sources recorded unsuccessful booking messages as received.
The game projector copied `SimMeta.booked` without checking the channel result.
The database query selected every outbound proposal, including failed, refused, and waiting attempts.
An earlier failed attempt also displaced a later successful retry's timestamp through `min(ts)`.

The native reproduction uses `World`, `ConsentNetwork`, generated personas, and the actual seeded `SimChannel` failure option.
At seed 4 and failure rate 0.25, five of 15 booking messages failed.
All five appeared in the game's receipt records and the database API's receipt records on the base.
Their statuses came from the channel; the reproduction did not substitute a failed send implementation.

## Fix

Require `delivered` when game mode records a booking receipt.
In database mode, select the successful-send statuses used by `NetworkRuntime.deliver`:
`accepted`, `sent`, `delivered`, `read`, and the local `dry_run` status.
Apply that filter before finding the first successful message timestamp.

Other implementations considered:

1. Filter the display in the client. That leaves the API and other consumers with false receipt records.
2. Exclude only `failed`. That still credits queued, refused, collected, expired, and unknown attempts.
3. Require only `delivered` in the database. That discards successful provider acceptance and local dry-run records recognized by the service.

This changes the receipt projection. It does not change booking, sending, participant consent, or the Network's scheduling clock.
Message and invitation attempt counts retain their existing definitions.

## Measurement

Each revision ran the same measurement program below from its checkout root.
There were four complete ten-day worlds: 80 generated NYC personas per world, seeds 4 and 7, failure rates 0 and 0.25.
Seed 4 reproduced the defect. Seed 7 was held out until the paired qualification.
All runs used the simulated reviewer (`review: "auto"`) and the default simulator start.
The database/API measurement clock was fixed at `2026-11-01T12:00:00Z`.

Each world fed native records into `Projector`.
`PgStore.save` persisted its Network state and the unchanged booking-message records into isolated local PostgreSQL.
The measurement then read `/api/state` and `/api/opportunity/:id` through the actual Observatory server.
Controlled database retry rows additionally exercised seven unsuccessful and five successful statuses.
Those status transitions are database projection fixtures, not live provider tests.

| Measure | Base | Fix |
|---|---:|---:|
| Native booking messages | 77 | 77 |
| Native failed booking messages | 10 | 10 |
| Native failed messages shown as received in game mode | 10 | 0 |
| Incorrect receipt observations across 32 snapshots | 140 / 526 | 0 / 526 |
| Incorrect opportunity-detail receipt observations | 130 / 449 | 0 / 449 |
| Changed successful-only control observations | N/A | 0 / 92 |
| Channel records, stored-message rows, expected receipts, and compared counters | Baseline | Identical |

The snapshot counts include repeated observations during status transitions; they are not independent meeting samples.
The native sample is 77 messages across four worlds, with ten seeded failures.
This is a deterministic correctness comparison, not a matching-quality estimate.
The comparison checks SHA-256 hashes of the full channel records and selected stored-message columns.
It also compares game counters and API message, invitation, acceptance, decline, scheduling, attendance, and no-show counters.

One integration case contains the native seed-4 reproduction and the retry-status sequence.
Its final assertion compares all collected game, state, and detail receipt maps.
The same final test file fails on the clean base and passes after the fix:

```text
Before: 0 pass, 1 fail, 3 expect() calls; 3.23 seconds
After:  1 pass, 0 fail, 3 expect() calls; 3.85 seconds
```

Initial fixture setup exposed a too-short synthetic server token and a missing typed dataset label.
Both fixture errors were corrected before the final paired regression and validation.
There was one production-fix candidate, the status filter shown above.

## Validation and safety_gates

| Command | Result |
|---|---|
| `bun install --frozen-lockfile` | 50 installs checked across 44 packages; no changes |
| Focused integration case, final file on base | 0 pass, 1 fail; 3 assertions; 3.23 seconds |
| Focused integration case, fix | 1 pass, 0 fail; 3 assertions; 3.85 seconds |
| `bun run typecheck` | All four configurations passed |
| Paired measurement program | Base 15.60 seconds; fix 14.12 seconds; identical input hashes and counters |
| `bun run sim --only audit,ops --json <output>` | Both 30/30 blocking gates passed; zero tracked misses |
| `bun run test:integration` | 676 pass, 8 skip, 6 fail; 13,744 assertions; 415.84 seconds |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 34.17 seconds |

All 31 audit/operations gate records match after excluding elapsed-time fields and the backup timing label.
Base elapsed time was 23.5 seconds; the fix took 24.2 seconds.
The full simulation was not repeated: AGENTS.md permits one per agent, already used earlier in this contribution session.

The full integration command includes all files listed by `bun run security`.
The new regression passed there in 4.01 seconds.
All six failures match the previously reproduced base failures by test name and failure cause:
missing `/bin/bash` for Wrangler, SIGTERM exit 143 instead of 0, and four Windows site-path assertions.
The eight integration skips are optional reconciliation cases; the end-to-end skip needs the optional browser SDK.
A fully green integration suite is not claimed.

Live sends and deploy flags were disabled. No production database, messages, or provider were used.
The PostgreSQL cluster was local and dedicated to this task; tests used process-specific disposable databases.
No UI, styles, copy, dependencies, matching rules, or safety thresholds changed.

## llm_evidence

N/A: this changes deterministic receipt projection, not model behavior.
The native world used existing policy personas and the simulated reviewer.
Real model calls: 0. Model-call cost: $0. Request settings: N/A.
No real-model quality result is claimed.

## agent_clients

N/A: no member-facing agent flow changed.
Codex desktop 26.1103.3517.0 drove Bun and the local HTTP/PostgreSQL workflow.
No browser or computer use was performed. No other client is claimed as tested.
Provider: OpenAI. Exact assistant model identifier: unavailable to this session.

## Limits and reproduction

The database preserves the service's successful-send semantics.
Provider acceptance is not proof that a person read the message.
The timestamp remains the successful message row's `ts`, not a newly introduced provider-receipt timestamp.
Local `dry_run` records remain visible as simulated successful sends.
This work does not change how the Network schedules or cancels a booking after a failed reveal.

Run `bun test --conditions eliza-source packages/observatory/test/booked-delivery.integration.test.ts` with local PostgreSQL.
Expect one passing case. PostgreSQL availability is required to execute this case rather than skip it.

Save the following program outside the checkout as `booked-delivery-measure.test.ts`.
Run it from each checkout root with the same local PostgreSQL setup:

```powershell
$env:BOOKED_DELIVERY_OUTPUT = '../booked-delivery-before.json' # use -after.json for the fix
bun test --conditions eliza-source ../booked-delivery-measure.test.ts
```

Compare each configuration's channel hash, snapshot row hashes, counters, and expected maps.
For every opportunity/member pair, compare `actual` and `detail` timestamps with `expected`.
Missing timestamps must stay missing until a successful send exists.

```ts
import { test, setSystemTime } from "bun:test";
import { SQL } from "bun";
import { pathToFileURL } from "node:url";
const root = process.cwd().replaceAll("\\", "/");
const mod = (p: string) => import(pathToFileURL(`${root}/${p}`).href);
const { World, generatePersonas, DEFAULT_START } = await mod("packages/sim/src/index.ts");
const { ConsentNetwork, PgStore } = await mod("packages/network/src/index.ts");
const { Store, emptyCounters } = await mod("packages/observatory/src/store.ts");
const { Projector } = await mod("packages/observatory/src/projector.ts");
const { createServer } = await mod("packages/observatory/src/server.ts");
const { testDb, dropTestDb } = await mod("packages/observatory/test/pg.ts");
const HOUR = 3_600_000, DAY = 24 * HOUR;
const configs = [{ seed: 4, failureRate: 0.25 }, { seed: 4, failureRate: 0 }, { seed: 7, failureRate: 0.25 }, { seed: 7, failureRate: 0 }];
const hash = (x: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex");
const receipts = (opps: any[]) => Object.fromEntries(opps.filter(o => Object.keys(o.booked?.told ?? {}).length).map(o => [o.id, o.booked.told]));
test("paired booked-plan receipt measurements", async () => {
  const results = [];
  setSystemTime(new Date("2026-11-01T12:00:00Z"));
  try { for (const { seed, failureRate } of configs) {
    const url = await testDb(), sql = new SQL(url);
    let server: any;
    try {
      const start = DEFAULT_START, personas = generatePersonas({ n: 80, seed, joinSpreadDays: 7, cityWeights: { nyc: 1, sf: 0 } });
      const store = new Store({ mode: "game", label: "Synthetic delivery fixture", dataset: "generated", capabilities: { canStep: true, canIntervene: true, hiddenTruth: true, readOnly: false } },
        { now: start, start, end: start + 10 * DAY, day: 1, playing: false, speed: DAY, waitingForPlayer: false });
      for (const p of personas) store.upsertMember({ id: p.id, name: p.name, city: p.homeCity, state: "not_joined", joined: false, minor: p.public.claimedAge < 18, age: p.public.claimedAge, counters: emptyCounters() });
      const projector = new Projector(store), network = new ConsentNetwork({ seed, review: "auto" });
      const world = new World({ seed, personas, days: 10, start, failureRate, network, writeLog: false, onRecord: (r: any) => projector.apply(r) });
      await world.run();
      const reveals = world.channel.all().filter((m: any) => m.meta?.booked);
      const expected: Record<string, Record<string, number>> = {};
      for (const m of reveals) if (m.status === "delivered") {
        const told = expected[m.meta.booked.proposalId] ??= {};
        told[m.memberId] = Math.min(told[m.memberId] ?? Infinity, m.ts);
      }
      const observations: any[] = [{ phase: "world", actual: receipts([...store.opps.values()]), expected: structuredClone(expected), counters: store.counts }];
      for (const p of personas) await sql`insert into network.members (id, name, home_city, age, account_status, joined_at)
        values (${p.id}, ${p.name}, 'nyc', ${p.public.claimedAge}, 'active', ${new Date(start)})`;
      await new PgStore(sql).save(network.exportState(), async (tx: any) => {
        for (const m of reveals) await tx`insert into network.messages (id, member_id, direction, channel, body, status, type, opportunity_id, ts)
          values (${m.id}, ${m.memberId}, 'outbound', ${m.channel}, ${m.body}, ${m.status}, 'proposal', ${m.meta.booked.proposalId}, ${new Date(m.ts)})`;
      });
      const token = "booked-delivery-measurement-synthetic-token";
      server = await createServer({ port: 0, development: false, mode: "real", platformEnv: "dev", token, staffRolesUrl: false, peopleUrl: false, audit: { url }, real: { url, service: false, pollMs: HOUR, pushMs: HOUR } });
      const req = async (path: string, body?: any) => {
        const r = await fetch(server.url + path, { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) });
        if (!r.ok) throw Error(`HTTP ${r.status}: ${path}`);
        return r.json() as Promise<any>;
      };
      const snapshot = async (phase: string, wanted: typeof expected) => {
        if (!(await req("/api/control", { type: "refresh" })).ok) throw Error("Refresh failed");
        const state = await req("/api/state");
        if (state.env.error) throw Error(state.env.error);
        const details = await Promise.all([...new Set(reveals.map((m: any) => m.meta.booked.proposalId))].map(id => req(`/api/opportunity/${id}`)));
        const rows = await sql`select id, member_id, direction, status, type, opportunity_id, ts from network.messages order by id`;
        const counters = Object.fromEntries(["messages", "outbound", "invites", "accepts", "declines", "meetingsScheduled", "meetingsHeld", "attended", "noShows"].map(k => [k, state.stats[k]]));
        observations.push({ phase, actual: receipts(state.opportunities), detail: receipts(details.map((d: any) => d.opportunity)), expected: structuredClone(wanted), rowsHash: hash(rows), counters });
      };
      await snapshot("native", expected);
      const failed = reveals.find((m: any) => m.status === "failed");
      if (failed) {
        const opp = failed.meta.booked.proposalId, member = failed.memberId, retryAt = failed.ts + HOUR;
        await sql`insert into network.messages (id, member_id, direction, body, status, type, opportunity_id, ts)
          values ('retry', ${member}, 'outbound', 'Synthetic booked-plan retry', 'queued', 'proposal', ${opp}, ${new Date(retryAt)})`;
        for (const status of ["queued", "sending", "collected", "unknown", "failed", "refused_opted_out", "expired", "accepted", "sent", "delivered", "read", "dry_run"]) {
          await sql`update network.messages set status = ${status} where id = 'retry'`;
          const current = structuredClone(expected);
          if (["accepted", "sent", "delivered", "read", "dry_run"].includes(status)) (current[opp] ??= {})[member] = retryAt;
          await snapshot(status, current);
        }
      }
      results.push({ seed, failureRate, personas: personas.length, reveals: reveals.length, failed: reveals.filter((m: any) => m.status === "failed").length, channelHash: hash(world.channel.all()), observations });
    } finally { await server?.stop(); await sql.close(); await dropTestDb(); }
  } } finally { setSystemTime(); }
  await Bun.write(process.env.BOOKED_DELIVERY_OUTPUT!, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.map(({ observations, channelHash, ...r }) => ({ ...r, snapshots: observations.length }))));
}, 180_000);
```
