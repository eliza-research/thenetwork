// The weekly bias monitor counts a date by its meeting time (upstream PR #470). Before the fix, dates
// were taken from the proposals created in the 28-day window, so a date dropped out of the report when
// its proposal left the window, even when the meeting was more recent. Two adults join slop by text, a
// person approves the match, both say yes, the date is booked and marked done; after a restart the
// monitor writes four reports, each read back through the staff API. Postgres in a database of its own
// per test process; dry-run sends; fictional numbers (+1 212 555 01xx).
// spec/weeklyBias.md, "Outcomes count only the opportunities in the observation window"
import { findExecutable } from "../../core/src/runtime/process.ts";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { DAY, HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { BIAS_WINDOW_MS } from "../service/bias.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_bias_window_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_bias_window";
const ADMIN = "adm-tok", REVIEWER = "rev-tok";
const RAE = "+12125550171", SAM = "+12125550172";

let sql: SQL;
let svc: NetworkService | undefined;
let evt = 0;

describe.skipIf(!pgAvailable)("weekly bias monitor: dates by meeting time (NetworkService, Postgres)", () => {
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

  test("a completed date stays in the report until its meeting leaves the window", async () => {
    const clock = new SimClock(START);
    const make = () => new NetworkService({
      url: URL_, clock, instance: "bias-window", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "slop:nyc" }],
      tokens: `admin:${ADMIN},reviewer:${REVIEWER}`, webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
      adapter: () => new DryRunAdapter(() => {}),
    });
    let s = svc = make();
    await s.start();
    const text = async (from: string, body: string) => {
      const n = ++evt;
      const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test", data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
      const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw }));
      expect(res.status).toBe(200);
      await res.text();
      clock.advance(MINUTE);
    };
    const staff = async (token: string, method: string, path: string, b?: unknown) => {
      const res = await s.fetch(new Request(`http://127.0.0.1:4848/apps/slop${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(b ? { "content-type": "application/json" } : {}) }, ...(b ? { body: JSON.stringify(b) } : {}) }));
      expect(res.status).toBe(200);
      return await res.json() as any;
    };
    const run = async (ms: number, step = 30 * MINUTE) => { for (let t = 0; t < ms; t += step) { clock.advance(Math.min(step, ms - t)); await s.tick(); } };

    for (const [e164, lines] of [
      [RAE, ["slop", "Rae, 29", "I'm a woman into men. Live in Greenpoint, love climbing and live music", "I'm a woman looking for men, 27 to 38, within 5 miles of 11222", "Something serious, no smokers", "Weekend evenings work best"]],
      [SAM, ["slop", "Sam, 31", "I'm a man into women. Williamsburg, I climb and go to shows", "I'm a man looking for women, 25 to 35, within 5 miles of 11211", "A relationship, no smokers", "Weekend evenings work best"]],
    ] as const) for (const line of lines) await text(e164, line);

    await staff(ADMIN, "POST", "/matching", { on: true });
    let item: any;
    for (let i = 0; i < 12 && !item; i++) { await run(2 * HOUR); item = (await staff(REVIEWER, "GET", "/review")).items?.[0]; }
    expect(item).toBeDefined();
    expect((await staff(REVIEWER, "POST", `/review/${encodeURIComponent(item.oppId)}`, { decision: "approve", secondsSpent: 20, revision: item.revision })).ok).toBe(true);

    const answered = new Set<string>();
    let booked: any;
    for (let i = 0; i < 24; i++) {
      await run(HOUR);
      for (const e164 of [RAE, SAM]) {
        const [ask] = await sql`select x.id, x.body from network.messages x join network.members m on m.id = x.member_id and m.app_id = x.app_id
          join platform.phone_identities p on p.person_id = m.person_id where x.app_id = 'slop' and p.e164 = ${e164}
          and x.opportunity_id = ${item.oppId} and x.direction = 'outbound' order by x.ts desc, x.id desc limit 1`;
        if (ask && !answered.has(ask.id) && /\?/.test(ask.body) && !/How did your date/.test(ask.body)) { answered.add(ask.id); await text(e164, "Yes, the first time works"); }
      }
      [booked] = await sql`select state, meeting_at from network.opportunities where app_id = 'slop' and id = ${item.oppId}`;
      if (booked?.state === "SCHEDULED") break;
    }
    expect(booked?.state).toBe("SCHEDULED");
    await staff(ADMIN, "POST", "/matching", { on: false });

    const meetingAt = new Date(booked.meeting_at).getTime();
    await run(meetingAt + 2 * DAY - clock.now());
    const opp = s.runtimeFor("slop")!.net.opps.get(item.oppId)!;
    expect(opp.stage).toBe("done");
    expect(opp.meetingAt).toBe(meetingAt);
    const createdAt = opp.createdAt;
    expect(meetingAt).toBeGreaterThan(createdAt);

    await s.close();
    s = svc = make();
    await s.start();
    await s.runtimeFor("slop")!.readState(n => expect(n.opps.get(item.oppId)?.stage).toBe("done"));

    const frames: { proposals: number; dates: number; secondDates: number }[] = [];
    for (const now of [createdAt + BIAS_WINDOW_MS, createdAt + BIAS_WINDOW_MS + 1, meetingAt + BIAS_WINDOW_MS, meetingAt + BIAS_WINDOW_MS + 1]) {
      clock.set(now);
      const report = await s.weeklyBias(s.runtimeFor("slop")!, true);
      expect(report?.members).toBe(2);
      expect((await staff(ADMIN, "GET", "/bias")).reports[0]).toEqual(report);
      const overall = report!.report.overall, months = BIAS_WINDOW_MS / (30.44 * DAY);
      frames.push({ proposals: Math.round(overall.proposals * months), dates: Math.round(overall.dates * months), secondDates: overall.secondDates });
    }
    const reports = (await staff(ADMIN, "GET", "/bias")).reports;
    expect(reports[0].report.dateStanding).toEqual({ positives: 0, negatives: 0, concordantTwice: 0, predicts: true });
    const shown = JSON.stringify(reports);
    for (const secret of [...opp.participants, "appearance"]) expect(shown).not.toContain(secret);
    expect((await sql`select distinct status from network.messages where direction = 'outbound'`).map((r: any) => r.status)).toEqual(["dry_run"]);
    // The proposal leaves the window one millisecond after its creation time does; the date stays until its meeting does.
    expect(frames).toEqual([
      { proposals: 1, dates: 1, secondDates: 0 }, { proposals: 0, dates: 1, secondDates: 0 },
      { proposals: 0, dates: 1, secondDates: 0 }, { proposals: 0, dates: 0, secondDates: 0 },
    ]);
  }, T);
});
