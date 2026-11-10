import { expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY, HOUR, SimClock } from "../../packages/core/src/index.ts";
import { CostLedger, PgCostSink } from "../../packages/network/service/cost.ts";
import { NetworkService } from "../../packages/network/service/service.ts";
import { rowsFromGame, writeRows } from "../../packages/observatory/db/writer.ts";
import { GameSource } from "../../packages/observatory/src/sources/game.ts";
import type { ControlCommand } from "../../packages/observatory/src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "../../packages/observatory/test/pg.ts";
import { createOps, lineMetrics, opsConfigFromEnv, PgAlertStore, runtimeProbe, type Notice } from "./ops.ts";

const MIN = 60_000;

test.skipIf(!pgAvailable)("ops keeps unread alerts open across SQL failures and a restart until their conditions end", async () => {
  const g = new GameSource({ seed: 1, scenario: "spam_wave", review: "human", pushMs: HOUR, tickMs: HOUR });
  let sql: SQL | undefined, service: NetworkService | undefined;
  const posts: { alerts: Notice[] }[] = [];
  const webhook = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    posts.push(await req.json());
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
    const clock = new SimClock(g.state().clock.now);
    service = new NetworkService({ url, clock, networks: [{ id: "ntwrk:nyc" }], env: { PLATFORM_ENV: "dev" }, notify: false, log: () => {} });
    const cost = new CostLedger({ sink: new PgCostSink(sql), clock });
    await cost.record({ app: "ntwrk", kind: "other", provider: "synthetic", costUsd: 2 });
    await sql`insert into platform.line_safety (line, action, event_type, at)
      values ('+12125550100', 'review', 'safety.review', ${new Date(clock.now())})`;
    await sql`insert into platform.outbound (id, app_id, line, to_address, kind, body, fingerprint, time_zone, status, next_attempt_at, created_at, updated_at)
      values ('held', 'slop', '+12125550100', '+12125550101', 'proactive', 'synthetic text', 'held', 'America/New_York', 'parked_leak_review',
        ${new Date(clock.now())}, ${new Date(clock.now())}, ${new Date(clock.now())})`;
    const config = opsConfigFromEnv({ ALERT_WEBHOOK_URL: webhook.url.href, ALERT_REVIEW_BACKLOG: "1", COST_BUDGET_DAILY_USD: "1", COST_BUDGET_DAILY_USD_NTWRK: "1" }, { env: "dev", build: "test", deployed: false });
    const makeOps = () => createOps({ config, probes: () => [...service!.runtimes.values()].map(runtimeProbe), line: () => lineMetrics(sql!),
      cost, store: new PgAlertStore(sql!), now: () => clock.now(), log: { info() {}, warn() {}, error() {} } });
    let ops = makeOps();
    const keys = ["queue_review:ntwrk:nyc", "line_safety", "leak_review:slop", "budget:total", "budget:ntwrk"].sort();
    const selected = (notices: Notice[]) => notices.filter(n => keys.includes(n.key));
    const stored = async () => ((await sql!`select * from network.ops_alerts order by key`) as { key: string; open: boolean }[]).filter(r => keys.includes(r.key));
    const initial = await ops.tick();
    expect(initial?.ok).toBe(true);
    expect(selected(posts.at(-1)!.alerts).map(n => n.key).sort()).toEqual(keys);
    const before = await stored();

    // Fail real reads in this disposable database. The alert store and local webhook remain available.
    await sql.unsafe("alter table network.facets rename to facets_unread");
    await sql.unsafe("alter table platform.line_safety rename to line_safety_unread");
    await sql.unsafe("alter table network.cost_ledger rename to cost_ledger_unread");
    clock.set(clock.now() + MIN);
    const failed = await ops.tick();
    expect(failed?.notices.filter(n => n.key === "ops_read:ntwrk:nyc" || n.key === "line_read" || n.key === "cost_read").length).toBe(3);
    expect(selected(posts.at(-1)!.alerts)).toEqual([]);
    expect(await stored()).toEqual(before);

    ops = makeOps();
    clock.set(clock.now() + MIN);
    await ops.tick();
    expect(posts.length).toBe(2);
    expect(await stored()).toEqual(before);
    await sql.unsafe("alter table network.facets_unread rename to facets");
    await sql.unsafe("alter table platform.line_safety_unread rename to line_safety");
    await sql.unsafe("alter table network.cost_ledger_unread rename to cost_ledger");
    clock.set(clock.now() + MIN);
    const recovered = await ops.tick();
    expect(recovered?.notices.filter(n => n.state === "resolved").map(n => n.key).sort()).toEqual(["cost_read", "line_read", "ops_read:ntwrk:nyc"]);
    expect(selected(posts.at(-1)!.alerts)).toEqual([]);
    expect((await stored()).every(r => r.open)).toBe(true);

    // Real recovery: native reviewer decisions empty the queue; the line and held text clear;
    // a new UTC day has no cost events. Only now should the original five alerts resolve.
    for (const o of g.state().opportunities.filter(o => o.state === "IN_REVIEW")) {
      await control({ type: "review", oppId: o.id, decision: "reject", reason: "weak_reason" });
    }
    await writeRows(sql, rowsFromGame(g), { truncate: true });
    await sql`update platform.line_safety set action = 'none'`;
    await sql`update platform.outbound set status = 'dropped' where id = 'held'`;
    clock.set(clock.now() + DAY);
    await ops.tick();
    expect(selected(posts.at(-1)!.alerts).map(n => `${n.key}:${n.state}`).sort()).toEqual(keys.map(k => `${k}:resolved`));
    expect((await stored()).every(r => !r.open)).toBe(true);
    clock.set(clock.now() + MIN);
    expect(selected((await ops.tick())!.notices)).toEqual([]);
  } finally {
    await service?.close();
    await sql?.close();
    await g.dispose();
    webhook.stop(true);
    await dropTestDb();
  }
}, 120_000);
