// The ops block: monitoring, alerts, cost tracking, the console's deploy guards and the backup drill
// (docs/deploy.md sections 2.6, 7 and 8; mvp-plan items 2, 10, 11 and 12). No model, no network call:
// the webhook, the heartbeat, the OTP provider, the rater and the LLM are fakes on a fake clock.
//   blocking: the alert rules; the dispatcher's dedupe (across a restart), escalation, repeat, resolve,
//             rate limit and retry after a failed post; no phone number or message text in metrics or
//             alerts; the cost rates, metering and budgets; /ops/metrics needs its token and /healthz
//             reports a hung tick; a deployed real-only console refuses to start without Cloudflare
//             Access; the backend and the real-only console import nothing from the simulator, and the
//             image prunes exactly those packages.
//   tracked:  on the dev Postgres (:54339), when it is up: the ops tables and grants under row-level
//             security, and the backup drill (pg_dump to a directory, restore into a new database,
//             row counts equal table by table). With REQUIRE_PG=1 (CI) these two gates block.
import { dirname, relative, resolve } from "node:path";
import { SQL } from "bun";
import { CostLedger, MemoryCostSink, budgetLines, costRatesFromEnv, DEFAULT_RATES, PgCostSink } from "../../packages/network/service/cost.ts";
import type { AppInfo } from "../../packages/platform/src/apps.ts";
import { APPS } from "../../packages/platform/src/apps.ts";
import type { PhotoRater } from "../../packages/platform/src/photos.ts";
import { createBackend, jsonLogger, loadConfig, type ServiceLike } from "../../deploy/backend/backend.ts";
import {
  AlertDispatcher, collectNetwork, createOps, evaluate, MemoryAlertStore, opsConfigFromEnv, PgAlertStore, runtimeProbe,
  type Alert, type NetworkMetrics, type NetworkProbe, type OpsMetrics,
} from "../../deploy/backend/ops.ts";
import { Block, expect } from "./gate.ts";

const REPO = resolve(import.meta.dir, "../..");
const MIN = 60_000, HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 9, 8, 15, 0, 0);
/** A phone number as a person or a provider writes it (E.164, (212) 555-0100, 212-555-0100); epoch times are not phones. */
const PHONE = /\+\d{10,15}|\(\d{3}\)\s?\d{3}-\d{4}|\b\d{3}[.-]\d{3}[.-]\d{4}\b/;

const healthy = (network: string, app: string): NetworkMetrics => ({
  network, app, lastTickAgoMs: 30_000, backlog: { review: 2, reviewOverdue: 0, deferred: 0, outboundWaiting: 1 },
  sends24h: { attempted: 200, failed: 1, refused: 3, dryRun: 0, smsFallback: 0 }, reviewExpired24h: 0,
  safety24h: { reports: 0, urgentReports: 0, minorAfterContact: 0, holds: 0, bans: 0 }, smsByDay: { today: 0, yesterday: 0 },
});
const CFG = opsConfigFromEnv({}, { env: "sim", build: "sim", deployed: false });
const noCost: OpsMetrics["cost"] = { day: "2026-10-08", totalUsd: 0, byApp: {}, budgets: [] };

