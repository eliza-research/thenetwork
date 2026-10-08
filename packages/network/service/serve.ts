// The service's two HTTP servers and its tick loop, shared by main.ts (production) and
// scripts/platform-dev.ts (local dev).
import type { NetworkService } from "./service.ts";

const TICK_MS = 60_000;

/** The staff and webhook server (default 127.0.0.1:4848) and the public API the sites call (default 127.0.0.1:8790). */
export function serveService(svc: NetworkService, o: { host: string; port: number; apiPort: number; log?: (s: string) => void }) {
  const log = o.log ?? console.log;
  const server = Bun.serve({ hostname: o.host, port: o.port, fetch: svc.fetch });
  log(`listening on http://${o.host}:${server.port} (POST /webhooks/blooio[/:app], GET /health, GET /review, POST /review/:oppId, POST /safety/lift, POST /safety/close, POST /matching; ?app= or /apps/:app/...)`);
  // The server is passed on: the client IP for the rate limits is the socket address unless a trusted proxy header is configured.
  const api = Bun.serve({ hostname: o.host, port: o.apiPort, fetch: (req, server) => svc.publicFetch(req, server) });
  log(`public API on http://${o.host}:${api.port}/api/* (the app comes from the Host header)`);
  return { server, api, stop: () => { server.stop(); api.stop(); } };
}

/** Every network ticks once a minute on its own: a slow network never holds back another one. */
export function startTicks(svc: NetworkService, log: (s: string) => void = console.log) {
  const busy = new Set<string>();
  const loop = async () => {
    await Promise.all([...svc.runtimes.values()].map(async rt => {
      if (busy.has(rt.id)) return;
      busy.add(rt.id);
      try { if (!(await rt.tick())) log(`${rt.id}: tick skipped: another instance holds the lock`); }
      catch (e) { log(`${rt.id}: tick failed: ${(e as Error).message}`); }
      finally { busy.delete(rt.id); }
    }));
  };
  const first = loop();
  const timer = setInterval(loop, TICK_MS);
  return { first, stop: () => clearInterval(timer) };
}
