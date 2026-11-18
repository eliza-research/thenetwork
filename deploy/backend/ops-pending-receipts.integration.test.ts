import { expect, test } from "bun:test";
import { SQL } from "bun";
import { HOUR, MINUTE, SimClock } from "../../packages/core/src/index.ts";
import { ChannelSendError, type SendReceipt, type SendRequest } from "../../packages/blooio/src/types.ts";
import { APPS } from "../../packages/platform/src/apps.ts";
import { BlooioAdapter } from "../../packages/network/service/channel.ts";
import { NetworkService } from "../../packages/network/service/service.ts";
import { dropTestDb, pgAvailable, testDb } from "../../packages/observatory/test/pg.ts";
import { createBackend, jsonLogger, loadConfig } from "./backend.ts";
import { createOps, PgAlertStore, runtimeProbe, type Notice, type OpsMetrics } from "./ops.ts";

test.skipIf(!pgAvailable)("unresolved receipts stay out of the send failure denominator until acceptance or final failure", async () => {
  const clock = new SimClock(Date.UTC(2026, 9, 9, 16)), phone = "+12125550171";
  let sql: SQL | undefined, service: NetworkService | undefined, stopHttp = () => {};
  let known = true, sends = 0, lookups = 0;
  const notices: Notice[] = [];
  const transport = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const path = new URL(req.url).pathname, body = await req.json();
    if (path === "/alerts") { notices.push(...body.alerts); return new Response("ok"); }
    if (path === "/send") sends++; else if (path === "/receipt") lookups++; else return new Response("not found", { status: 404 });
    return known ? Response.json({ providerMessageId: `local:${body.idempotencyKey}`, status: "queued" })
      : Response.json({ unknown: true }, { status: 202 });
  } });
  const request = async (path: string, value: SendRequest): Promise<SendReceipt> => {
    const r = await fetch(new URL(path, transport.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
    const body = await r.json();
    if (r.status === 202) throw new ChannelSendError("Synthetic receipt is unresolved", "unknown");
    if (!r.ok) throw Error(`Local transport HTTP ${r.status}`);
    return body as SendReceipt;
  };
  try {
    const url = await testDb();
    sql = new SQL({ url, max: 2 });
    service = new NetworkService({ url, clock, networks: [{ id: "friends:nyc", matchingEnabled: false }],
      photoStorage: null, notify: false, env: { PLATFORM_ENV: "dev" }, log: () => {},
      adapter: (_net, rt) => new BlooioAdapter({ clock, app: rt.app.id, from: "+12125550170", env: { PLATFORM_ENV: "dev" }, liveGate: () => true,
        provider: { kind: "sim", send: r => request("/send", r), receipt: r => request("/receipt", r) }, log: () => {} }) });
    const joined = await service.accounts.join(APPS.friends, { e164: phone, personId: null },
      { firstName: "Ari", age: 29, consent: { sms: true, wording: APPS.friends.consent.text } });
    if (!joined.ok) throw Error("Synthetic verified-profile fixture was refused");
    const rt = service.runtimes.get("friends:nyc")!, memberId = joined.membership.memberId;
    // Completed historical outcomes are a stored fixture; the unresolved row follows the real queue.
    await sql`delete from network.messages where app_id = 'friends'`;
    await sql`insert into network.messages (id, app_id, member_id, direction, body, status, ts)
      select 'ops-history-' || i, 'friends', ${memberId}, 'outbound', 'Synthetic completed outcome',
        case when i <= 5 then 'failed' else 'delivered' end, ${new Date(clock.now())} from generate_series(1, 250) i`;
    const emit = async (id: string) => {
      await rt.adapter.engaged!(phone);
      await rt.unitOfWork(() => { rt.unit.sends.push({ id, memberId, to: phone, body: "Your requested reminder is ready.",
        kind: "reply", type: "reminder", proactive: false, system: false, ts: clock.now() }); });
    };
    const token = "synthetic-ops-pending-receipt-token".padEnd(40, "x");
    const config = loadConfig({ PLATFORM_ENV: "dev", DATABASE_URL: url, OPS_METRICS_TOKEN: token, ALERT_WEBHOOK_URL: new URL("/alerts", transport.url).href });
    const log = jsonLogger(() => {}), key = "send_failures:friends:nyc";
    const ops = createOps({ config: config.ops, probes: () => [runtimeProbe(rt)], store: new PgAlertStore(sql), now: () => clock.now(), log });
    const backend = createBackend({ svc: service, config, log, ops, now: () => clock.now(), ping: async () => { await sql!`select 1`; return true; } });
    const http = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: backend.publicFetch });
    stopHttp = () => { http.stop(true); };
    const read = async () => {
      const r = await fetch(new URL("/ops/metrics", http.url), { headers: { authorization: `Bearer ${token}` } });
      expect(r.status).toBe(200);
      return r.json() as Promise<OpsMetrics>;
    };
    known = false; const initialSends = sends;
    await emit("ops-uncertain");
    expect(sends).toBe(initialSends + 1);
    expect((await sql`select status from platform.outbound where id = 'ops-uncertain'`)[0].status).toBe("unknown_acceptance");
    expect((await sql`select status from network.messages where id = 'ops-uncertain'`)[0].status).toBe("unknown_acceptance");
    expect((await read()).networks[0]!.sends24h).toEqual({ attempted: 250, failed: 5, refused: 0, dryRun: 0, smsFallback: 0 });
    expect((await ops.tick())?.open.some(n => n.key === key)).toBe(true);
    known = true; clock.advance(MINUTE);
    await rt.unitOfWork(() => undefined);
    expect(lookups).toBeGreaterThan(0);
    expect(sends).toBe(initialSends + 1);
    expect((await sql`select status from network.messages where id = 'ops-uncertain'`)[0].status).toBe("accepted");
    expect((await ops.tick())?.notices.find(n => n.key === key)?.state).toBe("resolved");
    expect((await read()).networks[0]!.sends24h.attempted).toBe(251);
    known = false;
    await emit("ops-unresolved-until-expiry");
    clock.advance(6 * HOUR + MINUTE);
    await rt.unitOfWork(() => undefined);
    expect((await sql`select status from network.messages where id = 'ops-unresolved-until-expiry'`)[0].status).toBe("failed_unknown");
    expect((await ops.tick())?.notices.find(n => n.key === key)?.state).toBe("firing");
    expect((await read()).networks[0]!.sends24h).toEqual({ attempted: 252, failed: 6, refused: 0, dryRun: 0, smsFallback: 0 });
    expect(sends).toBe(initialSends + 2);
    expect(notices.filter(n => n.key === key).map(n => n.state)).toEqual(["firing", "resolved", "firing"]);
  } finally {
    stopHttp();
    transport.stop(true);
    await service?.close();
    await sql?.close();
    await dropTestDb();
  }
}, 120_000);
