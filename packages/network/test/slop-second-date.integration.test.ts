// The slop.date "meet again" flow through NetworkService on Postgres (SD-236): two adults join slop by
// text, a person approves their match, both say yes, the date is booked, and after the date both say
// they would see each other again. At the next daily run the Network composes the second date, and it
// waits in the review queue for a person, like every proposal. Before the fix the second date was
// composed as a "social" opportunity, which slop (dating only) closed at once as "category not
// allowed". Postgres in a database of its own per test process; dry-run sends; fictional numbers
// (+1 212 555 01xx).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { DAY, HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_slop_second_date_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_slop_second_date";
const ADMIN = "adm-tok", REVIEWER = "rev-tok";
const RAE = "+12125550171", SAM = "+12125550172";

let sql: SQL;
let svc: NetworkService | undefined;
let evt = 0;

async function text(s: NetworkService, clock: SimClock, from: string, body: string) {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test", data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
}
const staff = (s: NetworkService, token: string, method: string, path: string, b?: unknown) =>
  s.fetch(new Request(`http://127.0.0.1:4848${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(b ? { "content-type": "application/json" } : {}) }, ...(b ? { body: JSON.stringify(b) } : {}) }));
const memberId = async (e164: string) =>
  ((await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'slop' and ph.e164 = ${e164}`)[0] as { id: string } | undefined)?.id;
const inbox = async (id: string) =>
  ((await sql`select body, opportunity_id from network.messages where app_id = 'slop' and member_id = ${id} and direction = 'outbound' order by ts, id`) as any[])
    .map(r => ({ body: r.body as string, opp: r.opportunity_id as string | null }));
async function run(s: NetworkService, clock: SimClock, ms: number, step = 30 * MINUTE) {
  for (let t = 0; t < ms; t += step) { clock.advance(Math.min(step, ms - t)); await s.tick(); }
}
const pairItems = async (s: NetworkService, a: string, b: string) =>
  (((await (await staff(s, REVIEWER, "GET", "/apps/slop/review")).json()) as any).items ?? [])
    .filter((x: any) => x.proposal.participants.includes(a) && x.proposal.participants.includes(b));

describe.skipIf(!pgAvailable)("slop.date: a second date after both say they would meet again (NetworkService, Postgres)", () => {
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

  test("both say 'again' at the check-in: the second date waits in the review queue (SD-236)", async () => {
    const clock = new SimClock(START);
    const s = svc = new NetworkService({
      url: URL_, clock, instance: "slop-second-date", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "slop:nyc" }],
      tokens: `admin:${ADMIN},reviewer:${REVIEWER}`, webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
      adapter: () => new DryRunAdapter(() => {}),
    });
    await s.start();
    const people = [
      { e164: RAE, lines: ["slop", "Rae, 29", "I'm a woman into men. Live in Greenpoint, love climbing and live music", "I'm a woman looking for men, 27 to 38, within 5 miles of 11222", "Something serious, no smokers", "Weekend evenings work best"] },
      { e164: SAM, lines: ["slop", "Sam, 31", "I'm a man into women. Williamsburg, I climb and go to shows", "I'm a man looking for women, 25 to 35, within 5 miles of 11211", "A relationship, no smokers", "Weekend evenings work best"] },
    ];
    for (const p of people) for (const line of p.lines) await text(s, clock, p.e164, line);
    const rae = (await memberId(RAE))!, sam = (await memberId(SAM))!;
    expect(rae).toBeString();
    expect(sam).toBeString();

    // ---- The first date: a person approves the match, both say yes, the date is booked.
    expect((await staff(s, ADMIN, "POST", "/apps/slop/matching", { on: true })).status).toBe(200);
    let item: any;
    for (let i = 0; i < 12 && !item; i++) { await run(s, clock, 2 * HOUR); item = (await pairItems(s, rae, sam))[0]; }
    expect(item).toBeDefined();
    expect((await (await staff(s, REVIEWER, "POST", `/apps/slop/review/${encodeURIComponent(item.oppId)}`, { decision: "approve", secondsSpent: 20 })).json() as any).ok).toBe(true);
    const answered = new Set<string>();
    for (let i = 0; i < 24; i++) {
      await run(s, clock, HOUR);
      for (const [id, e164] of [[rae, RAE], [sam, SAM]] as const) {
        const ask = (await inbox(id)).filter(m => m.opp === item.oppId).at(-1);
        if (ask && !answered.has(ask.body) && /\?/.test(ask.body) && !/How did your date/.test(ask.body)) { answered.add(ask.body); await text(s, clock, e164, "Yes, the first time works"); }
      }
      if ((await sql`select state from network.opportunities where app_id = 'slop' and id = ${item.oppId}`)[0]?.state === "SCHEDULED") break;
    }
    const [booked] = await sql`select state, meeting_at from network.opportunities where app_id = 'slop' and id = ${item.oppId}`;
    expect(booked?.state).toBe("SCHEDULED");

    // ---- After the date: both say they would see each other again.
    const meetingAt = booked.meeting_at ? new Date(booked.meeting_at).getTime() : clock.now() + 3 * DAY;
    if (meetingAt > clock.now()) await run(s, clock, meetingAt - clock.now() + 3 * HOUR, HOUR);
    for (const [id, e164, other] of [[rae, RAE, "him"], [sam, SAM, "her"]] as const) {
      for (let i = 0; i < 48 && !(await inbox(id)).some(m => /How did your date with/.test(m.body)); i++) await run(s, clock, HOUR, HOUR);
      expect((await inbox(id)).some(m => /How did your date with/.test(m.body))).toBe(true);
      await text(s, clock, e164, `It was great, we really clicked. I'd love to see ${other} again!`);
    }

    // ---- The next daily run composes the second date; it waits for a person in the review queue.
    let second: any;
    for (let i = 0; i < 8 && !second; i++) {
      await run(s, clock, 6 * HOUR, HOUR);
      second = (await pairItems(s, rae, sam)).find((x: any) => x.oppId !== item.oppId);
    }
    expect(second).toBeDefined();
    expect(second.proposal.category).toBe("romance");
    // Nobody hears of it before a person approves it.
    expect((await sql`select count(*)::int as n from network.messages where app_id = 'slop' and opportunity_id = ${second.oppId}`)[0].n).toBe(0);
    await s.close(); svc = undefined;
  }, T);
});
