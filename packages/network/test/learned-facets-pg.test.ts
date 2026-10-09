// What the Network learns from a member's texts lands in network.facets (runtime.ts writeLearned,
// learned.ts): interests matchable, slop's tags agent_private, a correction replaces the old row, and
// settings by text (pause, quiet hours) reach network.members. A NetworkRuntime on its own database
// (network_test_member_intents) on the local dev cluster; skipped without Postgres.
import { afterAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { SimClock } from "@thenetwork/core";
import { DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { migrate } from "../../observatory/db/migrate.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";
import { APPS } from "../../platform/src/apps.ts";
import { NetworkRuntime } from "../service/runtime.ts";

const T = 120_000;
const USER = process.env.USER ?? "postgres";
const DB = "network_test_member_intents";
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;

async function admin(q: string) {
  const sql = new SQL({ url: `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`, max: 1 });
  try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); }
}

let sql: SQL | undefined;
afterAll(async () => {
  await sql?.close();
  if (pgAvailable) await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
});

describe.skipIf(!pgAvailable)("learned facets in Postgres", () => {
  test("interests and slop tags are mirrored into network.facets; a correction replaces the old row; settings reach the member row", async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    await migrate(URL_, { lockTimeout: "5s" });
    sql = new SQL({ url: URL_, max: 4 });
    const clock = new SimClock(Date.UTC(2026, 9, 6, 16));
    await sql.begin(async tx => {
      await tx`select set_config('app.app_id', 'slop', true)`;
      await tx`insert into network.members (app_id, id, name, home_city, account_status, age, prefs, joined_at)
        values ('slop', 'mi-s1', 'Sam', 'nyc', 'active', 31, ${{ categoriesOptIn: ["romance"], romanceOptIn: true, quietHours: [21, 9], formats: ["one_to_one"], maxTravelMinutes: 45, onlyWhenAsked: false }}::jsonb, ${new Date(clock.now())})`;
    });
    const rt = new NetworkRuntime({ sql, clock, instance: "test", log: () => {}, capRefused: async () => new Set() }, { id: "slop:nyc", app: APPS.slop, city: "nyc", matchingAllowed: false });
    let n = 0;
    const say = async (body: string) => {
      await rt.unitOfWork(net => net.onInbound({ id: `mi-${++n}`, memberId: "mi-s1", body, ts: clock.now(), channel: "imessage" }));
      clock.advance(20 * 60_000);
    };
    const facets = async () => (await sql!`select id, kind, value, tags, privacy_scope, provenance, source from network.facets where app_id = 'slop' and member_id = 'mi-s1' order by id`) as any[];
    for (const t of ["hi", "I'm into jazz and hiking", "Weekends", "One on one"]) await say(t);
    await say("actually I'm a man looking for women, 25-30");
    let rows = await facets();
    const byId = new Map(rows.map(r => [r.id, r]));
    expect(byId.get("mi-s1:chat:i:jazz")).toMatchObject({ kind: "interest", privacy_scope: "matchable", provenance: "said", source: "chat" });
    expect(byId.get("mi-s1:chat:app:romance:age:25-30")).toMatchObject({ privacy_scope: "agent_private", provenance: "said" });
    expect(byId.get("mi-s1:chat:app:romance:seeks:woman")?.privacy_scope).toBe("agent_private");
    // A correction: the old age range row is gone, the new one is there.
    await say("actually 30-40");
    rows = await facets();
    expect(rows.some(r => r.id === "mi-s1:chat:app:romance:age:25-30")).toBe(false);
    expect(rows.some(r => r.id === "mi-s1:chat:app:romance:age:30-40")).toBe(true);
    // The member's own export reads non-private facets: the learned interests are there now, the tags are not.
    const exported = (await sql`select tags from network.facets where app_id = 'slop' and member_id = 'mi-s1' and privacy_scope <> 'agent_private'`) as any[];
    expect(exported.flatMap(r => r.tags)).toContain("jazz");
    expect(exported.flatMap(r => r.tags).some((t: string) => t.startsWith("romance:"))).toBe(false);
    // Settings by text reach the member row; the next unit reads them back with no change.
    await say("pause for two weeks");
    await say("no texts after 8pm");
    const [m] = (await sql`select participation_state, prefs from network.members where app_id = 'slop' and id = 'mi-s1'`) as any[];
    expect(m.participation_state).toBe("paused");
    expect((typeof m.prefs === "string" ? JSON.parse(m.prefs) : m.prefs).quietHours).toEqual([20, 9]);
    await say("what do you know about me?");
    const state = await rt.readState(net => net.memberList().find(x => x.id === "mi-s1")!);
    expect(state.state).toBe("paused");
    expect(state.quietHours).toEqual([20, 9]);
    // Rows are written once: a unit that learned nothing changes nothing.
    const before = JSON.stringify(await facets());
    await say("thanks");
    expect(JSON.stringify(await facets())).toBe(before);
  }, T);
});
