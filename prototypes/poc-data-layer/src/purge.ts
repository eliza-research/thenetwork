// Fix 3: physical purge after erasure, and a byte scan of the data directory to prove it.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { COMPLETE } from "./suite";
import type { Db } from "./db";

/**
 * Run due `physical_purge` jobs (enqueued by network.erase_member for the next 03:00 UTC window).
 * VACUUM (FULL, ANALYZE) rewrites each table, its TOAST table and all its indexes (including HNSW) into new files,
 * so dead tuples holding the erased member's bytes are not copied; ANALYZE replaces pg_statistic samples.
 * VACUUM cannot run inside a transaction, so `db` must be a plain (autocommit) connection.
 * `ignoreWindow` simulates the window arriving now.
 */
export async function runPurgeJobs(db: Db, opts: { worker?: string; ignoreWindow?: boolean; leaseSecs?: number } = {}) {
  const worker = opts.worker ?? "purger";
  const done: { jobId: number; tables: { table: string; ms: number }[]; checkpoint: boolean }[] = [];
  for (;;) {
    const [job] = await db.q<{ id: number; token: string; payload: { tables: string[] } }>(`
      UPDATE network.jobs j SET status = 'running', lease_owner = $1, lease_token = gen_random_uuid(),
             lease_expires_at = now() + make_interval(secs => $3::float8), attempts = j.attempts + 1
       WHERE id = (SELECT id FROM network.jobs WHERE type = 'physical_purge' AND status = 'pending' AND (due_at <= now() OR $2::bool)
                    ORDER BY due_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING j.id::int AS id, j.lease_token::text AS token, j.payload`, [worker, !!opts.ignoreWindow, opts.leaseSecs ?? 3600]);
    if (!job) return done;
    const tables: { table: string; ms: number }[] = [];
    for (const t of job.payload.tables) {
      if (!/^[a-z_]+$/.test(t)) throw new Error(`bad table ${t}`);
      const t0 = performance.now();
      await db.exec(`VACUUM (FULL, ANALYZE) network.${t}`);
      tables.push({ table: t, ms: Math.round(performance.now() - t0) });
    }
    // ANALYZE replaced the pg_statistic rows (sampled column values, e.g. member names and ids), but the old row
    // versions stay in pg_statistic's heap and TOAST until it is rewritten too. Requires superuser.
    const t1 = performance.now();
    await db.exec("VACUUM (FULL) pg_catalog.pg_statistic");
    tables.push({ table: "pg_catalog.pg_statistic", ms: Math.round(performance.now() - t1) });
    // Old relation files are truncated at commit and unlinked at the next checkpoint. CHECKPOINT needs superuser or
    // pg_checkpoint (PG15+); without it the next scheduled checkpoint (checkpoint_timeout, default 5 min) does it.
    const checkpoint = await db.exec("CHECKPOINT").then(() => true, () => false);
    await db.q(COMPLETE, [job.id, job.token, worker]);
    done.push({ jobId: job.id, tables, checkpoint });
  }
}

function walk(dir: string, out: string[] = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.isFile()) out.push(p);
  }
  return out;
}

/** Search every file under the data directory for each needle. pg_wal is reported separately. */
export async function scanDataDir(dataDir: string, needles: Record<string, Buffer>) {
  const hits: Record<string, string[]> = {}, walHits: Record<string, string[]> = {};
  let files = 0, bytes = 0;
  for (const f of walk(dataDir)) {
    const rel = f.slice(dataDir.length + 1);
    if (rel === "postmaster.pid" || rel.startsWith("log")) continue;
    let buf: Buffer;
    try { buf = Buffer.from(await Bun.file(f).arrayBuffer()); } catch { continue; } // removed mid-scan
    files++; bytes += buf.length;
    for (const [k, n] of Object.entries(needles)) {
      if (!buf.includes(n)) continue;
      const bucket = rel.startsWith("pg_wal") ? walHits : hits;
      (bucket[k] ??= []).push(rel);
    }
  }
  return { files, mb: Math.round(bytes / 1e5) / 10, hits, walHits };
}

/** Replace "base/<db>/<filenode>" with the relation name (resolved now: VACUUM FULL assigns new filenodes). */
export async function labelHits(db: Db, hits: Record<string, string[]>) {
  const names = new Map((await db.q<{ path: string; rel: string }>(`
    SELECT pg_relation_filepath(c.oid) AS path,
           coalesce((SELECT 'toast of ' || t.relname FROM pg_class t WHERE t.reltoastrelid = c.oid), c.relname) AS rel
      FROM pg_class c WHERE pg_relation_filepath(c.oid) IS NOT NULL`)).map((r) => [r.path, r.rel]));
  const out: Record<string, string[]> = {};
  for (const [k, files] of Object.entries(hits)) out[k] = [...new Set(files.map((f) => names.get(f.replace(/\.\d+$/, "")) ?? f))].sort();
  return out;
}

