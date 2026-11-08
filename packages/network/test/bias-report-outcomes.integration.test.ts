// Integration: what one weekly bias report (NetworkService.weeklyBias) counts for each member, on the
// dev Postgres (:54339), in a database of its own. Each case stores opportunities in the Network state
// (a saved unit of work), lets a tick run where the Network itself must act (attendance), then forces a
// report. Each case has its own network (city), so its members and its opportunities are its own.
// Every member is unrated (no photo rating), so the report has one group and the counts are the
// overall rates times the member-months of that group.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { SimClock } from "@thenetwork/core";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";
import { NetworkService } from "../service/service.ts";
import { START } from "./mini.ts";

const user = process.env.USER ?? "postgres";
const DB = `bias_outcomes_${process.pid}`;
const ADMIN_URL = `postgres://${user}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${user}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }
const DAY = 86_400_000;

let sql: SQL;
const services: NetworkService[] = [];

/** An opportunity as the Network stores it, with only what a case sets changed. */
const opp = (id: string, x: Record<string, unknown>) => ({
  id, origin: "engine", kind: "intro", category: "romance", objective: "a date", detail: "a date", participants: [], alternates: [],
  primed: new Set(), status: new Map(), explanations: {}, stage: "review", deadline: START + DAY, createdAt: START - DAY, score: 1,
  components: {}, generator: "test", exploration: false, sameDay: false, contacted: new Set(), reminded: new Set(), feedbackFrom: new Set(),
  tags: [], replacements: 0, ...x,
}) as never;

/** A booked date of two members that ended `daysAgo` days ago (created 5 days before it), with each member's check-in answer. */
const date = (id: string, a: string, b: string, daysAgo: number, post: Record<string, { came: boolean; otherNoShow: boolean }>) => {
  const meetingAt = START - daysAgo * DAY;
  return opp(id, {
    participants: [a, b], status: new Map([[a, "yes"], [b, "yes"]]), contacted: new Set([a, b]), stage: "done", feedbackSent: true,
    createdAt: meetingAt - 5 * DAY, meetingAt, bookedAt: { [a]: meetingAt - 3 * DAY, [b]: meetingAt - 3 * DAY }, feedbackFrom: new Set(Object.keys(post)),
    post: Object.fromEntries(Object.entries(post).map(([k, v]) => [k, { ...v, again: v.came && !v.otherNoShow, named: [] }])),
  });
};

/** One network (`slop:<city>`) with these adult members, these stored opportunities and one tick; then a forced report. */
async function report(city: string, members: { id: string; joinedDaysAgo: number }[], opps: (now: number) => [string, never][]) {
  if (city !== "nyc") await sql`insert into platform.networks (id, app_id, city, matching_enabled) values (${`slop:${city}`}, 'slop', ${city}, false) on conflict (id) do nothing`;
  for (const m of members) {
    await sql`insert into network.members (app_id, id, name, home_city, account_status, age, joined_at)
      values ('slop', ${m.id}, ${`Member ${m.id}`}, ${city}, 'active', 30, ${new Date(START - m.joinedDaysAgo * DAY)})`;
  }
  const clock = new SimClock(START);
  const svc = new NetworkService({ url: URL_, clock, env: { PLATFORM_ENV: "dev" }, instance: `bias-${city}`, networks: [{ id: `slop:${city}` }], notify: false, log: () => {} });
  services.push(svc);
  const rt = svc.runtimeFor("slop", city)!;
  await rt.unitOfWork(n => { for (const [id, o] of opps(clock.now())) n.opps.set(id, o); });
  await rt.tick();
  clock.advance(60_000); // the tick stored this minute's report
  const r = (await svc.weeklyBias(rt, true))!;
  const mm = r.report.groups.unrated!.memberMonths;
  const count = (metric: "proposals" | "dates" | "secondDates") => Math.round(r.report.overall[metric] * mm);
  return { members: r.members, proposals: count("proposals"), dates: count("dates"), secondDates: count("secondDates") };
}

describe.skipIf(!pgAvailable)("weekly bias report: the outcomes it counts", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    await applySchema(URL_, { lockTimeout: "5s" });
    sql = new SQL({ url: URL_, max: 2 });
  }, 120_000);
  afterAll(async () => {
    for (const s of services) await s.close().catch(() => {});
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("a proposal counts only for the members its probe reached (SD-450)", async () => {
    // p1 was probed first and said no: the opportunity closed from probing, and p2 was never contacted.
    const r = await report("sf", [{ id: "p1", joinedDaysAgo: 10 }, { id: "p2", joinedDaysAgo: 10 }], () => [
      ["sd450", opp("sd450", { participants: ["p1", "p2"], status: new Map([["p1", "no"], ["p2", "queued"]]), contacted: new Set(["p1"]), first: "p1", stage: "closed", closedFrom: "probing" })],
    ]);
    expect(r.members).toBe(2);
    expect(r.proposals).toBe(1);
  }, 120_000);
});
