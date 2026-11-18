import type { BackendHealth, Event } from "../../packages/core/src/generated/backendHealth.ts";
import { createBackend, jsonLogger, loadConfig, type ServiceLike } from "../../deploy/backend/backend.ts";
import { serveJourney } from "./serveJourney.ts";

// Each key is one /healthz request to its own backend process object, through the public fetch handler.
// The database ping stays open until checkDatabase answers it, so `CheckingDatabase` is a request whose shell
// waits on the ping. The tick read is synchronous and follows a successful ping at once, so a reachable answer
// is held until checkTicks has set the tick clock; `CheckingTicks` is that held answer.

const tickLateMs = 60_000;
const START = Date.UTC(2026, 9, 9, 16);
const FAILURE: Record<string, BackendHealth> = {
  draining: { tag: "Reported", status: "Draining" },
  database: { tag: "Reported", status: "DatabaseDown" },
  tick_late: { tag: "Reported", status: "TickLate" },
};

type Request = {
  backend: ReturnType<typeof createBackend>;
  setNow(at: number): void;
  ping?: { resolve(up: boolean): void; reject(error: Error): void };
  reachable?: true;
  response?: Promise<Response>;
  reported?: BackendHealth;
  pings: number;
};

function fakeService(): ServiceLike {
  return {
    fetch: async () => Response.json({ ok: true }),
    publicFetch: async () => Response.json({ ok: true }),
    runtimes: new Map([["ntwrk:nyc", { id: "ntwrk:nyc", tick: async () => true }]]),
    inboxTick: async () => {},
    purge: async () => {},
    close: async () => {},
  };
}

const requests = new Map<string, Request>();
let databaseFailures = 0;

async function requestFor(key: string): Promise<Request> {
  const existing = requests.get(key);
  if (existing) return existing;
  let now = START;
  const config = { ...loadConfig({ PLATFORM_ENV: "dev", DATABASE_URL: "postgres://conformance@localhost/health" }), tickMs: 3_600_000, tickLateMs };
  const request = { pings: 0, setNow: (at: number) => { now = at; } } as Request;
  request.backend = createBackend({
    svc: fakeService(), config, log: jsonLogger(() => {}), now: () => now,
    ping: () => new Promise<boolean>((resolve, reject) => { request.pings++; request.ping = { resolve, reject }; }),
  });
  // The first round of network ticks finishes at START.
  await request.backend.startTicks();
  requests.set(key, request);
  return request;
}

async function report(request: Request): Promise<void> {
  const response = await request.response!;
  const body = await response.json() as { ok: boolean; status?: string };
  if (response.status === 200 && body.ok === true) request.reported = { tag: "Reported", status: "Ready" };
  else if (response.status === 503 && body.status && FAILURE[body.status]) request.reported = FAILURE[body.status];
  else throw new Error(`Unexpected /healthz answer ${response.status}: ${JSON.stringify(body)}`);
}

async function stopAll() {
  await Promise.all([...requests.values()].map(async request => {
    request.ping?.resolve(false);
    await request.response;
    await request.backend.shutdown();
  }));
  requests.clear();
}

await serveJourney<Event>({
  reset: stopAll,
  async dispatch(key, event) {
    const request = await requestFor(key);
    switch (event.type) {
      case "checkAdmission": {
        if (request.response) return "refused";
        if (!event.serving) await request.backend.shutdown();
        request.response = request.backend.publicFetch(new Request("http://backend/healthz"));
        const settled = request.response.then(() => "answered" as const);
        for (let turn = 0; turn < 50 && request.pings === 0; turn++) {
          if (await Promise.race([settled, new Promise<"waiting">(resolve => setImmediate(() => resolve("waiting")))]) === "answered") break;
        }
        if (request.pings === 0) await report(request);
        return "accepted";
      }
      case "checkDatabase": {
        if (!request.ping || request.reachable) return "refused";
        if (event.reachable) {
          request.reachable = true;
          return "accepted";
        }
        // A false answer and a rejected ping both mean the database is down.
        if (databaseFailures++ % 2 === 0) request.ping.resolve(false);
        else request.ping.reject(new Error("connection refused"));
        request.ping = undefined;
        await report(request);
        return "accepted";
      }
      case "checkTicks": {
        if (!request.ping || !request.reachable) return "refused";
        if (event.late) request.setNow(START + tickLateMs + 1);
        request.ping.resolve(true);
        request.ping = undefined;
        await report(request);
        return "accepted";
      }
    }
  },
  async observe(key): Promise<BackendHealth> {
    const request = await requestFor(key);
    if (request.reported) return request.reported;
    if (request.pings > 1) throw new Error("One health check pinged the database more than once");
    if (request.ping) return request.reachable ? { tag: "CheckingTicks" } : { tag: "CheckingDatabase" };
    if (request.response) throw new Error("The health check is in flight without a pending ping");
    return { tag: "CheckingAdmission" };
  },
  observeOutput: () => null,
});
await stopAll();
