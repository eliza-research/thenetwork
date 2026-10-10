#!/usr/bin/env bun
// The alert monitor on its own (packages/network/service/monitor.ts; docs/runbook-dr.md, runbook-real 7.2).
// The backend runs the same loop in process with MONITOR=1; use this one from a cron or a second service.
//   bun run scripts/monitor.ts                       # the local dev database, every 5 minutes
//   bun run scripts/monitor.ts --once --state f.json # one run (a cron); the dedupe state lives in f.json
//   bun run scripts/monitor.ts --url <db> --healthz-url https://api.ntwrk.party/healthz
// Sinks: the log always, ALERT_FILE (JSON lines) and ALERT_WEBHOOK_URL (https JSON POST) when set.
// Budgets: COST_BUDGET_DAILY_USD, COST_BUDGET_MONTHLY_USD (unset: no cost alert). Never sends SMS.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { SQL } from "bun";
import { AlertDispatcher, DEFAULT_REALERT_MS, sinksFromEnv, type DispatchState } from "../packages/network/service/alerts.ts";
import { costPerMember, Monitor, MONITOR_INTERVAL_MS } from "../packages/network/service/monitor.ts";

const { values: a } = parseArgs({
  options: {
    url: { type: "string" }, once: { type: "boolean", default: false }, state: { type: "string" },
    "healthz-url": { type: "string" }, "interval-ms": { type: "string" }, "no-invariants": { type: "boolean", default: false },
  },
});
let url = a.url ?? process.env.NETWORK_DATABASE_URL;
if (!url) {
  const { DEV_PG_URL, devPgUp } = await import("../packages/observatory/db/dev-pg.ts");
  await devPgUp();
  url = DEV_PG_URL;
}
const log = (s: string) => console.log(s);
const sql = new SQL({ url, max: 1, connection: { application_name: "network-monitor" } });
const state: DispatchState | undefined = a.state && existsSync(a.state) ? JSON.parse(readFileSync(a.state, "utf8")) : undefined;
const reAlert = Number(process.env.ALERT_REALERT_MS);
const dispatcher = new AlertDispatcher({ sinks: sinksFromEnv(process.env, log), now: () => Date.now(), reAlertMs: Number.isFinite(reAlert) && reAlert > 0 ? reAlert : DEFAULT_REALERT_MS, log, ...(state ? { state } : {}) });
const healthzUrl = a["healthz-url"];
const monitor = new Monitor({
  sql, now: () => Date.now(), dispatcher, log, invariants: !a["no-invariants"], intervalMs: Number(a["interval-ms"]) || MONITOR_INTERVAL_MS,
  ...(healthzUrl ? { healthz: async () => (await fetch(healthzUrl, { signal: AbortSignal.timeout(10_000) })).status === 200 } : {}),
});
const save = () => { if (a.state) writeFileSync(a.state, JSON.stringify(dispatcher.snapshot())); };

if (a.once) {
  const sent = await monitor.runOnce();
  save();
  log(JSON.stringify({ sent: sent.length, active: Object.keys(dispatcher.snapshot()).length, costPerMember: await costPerMember(sql, Date.now()).catch(() => null) }));
  await sql.close();
  process.exit(0);
}
await monitor.start();
const stop = async () => { await monitor.stop(); save(); await sql.close(); process.exit(0); };
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
setInterval(save, MONITOR_INTERVAL_MS);