export async function opsBlock(b: Block): Promise<void> {
  // ---------------------------------------------------------------- alert rules
  await b.run("alerts: a healthy network raises none; each condition raises its own alert at its level", () => {
    expect(evaluate({ networks: [healthy("slop:nyc", "slop")], cost: noCost }, CFG)).toEqual([]);
    const sick: NetworkMetrics = {
      ...healthy("slop:nyc", "slop"), lastTickAgoMs: 20 * MIN,
      backlog: { review: 40, reviewOverdue: 2, deferred: 0, outboundWaiting: 80 },
      sends24h: { attempted: 100, failed: 6, refused: 0, dryRun: 0, smsFallback: 0 }, reviewExpired24h: 1,
      safety24h: { reports: 2, urgentReports: 1, minorAfterContact: 1, holds: 1, bans: 1 },
    };
    const cost: OpsMetrics["cost"] = { day: "2026-10-08", totalUsd: 9, byApp: { slop: 9 }, budgets: budgetLines({ slop: 9 }, { daily: 10, byApp: { slop: 8 } }) };
    const got = Object.fromEntries(evaluate({ networks: [sick], cost }, CFG).map(a => [a.key, a.level]));
    expect(got).toEqual({
      "tick_late:slop:nyc": "bad", "send_failures:slop:nyc": "bad", "review_sla:slop:nyc": "bad", "safety_minor:slop:nyc": "bad", "safety_report:slop:nyc": "bad",
      "safety_action:slop:nyc": "warn", "queue_outbound:slop:nyc": "warn", "queue_review:slop:nyc": "warn", "budget:total": "warn", "budget:slop": "bad",
    });
    // Under the minimum count, or under the rate, failures are not an alert; a report that is not urgent is a warning.
    const few = { ...healthy("peon:nyc", "peon"), sends24h: { attempted: 10, failed: 4, refused: 0, dryRun: 0, smsFallback: 0 } };
    const rare = { ...healthy("peon:nyc", "peon"), sends24h: { attempted: 1000, failed: 10, refused: 0, dryRun: 0, smsFallback: 0 } };
    const mild = { ...healthy("peon:nyc", "peon"), safety24h: { reports: 1, urgentReports: 0, minorAfterContact: 0, holds: 0, bans: 0 } };
    expect(evaluate({ networks: [few, rare], cost: noCost }, CFG)).toEqual([]);
    expect(evaluate({ networks: [mild], cost: noCost }, CFG).map(a => `${a.key}=${a.level}`)).toEqual(["safety_report:peon:nyc=warn"]);
    // No tick ever stored is late too, once the process has run for TICK_LATE (not at boot); an unreadable network is a warning, not silence.
    const never = { ...healthy("friends:nyc", "friends"), lastTickAgoMs: null };
    expect(evaluate({ networks: [never], cost: noCost, uptimeMs: 16 * MIN }, CFG).map(a => a.key)).toEqual(["tick_late:friends:nyc"]);
    expect(evaluate({ networks: [never], cost: noCost, uptimeMs: MIN }, CFG)).toEqual([]);
    expect(evaluate({ networks: [{ ...healthy("friends:nyc", "friends"), error: "timeout" }], cost: { error: "x" } }, CFG).map(a => a.key)).toEqual(["ops_read:friends:nyc", "cost_read"]);
  });

  await b.run("alerts: send outcomes count failures against what reached the provider (dry-run, refusals and waiting rows excluded)", async () => {
    const probe: NetworkProbe = {
      id: "slop:nyc", app: "slop",
      health: async () => ({ lastTick: { stored: T0 - 30_000, savedAt: T0 - 20_000 }, backlog: { review: 0, reviewOverdue: 0, deferred: 0, outboundWaiting: 0 } }),
      since: async () => ({
        statuses: { delivered: 90, read: 4, failed: 3, failed_no_address: 2, parked_error: 1, fell_back: 5, dry_run: 50, refused_opted_out: 7, suppressed_opt_out: 1, queued: 9 },
        events: [{ type: "review_expired", action: null, n: 2 }, { type: "safety_action", action: "ban", n: 1 }, { type: "safety_action", action: "lift_hold", n: 3 }],
        reports: [{ kind: "scam" }, { kind: "no_show" }], sms: { today: 4, yesterday: 1 },
      }),
    };
    const m = await collectNetwork(probe, T0);
    expect(m.lastTickAgoMs).toBe(20_000);
    expect(m.sends24h).toEqual({ attempted: 105, failed: 6, refused: 8, dryRun: 50, smsFallback: 5 });
    expect([m.reviewExpired24h, m.safety24h.bans, m.safety24h.holds, m.safety24h.reports, m.safety24h.urgentReports]).toEqual([2, 1, 0, 2, 1]);
    const broken = await collectNetwork({ ...probe, health: async () => { throw new Error("connection refused"); } }, T0);
    expect(broken.error).toBe("connection refused");
  });

  // ---------------------------------------------------------------- the dispatcher
  const fakeDispatcher = (store: MemoryAlertStore, clock: { t: number }, o: { max?: number; ok?: () => boolean } = {}) => {
    const posts: Record<string, any>[] = [];
    const d = new AlertDispatcher({
      store, now: () => clock.t, repeatMs: 6 * HOUR, maxPostsPerHour: o.max ?? 12, format: "json", env: "sim", build: "b1",
      post: async body => { posts.push(body); return o.ok ? o.ok() : true; },
    });
    return { d, posts };
  };
  const A = (key: string, level: Alert["level"], count = 1, bump = false): Alert => ({ key, level, count, text: `${key} text`, ...(bump ? { bump } : {}) });

  await b.run("dispatcher: one post per round; dedupe (also after a restart), escalation, safety bumps, repeat, resolve once", async () => {
    const store = new MemoryAlertStore(), clock = { t: T0 };
    let { d, posts } = fakeDispatcher(store, clock);
    const r1 = await d.dispatch([A("tick_late:slop:nyc", "warn"), A("safety_report:slop:nyc", "warn", 1, true)]);
    expect([posts.length, r1!.notices.length]).toEqual([1, 2]);
    expect(posts[0]!.alerts.map((a: any) => a.state)).toEqual(["firing", "firing"]);
    clock.t += MIN;
    await d.dispatch([A("tick_late:slop:nyc", "warn"), A("safety_report:slop:nyc", "warn", 1, true)]);
    expect(posts.length).toBe(1);
    // A restart (a new dispatcher on the same stored state) does not post again.
    ({ d, posts } = fakeDispatcher(store, clock));
    clock.t += MIN;
    await d.dispatch([A("tick_late:slop:nyc", "warn"), A("safety_report:slop:nyc", "warn", 1, true)]);
    expect(posts.length).toBe(0);
    // warn -> bad posts; a count that grows posts only for a safety alert (bump).
    clock.t += MIN;
    await d.dispatch([A("tick_late:slop:nyc", "bad", 5), A("safety_report:slop:nyc", "warn", 1, true)]);
    expect(posts.map(p => p.alerts.map((a: any) => a.key))).toEqual([["tick_late:slop:nyc"]]);
    clock.t += MIN;
    await d.dispatch([A("tick_late:slop:nyc", "bad", 9), A("safety_report:slop:nyc", "warn", 2, true)]);
    expect(posts.at(-1)!.alerts.map((a: any) => `${a.key}:${a.count}`)).toEqual(["safety_report:slop:nyc:2"]);
    expect(posts.length).toBe(2);
    // Still firing after ALERT_REPEAT_MS: posted again.
    clock.t += 6 * HOUR;
    await d.dispatch([A("tick_late:slop:nyc", "bad", 9), A("safety_report:slop:nyc", "warn", 2, true)]);
    expect(posts.length).toBe(3);
    // It ends: one "resolved" notice, then silence.
    clock.t += MIN;
    await d.dispatch([A("safety_report:slop:nyc", "warn", 2, true)]);
    expect(posts.at(-1)!.alerts).toEqual([{ key: "tick_late:slop:nyc", level: "bad", count: 9, text: "tick_late:slop:nyc text", state: "resolved" }]);
    clock.t += MIN;
    await d.dispatch([A("safety_report:slop:nyc", "warn", 2, true)]);
    expect(posts.length).toBe(4);
    // It comes back: a new alert.
    clock.t += MIN;
    await d.dispatch([A("tick_late:slop:nyc", "bad", 1), A("safety_report:slop:nyc", "warn", 2, true)]);
    expect(posts.at(-1)!.alerts.map((a: any) => `${a.key}:${a.state}`)).toEqual(["tick_late:slop:nyc:firing"]);
    expect(posts.at(-1)!.text).toMatch(/^\[sim\] The Network: 1 alert\(s\)\nBAD: tick_late:slop:nyc text$/);
  });

  await b.run("dispatcher: the hourly rate limit holds posts, which go out when the hour passes; a failed post is retried", async () => {
    const store = new MemoryAlertStore(), clock = { t: T0 };
    const { d, posts } = fakeDispatcher(store, clock, { max: 2 });
    for (let i = 0; i < 3; i++) { await d.dispatch(Array.from({ length: i + 1 }, (_, k) => A(`queue_review:n${k}`, "warn"))); clock.t += MIN; }
    expect(posts.length).toBe(2);
    const held = await d.dispatch([A("queue_review:n0", "warn"), A("queue_review:n1", "warn"), A("queue_review:n2", "warn")]);
    expect([held!.held, posts.length]).toEqual([1, 2]);
    clock.t += HOUR;
    await d.dispatch([A("queue_review:n0", "warn"), A("queue_review:n1", "warn"), A("queue_review:n2", "warn")]);
    expect(posts.at(-1)!.alerts.map((a: any) => a.key)).toEqual(["queue_review:n2"]);
    // The webhook answers 500: nothing is marked sent; the next round posts the same alert again.
    const s2 = new MemoryAlertStore();
    let up = false;
    const f = fakeDispatcher(s2, clock, { ok: () => up });
    const r = await f.d.dispatch([A("send_failures:slop:nyc", "bad", 7)]);
    expect([r!.posted, r!.ok]).toEqual([true, false]);
    up = true; clock.t += MIN;
    await f.d.dispatch([A("send_failures:slop:nyc", "bad", 7)]);
    expect(f.posts.length).toBe(2);
    clock.t += MIN;
    await f.d.dispatch([A("send_failures:slop:nyc", "bad", 7)]);
    expect(f.posts.length).toBe(2);
    // Slack format: { text } only.
    const slack = new AlertDispatcher({ store: new MemoryAlertStore(), post: async () => true, now: () => T0, repeatMs: HOUR, maxPostsPerHour: 1, format: "slack", env: "production", build: "b" });
    expect(Object.keys(slack.body([{ key: "k", level: "bad", count: 1, text: "t", state: "firing" }]))).toEqual(["text"]);
  });

  await b.run("alerts and metrics carry counts and network ids only: no phone number, member id or message text", async () => {
    const store = new MemoryAlertStore(), posts: Record<string, unknown>[] = [], lines: string[] = [];
    const probe: NetworkProbe = {
      id: "slop:nyc", app: "slop",
      health: async () => ({ lastTick: { stored: null, savedAt: null }, backlog: { review: 50, reviewOverdue: 3, deferred: 0, outboundWaiting: 70 } }),
      since: async () => ({ statuses: { failed: 30, delivered: 10 }, events: [{ type: "minor_after_contact", action: null, n: 1 }], reports: [{ kind: "minor" }], sms: { today: 0, yesterday: 0 } }),
    };
    const ops = createOps({
      config: { ...CFG, webhookUrl: "https://hooks.example.test/x" }, probes: () => [probe], store, now: () => T0,
      log: jsonLogger(s => lines.push(s)), post: async body => { posts.push(body); return true; },
    });
    await ops.tick();
    const m = await ops.metrics();
    const all = JSON.stringify({ posts, m, lines });
    expect(posts.length).toBe(1);
    expect(all).not.toMatch(PHONE);
    expect(all).not.toMatch(/mem_|"body"|"phone"/);
    // Without a webhook the notices are log lines ("alert"), still deduplicated.
    const logOnly: string[] = [];
    const quiet = createOps({ config: CFG, probes: () => [probe], store: new MemoryAlertStore(), now: () => T0, log: jsonLogger(s => logOnly.push(s)) });
    await quiet.tick();
    expect(logOnly.filter(l => l.includes('"msg":"alert"')).length).toBeGreaterThan(3);
    expect(logOnly.join("\n")).not.toMatch(PHONE);
  });

  // ---------------------------------------------------------------- cost
  await b.run("cost: Twilio Verify codes, Clef ratings, LLM calls, the line and SMS fallbacks are costed per app; budgets warn at 80%", async () => {
    let t = T0;
    const sink = new MemoryCostSink();
    const ledger = new CostLedger({ sink, clock: { now: () => t }, rates: { ...DEFAULT_RATES, blooioLineMonthlyUsd: 30 } });
    const slop = APPS.slop as AppInfo, peon = APPS.peon as AppInfo;
    const twilio = ledger.meterOtp({ name: "twilio_verify", send: async () => ({ ref: "VE1" }), check: async () => true });
    await twilio.send("+15550100", slop); await twilio.send("+15550101", slop); await twilio.send("+15550102", peon);
    expect(await twilio.check!("+15550100", "123456", "VE1")).toBe(true);
    const dev = { name: "dev_console", send: async () => ({ code: "000000" }) };
    expect(ledger.meterOtp(dev)).toBe(dev);
    const photos = [{}, {}, {}, {}] as never;
    let mode: "ok" | "refuse" | "error" = "ok";
    const rater = ledger.meterRater({ id: "clef", rate: async () => { if (mode === "error") throw new Error("503"); return mode === "ok" ? ({ overall: 0.5 } as never) : null; } } as PhotoRater);
    await rater.rate({} as never, photos);
    mode = "refuse"; await rater.rate({} as never, photos);
    mode = "error"; await rater.rate({} as never, [{}] as never).catch(() => {});
    const hooks = ledger.llmHooks("slop", "understand");
    hooks.onResponse!({ costMicro: 1500, costKnown: true, baseUrl: "https://api.surplusintelligence.ai/v1", model: "gpt-6-luna", usage: { promptTokens: 300, completionTokens: 50, reasoningTokens: 0 }, attempt: 0 } as never);
    hooks.onResponse!({ costMicro: 0, costKnown: true, baseUrl: "https://api.surplusintelligence.ai/v1", model: "gpt-6-luna", usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 }, attempt: 1 } as never);
    await Bun.sleep(0);
    await ledger.accrue("2026-10-08", { slop: 10 });
    await ledger.accrue("2026-10-08", { slop: 12 });
    const rows = [...sink.rows.values()];
    const by = (k: string) => rows.filter(r => r.kind === k);
    expect(by("otp_verify").map(r => `${r.app}:${r.costUsd}`)).toEqual(["slop:0.058", "slop:0.058", "peon:0.058"]);
    expect(by("photo_rating").map(r => [r.quantity, Math.round(r.costUsd * 1e6)])).toEqual([[4, 1700], [1, 425]]);
    expect(by("llm").map(r => [r.app, r.costUsd, r.estimated])).toEqual([["slop", 0.0015, false]]);
    expect(by("blooio_line").map(r => [r.app, r.costUsd])).toEqual([["shared", 1]]);
    expect(by("sms_fallback").map(r => [r.quantity, Math.round(r.costUsd * 1e4)])).toEqual([[12, 996]]);
    expect(rows.every(r => !PHONE.test(JSON.stringify(r)))).toBe(true);
    const totals = await ledger.totals("2026-10-08");
    expect(Math.round((totals.slop ?? 0) * 1e6)).toBe(Math.round((0.116 + 0.0017 + 0.000425 + 0.0015 + 12 * 0.0083) * 1e6));
    const lines = budgetLines(totals, { daily: 1.5, byApp: { slop: 0.2, peon: 1 } });
    expect(lines.map(l => [l.scope, l.share >= 1 ? "over" : l.share >= 0.8 ? "warn" : "ok"])).toEqual([["total", "warn"], ["slop", "over"], ["peon", "ok"]]);
    expect(() => costRatesFromEnv({ COST_SMS_USD: "-1" })).toThrow();
    expect(costRatesFromEnv({ COST_TWILIO_VERIFY_USD: "0.05" }).twilioVerifyUsd).toBe(0.05);
    t += 1;
  });

  // ---------------------------------------------------------------- the backend's routes
  await b.run("backend: /ops/metrics needs OPS_METRICS_TOKEN (404 without one, 401 for a wrong one); /healthz is 503 tick_late when a tick hangs", async () => {
    const base = { PLATFORM_ENV: "dev", DATABASE_URL: "postgres://x@localhost/x" };
    const token = "m".repeat(40);
    let release = () => {};
    let hang = true;
    const svc: ServiceLike = {
      fetch: async () => Response.json({ ok: true }), publicFetch: async () => Response.json({ ok: true }), close: async () => {},
      runtimes: new Map([["slop:nyc", { id: "slop:nyc", tick: async () => { if (hang) await new Promise<void>(r => { release = r; }); return true; } }]]),
    };
    let now = T0;
    const fakeOps = { tick: async () => undefined, metrics: async () => ({ ok: true, networks: [] }) };
    const mk = (env: Record<string, string>) => createBackend({ svc, config: { ...loadConfig({ ...base, ...env }), tickMs: HOUR, shutdownGraceMs: 10 }, log: jsonLogger(() => {}), ping: async () => true, ops: fakeOps, now: () => now });
    const off = mk({});
    expect((await off.publicFetch(new Request("http://x/ops/metrics", { headers: { authorization: `Bearer ${token}` } }))).status).toBe(404);
    const on = mk({ OPS_METRICS_TOKEN: token });
    expect((await on.publicFetch(new Request("http://x/ops/metrics"))).status).toBe(401);
    expect((await on.publicFetch(new Request("http://x/ops/metrics", { headers: { authorization: `Bearer ${"x".repeat(40)}` } }))).status).toBe(401);
    const ok = await on.publicFetch(new Request("http://x/ops/metrics", { headers: { authorization: `Bearer ${token}` } }));
    expect([ok.status, (await ok.json()).ok]).toEqual([200, true]);
    expect(() => loadConfig({ ...base, OPS_METRICS_TOKEN: "short" })).toThrow();
    const thrown = (f: () => unknown) => { try { f(); return ""; } catch (e) { return (e as Error).message; } };
    expect(thrown(() => loadConfig({ PLATFORM_ENV: "staging", DATABASE_URL: "postgres://x@db/x", MIGRATION_DATABASE_URL: "postgres://o@db/x", PLATFORM_HASH_KEY: "h".repeat(40), PLATFORM_PROXY_SECRET: "s".repeat(40),
      TURNSTILE_SECRET_KEY: "f", OTP_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t", TWILIO_VERIFY_SERVICE_SID: "VA", ALERT_WEBHOOK_URL: "http://hooks.example.test/x" }))).toMatch(/must be https/);
    // A tick that never finishes: healthy until TICK_LATE_MS (15 min by default), then 503 for the uptime monitor.
    void on.startTicks();
    expect((await on.publicFetch(new Request("http://x/healthz"))).status).toBe(200);
    now += 16 * MIN;
    const late = await on.publicFetch(new Request("http://x/healthz"));
    expect([late.status, (await late.json()).status]).toEqual([503, "tick_late"]);
    hang = false; release();
    await Bun.sleep(1);
    expect((await on.publicFetch(new Request("http://x/healthz"))).status).toBe(200);
    await on.shutdown();
  });

  // ---------------------------------------------------------------- the console deploy guards
  await b.run("console: a deployed real-only console refuses to start without Cloudflare Access", async () => {
    const keep = { PLATFORM_ENV: process.env.PLATFORM_ENV, OBSERVATORY_TRUST_CF_ACCESS: process.env.OBSERVATORY_TRUST_CF_ACCESS };
    process.env.PLATFORM_ENV = "production";
    delete process.env.OBSERVATORY_TRUST_CF_ACCESS;
    try {
      const { createServer } = await import("../../packages/observatory/src/server.ts");
      let err = "";
      await createServer({ realOnly: true, port: 0, real: { url: undefined }, audit: { dir: "/nonexistent" } }).then(s => s.stop(), e => { err = String((e as Error).message); });
      expect(err).toMatch(/refusing to start.*Cloudflare Access/);
    } finally {
      for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });

  await b.run("image: the backend and the real-only console import nothing from the simulator; the Dockerfile prunes exactly those packages", async () => {
    const FORBIDDEN = ["packages/sim/", "packages/judge/", "packages/evals/", "packages/worlds/", "packages/plugin-network/", "scripts/", "evals/"];
    const backend = await importGraph(`${REPO}/deploy/backend/server.ts`, true);
    // The console: its static graph (game mode and the scenario list are dynamic imports, never taken in real-only mode) and the web bundle.
    const consoleGraph = new Set([...(await importGraph(`${REPO}/packages/observatory/src/server.ts`, false)), ...(await importGraph(`${REPO}/packages/observatory/web/main.tsx`, true))]);
    const bad = [...backend, ...consoleGraph].filter(f => FORBIDDEN.some(p => f.startsWith(p)));
    expect(bad).toEqual([]);
    expect(backend.size).toBeGreaterThan(50);
    const docker = await Bun.file(`${REPO}/deploy/backend/Dockerfile`).text();
    const pruned = (docker.match(/^RUN rm -rf (.+)$/m)?.[1] ?? "").split(/\s+/).map(p => `${p.replace(/\/$/, "")}/`);
    expect(pruned.sort()).toEqual(FORBIDDEN.filter(p => p.startsWith("packages/")).sort());
  });

  // ---------------------------------------------------------------- Postgres (tracked)
  const admin = `postgres://${process.env.USER ?? "postgres"}@localhost:54339/postgres`;
  const up = await pgUp(admin);
  if (!up) {
    b.track("ops tables on Postgres (dev :54339)", false, "skipped: the dev Postgres is not running (bun run observatory:db)");
    b.track("backup drill: dump and restore into a new database, row counts equal", false, "skipped: the dev Postgres is not running");
    return;
  }
  const pgBlocking = process.env.REQUIRE_PG === "1";
  const src = `ops_drill_src_${process.pid}`, dst = `ops_drill_dst_${process.pid}`;
  const a = new SQL({ url: admin, max: 1 });
  await a.unsafe(`drop database if exists ${dst}`); await a.unsafe(`drop database if exists ${src}`);
  await a.unsafe(`create database ${src}`);
  const srcUrl = admin.replace(/\/postgres$/, `/${src}`);
  try {
    const { migrate } = await import("../../packages/observatory/db/migrate.ts");
    await migrate(srcUrl, { lockTimeout: "60s" });
    await b.run("ops tables on Postgres: service writes, per-app console reads, alert dedupe across a restart, the probe's reads under row-level security", async () => {
      const sql = new SQL({ url: srcUrl, max: 2 });
      try {
        await seed(sql);
        // The service role writes cost rows and reads them all.
        await sql.begin(async tx => {
          await tx`set local role network_service`;
          const sink = new PgCostSink(tx as unknown as SQL);
          await sink.write([{ id: "c1", app: "slop", day: "2026-10-08", at: T0, kind: "otp_verify", provider: "twilio_verify", quantity: 1, unitCostUsd: 0.058, costUsd: 0.058, estimated: true, detail: {} },
            { id: "c2", app: "peon", day: "2026-10-08", at: T0, kind: "otp_verify", provider: "twilio_verify", quantity: 1, unitCostUsd: 0.058, costUsd: 0.058, estimated: true, detail: {} },
            { id: "c3", app: "shared", day: "2026-10-08", at: T0, kind: "blooio_line", provider: "blooio", quantity: 1, unitCostUsd: 1, costUsd: 1, estimated: true, detail: { monthlyUsd: 30 } }]);
          await sink.write([{ id: "c3", app: "shared", day: "2026-10-08", at: T0, kind: "blooio_line", provider: "blooio", quantity: 1, unitCostUsd: 1, costUsd: 1, estimated: true, detail: { monthlyUsd: 30 } }]);
          expect(await sink.totals("2026-10-08")).toEqual({ peon: 0.058, shared: 1, slop: 0.058 });
        });
        // slop's console role sees slop and the shared line, never peon.
        const seen = await sql.begin(async tx => { await tx`set local role network_observatory_slop`; return (await tx`select app_id from network.cost_ledger order by app_id`).map((r: any) => r.app_id); });
        expect(seen).toEqual(["shared", "slop"]);
        const denied = await sql.begin(async tx => { await tx`set local role network_observatory_slop`; return tx`select 1 from network.ops_alerts`.then(() => "read", e => String(e.message)); });
        expect(denied).toMatch(/permission denied/);
        // The alert store: the service role, the advisory lock, dedupe across a restart.
        const posts: unknown[] = [];
        const svcSql = new SQL({ url: srcUrl, max: 1 });
        try {
          const mkD = () => new AlertDispatcher({ store: new PgAlertStore(svcSql), post: async x => { posts.push(x); return true; }, now: () => T0, repeatMs: HOUR, maxPostsPerHour: 5, format: "json", env: "sim", build: "b" });
          await svcSql`set role network_service`;
          await mkD().dispatch([A("tick_late:slop:nyc", "bad", 3)]);
          await mkD().dispatch([A("tick_late:slop:nyc", "bad", 3)]);
          expect(posts.length).toBe(1);
          const [row] = await svcSql`select open, last_sent_level from network.ops_alerts where key = 'tick_late:slop:nyc'`;
          expect([row?.open, row?.last_sent_level]).toEqual([true, "bad"]);
        } finally { await svcSql.close(); }
        // The probe's reads, as the service role with app.app_id set (what NetworkRuntime.scoped does).
        const probe = runtimeProbe({
          id: "slop:nyc", app: { id: "slop" },
          health: async () => ({ lastTick: { stored: T0, savedAt: T0 }, backlog: { review: 0, reviewOverdue: 0, deferred: 0, outboundWaiting: 0 } }),
          scoped: fn => sql.begin(async tx => { await tx`set local role network_service`; await tx`select set_config('app.app_id', 'slop', true)`; return fn(tx as unknown as SQL); }) as never,
        });
        const m = await collectNetwork(probe, T0 + MIN);
        expect(m.error).toBeUndefined();
        expect(m.sends24h).toEqual({ attempted: 3, failed: 1, refused: 1, dryRun: 1, smsFallback: 1 });
        expect([m.safety24h.minorAfterContact, m.safety24h.bans, m.safety24h.reports, m.safety24h.urgentReports, m.smsByDay.today]).toEqual([1, 1, 2, 1, 1]);
      } finally { await sql.close(); }
    }, pgBlocking);

    await b.run("backup drill: pg_dump of a seeded database, restore into a new database, row counts equal table by table", async () => {
      const { backup } = await import("../../deploy/backup/backup.ts");
      const { restore } = await import("../../deploy/backup/restore.ts");
      const dir = `${REPO}/runs/sim/ops-drill-${process.pid}`;
      try {
        const bk = await backup({ url: srcUrl, outDir: dir });
        const rows = Object.values(bk.manifest.rowCounts).reduce((s, n) => s + n, 0);
        expect(rows).toBeGreaterThan(30);
        expect(bk.manifest.rowCounts["network.cost_ledger"]).toBe(3);
        const r = await restore({ serverUrl: admin, db: dst, dir });
        expect(r.mismatches).toEqual([]);
        // A restore never writes into a database that exists, nor into a live name.
        expect(await restore({ serverUrl: admin, db: dst, dir }).then(() => "restored", e => String(e.message))).toMatch(/already exists/);
        expect(await restore({ serverUrl: admin, db: "railway", dir }).then(() => "restored", e => String(e.message))).toMatch(/refusing/);
        b.track(`backup drill: ${Object.keys(bk.manifest.rowCounts).length} tables, ${rows} rows, dump ${Math.round(bk.bytes / 1024)} KiB, restore ${r.ms} ms`, true);
      } finally { await Bun.$`rm -rf ${dir}`.quiet().nothrow(); }
    }, pgBlocking);
  } finally {
    await a.unsafe(`drop database if exists ${dst}`).catch(() => {});
    await a.unsafe(`drop database if exists ${src}`).catch(() => {});
    await a.close();
  }
}

/** A few rows in the tables the drill and the probe read (synthetic; +1 555 01xx numbers only). */
async function seed(sql: SQL) {
  const at = new Date(T0 - HOUR);
  for (let i = 0; i < 6; i++) {
    await sql`insert into network.members (app_id, id, name, home_city, account_status, age, joined_at) values ('slop', ${`m${i}`}, ${`Sim${i}`}, 'nyc', 'active', ${25 + i}, ${at})`;
  }
  const msgs: [string, string][] = [["delivered", "a"], ["failed", "b"], ["fell_back", "c"], ["dry_run", "d"], ["refused_opted_out", "e"], ["queued", "f"]];
  for (const [status, id] of msgs) await sql`insert into network.messages (app_id, id, member_id, direction, channel, body, status, ts) values ('slop', ${id}, 'm1', 'outbound', 'imessage', 'synthetic text', ${status}, ${at})`;
  for (const [type, payload] of [["minor_after_contact", { memberId: "m2" }], ["safety_action", { action: "ban", memberId: "m3" }], ["review_expired", { oppId: "o1" }]] as const) {
    await sql`insert into network.events (app_id, at, actor_type, type, object_type, object_id, payload) values ('slop', ${at}, 'agent', ${type}, 'member', 'm2', ${payload as Record<string, unknown>}::jsonb)`;
  }
  await sql`insert into network.network_state (id, version, state, saved_at) values ('slop:nyc', 1, ${{ reports: [{ id: "r1", kind: "scam", at: T0 - HOUR }, { id: "r2", kind: "no_show", at: T0 - 2 * HOUR }, { id: "r0", kind: "minor", at: T0 - 3 * 24 * HOUR }] }}::jsonb, ${at})`;
  await sql`insert into platform.people (id, lowest_age, created_at) values ('00000000-0000-4000-8000-000000000001', 30, ${at})`;
}

async function pgUp(url: string): Promise<boolean> {
  const s = new SQL({ url, max: 1, connectionTimeout: 2 });
  try { await s`select 1`; return true; } catch { return false; } finally { await s.close().catch(() => {}); }
}

/** Files (repo-relative) a module reaches by import: static imports, and with `dynamic` string-literal dynamic imports too. */
async function importGraph(entry: string, dynamic: boolean): Promise<Set<string>> {
  const ts = new Bun.Transpiler({ loader: "ts" }), tsx = new Bun.Transpiler({ loader: "tsx" });
  const seen = new Set<string>(), out = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const rel = relative(REPO, f);
    if (rel.startsWith("..") || rel.includes("node_modules/")) continue;
    out.add(rel);
    if (!/\.(ts|tsx)$/.test(f)) continue;
    let imports: ReturnType<Bun.Transpiler["scanImports"]>;
    try { imports = (f.endsWith(".tsx") ? tsx : ts).scanImports((await Bun.file(f).text()).replace(/^#!.*/, "")); }
    catch (e) { throw new Error(`cannot read the imports of ${rel}: ${(e as Error).message}`); }
    for (const i of imports) {
      if (i.kind === "dynamic-import" && !dynamic) continue;
      if (/\.(html|css)$/.test(i.path)) continue;
      try { stack.push(Bun.resolveSync(i.path, dirname(f))); } catch { /* a builtin */ }
    }
  }
  return out;
}
