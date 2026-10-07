// Fix 1 + 2 measurements: nearestMembers recall / rows / latency, and which index layout to use for city-filtered ANN.
import type { Db } from "./db";
import { type City, exactSql, nearestMembers, type RetrievalLog } from "./retrieval";
import { CREATE_FACET_HNSW, DROP_FACET_HNSW, pct, r2, seedVectors } from "./suite";

export type Strategy = "global" | "per-city" | "partitioned";

const SETUP: Record<Strategy, string> = {
  global: CREATE_FACET_HNSW.global,
  "per-city": CREATE_FACET_HNSW["per-city"],
  partitioned: `CREATE TABLE network.facets_part (member_id uuid NOT NULL, city text NOT NULL, embedding vector(1536)) PARTITION BY LIST (city);
    CREATE TABLE network.facets_part_sf PARTITION OF network.facets_part FOR VALUES IN ('sf');
    CREATE TABLE network.facets_part_nyc PARTITION OF network.facets_part FOR VALUES IN ('nyc');
    INSERT INTO network.facets_part SELECT member_id, city, embedding FROM network.facets;
    CREATE INDEX facets_part_hnsw ON network.facets_part USING hnsw (embedding vector_cosine_ops);
    ANALYZE network.facets_part`,
};
const SIZE: Record<Strategy, string> = {
  global: "SELECT pg_relation_size('network.facets_embedding_hnsw') AS b",
  "per-city": "SELECT pg_relation_size('network.facets_embedding_hnsw_sf') + pg_relation_size('network.facets_embedding_hnsw_nyc') AS b",
  partitioned: `SELECT sum(pg_relation_size(i.indexrelid)) AS b FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
                 WHERE c.relname IN ('facets_part_sf', 'facets_part_nyc')`,
};

export async function retrievalBench(db: Db, o: { members: number; dist: "uniform" | "clustered"; k?: number; queries?: number;
  strategies?: Strategy[]; vacuumFull?: boolean }) {
  const k = o.k ?? 50, nq = o.queries ?? 100;
  const seed = await seedVectors(db, o.members, o.dist, 0.42, "none");
  const qs = await db.q<{ v: string; city: City }>(
    "SELECT embedding::text AS v, CASE WHEN random() < 0.5 THEN 'sf' ELSE 'nyc' END AS city FROM network.facets ORDER BY random() LIMIT $1", [nq]);
  const truth: string[][] = [];
  for (const q of qs) truth.push((await db.q<{ member_id: string }>(exactSql(q.city, k), [q.v])).map((r) => r.member_id));
  const out: any[] = [];
  for (const strategy of o.strategies ?? (["global", "per-city", "partitioned"] as Strategy[])) {
    await db.exec(`${DROP_FACET_HNSW}; DROP TABLE IF EXISTS network.facets_part`);
    const t0 = performance.now();
    await db.exec(SETUP[strategy]);
    const buildSecs = r2((performance.now() - t0) / 1000);
    const [{ b }] = await db.q<{ b: string }>(SIZE[strategy]);
    const table = strategy === "partitioned" ? "network.facets_part" : undefined;
    for (const forceAnn of [false, true]) {
      const logs: RetrievalLog[] = [];
      const log = (l: RetrievalLog) => logs.push(l);
      const first = await nearestMembers(db, qs[0]!.city, qs[0]!.v, k, { explain: true, log, table, forceAnn });
      for (const q of qs.slice(0, 5)) await nearestMembers(db, q.city, q.v, k, { log, table, forceAnn }); // warm-up
      logs.length = 0;
      const lat: number[] = [], recalls: number[] = [];
      let rows = 0;
      for (const [i, q] of qs.entries()) {
        const t = performance.now();
        const r = await nearestMembers(db, q.city, q.v, k, { log, table, forceAnn });
        lat.push(performance.now() - t);
        const tr = new Set(truth[i]);
        recalls.push(r.rows.filter((x) => tr.has(x.member_id)).length / tr.size);
        rows += r.rows.length;
      }
      out.push({ strategy, mode: forceAnn ? "steered to ANN" : "planner default", buildSecs, indexMB: r2(Number(b) / 1e6),
        plan: first.explainIndex, p50: r2(pct(lat, 50)), p95: r2(pct(lat, 95)),
        recall: r2(recalls.reduce((a, x) => a + x, 0) / recalls.length), minRecall: r2(Math.min(...recalls)), avgRows: r2(rows / qs.length),
        minRows: Math.min(...logs.map((l) => l.rows)), fallbacks: logs.filter((l) => l.plan === "exact-fallback").length, efSearch: first.efSearch });
    }
  }
  let vacuumFull: any = null;
  if (o.vacuumFull) { // what the physical purge costs on this table (ACCESS EXCLUSIVE for the duration)
    await db.exec(`${DROP_FACET_HNSW}; DROP TABLE IF EXISTS network.facets_part; ${CREATE_FACET_HNSW["per-city"]}`);
    const t = performance.now();
    await db.exec("VACUUM (FULL, ANALYZE) network.facets");
    vacuumFull = { table: "network.facets", indexes: "per-city HNSW", secs: r2((performance.now() - t) / 1000) };
  }
  await db.exec(`${DROP_FACET_HNSW}; DROP TABLE IF EXISTS network.facets_part; ${CREATE_FACET_HNSW["per-city"]}`);
  return { members: o.members, dist: o.dist, k, queries: qs.length, ...seed, strategies: out, vacuumFull };
}
