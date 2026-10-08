// CI guard for REQUIRE_PG=1 (audit sites-infra-5): every Postgres test helper must see a Postgres,
// so no Postgres suite can skip silently. Exits 1 when one cannot.
//   REQUIRE_PG=1 bun run scripts/require-pg.ts
const HELPERS = ["../packages/observatory/test/pg.ts", "../packages/platform/test/pg.ts"];

export async function missingPg(helpers = HELPERS): Promise<string[]> {
  const missing: string[] = [];
  for (const h of helpers) {
    const m = (await import(h)) as { pgAvailable?: boolean };
    if (m.pgAvailable !== true) missing.push(h);
  }
  return missing;
}

if (import.meta.main) {
  if (process.env.REQUIRE_PG !== "1") {
    console.log("REQUIRE_PG is not 1: nothing to check");
    process.exit(0);
  }
  const missing = await missingPg();
  for (const h of missing) console.error(`${h}: no Postgres (pgAvailable is false) with REQUIRE_PG=1`);
  if (missing.length) process.exit(1);
  console.log(`Postgres available to ${HELPERS.length} test helpers`);
}
