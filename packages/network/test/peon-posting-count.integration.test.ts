import { expect, test } from "bun:test";
import { SQL } from "bun";
import { MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { dropTestDb, pgAvailable, testDb } from "../../observatory/test/pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { loadPostings } from "../service/postings.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { loadSnapshot } from "../service/snapshot.ts";
import { START } from "./mini.ts";

test.skipIf(!pgAvailable)("Peon asks for a valid opening count before confirming or saving a posting", async () => {
  const url = await testDb(), sql = new SQL({ url, max: 2 }), clock = new SimClock(START), secret = "synthetic-posting-count";
  const make = () => new NetworkService({ url, clock, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "peon:nyc" }],
    webhookSecret: secret, network: { seed: 1 }, photoStorage: null, notify: false, adapter: () => new DryRunAdapter(() => {}), log: () => {} });
  let svc = make(), seq = 0;
  const http = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: req => svc.fetch(req) });
  const say = async (phone: string, text: string) => {
    const id = `count_${++seq}`, body = JSON.stringify({ id, type: "message.received", api_version: "2026-10-01", created_at: clock.now(),
      organization_id: "org_test", data: { message_id: id, sender: phone, chat_id: phone, text, protocol: "imessage" } });
    const r = await fetch(new URL(WEBHOOK_PATH, http.url), { method: "POST", headers: { "content-type": "application/json",
      "x-blooio-signature": signBlooioPayload(secret, body, Math.floor(clock.now() / 1000)) }, body });
    expect(r.status).toBe(200); await r.text(); clock.advance(MINUTE);
  };
  const join = async (phone: string, age = 34) => {
    await say(phone, "peon"); await say(phone, `Rowan, ${age}`);
    return (await sql`select m.id from network.members m join platform.phone_identities p on p.person_id=m.person_id where m.app_id='peon' and p.e164=${phone}`)[0].id as string;
  };
  const last = async (id: string) => (await sql`select body from network.messages where app_id='peon' and member_id=${id} and direction='outbound' order by ts desc,id desc limit 1`)[0].body as string;
  const post = (count: string) => `We're hiring a data analyst, ${count ? `${count}, ` : ""}$90k-$120k, hybrid in Brooklyn, must have SQL`;
  const question = "How many openings are there? Please give a whole number from 1 to 50.";
  try {
    await svc.start();
    const a = "+12125550171", aid = await join(a);
    await say(a, post("2.5 openings"));
    expect(await last(aid)).toBe(question);
    expect(await loadPostings(sql, "peon", aid)).toHaveLength(0);
    await svc.close(); svc = make(); await svc.start();
    await say(a, "two");
    expect(await last(aid)).toContain("Data analyst, 2 openings, $90k-$120k a year");
    expect(await loadPostings(sql, "peon", aid)).toHaveLength(0);
    await say(a, "yes");
    expect((await loadPostings(sql, "peon", aid)).map(p => p.openings)).toEqual([2]);

    const b = "+12125550172", bid = await join(b);
    await say(b, post("x50"));
    expect(await last(bid)).toContain("Data analyst, 50 openings,");
    await say(b, "Actually, 51 openings");
    expect(await last(bid)).toBe(question);
    await say(b, "3");
    expect(await last(bid)).toContain("Data analyst, 3 openings,");
    expect(await loadPostings(sql, "peon", bid)).toHaveLength(0);
    await say(b, "yes");
    expect((await loadPostings(sql, "peon", bid)).map(p => p.openings)).toEqual([3]);

    const c = "+12125550173", cid = await join(c);
    await say(c, post(""));
    expect(await last(cid)).toContain("Data analyst, 1 opening,");
    await say(c, "no");
    expect(await loadPostings(sql, "peon", cid)).toHaveLength(0);
    await say(c, post("0 openings")); await say(c, "yes");
    expect(await loadPostings(sql, "peon", cid)).toHaveLength(0);

    const d = "+12125550174", did = await join(d);
    await say(d, post("-2 openings")); await say(d, "51 openings"); await say(d, "2.5 openings");
    expect(await last(did)).toBe("OK, I didn't post anything.");
    expect(await loadPostings(sql, "peon", did)).toHaveLength(0);
    const e = "+12125550175", eid = await join(e, 15);
    await say(e, post("2.5 openings"));
    expect(await last(eid)).toBe("Job posts are for adults (18+) only.");
    expect(await loadPostings(sql, "peon", eid)).toHaveLength(0);

    await svc.close(); svc = make(); await svc.start();
    const snapshot = await loadSnapshot(sql, clock.now(), { app: "peon", city: "nyc" });
    for (const [id, count] of [[aid, 2], [bid, 3]] as const) {
      const [saved] = await loadPostings(sql, "peon", id);
      expect(saved!.openings).toBe(count);
      expect(snapshot.facets.find(f => f.id === `job:${saved!.id}:openings`)?.tags).toEqual([`peon:openings:${count}`]);
    }
    expect((await sql`select distinct status from network.messages where direction='outbound'`).map((r: { status: string }) => r.status)).toEqual(["dry_run"]);
  } finally { http.stop(true); await svc.close(); await sql.close(); await dropTestDb(); }
}, 120_000);
