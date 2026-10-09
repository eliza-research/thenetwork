// The migration runner (db/migrate.ts): an empty database, a second run, two runners at once, an
// upgrade from the previous release's schema with data in it, and --plan (pending migrations, a
// baseline edited in place, a numbered migration edited after it ran). Databases of their own on the
// dev cluster (platform_test_<pid>_<name>), dropped after.
import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { SQL } from "bun";
import { migrate, migrations, plan } from "../db/migrate.ts";
import { dropDb, emptyDb, pgAvailable } from "../../platform/test/pg.ts";

const T = 120_000;
const REPO = resolve(import.meta.dir, "../../..");
/** The last commit before migrations 0015 and 0016 (origin/main on 2026-10-08): the previous release's schema. */
const PREVIOUS_RELEASE = "6a55050";
const urls: string[] = [];
afterAll(async () => { for (const u of urls) await dropDb(u); });

const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const git = (args: string[]) => { const r = Bun.spawnSync(["git", "-C", REPO, ...args]); return r.exitCode === 0 ? r.stdout.toString() : undefined; };
const previousAvailable = git(["cat-file", "-e", `${PREVIOUS_RELEASE}^{commit}`]) !== undefined;

describe.skipIf(!pgAvailable)("migrate.ts (Postgres)", () => {
  test("an empty database gets every migration; a second run applies nothing; --plan agrees", async () => {
    const url = await emptyDb("mig_empty"); urls.push(url);
    const before = await plan(url);
    expect(before.pending).toEqual(migrations().map(m => m.id));
    const first = await migrate(url, { lockTimeout: "5s" });
    expect(first.applied).toEqual(migrations().map(m => m.id));
    expect(first.applied).toContain("0015_cost_ledger");
    expect(first.applied).toContain("0016_run_inputs");
    const second = await migrate(url, { lockTimeout: "5s" });
    expect(second.applied).toEqual([]);
    const after = await plan(url);
    expect([after.pending, after.changedBaselines, after.edited]).toEqual([[], [], []]);
    expect(after.upToDate.length).toBe(migrations().length);
  }, T);

  test("two runners at once: the advisory lock lets one apply, the other finds nothing to do", async () => {
    const url = await emptyDb("mig_lock"); urls.push(url);
    const [a, b] = await Promise.all([migrate(url, { lockTimeout: "60s" }), migrate(url, { lockTimeout: "60s" })]);
    const all = migrations().map(m => m.id);
    expect([...a.applied, ...b.applied].sort()).toEqual([...all].sort());
    expect(a.applied.length === 0 || b.applied.length === 0).toBe(true);
    const sql = new SQL({ url, max: 1 });
    try {
      const [n] = await sql`select count(*)::int as n from public.__migrations`;
      expect(n.n).toBe(all.length);
    } finally { await sql.close(); }
  }, T);

  test.skipIf(!previousAvailable)("upgrade from the previous release's schema keeps the data and adds 0015 and 0016", async () => {
    const url = await emptyDb("mig_upgrade"); urls.push(url);
    // The previous release's runner, by hand: the same files in the same order, the same ledger rows.
    const files = git(["ls-tree", "--name-only", `${PREVIOUS_RELEASE}`, "packages/observatory/db/migrations/"])!.trim().split("\n").filter(f => /\/\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
    const old = [
      { id: "0001_network_schema", path: "packages/observatory/db/schema.sql", repeatable: true },
      { id: "0002_network_state", path: "packages/network/db/network-state.sql", repeatable: true },
      ...files.map(f => ({ id: f.split("/").pop()!.replace(/\.sql$/, ""), path: f, repeatable: false })),
      { id: "9001_oauth_schema", path: "packages/mcp/db/oauth.sql", repeatable: true },
      { id: "9002_notify_schema", path: "packages/notify/db/schema.sql", repeatable: true },
    ];
    expect(old.some(m => m.id === "0015_cost_ledger")).toBe(false);
    const sql = new SQL({ url, max: 1 });
    try {
      await sql.begin(async tx => {
        await tx.unsafe(`create table public.__migrations (id text primary key, checksum text not null, repeatable boolean not null default false, applied_at timestamptz not null default now())`);
        for (const m of old) {
          const text = git(["show", `${PREVIOUS_RELEASE}:${m.path}`])!;
          await tx.unsafe(text);
          await tx`insert into public.__migrations (id, checksum, repeatable) values (${m.id}, ${sha(text)}, ${m.repeatable})`;
        }
      });
      // Data written by the previous release.
      await sql`insert into network.members (id, app_id, name, home_city, account_status, age) values ('m1', 'slop', 'A', 'nyc', 'active', 30), ('m2', 'slop', 'B', 'nyc', 'active', 31)`;
      await sql`insert into network.messages (id, app_id, member_id, direction, body, status, ts) values ('x1', 'slop', 'm1', 'outbound', 'hi', 'delivered', now())`;
      await sql`insert into network.events (app_id, at, actor_type, type, payload) values ('slop', now(), 'agent', 'member_joined', '{}')`;
      await sql`insert into network.matching_runs (id, app_id, at, engine_version, proposals, summary) values ('slop.r1', 'slop', now(), 'engine-v1', 0, '{}')`;
      const count = async () => {
        const rows = await sql`select (select count(*) from network.members)::int as members, (select count(*) from network.messages)::int as messages,
          (select count(*) from network.events)::int as events, (select count(*) from network.matching_runs)::int as runs`;
        return rows[0];
      };
      const was = await count();

      const p = await plan(url);
      expect(p.pending).toContain("0015_cost_ledger");
      expect(p.pending).toContain("0016_run_inputs");
      expect(p.edited).toEqual([]);
      const r = await migrate(url, { lockTimeout: "5s" });
      expect(r.applied).toContain("0015_cost_ledger");
      expect(r.applied).toContain("0016_run_inputs");
      expect(await count()).toEqual(was);
      const [t] = await sql`select to_regclass('network.llm_usage') as a, to_regclass('network.usage_daily') as b, to_regclass('network.matching_run_inputs') as c`;
      expect([t.a, t.b, t.c].every(Boolean)).toBe(true);
      expect((await migrate(url, { lockTimeout: "5s" })).applied).toEqual([]);
    } finally { await sql.close(); }
  }, T);

  test("--plan reports a baseline edited in place (it runs again, logged) and a numbered migration edited after it ran", async () => {
    const url = await emptyDb("mig_plan"); urls.push(url);
    await migrate(url, { lockTimeout: "5s" });
    const sql = new SQL({ url, max: 1 });
    try {
      await sql`update public.__migrations set checksum = 'old' where id in ('0001_network_schema', '0012_person_cap_release')`;
    } finally { await sql.close(); }
    const p = await plan(url);
    expect(p.changedBaselines).toEqual(["0001_network_schema"]);
    expect(p.edited).toEqual(["0012_person_cap_release"]);
    expect(p.pending).toEqual([]);
    const lines: string[] = [];
    const r = await migrate(url, { lockTimeout: "5s", log: s => lines.push(s) });
    expect(r.applied).toEqual(["0001_network_schema"]);
    expect(lines.some(l => l.includes("re-running 0001_network_schema"))).toBe(true);
    expect(lines.some(l => l.includes("warning: 0012_person_cap_release changed"))).toBe(true);
    // The CLI prints the same plan and applies nothing.
    const cli = Bun.spawnSync(["bun", "run", resolve(import.meta.dir, "../db/migrate.ts"), "--plan", "--url", url]);
    expect(cli.exitCode).toBe(0);
    expect(cli.stdout.toString()).toContain("edited    0012_person_cap_release");
  }, T);
});
