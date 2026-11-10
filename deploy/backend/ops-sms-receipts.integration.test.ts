import { expect, test } from "bun:test";
import { SQL } from "bun";
import { MINUTE, SimClock } from "../../packages/core/src/index.ts";
import { ChannelSendError, type SendReceipt, type SendRequest, type Transport } from "../../packages/blooio/src/types.ts";
import { APPS } from "../../packages/platform/src/apps.ts";
import { BlooioAdapter } from "../../packages/network/service/channel.ts";
import { NetworkService } from "../../packages/network/service/service.ts";
import { dropTestDb, pgAvailable, testDb } from "../../packages/observatory/test/pg.ts";
import { createBackend, jsonLogger, loadConfig } from "./backend.ts";
import { createOps, PgAlertStore, runtimeProbe, type OpsMetrics } from "./ops.ts";

test.skipIf(!pgAvailable)("SMS receipts accrue once on the acceptance day across delivery updates and legacy fallback rows", async () => {
  const clock = new SimClock(Date.UTC(2026, 9, 9, 23, 59)), phone = "+12125550171";
  let sql: SQL | undefined, service: NetworkService | undefined, stopHttp = () => {};
  let known = true, protocol: Transport = "imessage", sends = 0;
  const endpoint = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const path = new URL(req.url).pathname, body = await req.json();
    if (path === "/alerts") return new Response("ok");
    if (path === "/send") sends++; else if (path !== "/receipt") return new Response("not found", { status: 404 });
    return known ? Response.json({ providerMessageId: `local:${body.idempotencyKey}`, status: "sent", transport: protocol, acceptedAt: clock.now() })
      : Response.json({ unknown: true }, { status: 202 });
  } });
  const request = async (path: string, value: SendRequest): Promise<SendReceipt> => {
    const r = await fetch(new URL(path, endpoint.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
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
    const emit = async (id: string) => {
      await rt.adapter.engaged!(phone);
      await rt.unitOfWork(() => { rt.unit.sends.push({ id, memberId, to: phone, body: "Your requested reminder is ready.",
        kind: "reply", type: "reminder", proactive: false, system: false, ts: clock.now() }); });
    };
    const token = "synthetic-ops-sms-receipt-token".padEnd(40, "x");
    const config = loadConfig({ PLATFORM_ENV: "dev", DATABASE_URL: url, OPS_METRICS_TOKEN: token,
      COST_BUDGET_DAILY_USD_FRIENDS: "0.005", ALERT_WEBHOOK_URL: new URL("/alerts", endpoint.url).href });
    const log = jsonLogger(() => {});
    const ops = createOps({ config: config.ops, probes: () => [runtimeProbe(rt)], store: new PgAlertStore(sql),
      cost: service.cost, now: () => clock.now(), log });
    const backend = createBackend({ svc: service, config, log, ops, now: () => clock.now(), ping: async () => { await sql!`select 1`; return true; } });
    const http = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: backend.publicFetch });
    stopHttp = () => { http.stop(true); };
    const read = async () => {
      const r = await fetch(new URL("/ops/metrics", http.url), { headers: { authorization: `Bearer ${token}` } });
      expect(r.status).toBe(200);
      return r.json() as Promise<OpsMetrics>;
    };
    protocol = "sms";
    await emit("sms-before-midnight");
    known = false;
    await emit("sms-receipt-after-midnight");
    const emitted = sends;
    expect((await sql`select status,transport from platform.outbound where id='sms-before-midnight'`)[0]).toEqual({ status: "sent", transport: "sms" });
    expect((await sql`select status from network.messages where id='sms-before-midnight'`)[0].status).toBe("sent");
    expect((await read()).networks[0]!.smsByDay).toEqual({ today: 1, yesterday: 0 });
    expect((await ops.tick())?.open.find(a => a.key === "budget:friends")?.level).toBe("bad");
    expect((await service.cost.totals("2026-10-09")).friends).toBeCloseTo(0.0083, 6);
    clock.advance(MINUTE); known = true;
    const delivered = await rt.adapter.status!({ kind: "status", channel: "sim", providerMessageId: "local:tn:sms-before-midnight", status: "delivered", at: clock.now() });
    if (!delivered) throw Error("Receipt did not advance the stored outcome");
    await rt.storeStatuses([delivered]);
    await rt.unitOfWork(() => undefined);
    expect(sends).toBe(emitted);
    expect((await sql`select status from network.messages where id='sms-receipt-after-midnight'`)[0].status).toBe("sent");
    await ops.tick();
    const nextDay = await read();
    expect(nextDay.networks[0]!.smsByDay).toEqual({ today: 1, yesterday: 1 });
    expect(nextDay.networks[0]!.sends24h.smsFallback).toBe(2);
    expect((await service.cost.totals("2026-10-09")).friends).toBeCloseTo(0.0083, 6);
    expect((await service.cost.totals("2026-10-10")).friends).toBeCloseTo(0.0083, 6);
    clock.advance(MINUTE); protocol = "imessage";
    await emit("imessage-control");
    // Compatibility fixtures: a legacy-only SMS and the old marker on a receipt-backed SMS.
    await sql`insert into network.messages (id,app_id,member_id,direction,body,status,ts)
      values ('legacy-sms','friends',${memberId},'outbound','Synthetic legacy fallback','fell_back',${new Date(clock.now())})`;
    await sql`update network.messages set status='fell_back' where id='sms-receipt-after-midnight'`;
    await ops.tick();
    const mixed = await read();
    expect(mixed.networks[0]!.smsByDay).toEqual({ today: 2, yesterday: 1 });
    expect(mixed.networks[0]!.sends24h.smsFallback).toBe(3);
    expect((await service.cost.totals("2026-10-10")).friends).toBeCloseTo(0.0166, 6);
    clock.advance(MINUTE); await ops.tick();
    expect((await service.cost.totals("2026-10-10")).friends).toBeCloseTo(0.0166, 6);
    expect((await sql`select quantity::float8 as quantity from network.cost_ledger where id='sms_fallback:friends:2026-10-10'`)[0].quantity).toBe(2);
  } finally {
    stopHttp();
    endpoint.stop(true);
    await service?.close();
    await sql?.close();
    await dropTestDb();
  }
}, 120_000);
