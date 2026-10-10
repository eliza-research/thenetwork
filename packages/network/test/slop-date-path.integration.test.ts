// The slop.date path end to end through NetworkService on Postgres (issue #9 gate): two adults join
// slop by text on the shared line, answer the onboarding asks, a person approves the match in the
// review queue, both say yes to the anonymous date probe, the date is booked, the check-in comes after
// the date, and one member's answer files a report. The report reaches the safety queue and the two
// people are kept apart afterwards. Postgres in a database of its own per test process; dry-run sends
// (the text is read back from network.messages); fictional numbers (+1 212 555 01xx).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { DAY, HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { loadSnapshot } from "../service/snapshot.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_slop_date_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_slop_date";
const ADMIN = "adm-tok", REVIEWER = "rev-tok", SAFETY = "saf-tok";
const RAE = "+12125550161", SAM = "+12125550162";
const debug = process.env.SLOP_PATH_DEBUG ? (s: string) => console.log(`  [slop-path] ${s}`) : () => {};

let sql: SQL;
let svc: NetworkService | undefined;
let evt = 0;

async function text(s: NetworkService, clock: SimClock, from: string, body: string) {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test", data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
  const result = (await res.json()).result as string;
  debug(`${from} -> "${body}" (${result})`);
  return result;
}
const staff = (s: NetworkService, token: string, method: string, path: string, b?: unknown) =>
  s.fetch(new Request(`http://127.0.0.1:4848${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(b ? { "content-type": "application/json" } : {}) }, ...(b ? { body: JSON.stringify(b) } : {}) }));
const memberId = async (e164: string) =>
  ((await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'slop' and ph.e164 = ${e164}`)[0] as { id: string } | undefined)?.id;
/** Every outbound text to one slop member so far, oldest first (dry-run: the text is only in network.messages). */
const inbox = async (id: string) =>
  ((await sql`select body, type, opportunity_id from network.messages where app_id = 'slop' and member_id = ${id} and direction = 'outbound' order by ts, id`) as any[])
    .map(r => ({ body: r.body as string, type: r.type as string | null, opp: r.opportunity_id as string | null }));
const last = async (id: string) => (await inbox(id)).at(-1)?.body ?? "";

/** Tick the service in steps (the tick loop of serve.ts). */
async function run(s: NetworkService, clock: SimClock, ms: number, step = 30 * MINUTE) {
  for (let t = 0; t < ms; t += step) { clock.advance(Math.min(step, ms - t)); await s.tick(); }
}

