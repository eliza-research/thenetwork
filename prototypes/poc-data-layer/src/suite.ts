// P02 data-layer experiments. Each takes a Backend so the same code runs on Postgres and PGlite.
import { type Backend, type Db, migrate, sqlstate } from "./db";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};
/** Postgres array literal (Bun.SQL's unsafe() does not serialise JS arrays). */
export const pgArray = (xs: string[]) => `{${xs.map((x) => `"${x.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;
export const r2 = (x: number) => Math.round(x * 100) / 100;

export async function resetSchema(db: Db) {
  await db.exec("DROP SCHEMA IF EXISTS network CASCADE");
  return migrate(db);
}

// ---------------------------------------------------------------- 2. job leasing
export const CLAIM = `
WITH c AS (
  SELECT id FROM network.jobs WHERE status = 'pending' AND due_at <= now()
   ORDER BY due_at, id LIMIT $2 FOR UPDATE SKIP LOCKED)
UPDATE network.jobs j SET status = 'running', lease_owner = $1, lease_token = gen_random_uuid(),
       lease_expires_at = now() + make_interval(secs => $3::float8 / 1000), attempts = j.attempts + 1
  FROM c WHERE j.id = c.id RETURNING j.id::int AS id, j.lease_token::text AS token`;
// Reaper: expired leases go back to pending with the fencing token cleared.
export const REAP = `
UPDATE network.jobs SET status = 'pending', lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
 WHERE id IN (SELECT id FROM network.jobs WHERE status = 'running' AND lease_expires_at < now()
               FOR UPDATE SKIP LOCKED) RETURNING id`;
// Completion is fenced by the lease token: a worker whose lease was reaped cannot complete.
export const COMPLETE = `
UPDATE network.jobs SET status = 'done', completed_at = now(), completed_by = $3, lease_token = NULL, lease_expires_at = NULL
 WHERE id = $1 AND lease_token = $2::uuid AND status = 'running' RETURNING id`;

export interface JobOpts { jobs: number; workers: number; batch: number; leaseMs: number; crashRate: number; zombieRate: number; seed: number }

export async function jobLeasing(b: Backend, o: JobOpts) {
  const admin = await b.connect();
  await admin.exec("TRUNCATE network.jobs, network.job_effects RESTART IDENTITY");
  await admin.q(`INSERT INTO network.jobs (type, payload, idempotency_key)
                 SELECT 'noop', jsonb_build_object('i', i), 'job-' || i FROM generate_series(1, $1::int) i`, [o.jobs]);
  const s = { executions: 0, completed: 0, crashes: 0, zombies: 0, fenced: 0, reaped: 0, reconnects: 0 };
  const t0 = performance.now();
  await Promise.all(Array.from({ length: o.workers }, async (_, w) => {
    const name = `w${w}`, rand = rng(o.seed * 100 + w);
    let db = await b.connect();
    for (;;) {
      const claimed = await db.q<{ id: number; token: string }>(CLAIM, [name, o.batch, o.leaseMs]);
      if (!claimed.length) {
        s.reaped += (await db.q(REAP)).length;
        const [{ n }] = await db.q<{ n: number }>("SELECT count(*)::int AS n FROM network.jobs WHERE status <> 'done'");
        if (!n) break;
        await sleep(20);
        continue;
      }
      for (const j of claimed) {
        s.executions++;
        const r = rand();
        if (r < o.crashRate) {       // crash: drop the connection, abandon this and the rest of the batch
          s.crashes++;
          if (b.concurrent) { await db.close(); db = await b.connect(); s.reconnects++; }
          break;
        }
        if (r < o.crashRate + o.zombieRate) { s.zombies++; await sleep(o.leaseMs * 1.5); s.reaped += (await db.q(REAP)).length; }
        const ok = await db.tx(async (t) => {
          if (!(await t.q(COMPLETE, [j.id, j.token, name])).length) return false;
          await t.q("INSERT INTO network.job_effects (job_id, worker) VALUES ($1, $2)", [j.id, name]);
          return true;
        });
        ok ? s.completed++ : s.fenced++;
      }
    }
    if (b.concurrent) await db.close();
  }));
  const secs = (performance.now() - t0) / 1000;
  const [v] = await admin.q(`SELECT
      (SELECT count(*)::int FROM network.jobs WHERE status = 'done') AS done,
      (SELECT count(*)::int FROM network.job_effects) AS effects,
      (SELECT count(DISTINCT job_id)::int FROM network.job_effects) AS distinct_jobs,
      (SELECT coalesce(max(c), 0)::int FROM (SELECT count(*) c FROM network.job_effects GROUP BY job_id) x) AS max_per_job,
      (SELECT count(*)::int FROM network.jobs WHERE attempts > 1) AS reclaimed,
      (SELECT count(DISTINCT completed_by)::int FROM network.jobs) AS workers_used`);
  if (b.concurrent) await admin.close();
  const exactlyOnce = v.done === o.jobs && v.effects === o.jobs && v.distinct_jobs === o.jobs && v.max_per_job === 1;
  return { ...o, ...s, ...v, secs: r2(secs), jobsPerSec: Math.round(o.jobs / secs), exactlyOnce };
}

