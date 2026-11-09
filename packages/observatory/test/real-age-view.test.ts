// SD-082 (observatory D01): the console's age state in real mode, on Postgres. The Network's stored
// flag (minor_reported, minor_record: no age event) is the only sign that member s1 is under 18. A read
// error on the console state view must not turn s1 into an adult in the console: the poll fails and
// the last good copy stays. Skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { RealSource } from "../src/sources/real.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

describe.skipIf(!pgAvailable)("console age view after a read error (Postgres)", () => {
  let url: string;
  let sql: SQL;
  let real: RealSource;
  const VIEW = "network.network_state_console_slop";
  // The console's own login for slop (network_observatory_slop): since migration 0010 it cannot read the shared view.
  const LOGIN = `obs_age_slop_${process.pid}`;

  beforeAll(async () => {
    url = await testDb();
    sql = new SQL(url);
    await sql.begin(async tx => {
      await tx`set local app.app_id = 'slop'`;
      await tx`insert into network.members (id, name, home_city, account_status, age, joined_at) values ('s1', 'Sam Slop', 'nyc', 'active', 30, now())`;
      await tx`insert into network.network_state (id, version, state) values ('slop:nyc', 1, ${{ matchingEnabled: false, trust: [], cases: [], members: [{ id: "s1", minor: true }] }}::jsonb)`;
    });
    await sql.unsafe(`drop role if exists ${LOGIN}`);
    await sql.unsafe(`create role ${LOGIN} login in role network_observatory_slop`);
    real = new RealSource({ url, app: "slop", appUrl: url.replace(/\/\/[^@]+@/, `//${LOGIN}@`), pollMs: 3_600_000, pushMs: 3_600_000, service: false });
    await real.init();
  }, 120_000);

  afterAll(async () => {
    await real?.dispose();
    await sql?.unsafe(`drop role if exists ${LOGIN}`).catch(() => {});
    await sql?.close();
    await dropTestDb();
  });

  test("a failed read of the console state view keeps the member under 18", async () => {
    const minor = () => real.state().members.find(m => m.id === "s1")?.minor;
    expect(minor()).toBe(true);
    // The view answers with an error (as on a timeout or a restart): the same columns, a query that fails when it runs.
    const [{ def }] = await sql`select pg_get_viewdef(${VIEW}::regclass) as def` as { def: string }[];
    await sql.unsafe(`create or replace view ${VIEW} with (security_barrier) as select v.* from (${def.replace(/;\s*$/, "")}) v where 1 / (select count(*) - count(*) from pg_class)::int = 1`);
    try {
      await (real as any).reload();
      expect(minor()).toBe(true);
      expect(real.state().env.error).toContain("Read failed");
    } finally {
      await sql.unsafe(`create or replace view ${VIEW} with (security_barrier) as ${def}`);
    }
    // The next good poll reads the view again and clears the error.
    await (real as any).reload();
    expect(minor()).toBe(true);
    expect(real.state().env.error).toBeUndefined();
  });
});
