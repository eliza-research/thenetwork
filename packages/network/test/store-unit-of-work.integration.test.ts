// Integration: the stored unit of work (PgStore, runStored) on the dev Postgres (:54339), in a database
// of its own. Two processes share one network: each has its own PgStore and pool. When the connection
// that holds a unit's advisory lock is lost while the unit runs, Postgres frees the lock and the other
// process takes it. The first unit must not then save over what the second one committed (SD-110).
// Skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { existsSync } from "node:fs";
import { DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { ConsentNetwork, PgStore, runStored } from "../src/index.ts";
import { Mini, type Spec } from "./mini.ts";

const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const DB = `network_store_uow_${process.pid}`;
const ADMIN_URL = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }
const climber = (id: string, name: string): Spec => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" }] });

describe.skipIf(!pgAvailable)("PgStore unit of work: a lost lock connection (SD-110)", () => {
  const stores: PgStore[] = [];
  let sql: SQL;
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    sql = new SQL({ url: URL_, max: 1 });
    await sql.unsafe(await Bun.file(new URL("../../observatory/db/schema.sql", import.meta.url)).text());
  }, 120_000);
  afterAll(async () => {
    for (const s of stores) await s.close();
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("a unit whose lock connection died does not overwrite the STOP the other process committed meanwhile", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
    await w.onboard("a", "b");
    const one = new PgStore(URL_), two = new PgStore(URL_);
    stores.push(one, two);
    await one.migrate();
    await one.save(w.net.exportState());
    const net = (store: PgStore) => { const n = new ConsentNetwork({ seed: 1, review: "auto", store }); n.init(w.ctx()); return n; };
    const A = net(one), B = net(two);
    const optedOut = async () => (await two.load())!.members.find(m => m.id === "a")!.optedOut;

    // Process one starts a unit. While it runs, its lock connection dies (a network cut, a proxy reset);
    // Postgres frees the session lock and process two handles a STOP under it, and acknowledges it.
    const first = runStored(A, undefined, async () => {
      const [holder] = await sql`select pid from pg_locks where locktype = 'advisory' and granted and database = (select oid from pg_database where datname = current_database())`;
      await sql`select pg_terminate_backend(${holder!.pid})`;
      await runStored(B, undefined, n => n.onInbound({ id: "stop", memberId: "a", body: "STOP", keyword: "STOP", ts: w.clock.now(), channel: "sms" }));
      expect(await optedOut()).toBe(true);
    });
    // The first unit fails: its save had no lock any more.
    await expect(first).rejects.toThrow();
    // The STOP that was acknowledged is still stored.
    expect(await optedOut()).toBe(true);
  }, 120_000);
});