// ---------------------------------------------------------------- 3. unique active opportunity
export async function uniqueOpportunity(b: Backend, rounds = 200, racers = 8) {
  const conns: Db[] = b.concurrent ? await Promise.all(Array.from({ length: racers }, () => b.connect())) : Array(racers).fill(await b.connect());
  const insert = (db: Db, ids: string[], hash: string, state = "PROPOSED") =>
    db.tx(async (t) => {
      await t.q(`INSERT INTO network.opportunities (kind, city, objective, objective_hash, participants, state)
                 VALUES ('intro', 'sf', 'test', $1, $2::uuid[], $3)`, [hash, pgArray(ids), state]);
      await t.q("SELECT pg_sleep(0.005)"); // hold the uncommitted row so racers genuinely overlap
    }).then(() => "ok", (e) => sqlstate(e) ?? String(e));
  let perfectRounds = 0, wins = 0, dupRejects = 0, otherErrors = 0;
  for (let r = 0; r < rounds; r++) {
    const ids = Array.from({ length: 2 + (r % 3) }, () => crypto.randomUUID());
    const res = await Promise.all(conns.map((c, i) => insert(c, i % 2 ? [...ids].reverse() : ids, `obj-${r}`)));
    const ok = res.filter((x) => x === "ok").length, dup = res.filter((x) => x === "23505").length;
    wins += ok; dupRejects += dup; otherErrors += racers - ok - dup;
    if (ok === 1 && dup === racers - 1) perfectRounds++;
  }
  // Semantics: terminal state frees the slot; another objective is independent; reordering is still a duplicate.
  const db = conns[0]!, ids = [crypto.randomUUID(), crypto.randomUUID()];
  const checks = {
    first: await insert(db, ids, "h1"),
    reorderedDuplicate: await insert(db, [...ids].reverse(), "h1"),
    otherObjective: await insert(db, ids, "h2"),
    afterDecline: await (async () => {
      await db.q("UPDATE network.opportunities SET state = 'DECLINED' WHERE objective_hash = 'h1'");
      return insert(db, ids, "h1");
    })(),
    terminalDuplicatesAllowed: await insert(db, ids, "h3", "EXPIRED").then(() => insert(db, ids, "h3", "EXPIRED")),
  };
  const semanticsOk = checks.first === "ok" && checks.reorderedDuplicate === "23505" && checks.otherObjective === "ok"
    && checks.afterDecline === "ok" && checks.terminalDuplicatesAllowed === "ok";
  if (b.concurrent) await Promise.all(conns.map((c) => c.close()));
  return { rounds, racers, perfectRounds, wins, dupRejects, otherErrors, checks, pass: perfectRounds === rounds && semanticsOk };
}

// ---------------------------------------------------------------- 4. advisory-lock exclusivity
const tryRun = (db: Db, city: string, runner: string, holdMs: number) =>
  db.tx(async (t) => {
    const [{ ok }] = await t.q<{ ok: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtext('network.matching'), hashtext($1)) AS ok", [city]);
    if (!ok) return false;
    const [{ id }] = await t.q<{ id: string }>("INSERT INTO network.matching_runs (city, runner) VALUES ($1, $2) RETURNING id", [city, runner]);
    await t.q("SELECT pg_sleep($1::float8)", [holdMs / 1000]);
    await t.q("UPDATE network.matching_runs SET finished_at = clock_timestamp() WHERE id = $1", [id]);
    return true;
  });

