import { expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY, MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { dropTestDb, pgAvailable, testDb } from "../../observatory/test/pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { START } from "./mini.ts";

test.skipIf(!pgAvailable)("trust decay survives restart with balanced history, without reopening a closed safety case", async () => {
  const url = await testDb(), sql = new SQL({ url, max: 2 }), clock = new SimClock(START);
  const secret = "synthetic-trust-history";
  const make = () => new NetworkService({ url, clock, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "friends:nyc" }],
    webhookSecret: secret, tokens: "safety:synthetic-safety", network: { seed: 1, matchingEnabled: false },
    photoStorage: null, notify: false, adapter: () => new DryRunAdapter(() => {}), log: () => {} });
  let svc = make(), seq = 0;
  const http = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: req => svc.fetch(req) });
  const say = async (phone: string, text: string) => {
    const id = `trust_${++seq}`, body = JSON.stringify({ id, type: "message.received", api_version: "2026-10-01", created_at: clock.now(),
      organization_id: "org_test", data: { message_id: id, sender: phone, chat_id: phone, text, protocol: "imessage" } });
    const r = await fetch(new URL(WEBHOOK_PATH, http.url), { method: "POST", headers: { "content-type": "application/json",
      "x-blooio-signature": signBlooioPayload(secret, body, Math.floor(clock.now() / 1000)) }, body });
    expect(r.status).toBe(200); await r.text(); clock.advance(MINUTE);
  };
  const state = () => svc.runtimeFor("friends")!.readState(n => n.exportState());
  const restart = async () => { await svc.close(); svc = make(); await svc.start(); };
  const tickAt = async (day: number) => { clock.set(START + day * DAY); await svc.tick(); return state(); };
  try {
    await svc.start();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const phone = `+1212555018${i}`;
      await say(phone, "friends"); await say(phone, `${["Ari", "Bea", "Cy", "Dee"][i]}, 34`);
      ids.push((await sql`select m.id from network.members m join platform.phone_identities p on p.person_id=m.person_id where m.app_id='friends' and p.e164=${phone}`)[0].id);
      if (i < 3) await say(phone, "Buy my course at https://example.test/offer");
      if (i === 2) await say(phone, "Buy my course at https://example.test/offer");
    }
    const [open, closed, held, clean] = ids as [string, string, string, string];
    const initial = await state();
    expect(ids.map(id => initial.trust.find(t => t.id === id)?.score ?? 0)).toEqual([3, 3, 6, 0]);
    const closedCase = initial.cases.find(c => c.memberId === closed)!;
    const close = await fetch(new URL("/apps/friends/safety/close", http.url), { method: "POST",
      headers: { authorization: "Bearer synthetic-safety", "content-type": "application/json" },
      body: JSON.stringify({ caseId: closedCase.id, note: "review complete" }) });
    expect(close.status).toBe(200); expect(await close.json()).toEqual({ ok: true });
    const before = await tickAt(13);
    expect(before.trust.find(t => t.id === open)!.events.map(e => e.points)).toEqual([3]);
    await restart();
    const first = await tickAt(15);
    expect(first.trust.find(t => t.id === open)!.score).toBe(2);
    expect(first.trust.find(t => t.id === open)!.events.map(e => [e.kind, e.points])).toEqual([["sales_spam", 3], ["decay", -1]]);
    expect(first.cases.find(c => c.memberId === open)!.events.map(e => e.points)).toEqual([3, -1]);
    await restart();
    const last = await tickAt(60);
    for (const id of [open, closed]) {
      const trust = last.trust.find(t => t.id === id)!;
      expect([trust.score, trust.level]).toEqual([0, "ok"]);
      expect(trust.events.map(e => e.points)).toEqual([3, -1, -2]);
      expect(trust.events.reduce((sum, e) => sum + e.points, 0)).toBe(trust.score);
    }
    expect(last.cases.filter(c => c.memberId === closed)).toHaveLength(1);
    expect(last.cases.find(c => c.id === closedCase.id)).toMatchObject({ status: "closed", events: closedCase.events });
    expect(last.cases.find(c => c.memberId === open)!.events.map(e => e.points)).toEqual([3, -1, -2]);
    expect(last.trust.find(t => t.id === held)).toMatchObject({ score: 6, level: "hold", events: initial.trust.find(t => t.id === held)!.events });
    expect(last.cases.filter(c => c.memberId === clean)).toEqual([]);
    const next = await tickAt(90);
    expect(next.trust.find(t => t.id === open)!.events).toEqual(last.trust.find(t => t.id === open)!.events);
    await restart();
    expect((await state()).trust).toEqual(next.trust);
    expect((await sql`select distinct status from network.messages where direction='outbound'`).map((r: { status: string }) => r.status)).toEqual(["dry_run"]);
  } finally { http.stop(true); await svc.close(); await sql.close(); await dropTestDb(); }
}, 120_000);
