// The console's database roles keep each app to itself (migration 0010; audit platform-7 /
// observatory-4, observatory-3; PRD 40.3). On a real Postgres database, as each console role:
//  - network.network_state_console (every app's state, run as its owner) is closed to every console
//    role; each app's role reads its own view only, and the shared role reads ntwrk's only;
//  - person-to-person blocks: an app's role reads only blocks between two members of its app;
//  - OBS-08: the cross-app role cannot read names, bios, ages or message texts, and its counts work;
//  - running the baseline schema again (it grants "all tables") does not open the shared view again;
//  - a golden list of what each console role may select in the network and platform schemas.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SQL } from "bun";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const T = 120_000;
const P = { a: crypto.randomUUID(), b: crypto.randomUUID(), c: crypto.randomUUID() };

describe.skipIf(!pgAvailable)("console roles (migration 0010)", () => {
  let url: string;
  let sql: SQL;
  /** Run a query as a role (in a transaction): the rows, or the error text. */
  const as = <R = any>(role: string, q: (tx: SQL) => Promise<R>) =>
    sql.begin(async tx => { await tx.unsafe(`set local role ${role}`); return q(tx); }).then(v => ({ v: v as R }), e => ({ e: String((e as Error).message) }));
  const denied = { e: expect.stringContaining("permission denied") };

  beforeAll(async () => {
    url = await testDb();
    sql = new SQL(url);
    // ntwrk: a and b; slop: a and c. Blocks: a->b (made on ntwrk), a->c (made on slop), b->c (no shared app).
    await sql`insert into platform.people (id, lowest_age) values (${P.a}, 30), (${P.b}, 15), (${P.c}, 41)`;
    for (const [app, rows] of [["ntwrk", [["n1", P.a, "Nia Ntwrk", 30], ["n2", P.b, "Ned Teen", 15]]], ["slop", [["s1", P.a, "Sam Slop", 30], ["s3", P.c, "Cy Slop", 41]]]] as const) {
      await sql.begin(async tx => {
        await tx.unsafe(`set local app.app_id = '${app}'`);
        for (const [id, person, name, age] of rows) {
          await tx`insert into network.members (id, name, bio, home_city, account_status, age, joined_at, person_id) values (${id}, ${name}, ${"bio of " + name}, 'nyc', 'active', ${age}, now(), ${person})`;
          await tx`insert into network.messages (id, member_id, direction, body, ts) values (${`m-${id}`}, ${id}, 'inbound', ${"secret words of " + name}, now())`;
          await tx`insert into platform.memberships (app_id, person_id, member_id, state, joined_at) values (${app}, ${person}, ${id}, 'active', now())`;
        }
        await tx`insert into network.network_state (id, version, state) values (${`${app}:nyc`}, 1, ${{ matchingEnabled: false, trust: [{ id: `${app}-x`, level: "hold" }], cases: [], members: [{ id: rows[0][0], minor: false }] }}::jsonb)`;
      });
    }
    await sql`insert into platform.person_blocks (from_person, to_person, origin_app, at) values (${P.a}, ${P.b}, 'ntwrk', now()), (${P.a}, ${P.c}, 'slop', now()), (${P.b}, ${P.c}, 'ntwrk', now())`;
  }, T);
  afterAll(async () => { await sql?.close(); await dropTestDb(); });

  test("no console role reads the view of every app; each app's role reads its own view; the shared role reads ntwrk's", async () => {
    for (const role of ["network_observatory", "network_observatory_ntwrk", "network_observatory_slop", "network_observatory_peon", "network_observatory_cross_app"]) {
      expect([role, await as(role, tx => tx`select id from network.network_state_console`)]).toEqual([role, denied]);
    }
    expect(await as("network_observatory_slop", tx => tx`select id from network.network_state_console_slop`)).toEqual({ v: [{ id: "slop:nyc" }] });
    expect(await as("network_observatory_slop", tx => tx`select id from network.network_state_console_ntwrk`)).toEqual(denied);
    expect(await as("network_observatory_ntwrk", tx => tx`select id from network.network_state_console_ntwrk`)).toEqual({ v: [{ id: "ntwrk:nyc" }] });
    expect(await as("network_observatory", tx => tx`select id from network.network_state_console_ntwrk`)).toEqual({ v: [{ id: "ntwrk:nyc" }] });
    expect(await as("network_observatory", tx => tx`select id from network.network_state_console_slop`)).toEqual(denied);
    // The cross-app role: trust levels and cases per app, nothing else from the stored state.
    const x = await as("network_observatory_cross_app", tx => tx`select * from network.network_state_console_cross_app order by app`) as { v: any[] };
    expect(x.v.map(r => [r.app, Object.keys(r).sort()])).toEqual([["ntwrk", ["app", "cases", "id", "saved_at", "trust"]], ["slop", ["app", "cases", "id", "saved_at", "trust"]]]);
  }, T);

  test("an app's role reads only blocks between two members of its app, never the whole table", async () => {
    expect(await as("network_observatory_slop", tx => tx`select from_person from platform.person_blocks`)).toEqual(denied);
    expect(await as("network_observatory_slop", tx => tx`select from_person, to_person from platform.person_blocks_slop`)).toEqual({ v: [{ from_person: P.a, to_person: P.c }] });
    expect(await as("network_observatory_ntwrk", tx => tx`select from_person, to_person from platform.person_blocks_ntwrk`)).toEqual({ v: [{ from_person: P.a, to_person: P.b }] });
    expect(await as("network_observatory_ntwrk", tx => tx`select 1 from platform.person_blocks_slop`)).toEqual(denied);
    // The view never says where a block was made.
    expect(await as("network_observatory_slop", tx => tx`select origin_app from platform.person_blocks_slop`)).toMatchObject({ e: expect.stringContaining("origin_app") });
  }, T);

  test("OBS-08: the cross-app role cannot read names, bios, ages or message texts; its counts work", async () => {
    const r = "network_observatory_cross_app";
    for (const q of [
      (tx: SQL) => tx`select name from network.members`, (tx: SQL) => tx`select bio from network.members`, (tx: SQL) => tx`select age from network.members`,
      (tx: SQL) => tx`select * from network.members`, (tx: SQL) => tx`select body from network.messages`, (tx: SQL) => tx`select * from network.messages`,
    ]) expect(await as(r, q)).toEqual(denied);
    expect(await as(r, tx => tx`select person_id from network.members where app_id = 'slop' and id = 's1'`)).toEqual({ v: [{ person_id: P.a }] });
    expect(await as(r, tx => tx`select count(*) filter (where direction = 'inbound')::int as n, max(ts) is not null as t from network.messages where app_id = 'slop' and member_id = 's1' and not system`))
      .toEqual({ v: [{ n: 1, t: true }] });
    expect(await as(r, tx => tx`select count(distinct opportunity_id)::int as n from network.participations where app_id = 'slop' and member_id = 's1' and role = 'participant'`)).toEqual({ v: [{ n: 0 }] });
  }, T);

  test("running the baseline schema again (it grants every table) does not open the view of every app", async () => {
    await sql.unsafe(await Bun.file(join(import.meta.dir, "..", "db", "schema.sql")).text());
    expect(await as("network_observatory", tx => tx`select id from network.network_state_console`)).toEqual(denied);
    expect(await as("network_observatory", tx => tx`select id from network.network_state_console_slop`)).toEqual(denied);
    expect(await as("network_observatory", tx => tx`select id from network.network_state_console_ntwrk`)).toEqual({ v: [{ id: "ntwrk:nyc" }] });
  }, T);

  test("golden: what each console role may select in the network and platform schemas", async () => {
    const roles = ["network_observatory", "network_observatory_ntwrk", "network_observatory_slop", "network_observatory_cross_app"];
    const rows = await sql`select r.rolname as role, n.nspname || '.' || c.relname as rel
      from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join pg_roles r
      where n.nspname in ('network', 'platform') and c.relkind in ('r', 'v', 'p') and r.rolname = any(${`{${roles.join(",")}}`}::text[])
        and has_table_privilege(r.oid, c.oid, 'select')
      order by 1, 2`;
    const by: Record<string, string[]> = Object.fromEntries(roles.map(r => [r, []]));
    for (const x of rows as { role: string; rel: string }[]) by[x.role]!.push(x.rel);
    // Nobody here reads phones, sessions, the raw stored state or the view of every app; only the cross-app role reads the whole blocks table (its person view).
    for (const r of roles) for (const rel of ["network.channel_identities", "network.network_state", "network.network_state_console", "platform.phone_identities", "platform.otp_challenges", "platform.sessions", ...(r.endsWith("cross_app") ? [] : ["platform.person_blocks"])]) {
      expect([r, rel, by[r]!.includes(rel)]).toEqual([r, rel, false]);
    }
    // Each app's role: its own console and blocks views only, no other app's.
    expect(by.network_observatory_slop!.filter(x => /console|person_blocks/.test(x))).toEqual(["network.network_state_console_slop", "platform.person_blocks_slop"]);
    expect(by.network_observatory_ntwrk!.filter(x => /console|person_blocks/.test(x))).toEqual(["network.network_state_console_ntwrk", "platform.person_blocks_ntwrk"]);
    expect(by.network_observatory!.filter(x => /console|person_blocks/.test(x))).toEqual(["network.network_state_console_ntwrk"]);
    // The cross-app role: no table of messages or members as a whole (column grants only).
    expect(by.network_observatory_cross_app!.filter(x => /console/.test(x))).toEqual(["network.network_state_console_cross_app"]);
    expect(by.network_observatory_cross_app).not.toContain("network.messages");
    expect(by.network_observatory_cross_app).not.toContain("network.members");
  }, T);
});
