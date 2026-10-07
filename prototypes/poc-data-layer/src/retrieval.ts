// Fix 1: filtered nearest-neighbour retrieval that cannot silently under-return.
import type { Db } from "./db";

export const CITIES = ["sf", "nyc"] as const;
export type City = (typeof CITIES)[number];

export type RetrievalPlan = "ann" | "exact-fallback";
export interface RetrievalLog {
  city: City; k: number; efSearch: number; plan: RetrievalPlan; rows: number; annRows: number; ms: number;
  /** Index (or "seq/bitmap scan") seen by EXPLAIN when opts.explain is set. */
  explainIndex?: string; explain?: string;
}
export interface NearestOpts {
  /** Run EXPLAIN on the same statement in the same transaction and report the index it uses. */
  explain?: boolean;
  /** Facet rows fetched per wanted member before de-duplicating by member (members can have several facets). */
  overfetch?: number;
  log?: (l: RetrievalLog) => void;
  /** Tests/benchmarks only: steer the planner to the ANN index even where it would pick an exact scan (small cities). */
  forceAnn?: boolean;
  /** Benchmarks only: query another table with the same shape (e.g. a list-partitioned copy). */
  table?: string;
}

/** Default logger: quiet unless NETWORK_LOG_RETRIEVAL is set. Every call reports the plan it used. */
export const retrievalLog: RetrievalLog[] = [];
const defaultLog = (l: RetrievalLog) => {
  retrievalLog.push(l);
  if (retrievalLog.length > 1000) retrievalLog.shift();
  if (process.env.NETWORK_LOG_RETRIEVAL) console.log("[nearestMembers]", JSON.stringify(l));
  if (l.plan === "exact-fallback" && l.rows > l.annRows) console.warn("[nearestMembers] ANN under-returned; used exact scan", JSON.stringify(l));
};

const toVec = (v: string | number[] | Float32Array) => (typeof v === "string" ? v : `[${Array.from(v).join(",")}]`);

/**
 * The statement text has the city as a literal (validated against CITIES) so the planner can prove the partial
 * index predicate `city = '<city>'`. It never depends on a cached generic plan: plan_cache_mode is forced to custom
 * for the transaction, and the text differs per (city, k, inner).
 */
export function annSql(city: City, k: number, inner: number, table = "network.facets") {
  return `SELECT member_id::text AS member_id, min(d)::float8 AS distance FROM (
  SELECT member_id, embedding <=> $1::vector AS d FROM ${table}
   WHERE city = '${city}' AND embedding IS NOT NULL
   ORDER BY embedding <=> $1::vector LIMIT ${inner}) c
GROUP BY member_id ORDER BY distance, member_id LIMIT ${k}`;
}
/** Exact scan: the aggregate in ORDER BY means no index can serve it. */
export function exactSql(city: City, k: number, table = "network.facets") {
  return `SELECT member_id::text AS member_id, min(embedding <=> $1::vector)::float8 AS distance FROM ${table}
 WHERE city = '${city}' AND embedding IS NOT NULL
 GROUP BY member_id ORDER BY distance, member_id LIMIT ${k}`;
}

/**
 * Top-k members in `city` nearest to `vec` (cosine). Must run in a transaction (it opens one if `tx` is not):
 * - SET LOCAL hnsw.ef_search = max(100, 2 * inner), hnsw.iterative_scan = relaxed_order, plan_cache_mode = force_custom_plan
 * - if the ANN path returns fewer than k members, re-runs as an exact scan, which returns min(k, candidates).
 *   So the result has exactly k rows whenever at least k members have an embedding in the city.
 */
export async function nearestMembers(tx: Db, city: City, vec: string | number[] | Float32Array, k: number, opts: NearestOpts = {}):
  Promise<{ rows: { member_id: string; distance: number }[]; plan: RetrievalPlan; efSearch: number; explainIndex?: string }> {
  if (!tx.inTx) return tx.tx((t) => nearestMembers(t, city, vec, k, opts));
  if (!CITIES.includes(city)) throw new Error(`unknown city ${city}`);
  if (!Number.isInteger(k) || k < 1 || k > 400) throw new Error(`k out of range: ${k}`);
  const inner = k * (opts.overfetch ?? 2);
  const efSearch = Math.min(1000, Math.max(100, 2 * inner)); // pgvector caps ef_search at 1000
  const t0 = performance.now();
  await tx.q(`SELECT set_config('hnsw.ef_search', $1, true), set_config('hnsw.iterative_scan', 'relaxed_order', true),
                     set_config('plan_cache_mode', 'force_custom_plan', true), set_config('enable_sort', $2, true)`,
    [String(efSearch), opts.forceAnn ? "off" : "on"]);
  const v = toVec(vec);
  const sql = annSql(city, k, inner, opts.table);
  let explainIndex: string | undefined, explain: string | undefined;
  if (opts.explain) {
    explain = (await tx.q(`EXPLAIN ${sql}`, [v])).map((r: any) => Object.values(r)[0]).join("\n");
    explainIndex = explain.match(/Index Scan using (\S+)/)?.[1] ?? (explain.includes("Seq Scan") ? "seq scan" : "other");
  }
  const ann = await tx.q<{ member_id: string; distance: number }>(sql, [v]);
  let rows = ann, plan: RetrievalPlan = "ann";
  if (ann.length < k) { // ANN under-returned, or fewer than k candidates exist: the exact scan returns min(k, candidates)
    rows = await tx.q(exactSql(city, k, opts.table), [v]);
    plan = "exact-fallback";
  }
  (opts.log ?? defaultLog)({ city, k, efSearch, plan, rows: rows.length, annRows: ann.length, ms: Math.round((performance.now() - t0) * 100) / 100, explainIndex, explain });
  return { rows, plan, efSearch, explainIndex };
}
