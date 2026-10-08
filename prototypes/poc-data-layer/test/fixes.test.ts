// Tests for the fixes in RESULTS.md "Fixes" (1-6). Postgres 16 throwaway cluster + PGlite.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startCluster, type Cluster } from "../src/cluster";
import { type Backend, type Db, pgBackend, pgConnect, pgliteBackend, pgliteOpen, schemaFingerprint, sqlstate } from "../src/db";
import { MockProvider, enqueueSend, handleSend, runSendWorkers, type CrashPoint, type SendPayload } from "../src/outbound";
import { engineFingerprint, syncProfile } from "../src/profile";
import { projectionDiff, projectionWorkload } from "../src/projections";
import { physicalErasure } from "../src/purge";
import { type City, exactSql, nearestMembers, type RetrievalLog } from "../src/retrieval";
import { simInsertMember, simInsertOpportunity } from "../src/sim";
import { deletionPropagation, resetSchema, seedVectors } from "../src/suite";

const HAS_PG = Bun.spawnSync(["test", "-x", `${process.env.PG_BIN ?? "/opt/homebrew/opt/postgresql@16/bin"}/initdb`]).exitCode === 0;
let cluster: Cluster, pg: Backend, pgAdmin: Db, lite: Backend & { db: Db };

beforeAll(async () => {
  lite = await pgliteBackend();
  await resetSchema(lite.db);
  if (HAS_PG) {
    cluster = startCluster(Number(process.env.PG_PORT ?? 54341));
    pg = pgBackend(cluster.url);
    pgAdmin = pgConnect(cluster.url);
    await resetSchema(pgAdmin);
  }
}, 60_000);
afterAll(async () => {
  await lite?.db.close();
  await pgAdmin?.close();
  cluster?.stop();
});

test("0001 + 0002 produce identical catalogs on PGlite and Postgres", async () => {
  if (!HAS_PG) return;
  expect(await schemaFingerprint(pgAdmin)).toEqual(await schemaFingerprint(lite.db));
});

// ------------------------------------------------------------------ 1 + 2. nearestMembers
async function recallRun(db: Db, n: number, queries: number, k = 50, forceAnn = false) {
  const qs = await db.q<{ v: string; city: City }>(
    "SELECT embedding::text AS v, city FROM network.facets ORDER BY md5(member_id::text) LIMIT $1", [queries]);
  const logs: RetrievalLog[] = [];
  const recalls: number[] = [], rows: number[] = [];
  for (const q of qs) {
    const truth = new Set((await db.q<{ member_id: string }>(exactSql(q.city, k), [q.v])).map((r) => r.member_id));
    const r = await nearestMembers(db, q.city, q.v, k, { forceAnn, log: (l) => logs.push(l) });
    rows.push(r.rows.length);
    recalls.push(r.rows.filter((x) => truth.has(x.member_id)).length / truth.size);
  }
  const first = await nearestMembers(db, qs[0]!.city, qs[0]!.v, k, { forceAnn, explain: true, log: () => {} });
  return { n, recall: recalls.reduce((a, x) => a + x, 0) / recalls.length, minRecall: Math.min(...recalls), minRows: Math.min(...rows),
    plans: [...new Set(logs.map((l) => l.plan))], explainIndex: first.explainIndex, city: qs[0]!.city };
}

