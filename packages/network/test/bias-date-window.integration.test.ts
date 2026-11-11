import { expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY, HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { dropTestDb, pgAvailable, testDb } from "../../observatory/test/pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { BIAS_WINDOW_MS } from "../service/bias.ts";
import { START } from "./mini.ts";

test.skipIf(!pgAvailable)("bias reports retain a completed date until its meeting leaves the window", async () => {
  const url = await testDb(), sql = new SQL({ url, max: 2 }), clock = new SimClock(START);
  const secret = "synthetic-bias-window", admin = "synthetic-bias-admin", reviewer = "synthetic-bias-reviewer";
  const make = () => new NetworkService({ url, clock, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "slop:nyc" }],
    tokens: `admin:${admin},reviewer:${reviewer}`, webhookSecret: secret, network: { seed: 1 },
    photoStorage: null, notify: false, adapter: () => new DryRunAdapter(() => {}), log: () => {} });
  let svc = make(), seq = 0;
  const http = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: req => svc.fetch(req) });
  const staff = async (path: string, body?: unknown, token = admin) => {
    const r = await fetch(new URL(`/apps/slop${path}`, http.url), { method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect(r.status).toBe(200); return await r.json() as any;
  };
  const say = async (phone: string, text: string) => {
    const id = `bias_${++seq}`, body = JSON.stringify({ id, type: "message.received", api_version: "2026-10-01", created_at: clock.now(),
      organization_id: "org_test", data: { message_id: id, sender: phone, chat_id: phone, text, protocol: "imessage" } });
    const r = await fetch(new URL(WEBHOOK_PATH, http.url), { method: "POST", headers: { "content-type": "application/json",
      "x-blooio-signature": signBlooioPayload(secret, body, Math.floor(clock.now() / 1000)) }, body });
    expect(r.status).toBe(200); await r.text(); clock.advance(MINUTE);
  };
  const advance = async (ms: number) => { for (let left = ms; left > 0;) { const step = Math.min(left, 30 * MINUTE); clock.advance(step); await svc.tick(); left -= step; } };
  try {
    await svc.start();
    for (const [phone, lines] of [
      ["+12125550161", ["slop", "Rae, 29", "I'm a woman into men. Live in Greenpoint, love climbing and live music", "I'm a woman looking for men, 27 to 38, within 5 miles of 11222", "Something serious, no smokers", "Weekend evenings work best"]],
      ["+12125550162", ["slop", "Sam, 31", "I'm a man into women. Williamsburg, I climb and go to shows", "I'm a man looking for women, 25 to 35, within 5 miles of 11211", "A relationship, no smokers", "Weekend evenings work best"]],
    ] as const) for (const line of lines) await say(phone, line);
    await staff("/matching", { on: true });
    let item: any;
    for (let i = 0; i < 12 && !item; i++) { await advance(2 * HOUR); item = (await staff("/review", undefined, reviewer)).items?.[0]; }
    expect(item).toBeDefined();
    expect((await staff(`/review/${encodeURIComponent(item.oppId)}`, { decision: "approve", secondsSpent: 20 }, reviewer)).ok).toBe(true);
    const answered = new Set<string>();
    let booked: any;
    for (let i = 0; i < 24; i++) {
      await advance(HOUR);
      for (const phone of ["+12125550161", "+12125550162"]) {
        const [ask] = await sql`select x.id,x.body from network.messages x join network.members m on m.id=x.member_id and m.app_id=x.app_id
          join platform.phone_identities p on p.person_id=m.person_id where x.app_id='slop' and p.e164=${phone}
          and x.opportunity_id=${item.oppId} and x.direction='outbound' order by x.ts desc,x.id desc limit 1`;
        if (ask && !answered.has(ask.id) && /\?/.test(ask.body) && !/How did your date/.test(ask.body)) { answered.add(ask.id); await say(phone, "Yes, the first time works"); }
      }
      [booked] = await sql`select state,meeting_at from network.opportunities where app_id='slop' and id=${item.oppId}`;
      if (booked?.state === "SCHEDULED") break;
    }
    expect(booked?.state).toBe("SCHEDULED");
    await staff("/matching", { on: false });
    const meetingAt = new Date(booked.meeting_at).getTime();
    await advance(meetingAt + 2 * DAY - clock.now());
    const opp = svc.runtimeFor("slop")!.net.opps.get(item.oppId)!;
    expect(opp.stage).toBe("done");
    expect(opp.meetingAt).toBe(meetingAt);
    const createdAt = opp.createdAt;
    expect(meetingAt).toBeGreaterThan(createdAt);
    await svc.close(); svc = make(); await svc.start();
    await svc.runtimeFor("slop")!.readState(n => expect(n.opps.get(item.oppId)?.stage).toBe("done"));
    const frames: { proposals: number; dates: number; secondDates: number }[] = [];
    for (const now of [createdAt + BIAS_WINDOW_MS, createdAt + BIAS_WINDOW_MS + 1, meetingAt + BIAS_WINDOW_MS, meetingAt + BIAS_WINDOW_MS + 1]) {
      clock.set(now);
      const report = await svc.weeklyBias(svc.runtimeFor("slop")!, true);
      expect(report?.members).toBe(2);
      expect((await staff("/bias")).reports[0]).toEqual(report);
      const overall = report!.report.overall, months = BIAS_WINDOW_MS / (30.44 * DAY);
      frames.push({ proposals: Math.round(overall.proposals * months), dates: Math.round(overall.dates * months), secondDates: overall.secondDates });
    }
    expect((await sql`select distinct status from network.messages where direction='outbound'`).map((r: { status: string }) => r.status)).toEqual(["dry_run"]);
    expect(frames).toEqual([
      { proposals: 1, dates: 1, secondDates: 0 }, { proposals: 0, dates: 1, secondDates: 0 },
      { proposals: 0, dates: 1, secondDates: 0 }, { proposals: 0, dates: 0, secondDates: 0 },
    ]);
  } finally { http.stop(true); await svc.close(); await sql.close(); await dropTestDb(); }
}, 120_000);
