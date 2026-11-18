import { expect, test } from "bun:test";
import { SQL } from "bun";
import { SimClock } from "../../packages/core/src/index.ts";
import { NetworkService } from "../../packages/network/service/service.ts";
import { dropTestDb, pgAvailable, testDb } from "../../packages/observatory/test/pg.ts";
import { createBackend, jsonLogger, loadConfig } from "./backend.ts";
import { createOps, PgAlertStore, runtimeProbe, type Notice, type OpsMetrics } from "./ops.ts";

test.skipIf(!pgAvailable)("staff saves do not replace the stored matcher heartbeat, including a network that never ticked", async () => {
  const MIN = 60_000;
  let sql: SQL | undefined, service: NetworkService | undefined, stopHttp = () => {};
  const delivered: Notice[][] = [];
  const webhook = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    delivered.push((await req.json() as { alerts: Notice[] }).alerts);
    return new Response("ok");
  } });
  try {
    const url = await testDb();
    sql = new SQL({ url, max: 2 });
    const [time] = await sql`select floor(extract(epoch from clock_timestamp()) * 1000)::float8 as now`;
    const now = time.now as number, earlier = now - 16 * MIN, clock = new SimClock(earlier);
    service = new NetworkService({ url, clock, networks: [{ id: "ntwrk:nyc" }, { id: "friends:nyc" }],
      env: { PLATFORM_ENV: "dev" }, notify: false, log: () => {} });
    const ntwrk = service.runtimes.get("ntwrk:nyc")!, friends = service.runtimes.get("friends:nyc")!;
    const token = "synthetic-ops-stored-tick-token".padEnd(40, "x");
    const config = loadConfig({ PLATFORM_ENV: "dev", DATABASE_URL: url, OPS_METRICS_TOKEN: token, ALERT_WEBHOOK_URL: webhook.url.href });
    const log = jsonLogger(() => {});
    const ops = createOps({ config: config.ops, probes: () => [ntwrk, friends].map(runtimeProbe),
      store: new PgAlertStore(sql), now: () => clock.now(), log });
    const backend = createBackend({ svc: service, config, log, ops, now: () => clock.now(), ping: async () => { await sql!`select 1`; return true; } });
    const http = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: backend.publicFetch });
    stopHttp = () => { http.stop(true); };
    const read = async () => {
      const r = await fetch(new URL("/ops/metrics", http.url), { headers: { authorization: `Bearer ${token}` } });
      expect(r.status).toBe(200);
      return r.json() as Promise<OpsMetrics>;
    };
    // A real tick runs on one network. The other has never ticked.
    expect(await ntwrk.tick()).toBe(true);
    clock.set(now);
    for (const rt of [ntwrk, friends]) await rt.unitOfWork(n => n.setMatchingEnabled(false, "operator@example.test"));
    const [stalled, never] = await Promise.all([ntwrk.health(), friends.health()]);
    expect(stalled.lastTick.stored).toBe(earlier);
    expect(never.lastTick.stored).toBeNull();
    expect(stalled.lastTick.savedAt! - earlier).toBeGreaterThan(15 * MIN);
    expect(never.lastTick.savedAt! - earlier).toBeGreaterThan(15 * MIN);
    const m = await read();
    expect(m.networks.map(n => n.lastTickAgoMs)).toEqual([16 * MIN, null]);
    const firing = await ops.tick();
    expect(firing?.notices.map(n => [n.key, n.state])).toEqual([
      ["tick_late:ntwrk:nyc", "firing"], ["tick_late:friends:nyc", "firing"],
    ]);
    expect(delivered).toEqual([firing!.notices]);
    expect((await sql`select key from network.ops_alerts where open order by key`).map((r: { key: string }) => r.key))
      .toEqual(["tick_late:friends:nyc", "tick_late:ntwrk:nyc"]);
    // Matching can be paused while the worker still ticks. Only a tick clears the alert.
    clock.set(now + MIN);
    for (const rt of [ntwrk, friends]) expect(await rt.tick()).toBe(true);
    const recovered = await ops.tick();
    expect(recovered?.notices.map(n => [n.key, n.state]).sort()).toEqual([
      ["tick_late:friends:nyc", "resolved"], ["tick_late:ntwrk:nyc", "resolved"],
    ]);
    expect(delivered).toEqual([firing!.notices, recovered!.notices]);
    expect((await read()).networks.map(n => n.lastTickAgoMs)).toEqual([0, 0]);
    expect((await sql`select key from network.ops_alerts where open`).length).toBe(0);
    clock.set(now + 2 * MIN);
    expect((await ops.tick())?.notices).toEqual([]);
    expect(delivered.length).toBe(2);
  } finally {
    stopHttp();
    webhook.stop(true);
    await service?.close();
    await sql?.close();
    await dropTestDb();
  }
}, 120_000);