describe("nearestMembers (postgres)", () => {
  test("5k clustered: k rows, recall >= 0.95 (planner's exact choice and steered ANN), EXPLAIN shows the plan", async () => {
    if (!HAS_PG) return;
    await seedVectors(pgAdmin, 5000, "clustered", 0.42, "per-city");
    const planner = await recallRun(pgAdmin, 5000, 50);
    expect(planner.minRows).toBe(50);
    expect(planner.recall).toBeGreaterThanOrEqual(0.95);
    expect(planner.explainIndex).toBe("seq scan"); // 2.5k rows per city: the planner rightly prefers exact
    const ann = await recallRun(pgAdmin, 5000, 50, 50, true);
    expect(ann.minRows).toBe(50);
    expect(ann.plans).toEqual(["ann"]);
    expect(ann.recall).toBeGreaterThanOrEqual(0.95);
    expect(ann.explainIndex).toBe(`facets_embedding_hnsw_${ann.city}`);
  }, 120_000);

  test("50k clustered: planner picks the per-city partial HNSW unsteered; k rows; recall >= 0.95", async () => {
    if (!HAS_PG) return;
    await seedVectors(pgAdmin, 50_000, "clustered", 0.42, "per-city");
    const r = await recallRun(pgAdmin, 50_000, 50);
    console.log("50k clustered nearestMembers", r);
    expect(r.explainIndex).toBe(`facets_embedding_hnsw_${r.city}`);
    expect(r.plans).toEqual(["ann"]);
    expect(r.minRows).toBe(50);
    expect(r.recall).toBeGreaterThanOrEqual(0.95);
  }, 300_000);

  test("plan survives statement caching: same text 12x keeps the partial index; a parameterised city cannot use it", async () => {
    if (!HAS_PG) return;
    const [{ v }] = await pgAdmin.q<{ v: string }>("SELECT embedding::text AS v FROM network.facets WHERE city = 'sf' LIMIT 1");
    const idx: (string | undefined)[] = [];
    for (let i = 0; i < 12; i++) idx.push((await nearestMembers(pgAdmin, "sf", v, 50, { explain: true, log: () => {} })).explainIndex);
    expect(new Set(idx)).toEqual(new Set(["facets_embedding_hnsw_sf"]));
    // The trap the literal city avoids: a generic plan with `city = $1` cannot prove the partial-index predicate.
    const generic = (await pgAdmin.q(`EXPLAIN (GENERIC_PLAN) SELECT member_id FROM network.facets WHERE city = $1
                                       ORDER BY embedding <=> $2::vector LIMIT 50`)).map((r: any) => Object.values(r)[0]).join("\n");
    expect(generic).not.toContain("facets_embedding_hnsw_sf");
  }, 60_000);

  test("asserts k rows: ANN under-return falls back to exact; fewer than k candidates returns all of them", async () => {
    if (!HAS_PG) return;
    await seedVectors(pgAdmin, 3000, "clustered", 0.42, "per-city");
    // One member with 300 facets right next to the query: the ANN window (2k rows) holds only that member.
    const [{ id, v }] = await pgAdmin.q<{ id: string; v: string }>("SELECT member_id::text AS id, embedding::text AS v FROM network.facets WHERE city = 'nyc' LIMIT 1");
    await pgAdmin.q(`INSERT INTO network.facets (member_id, city, kind, value, embedding)
                     SELECT $1, 'nyc', 'interest', 'dup', l2_normalize($2::vector + (SELECT array_agg(0.001 * (random() - 0.5)) FROM generate_series(1, 1536) WHERE g IS NOT NULL)::vector)
                       FROM generate_series(1, 300) g`, [id, v]);
    const logs: RetrievalLog[] = [];
    const r = await nearestMembers(pgAdmin, "nyc", v, 50, { forceAnn: true, log: (l) => logs.push(l) });
    expect(logs[0]!.annRows).toBeLessThan(50);
    expect(r.plan).toBe("exact-fallback");
    expect(r.rows.length).toBe(50);
    expect(new Set(r.rows.map((x) => x.member_id)).size).toBe(50);
    // A city with fewer than k candidates: returns all, no error.
    await pgAdmin.exec("DELETE FROM network.facets WHERE city = 'sf' AND member_id NOT IN (SELECT member_id FROM network.facets WHERE city = 'sf' ORDER BY member_id LIMIT 30)");
    const few = await nearestMembers(pgAdmin, "sf", v, 50, { log: () => {} });
    expect(few.rows.length).toBe(30);
  }, 120_000);
});

test("nearestMembers works on PGlite (2k clustered, per-city partial indexes)", async () => {
  const db = await pgliteOpen();
  try {
    await resetSchema(db);
    await seedVectors(db, 2000, "clustered", 0.42, "per-city");
    const ann = await recallRun(db, 2000, 20, 20, true);
    expect(ann.minRows).toBe(20);
    expect(ann.recall).toBeGreaterThanOrEqual(0.95);
    expect(ann.explainIndex).toBe(`facets_embedding_hnsw_${ann.city}`);
  } finally { await db.close(); }
}, 300_000);

