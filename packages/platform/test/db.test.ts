// The migrations and the database guards: the runner, the platform schema, composite keys across
// apps, row-level security per app, the synthetic-phone guard, and the upgrade of a database that
// has only the old schema files (as every dev database has today).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { migrate, migrations } from "../../observatory/db/migrate.ts";
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
    // The list comes from the migrations folder (platform-M4): a new file needs no test change.
    expect(first.applied).toEqual(migrations().map(m => m.id));
    expect(first.applied).toContain("0007_friends_platform_safety");
    const second = await migrate(url);
    expect(second.applied).toEqual([]);
    const sql = new SQL({ url, max: 1 });
    try {
      const apps = await sql`select id, join_mode, min_join_age, min_match_age from platform.apps order by id`;
      expect(apps.map((a: any) => `${a.id}:${a.join_mode}:${a.min_join_age}:${a.min_match_age}`)).toEqual(["friends:open:13:18", "ntwrk:invite:13:18", "peon:open:13:18", "slop:open:13:18"]);
      // Migration 0011: the slop and peon packs are wired, so an admin may switch their matching on (the stored switch still starts off).
      const nets = await sql`select id, matching_enabled from platform.networks order by id`;
      expect(nets.map((n: any) => `${n.id}:${n.matching_enabled}`)).toEqual(["friends:nyc:true", "ntwrk:nyc:true", "peon:nyc:true", "slop:nyc:true"]);
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

  test("a database migrated before the rename keeps its rows: buddies becomes friends everywhere (0007)", async () => {
    const url = await emptyDb("rename"); urls.push(url);
    const all = migrations();
    const upTo = all.findIndex(m => m.id === "0007_friends_platform_safety");
    // Apply 0001-0006 by hand, as a dev database had them before 0007.
    const sql = new SQL({ url, max: 1 });
    try {
      for (const m of all.slice(0, upTo)) await sql.unsafe(await Bun.file(m.file).text());
      await sql`create table if not exists public.__migrations (id text primary key, checksum text not null, repeatable boolean not null default false, applied_at timestamptz not null default now())`;
      for (const m of all.slice(0, upTo)) await sql`insert into public.__migrations (id, checksum, repeatable) values (${m.id}, 'old', ${m.repeatable})`;
      const [p] = await sql`insert into platform.people (id) values (gen_random_uuid()) returning id`;
      await sql`insert into platform.phone_identities (e164, person_id, verified_at, method) values ('+12125550161', ${p.id}, now(), 'otp_sms')`;
      await sql`insert into platform.memberships (app_id, person_id, member_id, state, first_name) values ('buddies', ${p.id}, 'buddies_m1', 'active', 'Bea')`;
      await sql`insert into platform.consent_events (e164, app_id, state, source, at) values ('+12125550161', 'buddies', 'opted_in', 'web_form', now())`;
      await sql`insert into platform.audit (app_id, actor, action) values ('buddies', 'staff@x', 'read')`;
      await sql.begin(async tx => {
        await tx`select set_config('app.app_id', 'buddies', true)`;
        await tx`insert into network.members (id, app_id, name, home_city, person_id) values ('buddies_m1', 'buddies', 'Bea', 'nyc', ${p.id})`;
        await tx`insert into network.facets (id, app_id, member_id, kind, value, privacy_scope, provenance) values ('f1', 'buddies', 'buddies_m1', 'interest', 'chess', 'matchable', 'said')`;
      });
      await sql`insert into network.network_state (id, version, state) values ('buddies:nyc', 1, '{}'::jsonb)`;
      await sql`insert into network.staff_audit (actor, action, app_id) values ('staff@x', 'review', 'buddies')`;
    } finally { await sql.close(); }
    const r = await migrate(url);
    expect(r.applied).toContain("0007_friends_platform_safety");
    const db = new SQL({ url, max: 1 });
    try {
      const appIds = async (q: Promise<any[]>) => [...new Set((await q).map((x: any) => x.app_id))];
      expect(await appIds(db`select app_id from platform.memberships`)).toEqual(["friends"]);
      expect(await appIds(db`select app_id from platform.consent_events`)).toEqual(["friends"]);
      expect(await appIds(db`select app_id from platform.audit`)).toEqual(["friends"]);
      expect(await appIds(db`select app_id from network.members`)).toEqual(["friends"]);
      expect(await appIds(db`select app_id from network.facets`)).toEqual(["friends"]);
      expect(await appIds(db`select app_id from network.staff_audit`)).toEqual(["friends"]);
      expect((await db`select id, app_id from network.network_state`).map((x: any) => `${x.id}/${x.app_id}`)).toEqual(["friends:nyc/friends"]);
      expect((await db`select id from platform.apps order by id`).map((x: any) => x.id)).toEqual(["friends", "ntwrk", "peon", "slop"]);
      expect((await db`select id from platform.networks where app_id = 'friends'`).map((x: any) => x.id)).toEqual(["friends:nyc"]);
      // Nothing in the catalog of this database still names buddies: roles' grants, policies, views.
      const left = await db`select 'policy ' || policyname as x from pg_policies where policyname like '%buddies%'
        union all select 'view ' || viewname from pg_views where viewname like '%buddies%'
        union all select 'grant ' || grantee || ' ' || table_name from information_schema.role_table_grants where grantee like '%buddies%'`;
      expect(left).toEqual([]);
      // The composite keys are back: a friends facet still needs its friends member.
      expect(await db`insert into network.facets (id, app_id, member_id, kind, value, privacy_scope, provenance) values ('f2', 'friends', 'nobody', 'k', 'v', 'matchable', 'said')`.then(() => "ok", e => String(e.message))).toContain("foreign key");
    } finally { await db.close(); }
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

    test("platform-7 catalog: a console role selects only row-level-security tables, its own app's views and a fixed list; never network_state_console", async () => {
      const rows = await sql`
        select r.rolname as role, n.nspname || '.' || c.relname as rel, c.relkind as kind, c.relrowsecurity as rls
        from pg_roles r cross join pg_class c join pg_namespace n on n.oid = c.relnamespace
        where r.rolname like 'network\\_observatory%' and n.nspname in ('network', 'platform') and c.relkind in ('r', 'v', 'm', 'p', 'f')
          and has_table_privilege(r.oid, c.oid, 'select')
        order by 1, 2`;
      const apps = (await sql`select id from platform.apps order by id`).map((r: any) => r.id as string);
      expect(apps.length).toBeGreaterThanOrEqual(4);
      // Readable without row-level security, on purpose: app configuration, each app's own views (they
      // filter by app), the console's own ops and audit tables, and the cross-app safety role's person tables.
      const allowed = (role: string, rel: string): boolean => {
        if (["platform.apps", "platform.cities", "platform.networks"].includes(rel)) return true;
        const app = role === "network_observatory" ? "ntwrk" : role.slice("network_observatory_".length);
        if (apps.includes(app) && [`network.network_state_console_${app}`, `platform.person_blocks_${app}`].includes(rel)) return true;
        if (role === "network_observatory") return ["network.staff_audit", "platform.staff_roles", "network.ops_alerts", "network.ops_alert_posts"].includes(rel);
        if (role === "network_observatory_audit") return rel === "network.staff_audit";
        if (role === "network_observatory_cross_app") return ["network.network_state_console_cross_app", "platform.memberships", "platform.people", "platform.person_blocks"].includes(rel);
        return false;
      };
      const open = rows.filter((r: any) => !(r.kind === "r" && r.rls) && !allowed(r.role, r.rel)).map((r: any) => `${r.role} ${r.rel}`);
      expect(open).toEqual([]);
      expect(rows.filter((r: any) => r.rel === "network.network_state_console" || r.rel === "network.network_state")).toEqual([]);
      // No console role gets around row-level security.
      expect((await sql`select rolname from pg_roles where rolname like 'network\\_observatory%' and (rolsuper or rolbypassrls)`).map((r: any) => r.rolname)).toEqual([]);
      // Each app's view shows that app's state only (one stored state per app here).
      for (const app of apps) await sql`insert into network.network_state (id, version, state) values (${`${app}:catalog`}, 1, '{}'::jsonb) on conflict (id) do nothing`;
      for (const app of apps) {
        const seen = await sql.begin(async tx => {
          await tx.unsafe(`set local role network_observatory_${app}`);
          return tx.unsafe(`select id from network.network_state_console_${app} order by id`);
        });
        const mine = (await sql`select id from network.network_state where app_id = ${app} order by id`).map((r: any) => r.id);
        expect([app, seen.map((r: any) => r.id)]).toEqual([app, mine]);
        expect(mine).toContain(`${app}:catalog`);
      }
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

    test("PLAT-11 channel identities are per app: one phone in two apps, and the service role sees its app's phones only", async () => {
      await sql`insert into network.channel_identities (app_id, member_id, channel, address) values ('ntwrk', 'n1', 'sms', '+12125550171'), ('slop', 's1', 'sms', '+12125550171')`;
      const seen = await sql.begin(async tx => {
        await tx`set local role network_service`;
        await tx`select set_config('app.app_id', 'slop', true)`;
        return tx`select app_id, member_id from network.channel_identities`;
      });
      expect(seen.map((r: any) => `${r.app_id}:${r.member_id}`)).toEqual(["slop:s1"]);
      expect(await sql`insert into network.channel_identities (app_id, member_id, channel, address) values ('slop', 'n1', 'sms', '+12125550172')`.then(() => "ok", e => String(e.message))).toContain("foreign key");
    });

    test("PLAT-22 platform_service may not change apps, networks, lines, settings or staff roles, nor edit a consent event", async () => {
      const as = (q: (tx: SQL) => Promise<unknown>) => sql.begin(async tx => { await tx`set local role platform_service`; await q(tx); }).then(() => "ok", e => String(e.message));
      expect(await as(tx => tx`update platform.apps set min_join_age = 18`)).toContain("permission denied");
      expect(await as(tx => tx`insert into platform.staff_roles (email, role, granted_by) values ('x@y', 'admin', 'me')`)).toContain("permission denied");
      expect(await as(tx => tx`update platform.settings set value = 'dev'`)).toContain("permission denied");
      expect(await as(tx => tx`delete from platform.networks`)).toContain("permission denied");
      expect(await as(tx => tx`insert into platform.app_lines (line_e164, app_id, provider, env) values ('+12125550173', 'slop', 'blooio', 'dev')`)).toContain("permission denied");
      await sql`insert into platform.consent_events (e164, app_id, state, source, at) values ('+12125550174', 'slop', 'opted_out', 'keyword:stop', now())`;
      expect(await as(tx => tx`update platform.consent_events set state = 'opted_in' where e164 = '+12125550174'`)).toContain("permission denied");
      expect(await as(tx => tx`insert into platform.consent_events (e164, app_id, state, source, at) values ('+12125550174', 'slop', 'opted_in', 'web_form', now())`)).toBe("ok");
      // A retried message writes one event (the ref is unique per phone).
      await sql`insert into platform.consent_events (e164, app_id, state, source, ref, at) values ('+12125550175', null, 'opted_out', 'keyword:stop', 'in:1', now())`;
      expect(await sql`insert into platform.consent_events (e164, app_id, state, source, ref, at) values ('+12125550175', null, 'opted_out', 'keyword:stop', 'in:1', now())`.then(() => "ok", e => String(e.message))).toContain("duplicate");
      // The service role is the platform's text channel too: it inherits platform_service.
      expect(await sql.begin(async tx => { await tx`set local role network_service`; return tx`select count(*)::int as n from platform.phone_identities`; }).then(() => "ok", e => String(e.message))).toBe("ok");
    });

    test("platform.audit is append-only", async () => {
      await sql`insert into platform.audit (app_id, actor, action) values ('slop', 'staff@x', 'reveal')`;
      expect(await sql`delete from platform.audit`.then(() => "ok", e => String(e.message))).toContain("append-only");
    });
  });
});
