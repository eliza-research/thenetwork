// Integration: a weekly bias report that can measure no group, in the ops alert round (createOps, the
// runtime probe and PgAlertStore) on the dev Postgres (:54339), in a database of its own. Such a report
// has no alerts, so before SD-237 it read as a clean pass: the ops round raised nothing, and the 0.8x
// "pause" rule of the pilot could not be checked without anyone being told. Skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../packages/observatory/db/dev-pg.ts";
import { pgAvailable } from "../../packages/observatory/test/pg.ts";
import { biasReport, type BiasMember } from "../../packages/network/service/bias.ts";
import { createOps, opsConfigFromEnv, PgAlertStore, runtimeProbe, type Notice } from "./ops.ts";

const user = process.env.USER ?? "postgres";
const DB = `ops_bias_blind_${process.pid}`;
const ADMIN_URL = `postgres://${user}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${user}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }
const MIN = 60_000, DAY = 24 * 60 * MIN;
const T0 = Date.UTC(2026, 9, 20, 15);

let sql: SQL;

describe.skipIf(!pgAvailable)("ops alerts: a bias report that measures nothing (SD-237)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    await applySchema(URL_, { lockTimeout: "5s" });
    sql = new SQL({ url: URL_, max: 2 });
  }, 120_000);
  afterAll(async () => {
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("a report with no group to compare (rater off, no outcomes) raises bias_blind; a report that can compare groups ends it", async () => {
    await sql`insert into network.network_state (id, version, state, saved_at) values ('slop:nyc', 1, ${{ reports: [] }}::jsonb, ${new Date(T0 - MIN)})`;
    const store = async (at: number, members: BiasMember[], opps: Parameters<typeof biasReport>[3]) => {
      const r = biasReport("slop:nyc", "slop", members, opps, at);
      await sql`insert into network.bias_reports (app_id, id, network_id, at, members, alerts, report)
        values ('slop', ${`bias_slop:nyc_${at}`}, 'slop:nyc', ${new Date(at)}, ${r.members}, ${r.report.alerts.length}, ${r.report as never}::jsonb)`;
      return r;
    };
    // The weekly report the service writes with the rater off: 12 adults, all "unrated", no dates yet.
    const unrated = Array.from({ length: 12 }, (_, i): BiasMember => ({ id: `m${i}` as never, age: 30, joinedAt: T0 - 20 * DAY, tags: [] }));
    const blind = await store(T0 - MIN, unrated, []);
    expect(blind.report.alerts).toEqual([]);

    let now = T0;
    const probe = runtimeProbe({
      id: "slop:nyc", app: { id: "slop" },
      health: async () => ({ lastTick: { stored: now - MIN, savedAt: now - MIN }, backlog: { review: 0, reviewOverdue: 0, deferred: 0, outboundWaiting: 0 } }),
      scoped: fn => sql.begin(async tx => { await tx`select set_config('app.app_id', 'slop', true)`; return fn(tx as unknown as SQL); }) as never,
    });
    const posts: Notice[][] = [];
    const ops = createOps({
      config: opsConfigFromEnv({}, { env: "test", build: "b", deployed: false }), probes: () => [probe], store: new PgAlertStore(sql), now: () => now,
      log: { info() {}, warn() {}, error() {} }, post: async body => { posts.push(body.alerts as Notice[]); return true; },
    });
    await ops.tick();
    expect(posts.flat().filter(n => n.state === "firing").map(n => n.key)).toEqual(["bias_blind:slop:nyc"]);

    // The next report can compare groups: the rater is on, 40 rated adults in five quintiles of 8, with dates.
    now += 7 * DAY;
    const all = Array.from({ length: 40 }, (_, i): BiasMember => ({ id: `r${i}` as never, age: 30, joinedAt: T0 - 20 * DAY,
      tags: [`appearance:face=${i / 40}`, `appearance:body=${i / 40}`, `appearance:overall=${i / 40}`, "appearance:conf=0.9"] }));
    const opps = all.slice(0, 20).map((m, i) => ({ participants: [m.id, all[39 - i]!.id], contacted: new Set([m.id, all[39 - i]!.id]), stage: "done", createdAt: now - 10 * DAY, meetingAt: now - 9 * DAY }));
    const seen = await store(now - MIN, all, opps);
    expect(Object.values(seen.report.groups).filter(g => g.n >= 8).length).toBeGreaterThanOrEqual(2);
    await ops.tick();
    expect(posts.flat().filter(n => n.state === "resolved").map(n => n.key)).toEqual(["bias_blind:slop:nyc"]);
  }, 120_000);
});
