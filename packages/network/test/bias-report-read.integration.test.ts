// Integration: where the weekly bias report (NetworkService.weeklyBias) reads the opportunities from,
// on the dev Postgres (:54339), in a database of its own. weeklyBias runs in afterTick, outside the
// Network lock. Before the fix it read rt.net.opps from memory, so a unit of work that changed the
// Network and did not save (it failed before or in its save) gave the report stages that the database
// never held (SD-448). The report must count the stored state only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { SimClock } from "@thenetwork/core";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";
import { NetworkService } from "../service/service.ts";
import { START } from "./mini.ts";

const user = process.env.USER ?? "postgres";
const DB = `bias_read_${process.pid}`;
const ADMIN_URL = `postgres://${user}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${user}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }
const DAY = 86_400_000;

let sql: SQL;
let svc: NetworkService | undefined;

describe.skipIf(!pgAvailable)("weekly bias report: it reads the stored state, not the memory of a failed unit (SD-448)", () => {
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

  test("a probe that a failed unit added in memory is not counted as a proposal that reached the members", async () => {
    const joined = new Date(START - 10 * DAY);
    for (const id of ["a1", "a2"]) {
      await sql`insert into network.members (app_id, id, name, home_city, account_status, age, joined_at) values ('slop', ${id}, ${`Member ${id}`}, 'nyc', 'active', 30, ${joined})`;
    }
    const clock = new SimClock(START);
    svc = new NetworkService({ url: URL_, clock, env: { PLATFORM_ENV: "dev" }, instance: "bias-read", networks: [{ id: "slop:nyc" }], notify: false, log: () => {} });
    const rt = svc.runtimeFor("slop")!;
    await rt.tick(); // a stored state with no opportunity
    // A unit changes the Network in memory (a probe reached both members), then fails: nothing is saved.
    const failed = await rt.unitOfWork(n => {
      n.opps.set("dirty", {
        id: "dirty", origin: "engine", kind: "intro", category: "romance", objective: "a date", detail: "a date", participants: ["a1", "a2"], alternates: [],
        primed: new Set(), status: new Map([["a1", "yes"], ["a2", "probing"]]), explanations: {}, stage: "probing", deadline: clock.now() + DAY,
        createdAt: clock.now() - DAY, score: 1, components: {} as never, generator: "test", exploration: false, sameDay: false,
        contacted: new Set(["a1", "a2"]), reminded: new Set(), feedbackFrom: new Set(), tags: [], replacements: 0,
      } as never);
      throw new Error("the unit failed before its save");
    }).then(() => false, () => true);
    expect(failed).toBe(true);
    const stored = await sql`select count(*)::int as n from network.opportunities where app_id = 'slop'`;
    expect(stored[0]!.n).toBe(0);
    clock.advance(60_000); // the tick stored this minute's report
    const r = await svc.weeklyBias(rt, true);
    expect(r?.members).toBe(2);
    expect(r?.report.overall.proposals).toBe(0);
  }, 120_000);
});
