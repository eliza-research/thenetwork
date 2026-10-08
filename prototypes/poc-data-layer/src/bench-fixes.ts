// Measurements for the "Fixes" section of RESULTS.md -> results/fixes.json. Usage:
//   bun run src/bench-fixes.ts [retrieval purge] [--sizes=5000,50000]
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startCluster } from "./cluster";
import { pgConnect } from "./db";
import { physicalErasure } from "./purge";
import { retrievalBench } from "./retrieval-bench";
import { resetSchema } from "./suite";

const args = process.argv.slice(2);
const stages = args.filter((a) => !a.startsWith("--"));
const want = (s: string) => !stages.length || stages.includes(s);
const sizes = (args.find((a) => a.startsWith("--sizes="))?.split("=")[1] ?? "5000,50000").split(",").map(Number);
const outDir = join(import.meta.dir, "..", "results"), outFile = join(outDir, "fixes.json");
mkdirSync(outDir, { recursive: true });
const results: Record<string, any> = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : {};
const save = (k: string, v: unknown) => { results[k] = v; console.log(k, JSON.stringify(v, null, 1)); return Bun.write(outFile, JSON.stringify(results, null, 2)); };

const cluster = startCluster(Number(process.env.PG_PORT ?? 54343));
const db = pgConnect(cluster.url);
try {
  await resetSchema(db);
  if (want("retrieval")) {
    const r: any[] = results.retrieval?.filter((x: any) => !sizes.includes(x.members)) ?? [];
    for (const n of sizes) { r.push(await retrievalBench(db, { members: n, dist: "clustered", vacuumFull: true })); await save("retrieval", r); }
  }
  if (want("purge")) { await resetSchema(db); await save("purge", await physicalErasure(db, 5000)); }
} finally {
  await db.close().catch(() => {});
  cluster.stop();
}