// ------------------------------------------------------------------ 3. erasure: member_ids + physical purge
describe("erasure (postgres)", () => {
  test("erasure finds jobs through member_ids (GIN), not a LIKE scan of payload", async () => {
    if (!HAS_PG) return;
    await resetSchema(pgAdmin);
    await pgAdmin.q(`INSERT INTO network.jobs (type, payload, member_ids)
                     SELECT 'reminder', jsonb_build_object('member', m), ARRAY[m] FROM (SELECT gen_random_uuid() AS m FROM generate_series(1, 50000)) s`);
    await pgAdmin.exec("ANALYZE network.jobs");
    const [{ m }] = await pgAdmin.q<{ m: string }>("SELECT member_ids[1]::text AS m FROM network.jobs LIMIT 1");
    const plan = (await pgAdmin.q(`EXPLAIN ANALYZE UPDATE network.jobs SET payload = '{"redacted":true}', member_ids = array_remove(member_ids, $1::uuid)
                                   WHERE member_ids @> ARRAY[$1::uuid]`, [m])).map((r: any) => Object.values(r)[0]).join("\n");
    expect(plan).toContain("jobs_member_ids_gin");
    const r = await deletionPropagation(pgAdmin);
    expect(r.erased.jobs_redacted).toBe(1);
    expect(r.after).toEqual({ hits: {}, embeddings: 0 });
    expect(r.pass).toBe(true);
  }, 120_000);

  test("physical purge: embedding, name and id bytes are in relation files after erasure + VACUUM, and gone after the purge job", async () => {
    if (!HAS_PG) return;
    await resetSchema(pgAdmin);
    const r = await physicalErasure(pgAdmin, 2000);
    console.log("physical purge", JSON.stringify({ afterErase: r.afterErase.hits, afterPlainVacuum: r.afterPlainVacuum.hits,
      afterPurge: r.afterPurge.hits, walAfterPurge: Object.keys(r.afterPurge.walHits), purgeJob: r.purgeJob, purgeMs: r.purgeMs }));
    expect(r.afterErase.hits["facet:raw"]).toEqual(["toast of facets"]);
    expect(r.afterErase.hits["facet:normalized"]).toEqual(["facets_embedding_hnsw_sf"]);
    expect(Object.keys(r.afterPlainVacuum.hits).length).toBeGreaterThan(0); // plain VACUUM is not enough
    expect(r.afterPurge.hits).toEqual({});
    expect(r.purge.length).toBe(1);
    expect(r.purgeJob.idempotency_key).toMatch(/^physical_purge:\d{4}-\d{2}-\d{2}T03$/);
    expect(r.pass).toBe(true);
  }, 300_000);
});

test("PGlite erasure leaves 0 PII rows and 0 embeddings with the v2 erase_member", async () => {
  const r = await deletionPropagation(lite.db);
  expect(r.after).toEqual({ hits: {}, embeddings: 0 });
  expect(r.pass).toBe(true);
}, 60_000);

// ------------------------------------------------------------------ 4. PGlite error accumulation
test("PGlite: 5,000 expected duplicates through the sim helpers raise nothing and the instance stays healthy", async () => {
  const db = await pgliteOpen();
  try {
    await resetSchema(db);
    const a = (await simInsertMember(db, { name: "a", home_city: "sf" }))!, b = (await simInsertMember(db, { name: "b", home_city: "sf" }))!;
    const ids: (string | null)[] = [];
    for (let i = 0; i < 5000; i++) {
      ids.push(await simInsertOpportunity(db, { kind: "intro", city: "sf", objective: "x", objectiveHash: "h", participants: i % 2 ? [a, b] : [b, a] }));
      if (i % 100 === 0) await simInsertMember(db, { id: a, name: "dup", home_city: "sf" });
    }
    expect(ids.filter(Boolean).length).toBe(1);
    expect(ids.slice(1).every((x) => x === null)).toBe(true);
    expect((await db.q("SELECT count(*)::int AS n FROM network.opportunities"))[0].n).toBe(1);
    // The constraint is still enforced for code that does not use the helpers.
    const raw = await db.q(`INSERT INTO network.opportunities (kind, city, objective, objective_hash, participants)
                            VALUES ('intro', 'sf', 'x', 'h', ARRAY[$1, $2]::uuid[])`, [a, b]).then(() => "ok", (e) => sqlstate(e));
    expect(raw).toBe("23505");
    expect((await db.q("SELECT 1 AS ok"))[0].ok).toBe(1);
  } finally { await db.close(); }
}, 300_000);

