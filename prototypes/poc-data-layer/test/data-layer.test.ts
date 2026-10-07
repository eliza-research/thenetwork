// Fast correctness pass (small sizes). Full measurements: `bun run bench` -> RESULTS.md.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startCluster, type Cluster } from "../src/cluster";
import { type Backend, type Db, pgBackend, pgConnect, pgliteBackend, schemaFingerprint } from "../src/db";
import { advisoryLock, deletionPropagation, jobLeasing, resetSchema, uniqueOpportunity, vectorBench } from "../src/suite";

const HAS_PG = Bun.spawnSync(["test", "-x", `${process.env.PG_BIN ?? "/opt/homebrew/opt/postgresql@16/bin"}/initdb`]).exitCode === 0;
let cluster: Cluster, pg: Backend, pgAdmin: Db, lite: Backend & { db: Db };

beforeAll(async () => {
  lite = await pgliteBackend();
  await resetSchema(lite.db);
  if (HAS_PG) {
    cluster = startCluster(Number(process.env.PG_PORT ?? 54331));
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

test("migrations produce identical catalogs on PGlite and Postgres", async () => {
  if (!HAS_PG) return;
  expect(await schemaFingerprint(pgAdmin)).toEqual(await schemaFingerprint(lite.db));
});

for (const which of ["postgres", "pglite"] as const) {
  describe(which, () => {
    const b = () => (which === "postgres" ? pg : lite);
    const db = () => (which === "postgres" ? pgAdmin : lite.db);
    const skip = which === "postgres" && !HAS_PG;

    test("jobs complete exactly once with crashes and zombies", async () => {
      if (skip) return;
      const r = await jobLeasing(b(), { jobs: 1000, workers: 8, batch: 1, leaseMs: 200, crashRate: 0.02, zombieRate: 0.01, seed: 1 });
      expect(r.exactlyOnce).toBe(true);
      expect(r.crashes).toBeGreaterThan(0);
      expect(r.reclaimed).toBeGreaterThan(0);
    }, 60_000);

    test("unique partial index allows one active opportunity per participant set + objective", async () => {
      if (skip) return;
      const r = await uniqueOpportunity(b(), 20);
      expect(r.pass).toBe(true);
    }, 60_000);

    test("advisory lock: one matching run per city at a time", async () => {
      if (skip || which === "pglite") return; // single session: locks are re-entrant, exclusivity untestable
      expect((await advisoryLock(b(), 10)).pass).toBe(true);
    }, 60_000);

    test("member erasure leaves 0 PII rows and 0 embeddings", async () => {
      if (skip) return;
      const r = await deletionPropagation(db());
      expect(r.after).toEqual({ hits: {}, embeddings: 0 });
      expect(r.pass).toBe(true);
    }, 60_000);

    test("HNSW top-50 with city filter returns 50 rows and high recall when iterative scan is on", async () => {
      if (skip) return;
      const r = await vectorBench(db(), 300, "uniform", 20);
      const it = r.rows.find((x) => x.config.includes("ef_search=200"))!;
      expect(it.usesHnsw).toBe(true);
      expect(it.avgRows).toBe(50);
      expect(it.recall).toBeGreaterThan(0.9);
    }, 120_000);
  });
}
