// Integration: the members of a weekly bias report (NetworkService.weeklyBias) when one app has two
// networks (slop:nyc and slop:sf) on the dev Postgres (:54339), in a database of its own. The report
// counts the opportunities of one network, so it must count the members of that network only: the
// members whose home the runtime owns (conversationCities, as the snapshot and the address book do).
// Before the fix each report held every slop member, and the members of the other city added rows
// with 0 outcomes to the rate and the quintiles (SD-447).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { SimClock } from "@thenetwork/core";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";
import { NetworkService } from "../service/service.ts";
import { START } from "./mini.ts";

const user = process.env.USER ?? "postgres";
const DB = `bias_scope_${process.pid}`;
const ADMIN_URL = `postgres://${user}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${user}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }
const DAY = 86_400_000;

let sql: SQL;
let svc: NetworkService | undefined;

describe.skipIf(!pgAvailable)("weekly bias report: the members of one network (SD-447)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    await applySchema(URL_, { lockTimeout: "5s" });
    sql = new SQL({ url: URL_, max: 2 });
  }, 120_000);
  afterAll(async () => {
    await svc?.close().catch(() => {});
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("with slop:nyc and slop:sf, each report counts the adult members of its own city only", async () => {
    await sql`insert into platform.networks (id, app_id, city, matching_enabled) values ('slop:sf', 'slop', 'sf', true) on conflict (id) do nothing`;
    const joined = new Date(START - 10 * DAY);
    for (const [id, city] of [["n1", "nyc"], ["n2", "nyc"], ["s1", "sf"], ["s2", "sf"], ["s3", "sf"]] as const) {
      await sql`insert into network.members (app_id, id, name, home_city, account_status, age, joined_at) values ('slop', ${id}, ${`Member ${id}`}, ${city}, 'active', 30, ${joined})`;
    }
    svc = new NetworkService({ url: URL_, clock: new SimClock(START), env: { PLATFORM_ENV: "dev" }, instance: "bias-scope",
      networks: [{ id: "slop:nyc" }, { id: "slop:sf" }], notify: false, log: () => {} });
    const nyc = await svc.weeklyBias(svc.runtimeFor("slop", "nyc")!, true);
    const sf = await svc.weeklyBias(svc.runtimeFor("slop", "sf")!, true);
    expect([nyc?.network, nyc?.members]).toEqual(["slop:nyc", 2]);
    expect([sf?.network, sf?.members]).toEqual(["slop:sf", 3]);
  }, 120_000);
});