// ------------------------------------------------------------------ 5a. projections rebuilt from events
for (const which of ["postgres", "pglite"] as const) {
  test(`${which}: projections rebuilt from >= 5,000 events equal the live tables (with deletes, cascades, erasures)`, async () => {
    if (which === "postgres" && !HAS_PG) return;
    const db = which === "postgres" ? pgAdmin : await pgliteOpen();
    try {
      await resetSchema(db);
      const w = await projectionWorkload(db, { minEvents: 5000, seed: 11 });
      console.log(`${which} projection workload`, JSON.stringify(w));
      expect(w.events).toBeGreaterThanOrEqual(5000);
      expect(w.ops["member.erase"]).toBeGreaterThan(0);
      expect(w.ops["opportunity.delete"]).toBeGreaterThan(0);
      const diff = await projectionDiff(db);
      expect(diff).toEqual([
        { projection: "members", only_live: 0, only_rebuilt: 0 },
        { projection: "opportunities", only_live: 0, only_rebuilt: 0 },
        { projection: "participations", only_live: 0, only_rebuilt: 0 },
      ]);
      const [{ n }] = await db.q<{ n: number }>("SELECT count(*)::int AS n FROM network.members");
      expect(n).toBeGreaterThan(100);
      // Negative control: a write that bypasses the triggers is detected.
      await db.tx(async (t) => {
        await t.exec("SET LOCAL session_replication_role = replica");
        await t.exec("UPDATE network.members SET name = 'tampered' WHERE id = (SELECT id FROM network.members LIMIT 1)");
      });
      expect((await projectionDiff(db)).find((d) => d.projection === "members")).toEqual({ projection: "members", only_live: 1, only_rebuilt: 1 });
    } finally { if (which === "pglite") await db.close(); }
  }, 300_000);
}

// ------------------------------------------------------------------ 5b. profile sync vs engine tables
for (const which of ["postgres", "pglite"] as const) {
  test(`${which}: profile sync leaves engine-learned tables unchanged, and cannot write them`, async () => {
    if (which === "postgres" && !HAS_PG) return;
    const db = which === "postgres" ? pgAdmin : lite.db;
    await resetSchema(db);
    const ids = (await db.q<{ id: string }>(`INSERT INTO network.members (name, home_city) SELECT 'm' || i, 'sf' FROM generate_series(1, 50) i
                                             RETURNING id::text AS id`)).map((r) => r.id);
    await db.q(`INSERT INTO network.engine_member_state (member_id, learned_embedding, affinity, response_rate)
                SELECT id, l2_normalize((SELECT array_agg(random()) FROM generate_series(1, 1536) WHERE id IS NOT NULL)::vector), '{"climbing":0.8}', 0.5
                  FROM network.members`);
    await db.q("INSERT INTO network.facets (member_id, city, kind, value, provenance) SELECT id, 'sf', 'interest', 'jazz', 'inferred' FROM network.members");
    await db.q("INSERT INTO network.intents (member_id, objective, category) SELECT id, 'meet founders', 'work' FROM network.members");
    await db.q("INSERT INTO network.edges (from_id, to_id, type) SELECT a.id, b.id, 'met' FROM network.members a JOIN network.members b ON a.id < b.id LIMIT 200");
    const before = await engineFingerprint(db);
    let changed = 0;
    for (let i = 0; i < 300; i++) {
      const r = await syncProfile(db, ids[i % ids.length]!, { name: `m${i % 50} v${Math.floor(i / 100)}`, email: `m${i}@example.com`,
        headline: `headline ${i}`, bio: "bio", links: [`https://example.com/${i}`], source: "linkedin", source_rev: `r${Math.floor(i / 50)}` });
      if (r.changed) changed++;
    }
    expect(changed).toBeGreaterThan(0);
    expect(await engineFingerprint(db)).toEqual(before);
    const [{ profiles }] = await db.q("SELECT count(*)::int AS profiles FROM network.profiles");
    expect(profiles).toBe(50);
    // A buggy sync that touches an engine table is rejected.
    const bad = await db.tx(async (t) => {
      await t.q("SELECT set_config('network.writer', 'profile_sync', true)");
      await t.q("UPDATE network.engine_member_state SET response_rate = 0 WHERE member_id = $1", [ids[0]]);
    }).then(() => "allowed", (e) => sqlstate(e));
    expect(bad).toBe("P0001");
    expect(await engineFingerprint(db)).toEqual(before);
  }, 120_000);
}

