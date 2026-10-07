// Minimal repro: a PGlite instance stops working after a few thousand caught SQL errors.
// Run with Bun or Node 22+:  bun repro/pglite-error-limit.ts   |   node repro/pglite-error-limit.ts
// Only dependency: @electric-sql/pglite (no extensions).
import { PGlite } from "@electric-sql/pglite";

const cases: Record<string, { sql: string; expect: string }> = {
  unique_violation: { sql: "INSERT INTO t VALUES (1)", expect: "23505" },
  division_by_zero: { sql: "SELECT 1/0", expect: "22012" },
  raise_exception: { sql: "DO $$ BEGIN RAISE EXCEPTION 'boom'; END $$", expect: "P0001" },
  syntax_error: { sql: "SELEC 1", expect: "42601" },
};

for (const [name, c] of Object.entries(cases)) {
  const db = await PGlite.create();
  await db.exec("CREATE TABLE t (k int PRIMARY KEY); INSERT INTO t VALUES (1)");
  let caught = 0, unexpected = "";
  for (; caught < 10_000; caught++) {
    try { await db.query(c.sql); unexpected = "query unexpectedly succeeded"; break; }
    catch (e: any) { if (e?.code !== c.expect) { unexpected = `${e?.code ?? ""} ${e?.message ?? e}`.trim(); break; } }
  }
  const next = await db.query("SELECT 1 AS ok").then(() => "ok", (e: any) => `${e?.code ?? ""} ${e?.message ?? e}`.trim());
  console.log(`${name.padEnd(17)} expected errors caught: ${String(caught).padStart(5)}  then: ${unexpected || "-"}  | next 'SELECT 1': ${next}`);
  await db.close().catch(() => {});
}
