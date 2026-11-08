// SD-083 (observatory D02): the console's database login check in real mode, on Postgres. A login
// that is not fit for the app (loginProblem) must never serve the console, also when the first check
// fails with an error: the console reads nothing until the check answers, and it checks again on the
// next poll. Skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { RealSource } from "../src/sources/real.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

describe.skipIf(!pgAvailable)("console login check after a check error (Postgres)", () => {
  let url: string;
  let sql: SQL;
  // peon's read login, given to the slop console: not a member of network_observatory_slop, so unfit.
  const LOGIN = `obs_check_peon_${process.pid}`;

  beforeAll(async () => {
    url = await testDb();
    sql = new SQL(url);
    await sql.unsafe(`drop role if exists ${LOGIN}`);
    await sql.unsafe(`create role ${LOGIN} login in role network_observatory_peon`);
  }, 120_000);

  afterAll(async () => {
    await sql?.unsafe(`drop role if exists ${LOGIN}`).catch(() => {});
    await sql?.close();
    await dropTestDb();
  });

  test("an unfit login whose first check fails is refused when the check answers, and serves nothing before", async () => {
    // The login check reads pg_roles: in this test database it fails for the login until the grant comes back.
    await sql.unsafe("revoke select on pg_catalog.pg_roles from public");
    const real = new RealSource({ url, app: "slop", appUrl: url.replace(/\/\/[^@]+@/, `//${LOGIN}@`), pollMs: 3_600_000, pushMs: 3_600_000, service: false });
    try {
      await real.init();
      expect(real.state().env.error).toContain("Could not check the database login");
      await sql.unsafe("grant select on pg_catalog.pg_roles to public");
      await (real as any).reload();
      expect(real.state().env.error).toContain("network_observatory_slop");
      expect(real.state().members).toEqual([]);
    } finally {
      await sql.unsafe("grant select on pg_catalog.pg_roles to public");
      await real.dispose();
    }
  });
});
