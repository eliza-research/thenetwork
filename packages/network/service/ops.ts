// The backend's operations wiring (deploy/backend/server.ts), in one call so the entry point stays short:
//  - the cost ledger (costs.ts) is always on: every LLM call this process makes is a row of network.llm_usage;
//  - the monitor (monitor.ts) runs when MONITOR=1, with the sinks the environment names (alerts.ts:
//    the log, ALERT_FILE, ALERT_WEBHOOK_URL). Never SMS.
import { SQL } from "bun";
import { AlertDispatcher, DEFAULT_REALERT_MS, sinksFromEnv } from "./alerts.ts";
import { CostLedger } from "./costs.ts";
import { Monitor } from "./monitor.ts";

export interface OpsOptions {
  databaseUrl: string;
  now: () => number;
  log: (line: string) => void;
  env?: Record<string, string | undefined>;
  /** The liveness check the monitor uses (the backend's own /healthz check). */
  healthz?: () => Promise<boolean>;
}

export function startOps(o: OpsOptions): { monitor?: Monitor; ledger: CostLedger; stop(): Promise<void> } {
  const env = o.env ?? process.env;
  const ledgerSql = new SQL({ url: o.databaseUrl, max: 1, idleTimeout: 30, connection: { application_name: "network-backend-costs" } });
  const ledger = new CostLedger({ sql: ledgerSql, now: o.now, log: o.log });
  ledger.install();
  let monitor: Monitor | undefined, monitorSql: SQL | undefined;
  if (env.MONITOR === "1") {
    monitorSql = new SQL({ url: o.databaseUrl, max: 1, idleTimeout: 30, connection: { application_name: "network-backend-monitor" } });
    const reAlert = Number(env.ALERT_REALERT_MS);
    const dispatcher = new AlertDispatcher({ sinks: sinksFromEnv(env, o.log), now: o.now, reAlertMs: Number.isFinite(reAlert) && reAlert > 0 ? reAlert : DEFAULT_REALERT_MS, log: o.log });
    monitor = new Monitor({ sql: monitorSql, now: o.now, dispatcher, log: o.log, ...(o.healthz ? { healthz: o.healthz } : {}) });
    void monitor.start();
  }
  return {
    monitor, ledger,
    async stop() {
      await monitor?.stop();
      await ledger.close();
      await Promise.all([ledgerSql.close(), monitorSql?.close()].map(p => p?.catch(() => {})));
    },
  };
}
