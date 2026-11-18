import { expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY, HOUR, SimClock } from "../../packages/core/src/index.ts";
import { NetworkService } from "../../packages/network/service/service.ts";
import { rowsFromGame, writeRows } from "../../packages/observatory/db/writer.ts";
import { GameSource } from "../../packages/observatory/src/sources/game.ts";
import type { ControlCommand } from "../../packages/observatory/src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "../../packages/observatory/test/pg.ts";
import { createBackend, jsonLogger, loadConfig } from "./backend.ts";
import { createOps, PgAlertStore, runtimeProbe, type OpsMetrics } from "./ops.ts";

test.skipIf(!pgAvailable)("ops metrics publishes completed alerts into the current HTTP cache, including a refresh during dispatch", async () => {
  const g = new GameSource({ seed: 1, scenario: "spam_wave", review: "human", pushMs: HOUR, tickMs: HOUR });
  let sql: SQL | undefined, service: NetworkService | undefined, pending: Promise<unknown> | undefined;
  let holdNext = false, release = () => {}, arrived = () => {}, stopHttp = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const receiving = new Promise<void>(resolve => { arrived = resolve; });
  const webhook = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    await req.json();
    if (holdNext) { holdNext = false; arrived(); await blocked; }
    return new Response("ok");
  } });
  const control = async (cmd: ControlCommand) => {
    const r = await g.control(cmd, "reviewer@example.test");
    if (!r.ok) throw Error(r.error);
  };
  try {
    await g.init();
    await control({ type: "step", ms: DAY });
    const url = await testDb();
    sql = new SQL({ url, max: 2 });
    await writeRows(sql, rowsFromGame(g), { truncate: true });
    const clock = new SimClock(g.state().clock.now), token = "synthetic-ops-cache-token".padEnd(40, "x");
    service = new NetworkService({ url, clock, networks: [{ id: "ntwrk:nyc" }], env: { PLATFORM_ENV: "dev" }, notify: false, log: () => {} });
    const config = loadConfig({ PLATFORM_ENV: "dev", DATABASE_URL: url, OPS_METRICS_TOKEN: token, ALERT_REVIEW_BACKLOG: "1", ALERT_WEBHOOK_URL: webhook.url.href });
    const log = jsonLogger(() => {});
    const ops = createOps({ config: config.ops, probes: () => [...service!.runtimes.values()].map(runtimeProbe),
      store: new PgAlertStore(sql), now: () => clock.now(), log });
    const backend = createBackend({ svc: service, config, log, ops, now: () => clock.now(), ping: async () => { await sql!`select 1`; return true; } });
    const http = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: backend.publicFetch });
    stopHttp = () => { http.stop(true); };
    const read = async () => {
      const response = await fetch(new URL("/ops/metrics", http.url), { headers: { authorization: `Bearer ${token}` } });
      expect(response.status).toBe(200);
      return response.json() as Promise<OpsMetrics>;
    };
    const persisted = async () => {
      const open = await sql!`select key, level, count from network.ops_alerts where open order by key`;
      const [posts] = await sql!`select count(*)::int as n from network.ops_alert_posts where at > ${new Date(clock.now() - HOUR)}`;
      return { open: [...open], postsLastHour: posts.n as number };
    };
    const canonical = (alerts: OpsMetrics["alerts"]) => alerts && { ...alerts, open: [...alerts.open].sort((a, b) => a.key.localeCompare(b.key)) };
    await ops.tick();
    const first = await read();
    expect(canonical(first.alerts)).toEqual(await persisted());
    expect(first.alerts!.open.some(a => a.key === "queue_review:ntwrk:nyc")).toBe(true);
    expect((await read()).at).toBe(first.at);

    for (const o of g.state().opportunities.filter(o => o.state === "IN_REVIEW")) {
      await control({ type: "review", oppId: o.id, decision: "reject", reason: "weak_reason" });
    }
    await writeRows(sql, rowsFromGame(g), { truncate: true });
    clock.set(clock.now() + 60_000);
    await ops.tick();
    const cleared = await read();
    expect(canonical(cleared.alerts)).toEqual(await persisted());
    expect(cleared.alerts!.open.some(a => a.key === "queue_review:ntwrk:nyc")).toBe(false);

    await control({ type: "step", ms: DAY });
    expect(g.state().opportunities.some(o => o.state === "IN_REVIEW")).toBe(true);
    await writeRows(sql, rowsFromGame(g), { truncate: true });
    clock.set(g.state().clock.now);
    holdNext = true;
    const dispatch = ops.tick();
    pending = dispatch;
    await Promise.race([receiving, dispatch.then(() => { throw Error("The webhook did not wait"); })]);
    clock.set(clock.now() + 16_000);
    const during = await read();
    expect(during.at).toBe(clock.now());
    expect(during.alerts).toEqual(cleared.alerts);
    release();
    expect((await dispatch)?.ok).toBe(true);
    pending = undefined;
    const after = await read();
    expect(canonical(after.alerts)).toEqual(await persisted());
    expect(after.alerts!.open.some(a => a.key === "queue_review:ntwrk:nyc")).toBe(true);
    expect(after.at).toBe(during.at);
    expect(after.networks).toEqual(during.networks);
  } finally {
    release();
    await pending?.catch(() => {});
    stopHttp();
    webhook.stop(true);
    await service?.close();
    await sql?.close();
    await g.dispose();
    await dropTestDb();
  }
}, 120_000);
