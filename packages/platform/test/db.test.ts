// The migrations and the database guards: the runner, the platform schema, composite keys across
// apps, row-level security per app, the synthetic-phone guard, and the upgrade of a database that
// has only the old schema files (as every dev database has today).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { migrate } from "../../observatory/db/migrate.ts";
import { dropDb, emptyDb, migratedDb, pgAvailable } from "./pg.ts";

const T = 120_000;
const urls: string[] = [];
afterAll(async () => { for (const u of urls) await dropDb(u); });

const member = (sql: SQL, app: string, id: string) =>
  sql`insert into network.members (id, app_id, name, home_city, account_status) values (${id}, ${app}, ${id}, 'nyc', 'active')`;

describe.skipIf(!pgAvailable)("migrations (Postgres)", () => {
  test("apply twice cleanly on a fresh database; the second run applies nothing", async () => {
    const url = await emptyDb("twice"); urls.push(url);
    const first = await migrate(url);
    expect(first.applied).toEqual(["0001_network_schema", "0002_network_state", "0003_platform", "0004_network_apps", "0005_console_apps", "0006_platform_safety"]);
    const second = await migrate(url);
    expect(second.applied).toEqual([]);
    const sql = new SQL({ url, max: 1 });
    try {
      const apps = await sql`select id, join_mode, min_join_age, min_match_age from platform.apps order by id`;
      expect(apps.map((a: any) => `${a.id}:${a.join_mode}:${a.min_join_age}:${a.min_match_age}`)).toEqual(["buddies:open:18:18", "ntwrk:invite:13:18", "peon:open:18:18", "slop:open:18:18"]);
      const nets = await sql`select id, matching_enabled from platform.networks order by id`;
      expect(nets.map((n: any) => `${n.id}:${n.matching_enabled}`)).toEqual(["buddies:nyc:true", "ntwrk:nyc:true", "peon:nyc:false", "slop:nyc:false"]);
      // A write with no app.app_id lands in the legacy app (ntwrk) until that setting is removed; then it fails.
      await sql`insert into network.members (id, name, home_city) values ('legacy', 'L', 'nyc')`;
      expect((await sql`select app_id from network.members where id = 'legacy'`)[0].app_id).toBe("ntwrk");
      await sql`delete from platform.settings where key = 'legacy_default_app'`;
      expect(await sql`insert into network.members (id, name, home_city) values ('noapp', 'N', 'nyc')`.then(() => "ok", e => String(e.message))).toContain("app.app_id is not set");
    } finally { await sql.close(); }
  }, T);

  test("an old database (schema files only, a legacy 'nyc' state) upgrades: rows backfilled to ntwrk, state id renamed", async () => {
    const url = await emptyDb("upgrade"); urls.push(url);
    const sql = new SQL({ url, max: 1 });
    try {
      await sql.unsafe(await Bun.file(new URL("../../observatory/db/schema.sql", import.meta.url).pathname).text());
      await sql.unsafe(await Bun.file(new URL("../../network/db/network-state.sql", import.meta.url).pathname).text());
      await sql`insert into network.members (id, name, home_city, age, joined_at) values ('a', 'A', 'nyc', 34, now()), ('b', 'B', 'nyc', null, now())`;
      // A legacy member texts from a phone; another from an Apple ID (not a phone: left as it is).
      await sql`insert into network.channel_identities (member_id, channel, address, is_primary) values ('a', 'imessage', '+12125550177', true), ('b', 'imessage', 'b@example.com', true)`;
      await sql`insert into network.edges (from_id, to_id, type) values ('a', 'b', 'knows')`;
      await sql`insert into network.network_state (id, version, state) values ('nyc', 1, '{}'::jsonb)`;
      const r = await migrate(url);
      expect(r.applied).toContain("0004_network_apps");
      expect((await sql`select distinct app_id from network.members`).map((x: any) => x.app_id)).toEqual(["ntwrk"]);
      expect((await sql`select app_id from network.edges`)[0].app_id).toBe("ntwrk");
      expect((await sql`select id, app_id from network.network_state`)[0]).toEqual({ id: "ntwrk:nyc", app_id: "ntwrk" });
      // Members from before the platform get a person, a phone and an ntwrk membership (export, stop and delete then work for them).
      const [pa] = await sql`select m.person_id, p.lowest_age, ph.e164, ms.state, ms.first_name from network.members m join platform.people p on p.id = m.person_id
        join platform.phone_identities ph on ph.person_id = p.id join platform.memberships ms on ms.member_id = m.id where m.id = 'a'`;
      expect(pa).toMatchObject({ lowest_age: 34, e164: "+12125550177", state: "active", first_name: "A" });
      expect((await sql`select person_id from network.members where id = 'b'`)[0].person_id).toBeNull();
    } finally { await sql.close(); }
  }, T);

  describe("guards", () => {
    let sql: SQL;
    beforeAll(async () => {
      const url = await migratedDb("guards"); urls.push(url);
      sql = new SQL({ url, max: 2 });
      await member(sql, "ntwrk", "n1"); await member(sql, "ntwrk", "n2");
      await member(sql, "slop", "s1"); await member(sql, "peon", "p1");
    }, T);
    afterAll(async () => { await sql?.close(); });

    test("a composite foreign key refuses an edge, a facet or a participation across apps", async () => {
      const err = (q: Promise<unknown>) => q.then(() => "ok", e => String(e.message));
      expect(await err(sql`insert into network.edges (app_id, from_id, to_id, type) values ('slop', 's1', 'p1', 'knows')`)).toContain("foreign key");
      expect(await err(sql`insert into network.edges (app_id, from_id, to_id, type) values ('ntwrk', 'n1', 's1', 'knows')`)).toContain("foreign key");
      expect(await err(sql`insert into network.facets (id, app_id, member_id, kind, value, privacy_scope, provenance) values ('f1', 'peon', 's1', 'k', 'v', 'matchable', 'said')`)).toContain("foreign key");
      await sql`insert into network.opportunities (id, app_id, kind, state, city, objective) values ('o1', 'ntwrk', 'intro', 'proposed', 'nyc', 'x')`;
      expect(await err(sql`insert into network.participations (app_id, opportunity_id, member_id, status) values ('ntwrk', 'o1', 's1', 'pending')`)).toContain("foreign key");
      expect(await err(sql`insert into network.edges (app_id, from_id, to_id, type) values ('ntwrk', 'n1', 'n2', 'knows')`)).toBe("ok");
    });

    test("row-level security: each app's console role reads its own rows only; the service role writes only its app", async () => {
      const as = (role: string, q: (tx: SQL) => Promise<any>, app?: string) => sql.begin(async tx => {
        await tx.unsafe(`set local role ${role}`);
        if (app) await tx.unsafe(`set local app.app_id = '${app}'`);
        return q(tx);
      });
      const ids = (rows: any[]) => rows.map(r => r.id).sort();
      expect(ids(await as("network_observatory_slop", tx => tx`select id from network.members`))).toEqual(["s1"]);
      expect(ids(await as("network_observatory_peon", tx => tx`select id from network.members`))).toEqual(["p1"]);
      // The original console role keeps reading The Network (ntwrk), as the observatory tests expect.
      expect(ids(await as("network_observatory", tx => tx`select id from network.members`))).toEqual(["n1", "n2"]);
      expect(await as("network_observatory_slop", tx => tx`select count(*)::int as n from network.edges where app_id = 'ntwrk'`)).toEqual([{ n: 0 }]);
      // No console role reads phones.
      expect(await as("network_observatory_slop", tx => tx`select 1 from platform.phone_identities`).then(() => "ok", e => String(e.message))).toContain("permission denied");
      // The service role in a slop unit of work: sees slop only, cannot write ntwrk rows.
      expect(ids(await as("network_service", tx => tx`select id from network.members`, "slop"))).toEqual(["s1"]);
      expect(await as("network_service", tx => tx`insert into network.members (id, app_id, name, home_city) values ('x', 'ntwrk', 'X', 'nyc')`, "slop").then(() => "ok", e => String(e.message))).toContain("row-level security");
      expect(await as("network_service", tx => tx`insert into network.members (id, name, home_city) values ('s2', 'S', 'nyc') returning app_id`, "slop")).toEqual([{ app_id: "slop" }]);
    });

    test("in production the synthetic 555-01xx numbers are refused", async () => {
      const add = (e164: string) => sql.begin(async tx => {
        const [p] = await tx`insert into platform.people (id) values (gen_random_uuid()) returning id`;
        await tx`insert into platform.phone_identities (e164, person_id, verified_at, method) values (${e164}, ${p.id}, now(), 'staff')`;
      }).then(() => "ok", e => String(e.message));
      expect(await add("+12125550101")).toBe("ok");
      await sql`update platform.settings set value = 'production' where key = 'environment'`;
      try {
        expect(await add("+12125550102")).toContain("synthetic phone");
        expect(await add("+12125551234")).toBe("ok");
      } finally {
        await sql`update platform.settings set value = 'dev' where key = 'environment'`;
      }
    });

    test("platform.audit is append-only", async () => {
      await sql`insert into platform.audit (app_id, actor, action) values ('slop', 'staff@x', 'reveal')`;
      expect(await sql`delete from platform.audit`.then(() => "ok", e => String(e.message))).toContain("append-only");
    });
  });
});
