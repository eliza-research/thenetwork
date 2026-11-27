// The migrations and the database guards: the runner, the platform schema, composite keys across
// apps, row-level security per app, the synthetic-phone guard, and the upgrade of a database that
// has only the old schema files (as every dev database has today).
import { fileAt } from "../../core/src/runtime/files.ts";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { migrate, migrations, withDevMigrationLock } from "../../db/migrate.ts";
import { PgPeopleStore } from "../src/pg-store.ts";
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
      // Migration 0011 + 0098: 4 apps x 5 launch cities; NYC rows keep matching_enabled = true, new city rows start false.
      const nets = await sql`select id, matching_enabled from platform.networks order by id`;
      expect(nets.map((n: any) => `${n.id}:${n.matching_enabled}`)).toEqual([
        "friends:chicago:false", "friends:la:false", "friends:miami:false", "friends:nyc:true", "friends:sf:false",
        "ntwrk:chicago:false", "ntwrk:la:false", "ntwrk:miami:false", "ntwrk:nyc:true", "ntwrk:sf:false",
        "peon:chicago:false", "peon:la:false", "peon:miami:false", "peon:nyc:true", "peon:sf:false",
        "slop:chicago:false", "slop:la:false", "slop:miami:false", "slop:nyc:true", "slop:sf:false",
      ]);
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
      await sql.unsafe(await fileAt(new URL("../../db/schema.sql", import.meta.url)).text());
      await sql.unsafe(await fileAt(new URL("../../network/db/network-state.sql", import.meta.url)).text());
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
    await withDevMigrationLock(url, async () => {
      try {
        for (const m of all.slice(0, upTo)) await sql.unsafe(await fileAt(m.file).text());
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
    });
    const parallel = await Promise.all(["rename_parallel_a", "rename_parallel_b"].map(emptyDb));
    urls.push(...parallel);
    const [r, ...fresh] = await Promise.all([url, ...parallel].map(database => migrate(database)));
    expect(r.applied).toContain("0007_friends_platform_safety");
    for (const result of fresh) expect(result.applied).toEqual(all.map(migration => migration.id));
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
      expect((await db`select id from platform.networks where app_id = 'friends' order by id`).map((x: any) => x.id)).toEqual([
        "friends:chicago", "friends:la", "friends:miami", "friends:nyc", "friends:sf",
      ]);
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
    let dbUrl = "";
    beforeAll(async () => {
      dbUrl = await migratedDb("guards"); urls.push(dbUrl);
      sql = new SQL({ url: dbUrl, max: 2 });
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
      // filter by app), the public event catalog used in snapshots, and scoped ops, audit and safety tables.
      const catalog = ["network.public_events", "network.public_event_imports"];
      const personAgeView = "platform.observatory_person_ages";
      const allowed = (role: string, rel: string): boolean => {
        if (["platform.apps", "platform.cities", "platform.networks", "platform.venues"].includes(rel)) return true;
        const app = role === "network_observatory" ? "ntwrk" : role.slice("network_observatory_".length);
        if (apps.includes(app) && [
          `network.network_state_console_${app}`, `network.outbound_evidence_${app}`, `network.booking_receipts_${app}`,
          `platform.person_blocks_${app}`, `platform.matching_ages_${app}`, `platform.teen_pair_avoid_members_${app}`,
        ].includes(rel)) return true;
        if (catalog.includes(rel)) return apps.includes(app) || role === "network_observatory_cross_app";
        if (role === "network_observatory") return ["network.staff_audit", "platform.staff_roles", "network.ops_alerts", "network.ops_alert_posts"].includes(rel);
        if (role === "network_observatory_audit") return rel === "network.staff_audit";
        if (role === "network_observatory_cross_app") return [
          "network.network_state_console_cross_app", "platform.memberships", "platform.people", "platform.person_blocks", personAgeView,
        ].includes(rel);
        return false;
      };
      const open = rows.filter((r: any) => !(r.kind === "r" && r.rls) && !allowed(r.role, r.rel)).map((r: any) => `${r.role} ${r.rel}`);
      expect(open).toEqual([]);
      const personAgeColumns = await sql`
        select attname as name, format_type(atttypid, atttypmod) as type from pg_attribute
        where attrelid = ${personAgeView}::regclass and attnum > 0 and not attisdropped order by attnum`;
      expect(personAgeColumns).toEqual([{ name: "person_id", type: "uuid" }, { name: "age", type: "integer" }]);
      const personAgeReaders = await sql`
        select r.rolname as role, n.nspname || '.' || c.relname as relation
        from pg_roles r cross join pg_class c join pg_namespace n on n.oid = c.relnamespace
        where (r.rolname like 'network\\_%' or r.rolname = 'platform_service') and n.nspname = 'platform'
          and c.relname in ('observatory_person_ages', 'signup_eligibility')
          and has_any_column_privilege(r.oid, c.oid, 'select')
        order by 1, 2`;
      expect(personAgeReaders).toEqual([
        { role: "network_observatory_cross_app", relation: personAgeView },
        { role: "network_service", relation: "platform.signup_eligibility" },
        { role: "platform_service", relation: "platform.signup_eligibility" },
      ]);
      const evidenceViews = ["outbound_evidence", "booking_receipts"];
      for (const view of evidenceViews) {
        const readers = rows.filter(r => r.rel.startsWith(`network.${view}_`)).map(r => `${r.role} ${r.rel}`);
        expect(readers.sort()).toEqual([
          `network_observatory network.${view}_ntwrk`,
          ...apps.map(app => `network_observatory_${app} network.${view}_${app}`),
        ].sort());
      }
      const catalogWriters = await sql`
        select r.rolname as role, c.relname as relation
        from pg_roles r cross join pg_class c join pg_namespace n on n.oid = c.relnamespace
        where r.rolname like 'network\\_observatory%' and n.nspname = 'network'
          and (c.relname in ('public_events', 'public_event_imports') or c.relname in ${sql(evidenceViews.flatMap(view => apps.map(app => `${view}_${app}`)))})
          and has_table_privilege(r.oid, c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')`;
      expect(catalogWriters).toEqual([]);
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

    test("birth readings, teen pool safety tables, and private age projection grants", async () => {
      const columns = async (table: string) => (await sql`select column_name from information_schema.columns
        where table_schema = 'platform' and table_name = ${table} order by ordinal_position`).map((r: any) => r.column_name as string);
      expect(await columns("people")).toEqual(expect.arrayContaining(["birth_date", "birth_lower", "birth_upper", "birth_youngest", "birth_first_exact"]));
      expect(await columns("age_floor")).toEqual(expect.arrayContaining(["birth_lower", "birth_upper", "birth_youngest"]));
      expect(await columns("pending_texts")).toContain("birth_date");
      expect((await sql`select to_regclass('platform.teen_age_confirmations') as t`)[0].t).toBeNull();
      expect(await columns("teen_pool_bars")).toEqual(["phone_hash", "reason", "at"]);
      expect(await columns("teen_pool_holds")).toEqual(["phone_hash", "app_id", "at"]);
      expect(await columns("teen_pair_avoid")).toEqual(["phone_hash_a", "phone_hash_b", "at"]);
      const internalAgeFacts = ["birth_date", "birth_lower", "birth_upper", "birth_youngest", "floor_birth_lower", "floor_birth_upper",
        "floor_birth_youngest", "teen_pool_barred", "teen_pool_held", "signup_minor_cap", "signup_age_observed"];
      const consoleAgeFacts = ["teen_pool_barred", "teen_pool_held", "signup_minor_cap", "signup_age_observed", "birth_exact", "age_conflict"];
      const privateBirthCols = ["birth_date", "birth_lower", "birth_upper", "birth_youngest", "floor_birth_lower", "floor_birth_upper", "floor_birth_youngest"];
      const apps = (await sql`select id from platform.apps order by id`).map((r: any) => r.id as string);
      const serviceCols = await columns("matching_ages");
      expect(serviceCols.slice(0, 8)).toEqual(["app_id", "member_id", "age", "banned", "staff_held", "report_held", "minor_signal_at", "birth_date"]);
      expect(serviceCols.slice(-internalAgeFacts.length)).toEqual(internalAgeFacts);
      expect(serviceCols.includes("teen_confirmed_birth")).toBe(false);
      for (const view of apps.map(app => `matching_ages_${app}`)) {
        const cols = await columns(view);
        expect([view, cols.slice(0, 7)]).toEqual([view, ["app_id", "member_id", "age", "banned", "staff_held", "report_held", "minor_signal_at"]]);
        expect([view, cols.slice(-consoleAgeFacts.length)]).toEqual([view, consoleAgeFacts]);
        for (const col of [...privateBirthCols, "teen_confirmed_birth"]) expect([view, col, cols.includes(col)]).toEqual([view, col, false]);
      }
      const can = async (role: string, table: string, privilege: string) =>
        (await sql`select has_table_privilege(${role}, ${`platform.${table}`}, ${privilege}) as ok`)[0].ok as boolean;
      for (const privilege of ["select", "insert", "update", "delete"]) expect(["teen_pool_bars", privilege, await can("network_service", "teen_pool_bars", privilege)]).toEqual(["teen_pool_bars", privilege, true]);
      for (const table of ["teen_pool_holds", "teen_pair_avoid"]) {
        for (const privilege of ["select", "insert", "delete"]) expect([table, privilege, await can("network_service", table, privilege)]).toEqual([table, privilege, true]);
        for (const privilege of ["select", "delete"]) expect([table, privilege, await can("platform_service", table, privilege)]).toEqual([table, privilege, true]);
        expect([table, await can("platform_service", table, "update")]).toEqual([table, false]);
      }
      expect([await can("platform_service", "teen_pair_avoid", "insert"), await can("platform_service", "teen_pool_holds", "insert")]).toEqual([true, false]);
      for (const table of ["teen_pool_bars", "teen_pool_holds", "teen_pair_avoid"]) {
        expect([table, await can("public", table, "select")]).toEqual([table, false]);
        for (const app of apps) expect([table, app, await can(`network_observatory_${app}`, table, "select")]).toEqual([table, app, false]);
      }
      expect([await can("platform_service", "teen_pool_bars", "insert"), await can("platform_service", "teen_pool_bars", "delete")]).toEqual([true, false]);
      expect(await can("platform_service", "person_minor_signals", "delete")).toBe(false);
      for (const role of ["public", "network_observatory", "network_observatory_cross_app", ...apps.map(app => `network_observatory_${app}`)]) {
        expect([role, await can(role, "signup_eligibility", "select")]).toEqual([role, false]);
      }
      expect(await columns("age_floor")).toContain("birth_first_exact");
      const readAs = (role: string, query: string) =>
        sql.begin(async tx => { await tx.unsafe(`set local role ${role}`); return tx.unsafe(query); }).then(() => "ok", e => String(e.message));
      for (const column of ["birth_date", "birth_lower", "birth_upper", "birth_youngest", "birth_first_exact"]) {
        expect([column, await readAs("network_observatory_cross_app", `select ${column} from platform.people limit 1`)]).toEqual([column, expect.stringContaining("permission denied")]);
      }
      expect(await readAs("network_observatory_cross_app", "select * from platform.people limit 1")).toContain("permission denied");
      expect(await readAs("network_observatory_cross_app", "select id, lowest_age, created_at, deleted_at from platform.people limit 1")).toBe("ok");
      const err = (q: Promise<unknown>) => q.then(() => "ok", e => String(e.message));
      const [p] = await sql`insert into platform.people (id) values (gen_random_uuid()) returning id`;
      expect(await err(sql`update platform.people set birth_date = 18991231, birth_lower = 18991230, birth_upper = 18991231, birth_youngest = 18991231 where id = ${p.id}`)).toContain("check");
      expect(await err(sql`update platform.people set birth_upper = 20100315 where id = ${p.id}`)).toContain("check");
      expect(await err(sql`update platform.people set birth_date = 20100315 where id = ${p.id}`)).toContain("check");
      expect(await err(sql`insert into platform.teen_pool_bars (phone_hash, reason, at) values ('h', 'because', now())`)).toContain("check");
      expect(await err(sql`update platform.people set birth_date = 20100315, birth_lower = 20100314, birth_upper = 20100315, birth_youngest = 20100315 where id = ${p.id}`)).toBe("ok");
    });

    test("0083: photo offers, drafts, page links and receive preferences; the photo wire columns and the choice list are gone", async () => {
      const columns = async (table: string) => (await sql`select column_name from information_schema.columns
        where table_schema = 'platform' and table_name = ${table} order by ordinal_position`).map((r: any) => r.column_name as string);
      expect(await columns("photo_relay_offers")).toEqual([]);
      expect(await columns("outbound")).not.toContain("approved_photos");
      const items = await columns("photo_relay_items");
      for (const gone of ["action_id", "delivery_intent", "delivery_expires_at"]) expect([gone, items.includes(gone)]).toEqual([gone, false]);
      expect(items).toContain("offer_id");
      expect(await columns("photos")).toEqual(expect.arrayContaining(["label", "batch_id"]));
      const apps = (await sql`select id from platform.apps order by id`).map((r: any) => r.id as string);
      const can = async (role: string, table: string, privilege: string) =>
        (await sql`select has_table_privilege(${role}, ${`platform.${table}`}, ${privilege}) as ok`)[0].ok as boolean;
      for (const table of ["photo_relay_drafts", "photo_offers", "photo_page_links", "photo_receive_prefs"]) {
        for (const privilege of ["select", "insert", "update", "delete"]) expect([table, privilege, await can("platform_service", table, privilege)]).toEqual([table, privilege, true]);
        expect([table, await can("platform_service", table, "truncate")]).toEqual([table, false]);
        expect([table, await can("public", table, "select")]).toEqual([table, false]);
        for (const app of apps) expect([table, app, await can(`network_observatory_${app}`, table, "select")]).toEqual([table, app, false]);
      }
      const err = (q: Promise<unknown>) => q.then(() => "ok", e => String(e.message));
      const [p] = await sql`insert into platform.people (id) values (gen_random_uuid()) returning id`;
      const photo = (id: string, label: string | null) => sql`insert into platform.photos (id, person_id, app_id, storage_key, content_type, bytes, sha256, consent_version, created_at, stored_at, label)
        values (${id}, ${p.id}, 'slop', ${id.slice(3).padEnd(48, "0")}, 'image/jpeg', 10, ${"a".repeat(64)}, 'v', now(), now(), ${label})`;
      expect(await err(photo(`ph_${"1".repeat(24)}`, "Beach"))).toContain("check");
      expect(await err(photo(`ph_${"2".repeat(24)}`, "beach day"))).toBe("ok");
      expect(await err(photo(`ph_${"3".repeat(24)}`, "beach day"))).toContain("duplicate");
      expect(await err(sql`insert into platform.photo_page_links (id, person_id, app_id, purpose, issued_at, expires_at)
        values (${"b".repeat(64)}, ${p.id}, 'slop', 'view', now(), now() + interval '1 hour')`)).toContain("check");
    });

    test("0085: relay items wait for the automatic check, view links have no expiry, and the view window is gone", async () => {
      const columns = async (table: string) => (await sql`select column_name from information_schema.columns
        where table_schema = 'platform' and table_name = ${table} order by ordinal_position`).map((r: any) => r.column_name as string);
      const offers = await columns("photo_offers");
      for (const gone of ["ready_by", "view_until"]) expect([gone, offers.includes(gone)]).toEqual([gone, false]);
      expect(offers).toContain("taken_back_ids");
      expect(await columns("photo_relay_items")).toEqual(expect.arrayContaining(["screen_attempts", "screen_at"]));
      const definition = async (name: string) => String((await sql`select pg_get_constraintdef(c.oid) as def from pg_constraint c join pg_namespace n on n.oid = c.connamespace
        where n.nspname = 'platform' and c.conname = ${name}`)[0]?.def ?? "");
      const phases = await definition("photo_offers_phase_check");
      expect(phases).toContain("ready");
      expect(phases).not.toMatch(/'(viewing|closed)'/);
      expect(await definition("photo_relay_items_state_check")).toContain("screening");
      expect(await definition("photo_relay_items_screen_at")).toContain("screen_at IS NOT NULL");
      expect(await definition("photo_page_links_view_open")).toContain("expires_at IS NULL");
      const err = (q: Promise<unknown>) => q.then(() => "ok", e => String(e.message));
      const [p] = await sql`insert into platform.people (id) values (gen_random_uuid()) returning id`;
      expect(await err(sql`insert into platform.photo_page_links (id, person_id, app_id, purpose, issued_at, expires_at)
        values (${"c".repeat(64)}, ${p.id}, 'slop', 'mine', now(), null)`)).toContain("check");
      expect(await err(sql`insert into platform.photo_page_links (id, person_id, app_id, purpose, issued_at, expires_at)
        values (${"d".repeat(64)}, ${p.id}, 'slop', 'mine', now(), now() + interval '15 minutes')`)).toBe("ok");
    });

    test("0088: a ready offer does not hold its pair, and a block, a ban, a hold, a report hold or erasure records an end fact on the open offers of that person only", async () => {
      const err = (q: Promise<unknown>) => q.then(() => "ok", e => String(e.message));
      const person = async () => (await sql`insert into platform.people (id) values (gen_random_uuid()) returning id`)[0].id as string;
      let n = 0;
      const offer = async (from: string, to: string, phase: string, app = "slop") => {
        const id = `pof_${crypto.randomUUID().replaceAll("-", "")}`;
        n++;
        await sql`insert into platform.photo_offers (id, request_key, app_id, thread_id, sender_person_id, recipient_person_id, sender_member_id, recipient_member_id,
            photo_ids, photo_sha256, photo_count, consent_id, consented_at, policy_version, phase, answer_by, created_at, changed_at, checked_at)
          values (${id}, ${`rk0088_${id}`}, ${app}, 'thread_0088', ${from}::uuid, ${to}::uuid, ${`m0088_${n}_a`}, ${`m0088_${n}_b`},
            ${[`ph_${"a".repeat(24)}`]}::text[], ${["a".repeat(64)]}::text[], 1, ${`pcn0088_${id}`}, now(), 'v', ${phase}, now() + interval '1 day', now(), now(), now())`;
        return id;
      };
      const ended = async (ids: string[]) => {
        const rows = await sql<{ id: string; party_ended: boolean }[]>`select id, party_ended from platform.photo_offers where id = any(${ids}::text[])`;
        return ids.map(id => rows.find(r => r.id === id)!.party_ended);
      };

      const a = await person(), b = await person(), c = await person();
      const ready1 = await offer(a, b, "ready"), ready2 = await offer(a, b, "ready");
      const asking = await offer(a, b, "asking");
      expect(await err(offer(a, b, "reviewing"))).toContain("photo_offers_one_open");
      const declined = await offer(a, b, "declined");
      const other = await offer(a, c, "ready");
      const back = await offer(b, a, "ready");
      await sql`insert into platform.person_blocks (from_person, to_person, origin_app, at) values (${b}::uuid, ${a}::uuid, 'slop', now())`;
      expect(await ended([ready1, ready2, asking, declined, other, back])).toEqual([true, true, true, false, false, true]);

      const banned = await person(), friend = await person();
      const toBanned = await offer(friend, banned, "ready"), fromFriend = await offer(friend, c, "asking");
      await sql`insert into platform.bans (id, scope, person_id, reason, banned_by) values (${`ban0088_${banned}`}, 'person', ${banned}::uuid, 'fixture', 'staff_fixture')`;
      expect(await ended([toBanned, fromFriend])).toEqual([true, false]);

      const held = await person(), peer = await person();
      const slopOffer = await offer(held, peer, "ready", "slop"), friendsOffer = await offer(peer, held, "ready", "friends");
      await sql`insert into platform.staff_safety_holds (person_id, app_id, decision_id, held_at, released_apps) values (${held}::uuid, null, gen_random_uuid(), now(), '{friends}')`;
      expect(await ended([slopOffer, friendsOffer])).toEqual([true, false]);
      await sql`update platform.staff_safety_holds set released_apps = '{}' where person_id = ${held}::uuid and app_id is null`;
      expect(await ended([slopOffer, friendsOffer])).toEqual([true, true]);

      const reported = await person(), other2 = await person();
      const reportedSlop = await offer(other2, reported, "reviewing", "slop"), reportedFriends = await offer(other2, reported, "ready", "friends");
      await sql`insert into platform.report_safety_carryovers (app_id, origin_runtime_id, report_id, person_id) values ('slop', 'slop:nyc', 'report_0088', ${reported}::uuid)`;
      expect(await ended([reportedSlop, reportedFriends])).toEqual([true, false]);

      const erased = await person(), other3 = await person();
      const erasedOffer = await offer(erased, other3, "ready");
      await sql`update platform.people set deleted_at = now() where id = ${erased}::uuid`;
      expect(await ended([erasedOffer])).toEqual([true]);
    });

    test("platform.audit is append-only", async () => {
      await sql`insert into platform.audit (app_id, actor, action) values ('slop', 'staff@x', 'reveal')`;
      expect(await sql`delete from platform.audit`.then(() => "ok", e => String(e.message))).toContain("append-only");
    });

    test("PgPeopleStore.withLock runs distinct keys concurrently while serializing the same key", async () => {
      const store = new PgPeopleStore(dbUrl);
      try {
        let releaseA!: () => void;
        let enteredA!: () => void;
        const aEntered = new Promise<void>(r => { enteredA = r; });
        const aHold = new Promise<void>(r => { releaseA = r; });
        const events: string[] = [];

        const firstA = store.withLock("phone-a", async () => {
          events.push("a1-start");
          enteredA();
          await aHold;
          events.push("a1-end");
          return "a1";
        });
        await aEntered;

        const secondA = store.withLock("phone-a", async () => {
          events.push("a2");
          return "a2";
        });

        // A distinct key must complete while phone-a is still held.
        const bDone = await store.withLock("phone-b", async () => {
          events.push("b");
          return "b";
        });
        expect(bDone).toBe("b");
        expect(events).toEqual(["a1-start", "b"]);

        releaseA();
        expect(await Promise.all([firstA, secondA])).toEqual(["a1", "a2"]);
        expect(events).toEqual(["a1-start", "b", "a1-end", "a2"]);
      } finally {
        await store.close();
      }
    });
  });
});