export async function advisoryLock(b: Backend, rounds = 100, holdMs = 20) {
  const [a, c, n]: Db[] = b.concurrent ? await Promise.all([b.connect(), b.connect(), b.connect()]) : Array(3).fill(await b.connect());
  await a.exec("TRUNCATE network.matching_runs");
  let exclusiveRounds = 0, otherCityProceeded = 0;
  for (let r = 0; r < rounds; r++) {
    const [x, y, z] = await Promise.all([tryRun(a, "sf", "A", holdMs), tryRun(c, "sf", "B", holdMs), tryRun(n, "nyc", "C", holdMs)]);
    if (Number(x) + Number(y) === 1) exclusiveRounds++;
    if (z) otherCityProceeded++;
  }
  const [{ overlaps }] = await a.q<{ overlaps: number }>(`SELECT count(*)::int AS overlaps FROM network.matching_runs p
      JOIN network.matching_runs q ON p.city = q.city AND p.id < q.id
       AND p.started_at < q.finished_at AND q.started_at < p.finished_at`);
  // Crash while holding the lock: kill the holder's backend; the lock must be released.
  let releasedOnCrash: boolean | null = null;
  if (b.concurrent) {
    const holder = tryRun(a, "sf", "crasher", 5000).catch(() => "killed");
    await sleep(100);
    const blockedWhileHeld = !(await tryRun(c, "sf", "B", 1));
    await n.q(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
               WHERE pid <> pg_backend_pid() AND query LIKE 'SELECT pg_sleep%'`);
    const killed = await holder;
    releasedOnCrash = blockedWhileHeld && killed === "killed" && (await tryRun(c, "sf", "B", 1));
    await Promise.all([a.close().catch(() => {}), c.close(), n.close()]);
  }
  return { rounds, exclusiveRounds, otherCityProceeded, overlaps, releasedOnCrash,
    pass: exclusiveRounds === rounds && otherCityProceeded === rounds && overlaps === 0 && releasedOnCrash !== false };
}

// ---------------------------------------------------------------- 5. pgvector HNSW retrieval
/** HNSW layout for seedVectors: one global index (the original PoC), per-city partial indexes (fix 2), or none. */
export type VectorIndex = "global" | "per-city" | "none";
export const DROP_FACET_HNSW = "DROP INDEX IF EXISTS network.facets_embedding_hnsw, network.facets_embedding_hnsw_sf, network.facets_embedding_hnsw_nyc";
export const CREATE_FACET_HNSW: Record<VectorIndex, string> = {
  global: "CREATE INDEX facets_embedding_hnsw ON network.facets USING hnsw (embedding vector_cosine_ops)",
  "per-city": `CREATE INDEX facets_embedding_hnsw_sf ON network.facets USING hnsw (embedding vector_cosine_ops) WHERE city = 'sf';
               CREATE INDEX facets_embedding_hnsw_nyc ON network.facets USING hnsw (embedding vector_cosine_ops) WHERE city = 'nyc'`,
  none: "SELECT 1",
};

export async function seedVectors(db: Db, members: number, dist: "uniform" | "clustered", seed = 0.42, index: VectorIndex = "global") {
  await db.exec(`TRUNCATE network.members CASCADE; ${DROP_FACET_HNSW}`);
  await db.q("SELECT setseed($1::float8)", [seed]);
  await db.q(`INSERT INTO network.members (name, home_city)
              SELECT 'synthetic ' || i, CASE WHEN random() < 0.5 THEN 'sf' ELSE 'nyc' END FROM generate_series(1, $1::int) i`, [members]);
  const t0 = performance.now();
  if (dist === "uniform") {
    await db.exec(`INSERT INTO network.facets (member_id, city, kind, value, embedding)
      SELECT m.id, m.home_city, 'interest', 'synthetic',
             l2_normalize((SELECT array_agg(random() - 0.5) FROM generate_series(1, 1536) WHERE m.id IS NOT NULL)::vector)
        FROM network.members m`);
  } else { // 200 topical clusters plus noise: closer to real embeddings than uniform noise
    // centroid + 0.6 * U(-0.5, 0.5) per dimension, as before, but with pgvector's vector + vector (about 15x faster
    // than subscripting a float array 1536 times per row).
    await db.exec(`CREATE TEMP TABLE centroids AS SELECT c, (SELECT array_agg(random() - 0.5) FROM generate_series(1, 1536) WHERE c IS NOT NULL)::vector AS v
                     FROM generate_series(0, 199) c;
      INSERT INTO network.facets (member_id, city, kind, value, embedding)
      SELECT m.id, m.home_city, 'interest', 'synthetic',
             l2_normalize(ce.v + (SELECT array_agg(0.6 * (random() - 0.5)) FROM generate_series(1, 1536) WHERE m.id IS NOT NULL)::vector)
        FROM network.members m JOIN centroids ce ON ce.c = abs(hashtext(m.id::text)) % 200;
      DROP TABLE centroids`);
  }
  const loadSecs = (performance.now() - t0) / 1000;
  const t1 = performance.now();
  await db.exec(`${CREATE_FACET_HNSW[index]}; ANALYZE network.facets`);
  return { loadSecs: r2(loadSecs), indexSecs: r2((performance.now() - t1) / 1000) };
}

const KNN = "SELECT member_id::text AS id FROM network.facets WHERE city = $1 ORDER BY embedding <=> $2::vector LIMIT 50";

export async function vectorBench(db: Db, members: number, dist: "uniform" | "clustered", queries = 100) {
  const build = await seedVectors(db, members, dist);
  const qs = await db.q<{ v: string; city: string }>(
    "SELECT embedding::text AS v, CASE WHEN random() < 0.5 THEN 'sf' ELSE 'nyc' END AS city FROM network.facets ORDER BY random() LIMIT $1", [queries]);
  let cfgNo = 0;
  const run = async (setup: string) => {
    await db.exec(`RESET ALL; ${setup}`);
    // Distinct text per config: Bun.SQL caches prepared statements, and a cached generic plan ignores later SET enable_*.
    const sql = `${KNN} /* cfg ${cfgNo++} */`;
    for (const q of qs.slice(0, 5)) await db.q(sql, [q.city, q.v]); // warm-up
    const lat: number[] = [], res: string[][] = [];
    for (const q of qs) {
      const t = performance.now();
      res.push((await db.q<{ id: string }>(sql, [q.city, q.v])).map((r) => r.id));
      lat.push(performance.now() - t);
    }
    const plan = (await db.q(`EXPLAIN ${KNN.replace("$1", "'sf'").replace("$2::vector", `'${qs[0]!.v}'::vector`)}`))
      .map((r: any) => Object.values(r)[0]).join(" ");
    return { lat, res, usesHnsw: plan.includes("facets_embedding_hnsw") };
  };
  const exact = await run("SET enable_indexscan = off;");
  const force = "SET enable_sort = off;"; // steer the planner to the HNSW path (it prefers city btree + sort on small tables)
  const configs: Record<string, string> = {
    "planner default (pgvector defaults)": "",
    "hnsw default (ef_search=40, no iterative)": force,
    "hnsw ef_search=100 iterative": `${force} SET hnsw.ef_search = 100; SET hnsw.iterative_scan = relaxed_order;`,
    "hnsw ef_search=200 iterative": `${force} SET hnsw.ef_search = 200; SET hnsw.iterative_scan = relaxed_order;`,
    "hnsw ef_search=400 iterative": `${force} SET hnsw.ef_search = 400; SET hnsw.iterative_scan = relaxed_order;`,
  };
  const rows = [{ config: "exact scan", p50: r2(pct(exact.lat, 50)), p95: r2(pct(exact.lat, 95)), recall: 1, avgRows: 50, usesHnsw: exact.usesHnsw }];
  for (const [config, setup] of Object.entries(configs)) {
    const r = await run(setup);
    const recall = r.res.reduce((acc, ids, i) => {
      const truth = new Set(exact.res[i]);
      return acc + ids.filter((id) => truth.has(id)).length / truth.size;
    }, 0) / qs.length;
    rows.push({ config, p50: r2(pct(r.lat, 50)), p95: r2(pct(r.lat, 95)), recall: r2(recall),
      avgRows: r2(r.res.reduce((a, x) => a + x.length, 0) / qs.length), usesHnsw: r.usesHnsw });
  }
  await db.exec("RESET ALL");
  return { members, dist, queries, ...build, rows };
}

// ---------------------------------------------------------------- 6. deletion propagation
export async function deletionPropagation(db: Db, opts: { physical?: boolean } = {}) {
  await db.exec("TRUNCATE network.members, network.opportunities, network.jobs, network.job_effects CASCADE");
  const token = `Zelda${Math.floor(Math.random() * 1e9)}`;
  const pii = { name: `${token} Erasable`, phone: "+14155550199", email: `${token.toLowerCase()}@example.com` };
  const vec = (k: number) => `[${Array.from({ length: 1536 }, (_, i) => Math.sin(i * 0.37 + k)).join(",")}]`;
  const [{ id: t }] = await db.q<{ id: string }>(
    "INSERT INTO network.members (name, phone, email, home_city) VALUES ($1, $2, $3, 'sf') RETURNING id::text AS id", [pii.name, pii.phone, pii.email]);
  const others = (await db.q<{ id: string }>(`INSERT INTO network.members (name, home_city, invited_by)
      SELECT 'other ' || i, 'sf', $1::uuid FROM generate_series(1, 20) i RETURNING id::text AS id`, [t])).map((r) => r.id);
  const [o1, o2] = others as [string, string];
  await db.q(`INSERT INTO network.facets (member_id, city, kind, value, embedding) VALUES
      ($1, 'sf', 'interest', 'climbing at Dogpatch Boulders', $2::vector), ($1, 'sf', 'fact', $3, $4::vector),
      ($5, 'sf', 'interest', 'jazz', $6::vector)`, [t, vec(1), `works with ${pii.email}`, vec(2), o1, vec(3)]);
  await db.q("INSERT INTO network.intents (member_id, objective, category, embedding) VALUES ($1, 'find a climbing partner', 'hobby', $2::vector)", [t, vec(4)]);
  await db.q("INSERT INTO network.edges (from_id, to_id, type, evidence) VALUES ($1, $2, 'met', 'coffee'), ($2, $1, 'enjoyed', 'great chat'), ($2, $3, 'knows', null)", [t, o1, o2]);
  const [{ id: opp }] = await db.q<{ id: string }>(`INSERT INTO network.opportunities (kind, city, objective, objective_hash, participants)
      VALUES ('intro', 'sf', $1, 'h', ARRAY[$2, $3]::uuid[]) RETURNING id::text AS id`, [`${pii.name} x other 1: climbing`, t, o1]);
  await db.q("INSERT INTO network.participations (opportunity_id, member_id) VALUES ($1, $2), ($1, $3)", [opp, t, o1]);
  await db.q(`INSERT INTO network.outbound_messages (member_id, channel, to_address, body, mentions, idempotency_key) VALUES
      ($1, 'imessage', $2, 'Hi! Want to meet someone who climbs?', '{}', $5 || '-1'),
      ($3, 'imessage', '+14155550100', $4, ARRAY[$1]::uuid[], $5 || '-2'),
      ($3, 'imessage', '+14155550100', 'unrelated message', '{}', $5 || '-3')`, [t, pii.phone, o1, `Meet ${pii.name}, they climb too`, crypto.randomUUID()]);
  await db.q("INSERT INTO network.profiles (member_id, headline, bio, source, source_rev) VALUES ($1, $2, 'climber', 'linkedin', 'r1')", [t, `${pii.name}, engineer`]);
  await db.q("INSERT INTO network.engine_member_state (member_id, learned_embedding) VALUES ($1, $2::vector)", [t, vec(5)]);
  await db.q(`INSERT INTO network.events (actor_type, actor_id, type, subject_ids, payload) VALUES
      ('member', $1, 'member.joined', ARRAY[$1]::uuid[], jsonb_build_object('name', $3::text, 'phone', $4::text)),
      ('engine', NULL, 'opportunity.proposed', ARRAY[$1, $2]::uuid[], jsonb_build_object('note', $3::text)),
      ('member', $2, 'member.joined', ARRAY[$2]::uuid[], '{}')`, [t, o1, pii.name, pii.phone]);
  await db.q(`INSERT INTO network.jobs (type, payload, member_ids) VALUES ('reminder', jsonb_build_object('member', $1::text), ARRAY[$1]::uuid[]),
      ('reminder', jsonb_build_object('member', $2::text), ARRAY[$2]::uuid[])`, [t, o1]);

  const tables = (await db.q<{ t: string }>(`SELECT table_name AS t FROM information_schema.tables
      WHERE table_schema = 'network' AND table_type = 'BASE TABLE' AND table_name <> 'erasure_log' ORDER BY 1`)).map((r) => r.t);
  const vecCols = await db.q<{ t: string; c: string }>(`SELECT table_name AS t, column_name AS c FROM information_schema.columns
      WHERE table_schema = 'network' AND udt_name = 'vector'`);
  const targetVecs = [vec(1), vec(2), vec(4), vec(5)];
  const needles = [t, pii.name, pii.phone, pii.email, token].map((x) => `%${x}%`);
  const scan = async () => {
    const hits: Record<string, number> = {};
    for (const tb of tables) {
      const [{ n }] = await db.q<{ n: number }>(`SELECT count(*)::int AS n FROM network.${tb} x WHERE x::text ILIKE ANY ($1::text[])`, [pgArray(needles)]);
      if (n) hits[tb] = n;
    }
    let embeddings = 0;
    for (const { t: tb, c } of vecCols) {
      const [{ n }] = await db.q<{ n: number }>(`SELECT count(*)::int AS n FROM network.${tb} WHERE ${c} = ANY ($1::vector[])`, [pgArray(targetVecs)]);
      embeddings += n;
    }
    return { hits, embeddings };
  };
  const before = await scan();
  const counts = (await db.q("SELECT network.erase_member($1::uuid) AS c", [t]))[0].c;
  const after = await scan();
  const [survivors] = await db.q(`SELECT (SELECT count(*)::int FROM network.members) AS members,
      (SELECT count(*)::int FROM network.facets) AS facets, (SELECT count(*)::int FROM network.edges) AS edges,
      (SELECT count(*)::int FROM network.erasure_log) AS erasure_log`);
  const appendOnly = await db.q("DELETE FROM network.events").then(() => "allowed", (e) => sqlstate(e));
  const appendOnlyUpd = await db.q("UPDATE network.events SET type = 'x'").then(() => "allowed", (e) => sqlstate(e));
  const physical = opts.physical ? await physicalResidue(db, token, targetVecs) : null;
  const pass = Object.keys(before.hits).length > 0 && before.embeddings === 4 && Object.keys(after.hits).length === 0
    && after.embeddings === 0 && survivors.members === 20 && survivors.facets === 1 && survivors.edges === 1
    && appendOnly === "P0001" && appendOnlyUpd === "P0001";
  return { tablesScanned: tables.length, before, erased: counts, after, survivors, appendOnly: { delete: appendOnly, update: appendOnlyUpd }, physical, pass };
}

/** Postgres only: are the deleted bytes still present in relation files (heap, TOAST, HNSW) after DELETE / VACUUM / VACUUM FULL? */
async function physicalResidue(db: Db, token: string, vecs: string[]) {
  const [{ dir }] = await db.q<{ dir: string }>("SELECT current_setting('data_directory') AS dir");
  const f = new Float32Array(JSON.parse(vecs[0]!));
  const norm = Math.sqrt(f.reduce((a, x) => a + x * x, 0)); // HNSW cosine opclass stores the L2-normalised copy
  const needles = { name: Buffer.from(token), embedding: Buffer.from(f.slice(0, 16).buffer),
    normalizedEmbedding: Buffer.from(new Float32Array(f.slice(0, 16).map((x) => x / norm)).buffer) };
  const files = async () => (await db.q<{ rel: string; path: string }>(`SELECT rel, pg_relation_filepath(rel) AS path FROM (VALUES
      ('network.members'), ('network.facets'), ('network.facets_embedding_hnsw_sf'), ('network.events'), ('network.outbound_messages')) v(rel)
      UNION ALL SELECT 'facets toast', pg_relation_filepath(reltoastrelid) FROM pg_class WHERE oid = 'network.facets'::regclass`));
  const probe = async () => {
    await db.exec("CHECKPOINT");
    const found: string[] = [];
    for (const f of await files()) {
      const buf = Buffer.from(await Bun.file(`${dir}/${f.path}`).arrayBuffer());
      for (const [k, n] of Object.entries(needles)) if (buf.includes(n)) found.push(`${f.rel}:${k}`);
    }
    return found;
  };
  const afterDelete = await probe();
  await db.exec("VACUUM network.members, network.facets, network.events, network.outbound_messages");
  const afterVacuum = await probe();
  await db.exec("VACUUM FULL network.members, network.facets, network.events, network.outbound_messages");
  const afterVacuumFull = await probe();
  return { afterDelete, afterVacuum, afterVacuumFull };
}