/** Byte patterns for a 1536-d embedding: the raw float4s (heap/TOAST) and the L2-normalised copy (cosine HNSW). */
export function embeddingNeedles(name: string, v: number[]) {
  const f = new Float32Array(v);
  const norm = Math.sqrt(f.reduce((a, x) => a + x * x, 0));
  return {
    [`${name}:raw`]: Buffer.from(f.slice(0, 16).buffer),
    [`${name}:normalized`]: Buffer.from(new Float32Array(f.slice(0, 16).map((x) => x / norm)).buffer),
  };
}

/**
 * End-to-end: seed a member with PII and embeddings in facets, intents and engine state among `others` members,
 * ANALYZE (so pg_statistic samples exist), erase, then byte-scan the data directory before and after the purge job.
 */
export async function physicalErasure(db: Db, others = 2000) {
  await db.exec("TRUNCATE network.members, network.opportunities, network.jobs CASCADE");
  const [{ dir }] = await db.q<{ dir: string }>("SELECT current_setting('data_directory') AS dir");
  const token = `Purgable${Math.floor(Math.random() * 1e9)}`;
  const vec = (k: number) => Array.from({ length: 1536 }, (_, i) => Math.sin(i * 0.37 + k) + 0.01 * k);
  const lit = (v: number[]) => `[${v.join(",")}]`;
  const [{ id }] = await db.q<{ id: string }>(
    "INSERT INTO network.members (name, email, phone, home_city) VALUES ($1, $2, '+14155550142', 'sf') RETURNING id::text AS id",
    [`${token} Person`, `${token.toLowerCase()}@example.com`]);
  await db.q(`INSERT INTO network.members (name, home_city) SELECT 'other ' || i, CASE WHEN i % 2 = 0 THEN 'sf' ELSE 'nyc' END
              FROM generate_series(1, $1::int) i`, [others]);
  await db.q(`INSERT INTO network.facets (member_id, city, kind, value, embedding)
              SELECT id, home_city, 'interest', 'synthetic', l2_normalize((SELECT array_agg(random() - 0.5) FROM generate_series(1, 1536) WHERE id IS NOT NULL)::vector)
                FROM network.members WHERE id <> $1::uuid`, [id]);
  await db.q("INSERT INTO network.facets (member_id, city, kind, value, embedding) VALUES ($1, 'sf', 'interest', $2, $3::vector)",
    [id, `${token} climbs`, lit(vec(1))]);
  await db.q("INSERT INTO network.intents (member_id, objective, category, embedding) VALUES ($1, $2, 'hobby', $3::vector)",
    [id, `${token} wants a climbing partner`, lit(vec(2))]);
  await db.q("INSERT INTO network.engine_member_state (member_id, learned_embedding) VALUES ($1, $2::vector)", [id, lit(vec(3))]);
  await db.q("INSERT INTO network.profiles (member_id, headline, source, source_rev) VALUES ($1, $2, 'linkedin', 'r1')", [id, `${token} at Acme`]);
  await db.q("INSERT INTO network.jobs (type, payload, member_ids) VALUES ('reminder', jsonb_build_object('who', $1::text), ARRAY[$2]::uuid[])", [token, id]);
  await db.exec("ANALYZE");
  const needles = { name: Buffer.from(token), idText: Buffer.from(id), idBinary: Buffer.from(id.replace(/-/g, ""), "hex"), ...embeddingNeedles("facet", vec(1)),
    ...embeddingNeedles("intent", vec(2)), ...embeddingNeedles("engineState", vec(3)) };

  const erased = (await db.q("SELECT network.erase_member($1::uuid) AS c", [id]))[0].c;
  const [purgeJob] = await db.q("SELECT id::int, due_at::text, idempotency_key, payload->'deadline' AS deadline FROM network.jobs WHERE type = 'physical_purge'");
  await db.exec("CHECKPOINT");
  const scan = async () => { const r = await scanDataDir(dir, needles); return { ...r, hits: await labelHits(db, r.hits) }; };
  const afterErase = await scan();
  await db.exec("VACUUM"); await db.exec("CHECKPOINT"); // what routine autovacuum would do: not enough
  const afterPlainVacuum = await scan();
  const t0 = performance.now();
  const purge = await runPurgeJobs(db, { ignoreWindow: true });
  const purgeMs = Math.round(performance.now() - t0);
  const afterPurge = await scan();
  return { others, erased, purgeJob, afterErase, afterPlainVacuum, purge, purgeMs, afterPurge,
    pass: Object.keys(afterErase.hits).length > 0 && Object.keys(afterPurge.hits).length === 0 };
}
