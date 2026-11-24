import type { BackendHealth, Event } from "../../packages/core/src/generated/backendHealth.ts";
import { HOUR, MINUTE } from "../../packages/core/src/clock.ts";
import { createBackend, jsonLogger, loadConfig, type ServiceLike } from "../../deploy/backend/backend.ts";
import { serveJourney } from "./serveJourney.ts";

const tickLateMs = MINUTE;
const START = Date.UTC(2026, 9, 9, 16);
const FAILURE: Record<string, BackendHealth> = {
  draining: { tag: "Reported", status: "Draining" },
  database: { tag: "Reported", status: "DatabaseDown" },
  tick_late: { tag: "Reported", status: "TickLate" },
};

type HealthCheck = {
  backend: ReturnType<typeof createBackend>;
  setNow(at: number): void;
  ping?: { resolve(up: boolean): void; reject(error: Error): void };
  reachable?: true;
  response?: Promise<Response>;
  reported?: BackendHealth;
  pings: number;
};

function staticService(): ServiceLike {
  return {
    fetch: async () => Response.json({ ok: true }),
    publicFetch: async () => Response.json({ ok: true }),
    runtimes: new Map([["ntwrk:nyc", { id: "ntwrk:nyc", tick: async () => true }]]),
    inboxTick: async () => {},
    purge: async () => {},
    close: async () => {},
  };
}

const checks = new Map<string, HealthCheck>();
let databaseFailures = 0;

async function checkFor(key: string): Promise<HealthCheck> {
  const existing = checks.get(key);
  if (existing) return existing;
  let now = START;
  const config = { ...loadConfig({ PLATFORM_ENV: "dev", DATABASE_URL: "postgres://conformance@localhost/health" }), tickMs: HOUR, tickLateMs };
  const check: HealthCheck = {
    pings: 0,
    setNow: (at: number) => { now = at; },
    backend: createBackend({
      svc: staticService(), config, log: jsonLogger(() => {}), now: () => now,
      ping: () => new Promise<boolean>((resolve, reject) => { check.pings++; check.ping = { resolve, reject }; }),
    }),
  };
  await check.backend.startTicks();
  checks.set(key, check);
  return check;
}

async function report(check: HealthCheck): Promise<void> {
  const response = await check.response!;
  const body = await response.json() as { ok: boolean; status?: string };
  if (response.status === 200 && body.ok === true) check.reported = { tag: "Reported", status: "Ready" };
  else if (response.status === 503 && body.status && FAILURE[body.status]) check.reported = FAILURE[body.status];
  else throw new Error(`Unexpected /healthz answer ${response.status}: ${JSON.stringify(body)}`);
}

async function stopAll() {
  await Promise.all([...checks.values()].map(async check => {
    check.ping?.resolve(false);
    await check.response;
    await check.backend.shutdown();
  }));
  checks.clear();
}

await serveJourney<Event>({
  reset: stopAll,
  async dispatch(key, event) {
    const check = await checkFor(key);
    switch (event.type) {
      case "checkAdmission": {
        if (check.response) return "refused";
        if (!event.serving) await check.backend.shutdown();
        check.response = check.backend.publicFetch(new Request("http://backend/healthz"));
        const settled = check.response.then(() => "answered" as const);
        for (let turn = 0; turn < 50 && check.pings === 0; turn++) {
          if (await Promise.race([settled, new Promise<"waiting">(resolve => setImmediate(() => resolve("waiting")))]) === "answered") break;
        }
        if (check.pings === 0) await report(check);
        return "accepted";
      }
      case "checkDatabase": {
        if (!check.ping || check.reachable) return "refused";
        if (event.reachable) {
          check.reachable = true;
          return "accepted";
        }
        if (databaseFailures++ % 2 === 0) check.ping.resolve(false);
        else check.ping.reject(new Error("connection refused"));
        check.ping = undefined;
        await report(check);
        return "accepted";
      }
      case "checkTicks": {
        if (!check.ping || !check.reachable) return "refused";
        if (event.late) check.setNow(START + tickLateMs + 1);
        check.ping.resolve(true);
        check.ping = undefined;
        await report(check);
        return "accepted";
      }
    }
  },
  async observe(key): Promise<BackendHealth> {
    const check = await checkFor(key);
    if (check.reported) return check.reported;
    if (check.pings > 1) throw new Error("One health check pinged the database more than once");
    if (check.ping) return check.reachable ? { tag: "CheckingTicks" } : { tag: "CheckingDatabase" };
    if (check.response) throw new Error("The health check is in flight without a pending ping");
    return { tag: "CheckingAdmission" };
  },
  observeOutput: () => null,
});
await stopAll();
