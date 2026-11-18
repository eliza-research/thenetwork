import { expect, test } from "bun:test";
import { SQL } from "bun";
import { MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { dropTestDb, pgAvailable, testDb } from "../../observatory/test/pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { loadPostings } from "../service/postings.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { loadSnapshot } from "../service/snapshot.ts";
import { POSTING_COPY } from "../src/jobs.ts";
import { START } from "./mini.ts";

test.skipIf(!pgAvailable)("Peon reads smart-apostrophe job posts back before saving them through HTTP and Postgres", async () => {
  const clock = new SimClock(START), secret = "synthetic-posting-quotes-webhook";
  let sql: SQL | undefined, svc: NetworkService | undefined, http: ReturnType<typeof Bun.serve> | undefined;
  try {
    const url = await testDb();
    sql = new SQL({ url, max: 2 });
    const service = () => new NetworkService({ url, clock, instance: "posting-quotes", log: () => {},
      env: { PLATFORM_ENV: "dev" }, networks: [{ id: "ntwrk:nyc" }, { id: "peon:nyc" }],
      webhookSecret: secret, network: { seed: 1 }, photoStorage: null, notify: false,
      adapter: () => new DryRunAdapter(() => {}) });
    svc = service(); await svc.start();
    http = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: r => svc!.fetch(r) });
    let seq = 0;
    const say = async (phone: string, body: string) => {
      const n = ++seq, raw = JSON.stringify({ id: `quotes-evt-${n}`, type: "message.received", api_version: "2026-10-01",
        created_at: clock.now(), organization_id: "org_test", data: { message_id: `quotes-msg-${n}`, sender: phone, chat_id: phone, text: body, protocol: "imessage" } });
      const r = await fetch(`${http!.url}${WEBHOOK_PATH.slice(1)}`, { method: "POST", headers: { "content-type": "application/json",
        "x-blooio-signature": signBlooioPayload(secret, raw, Math.floor(clock.now() / 1000)) }, body: raw });
      expect(r.status).toBe(200); await r.arrayBuffer(); clock.advance(MINUTE);
    };
    const member = async (phone: string) => (await sql!`select m.id from network.members m join platform.phone_identities p on p.person_id=m.person_id where m.app_id='peon' and p.e164=${phone}`)[0].id as string;
    const last = async (id: string) => (await sql!`select body from network.messages where app_id='peon' and member_id=${id} and direction='outbound' order by ts desc,id desc limit 1`)[0].body as string;
    const saved: { id: string; manager: string }[] = [];
    for (const [i, quote] of ["’", "‘", "'"].entries()) {
      const phone = `+1212555017${i}`;
      await say(phone, "peon"); await say(phone, "Rowan, 34");
      const id = await member(phone);
      await say(phone, `${i === 1 ? `I${quote}m` : `We${quote}re`} hiring a data analyst (level 2), 2 openings, $90k-$120k, hybrid in Brooklyn, must have SQL. We can${quote}t sponsor`);
      expect(await last(id)).toMatch(/^Here's your job post: Data analyst, 2 openings, \$90k-\$120k a year, hybrid in Brooklyn\./);
      expect(await last(id)).toContain("Visa sponsorship: no.");
      expect(await loadPostings(sql, "peon", id)).toHaveLength(0);
      await say(phone, "yes");
      expect(await last(id)).toMatch(/^Posted: data analyst\./);
      const posts = await loadPostings(sql, "peon", id);
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({ title: "data analyst", openings: 2, payMin: 90, payMax: 120, mode: "hybrid", sponsors: false, status: "active" });
      saved.push({ id: posts[0]!.id, manager: id });
    }
    await say("+12125550179", "peon"); await say("+12125550179", "Kai, 15");
    const minor = await member("+12125550179");
    await say("+12125550179", "We’re hiring a cashier, 1 opening, $30k-$35k, onsite in Queens");
    expect(await last(minor)).toBe(POSTING_COPY.adultsOnly);
    expect(await loadPostings(sql, "peon", minor)).toHaveLength(0);
    await svc.close(); svc = service(); await svc.start();
    const snap = await loadSnapshot(sql, clock.now(), { app: "peon", city: "nyc" });
    for (const p of saved) {
      expect(snap.members.some(m => m.id === `job:${p.id}`)).toBe(true);
      expect((await loadPostings(sql, "peon", p.manager))[0]).toMatchObject({ id: p.id, sponsors: false, status: "active" });
    }
  } finally {
    await http?.stop(true); await svc?.close(); await sql?.close(); await dropTestDb();
  }
}, 180_000);
