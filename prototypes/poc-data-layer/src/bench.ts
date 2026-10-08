// Full P02 measurements on Postgres 16 (throwaway cluster) and PGlite. Usage:
//   bun run src/bench.ts [schema jobs unique lock vectors delete] [--sizes=300,5000,50000] [--lite-sizes=300,5000]
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startCluster } from "./cluster";
import { type Db, pgBackend, pgConnect, pgliteBackend, schemaFingerprint } from "./db";
import { advisoryLock, deletionPropagation, jobLeasing, resetSchema, uniqueOpportunity, vectorBench } from "./suite";

const args = process.argv.slice(2);
const flag = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const stages = args.filter((a) => !a.startsWith("--"));
const want = (s: string) => !stages.length || stages.includes(s);
const sizes = flag("sizes", "300,5000,50000").split(",").filter(Boolean).map(Number);
const liteSizes = flag("lite-sizes", "300,5000").split(",").filter(Boolean).map(Number);

const outDir = join(import.meta.dir, "..", "results");
const outFile = join(outDir, "results.json");
mkdirSync(outDir, { recursive: true });
const results: Record<string, any> = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : {};
const save = (k: string, v: unknown) => {
  results[k] = v;
  console.log(k, JSON.stringify(v, null, 1));
  return Bun.write(outFile, JSON.stringify(results, null, 2));
};
const timed = async <T>(fn: () => Promise<T>) => { const t = performance.now(); const r = await fn(); return { ms: Math.round(performance.now() - t), r }; };

const cluster = startCluster();
const pg = pgBackend(cluster.url, "postgres16");
const admin: Db = pgConnect(cluster.url);
const lite = await pgliteBackend();
try {
  const mig = await timed(() => resetSchema(admin));
  const [pgVer] = await admin.q("SELECT version() AS v, (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS pgvector");
  const migLite = await timed(() => resetSchema(lite.db));
  const [liteVer] = await lite.db.q("SELECT version() AS v, (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS pgvector");
  await save("env", { postgres: pgVer, pglite: liteVer, cpus: navigator.hardwareConcurrency, bun: Bun.version });

  if (want("schema")) {
    const [a, b] = [await schemaFingerprint(admin), await schemaFingerprint(lite.db)];
    const sa = new Set(a), sb = new Set(b);
    await save("schema", { migrationSha: mig.r, pgMigrateMs: mig.ms, pgliteMigrateMs: migLite.ms, catalogEntries: a.length,
      onlyPostgres: a.filter((x) => !sb.has(x)), onlyPglite: b.filter((x) => !sa.has(x)), identical: a.join() === b.join() });
  }
  if (want("jobs")) {
    const base = { jobs: 10_000, workers: 8, batch: 1, leaseMs: 500, crashRate: 0, zombieRate: 0, seed: 7 };
    await save("jobs", {
      pgClean: await jobLeasing(pg, base),
      pgCrashes: await jobLeasing(pg, { ...base, crashRate: 0.01, zombieRate: 0.005 }),
      pgBatch10Crashes: await jobLeasing(pg, { ...base, batch: 10, crashRate: 0.01, zombieRate: 0.005 }),
      pgliteCrashes: await jobLeasing(lite, { ...base, crashRate: 0.01, zombieRate: 0.005 }),
    });
  }
  if (want("unique")) await save("unique", { pg: await uniqueOpportunity(pg, 500), pglite: await uniqueOpportunity(lite, 100) }); // PGlite: see liteerrors
  if (want("liteerrors")) { // PGlite 0.5.8 wedges after ~3k SQL errors in one instance (54001, then 25P02 forever)
    const { PGlite } = await import("@electric-sql/pglite");
    const db = await PGlite.create();
    await db.exec("CREATE TABLE t (k text PRIMARY KEY); INSERT INTO t VALUES ('x')");
    let n = 0, code: string | undefined;
    for (; n < 10_000; n++) { try { await db.query("INSERT INTO t VALUES ('x')"); } catch (e: any) { if (e.code !== "23505") { code = e.code; break; } } }
    const after = await db.query("SELECT 1").then(() => "ok", (e: any) => e.code);
    await save("pgliteErrorLimit", { uniqueViolationsSurvived: n, failingCode: code, nextQuery: after });
    await db.close().catch(() => {});
  }
  if (want("lock")) await save("lock", { pg: await advisoryLock(pg, 200), pglite: await advisoryLock(lite, 20) });
  if (want("delete")) await save("delete", { pg: await deletionPropagation(admin, { physical: true }), pglite: await deletionPropagation(lite.db) });
  if (want("vectors")) {
    const planned = new Set([...sizes.map((n) => `postgres16:${n}`), ...liteSizes.map((n) => `pglite:${n}`)]);
    const v: any[] = (results.vectors ?? []).filter((x: any) => !planned.has(`${x.engine}:${x.members}`));
    for (const n of sizes) { v.push({ engine: "postgres16", ...(await vectorBench(admin, n, "uniform")) }); await save("vectors", v); }
    if (sizes.includes(50_000)) { v.push({ engine: "postgres16", ...(await vectorBench(admin, 50_000, "clustered")) }); await save("vectors", v); }
    for (const n of liteSizes) { v.push({ engine: "pglite", ...(await vectorBench(lite.db, n, "uniform")) }); await save("vectors", v); }
  }
} finally {
  await admin.close().catch(() => {});
  await lite.db.close().catch(() => {});
  cluster.stop();
}
