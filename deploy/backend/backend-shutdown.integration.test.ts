// Integration: the deployed backend's graceful shutdown with a real Bun HTTP server (Bun.serve) and a
// request that does not finish. The grace period must bound the whole shutdown, the HTTP drain
// included, so the pool closes and "shutdown complete" is logged before the host sends SIGKILL
// (Railway: 30 s after SIGTERM). SD-158.
import { expect, test } from "bun:test";
import { createBackend, jsonLogger, loadConfig, type ServiceLike } from "./backend.ts";

test("a hung HTTP request does not hold shutdown past the grace period (SD-158)", async () => {
  let entered!: () => void;
  const inside = new Promise<void>(r => { entered = r; });
  const svc: ServiceLike & { closed: boolean } = {
    closed: false,
    // The gateway's /internal/turn call that never answers (a stuck query, a hung upstream).
    async fetch() { entered(); return new Promise<Response>(() => {}); },
    async publicFetch() { return Response.json({ ok: true }); },
    runtimes: new Map(),
    async close() { svc.closed = true; },
  };
  const lines: string[] = [];
  const config = { ...loadConfig({ PLATFORM_ENV: "dev", DATABASE_URL: "postgres://unused@localhost:1/unused" }), tickMs: 3_600_000, shutdownGraceMs: 200 };
  const b = createBackend({ svc, config, log: jsonLogger(s => lines.push(s)), ping: async () => true });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: req => b.publicFetch(req, server) });
  const pending = fetch(`http://127.0.0.1:${server.port}/internal/turn`, { method: "POST", body: "{}" }).catch(() => undefined);
  await inside;

  const outcome = await Promise.race([b.shutdown([server]), Bun.sleep(3_000).then(() => "still waiting" as const)]);
  expect(outcome).toEqual({ clean: false });
  expect(svc.closed).toBe(true);
  expect(lines.some(l => l.includes('"msg":"shutdown complete"'))).toBe(true);
  server.stop(true);
  await pending;
}, 10_000);