describe.skipIf(!pgAvailable)("slop.date: join to report after the date (NetworkService, Postgres)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    sql = new SQL({ url: URL_, max: 2 });
  }, T);
  afterAll(async () => {
    await svc?.close().catch(() => {});
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("join, onboard, review approval, mutual yes, date booked, check-in, report to the safety queue, pair kept apart", async () => {
    const clock = new SimClock(START);
    const s = svc = new NetworkService({
      url: URL_, clock, instance: "slop-date", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "ntwrk:nyc" }, { id: "slop:nyc" }],
      tokens: `admin:${ADMIN},reviewer:${REVIEWER},safety:${SAFETY}`, webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
      adapter: () => new DryRunAdapter(() => {}),
    });
    await s.start();

    // ---- Join slop by keyword on the shared line, then the onboarding asks.
    const people = [
      { e164: RAE, name: "Rae, 29", about: "I'm a woman into men. Live in Greenpoint, love climbing and live music", seeking: "I'm a woman looking for men, 27 to 38, within 5 miles of 11222", goal: "Something serious, no smokers" },
      { e164: SAM, name: "Sam, 31", about: "I'm a man into women. Williamsburg, I climb and go to shows", seeking: "I'm a man looking for women, 25 to 35, within 5 miles of 11211", goal: "A relationship, no smokers" },
    ];
    for (const p of people) {
      expect(await text(s, clock, p.e164, "slop")).toBeString();
      await text(s, clock, p.e164, p.name);
      await text(s, clock, p.e164, p.about);
      await text(s, clock, p.e164, p.seeking);
      await text(s, clock, p.e164, p.goal);
      await text(s, clock, p.e164, "Weekend evenings work best");
    }
    const rae = (await memberId(RAE))!, sam = (await memberId(SAM))!;
    expect(rae).toBeString();
    expect(sam).toBeString();
    for (const id of [rae, sam]) debug(`${id}: ${(await inbox(id)).map(m => m.body).join(" | ")}`);

    // ---- Matching on; the engine proposes; nobody hears of it before a person approves.
    expect((await staff(s, ADMIN, "POST", "/apps/slop/matching", { on: true })).status).toBe(200);
    let item: any;
    for (let i = 0; i < 12 && !item; i++) {
      await run(s, clock, 2 * HOUR);
      const q = await (await staff(s, REVIEWER, "GET", "/apps/slop/review")).json() as any;
      item = q.items?.find((x: any) => x.proposal.participants.includes(rae) && x.proposal.participants.includes(sam));
    }
    expect(item).toBeDefined();
    // A reviewer's edit that talks about looks or a rating is refused on slop (photo ratings are never shown), and nothing is sent.
    for (const words of ["You're both really attractive, she's in the 73rd percentile.", "Similar looks level, good match.", "Top 10% photo rating."]) {
      const r = await (await staff(s, REVIEWER, "POST", `/apps/slop/review/${encodeURIComponent(item.oppId)}`, { decision: "edit", explanations: { [rae]: words }, secondsSpent: 5 })).json() as any;
      expect([words, r.ok, r.code ?? r.error ?? r.reason]).toEqual([words, false, "edit_leak"]);
    }
    expect((await sql`select count(*)::int as n from network.messages where app_id = 'slop' and opportunity_id = ${item.oppId}`)[0].n).toBe(0);
    expect((await (await staff(s, REVIEWER, "POST", `/apps/slop/review/${encodeURIComponent(item.oppId)}`, { decision: "approve", secondsSpent: 20 })).json() as any).ok).toBe(true);

    // ---- The anonymous probe, a yes from each side, the booked date.
    const answered = new Set<string>();
    for (let i = 0; i < 24; i++) {
      await run(s, clock, HOUR);
      for (const [id, e164] of [[rae, RAE], [sam, SAM]] as const) {
        const msgs = (await inbox(id)).filter(m => m.opp === item.oppId);
        const ask = msgs.at(-1);
        if (ask && !answered.has(ask.body) && /\?/.test(ask.body) && !/How did your date/.test(ask.body)) { answered.add(ask.body); debug(`${id} asked: ${ask.body}`); await text(s, clock, e164, "Yes, the first time works"); }
      }
      const [o] = await sql`select state from network.opportunities where app_id = 'slop' and id = ${item.oppId}`;
      if (o?.state === "SCHEDULED") break;
    }
    const [booked] = await sql`select state, meeting_at from network.opportunities where app_id = 'slop' and id = ${item.oppId}`;
    expect(booked?.state).toBe("SCHEDULED");
    for (const id of [rae, sam]) expect((await inbox(id)).some(m => /You're both in: a first date with/.test(m.body))).toBe(true);

    // ---- After the date: the check-in, and Rae's answer files a report.
    const meetingAt = booked.meeting_at ? new Date(booked.meeting_at).getTime() : clock.now() + 3 * DAY;
    if (meetingAt > clock.now()) await run(s, clock, meetingAt - clock.now() + 3 * HOUR, HOUR);
    for (let i = 0; i < 48 && !(await inbox(rae)).some(m => /How did your date with/.test(m.body)); i++) await run(s, clock, HOUR, HOUR);
    expect(await last(rae)).toMatch(/How did your date with/);
    await text(s, clock, RAE, "He was really rude and kept harassing me after I said I wanted to leave.");

    const reports = await (await staff(s, SAFETY, "GET", "/apps/slop/safety/reports")).json() as any;
    debug(JSON.stringify(reports));
    expect(reports.ok).toBe(true);
    expect(reports.reports).toHaveLength(1);
    expect(reports.reports[0]).toMatchObject({ kind: "harassment", source: "check_in", status: "open", reporterId: rae, subjectId: sam, opportunityId: item.oppId });

    // ---- The pair is kept apart: a blocked edge in the snapshot, and no new proposal between them.
    const snap = await loadSnapshot(sql, clock.now(), { app: "slop", city: "nyc" });
    expect(snap.edges.some(e => e.type === "blocked" && ((e.from === rae && e.to === sam) || (e.from === sam && e.to === rae)))).toBe(true);
    await run(s, clock, 3 * DAY, 6 * HOUR);
    const later = await (await staff(s, REVIEWER, "GET", "/apps/slop/review")).json() as any;
    expect((later.items ?? []).some((x: any) => x.oppId !== item.oppId && x.proposal.participants.includes(rae) && x.proposal.participants.includes(sam))).toBe(false);
    expect((await sql`select count(*)::int as n from network.opportunities o where o.app_id = 'slop' and o.id <> ${item.oppId}
      and exists (select 1 from network.participations p where p.app_id = o.app_id and p.opportunity_id = o.id and p.member_id = ${rae})
      and exists (select 1 from network.participations p where p.app_id = o.app_id and p.opportunity_id = o.id and p.member_id = ${sam})`)[0].n).toBe(0);
  }, T);
});