// ------------------------------------------------------------------ 6. outbound idempotency
async function seedSend(db: Db, n: number) {
  await db.exec("TRUNCATE network.jobs, network.outbound_messages");
  const [{ id: member }] = await db.q<{ id: string }>("INSERT INTO network.members (name, home_city, phone) VALUES ('r', 'sf', '+14155550111') RETURNING id::text AS id");
  const msgs: SendPayload[] = Array.from({ length: n }, (_, i) => ({ idempotency_key: `opp:${i}:invite:${member}:v1`, member_id: member,
    channel: "imessage", to: "+14155550111", body: `invite ${i}` }));
  for (const m of msgs) { await enqueueSend(db, m); await enqueueSend(db, m); } // producers may enqueue twice
  return msgs;
}
const sendCounts = async (db: Db) => (await db.q(`SELECT (SELECT count(*)::int FROM network.outbound_messages) AS rows,
    (SELECT count(*)::int FROM network.outbound_messages WHERE status = 'sent') AS sent,
    (SELECT count(*)::int FROM network.jobs WHERE type = 'send_message') AS jobs,
    (SELECT count(*)::int FROM network.jobs WHERE type = 'send_message' AND status = 'done') AS done`))[0];

for (const which of ["postgres", "pglite"] as const) {
  describe(`${which}: outbound`, () => {
    const b = () => (which === "postgres" ? pg : lite);
    const db = () => (which === "postgres" ? pgAdmin : lite.db);
    const skip = which === "postgres" && !HAS_PG;

    for (const at of ["after-row", "after-sending-mark", "after-provider", "after-sent-mark"] as CrashPoint[]) {
      test(`job crashes ${at}, is reclaimed and retried: 1 row, 1 provider send call`, async () => {
        if (skip) return;
        await seedSend(db(), 1);
        const provider = new MockProvider();
        const s = await runSendWorkers(b(), provider, { workers: 1, leaseMs: 100, crashRate: 0, seed: 1,
          crash: (_id, attempt) => (attempt === 1 ? at : undefined) });
        expect(s.crashes).toEqual({ [at]: 1 });
        expect(await sendCounts(db())).toEqual({ rows: 1, sent: 1, jobs: 1, done: 1 });
        expect(provider.sendCalls).toBe(1);
        expect(provider.delivered.size).toBe(1);
      }, 30_000);
    }

    test("1,000 sends, 8 workers, 5% crashes at random points: rows = deliveries = provider send calls = 1,000", async () => {
      if (skip) return;
      await seedSend(db(), 1000);
      const provider = new MockProvider();
      const s = await runSendWorkers(b(), provider, { workers: 8, leaseMs: 150, crashRate: 0.05, seed: 3 });
      console.log(`${which} outbound`, JSON.stringify({ ...s, sendCalls: provider.sendCalls, lookups: provider.lookupCalls, replays: provider.replays }));
      expect(Object.values(s.crashes).reduce((a, x) => a + x, 0)).toBeGreaterThan(20);
      expect(await sendCounts(db())).toEqual({ rows: 1000, sent: 1000, jobs: 1000, done: 1000 });
      expect(provider.delivered.size).toBe(1000);
      expect(provider.sendCalls).toBe(1000);
    }, 120_000);

    test("zombie worker (lease expired mid-send): provider idempotency key keeps it to one delivery", async () => {
      if (skip) return;
      const [m] = await seedSend(db(), 1);
      const provider = new MockProvider();
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const slow = Object.assign(Object.create(provider), {
        send: async (x: any) => { await gate; return provider.send(x); }, lookup: (k: string) => provider.lookup(k) });
      const zombie = handleSend(db(), m!, slow);           // marks 'sending', then stalls inside the provider call
      await new Promise((r) => setTimeout(r, 50));
      const retry = await handleSend(db(), m!, provider);  // the reclaimed retry: lookup finds nothing yet, sends
      release();
      await zombie;
      expect(retry).toBe("sent");
      expect((await sendCounts(db())).rows).toBe(1);
      expect(provider.delivered.size).toBe(1);
      expect(provider.sendCalls).toBe(2);                   // residual: one extra call, absorbed by the provider key
      expect(provider.replays).toBe(1);
    }, 30_000);
  });
}
