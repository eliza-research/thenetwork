// Integration: opportunity and request ids of two networks of one app (ntwrk:nyc and ntwrk:sf, the
// multi-city path tests/e2e/platform.e2e.test.ts runs) on the dev Postgres (:54339), in a database of its
// own. network.opportunities, network.participations and network.requests have global primary keys, so
// the ids two networks mint must differ, or one network's save overwrites the other's rows (SD-111).
// Skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { existsSync } from "node:fs";
import { DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { PgStore } from "../src/index.ts";
import { Mini, type Spec } from "./mini.ts";

const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const DB = `network_ids_${process.pid}`;
const ADMIN_URL = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }
const climber = (id: string, name: string, wants = true): Spec => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: wants ? [{ objective: "find a regular climbing partner", category: "hobby" }] : [] });
const ASK = "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.";

describe.skipIf(!pgAvailable)("two networks of one app: ids (SD-111)", () => {
  const stores: PgStore[] = [];
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    const setup = new SQL({ url: URL_, max: 1 });
    await setup.unsafe(await Bun.file(new URL("../../observatory/db/schema.sql", import.meta.url)).text());
    await setup.close();
  }, 120_000);
  afterAll(async () => {
    for (const s of stores) await s.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("a request in ntwrk:sf does not overwrite the opportunity, participants and request of ntwrk:nyc", async () => {
    const nycStore = new PgStore(URL_, "ntwrk:nyc"), sfStore = new PgStore(URL_, "ntwrk:sf");
    stores.push(nycStore, sfStore);
    await nycStore.migrate();
    const nycPeople = [climber("r", "Rae Kim", false), climber("c1", "Cal One"), climber("c2", "Cleo Two"), climber("c3", "Cass Three")];
    const sfPeople = [climber("s", "Sam Lee", false), climber("d1", "Dee One"), climber("d2", "Dan Two"), climber("d3", "Dot Three")];
    for (const p of [...nycPeople, ...sfPeople]) await nycStore.sql`insert into network.members (id, name, home_city) values (${p.id}, ${p.name}, 'nyc')`;
    // Each network's ConsentNetwork gets its app and city, as the service runtime gives them (runtime.ts).
    const nyc = new Mini(nycPeople, { review: "human", app: "ntwrk", city: "nyc" });
    const sf = new Mini(sfPeople, { review: "human", app: "ntwrk", city: "sf" });
    await nyc.onboard("r", "c1", "c2", "c3");
    await sf.onboard("s", "d1", "d2", "d3");
    await nyc.say("r", ASK);
    await sf.say("s", ASK);
    const nycOpp = nyc.net.reviewQueue()[0]!.oppId, nycReq = nyc.net.exportState().requests[0]!.id;
    await nycStore.save(nyc.net.exportState());
    await sfStore.save(sf.net.exportState());

    const [opp] = await nycStore.sql`select city from network.opportunities where id = ${nycOpp}`;
    expect(opp?.city).toBe("nyc");
    const parts: string[] = (await nycStore.sql`select member_id from network.participations where opportunity_id = ${nycOpp}`).map((r: any) => r.member_id as string);
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every(id => nycPeople.some(p => p.id === id))).toBe(true);
    const [req] = await nycStore.sql`select member_id from network.requests where id = ${nycReq}`;
    expect(req?.member_id).toBe("r");
  }, 120_000);
});
