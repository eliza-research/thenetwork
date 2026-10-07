#!/usr/bin/env bun
// The Network Observatory server: game mode (live simulated world) and real-world mode (Postgres),
// switchable at runtime. REST for state and details, a WebSocket for live deltas, and the web UI.
//   bun run packages/observatory/src/server.ts [--port 4747] [--mode game|real] [--seed 1]
//       [--personas 0] [--engine engine-v1|random|off] [--db-url postgres://...]
import { parseArgs } from "node:util";
import type { Server, ServerWebSocket } from "bun";
import index from "../web/index.html";
import { SCENARIOS } from "../../network/src/scenarios.ts";
import { GameSource, type GameOptions } from "./sources/game.ts";
import { RealSource, type RealOptions } from "./sources/real.ts";
import type { DataSource } from "./sources/source.ts";
import type { ControlCommand, Mode, ObsDelta } from "./types.ts";

export interface ServerOptions {
  port?: number;
  mode?: Mode;
  game?: GameOptions;
  real?: RealOptions;
  /** Bundle the UI in development mode (HMR, unminified). Default: NODE_ENV !== "production". */
  development?: boolean;
}

export interface ObservatoryServer {
  server: Server<unknown>; url: string; mode(): Mode;
  source(mode?: Mode): Promise<DataSource>;
  setMode(mode: Mode): Promise<void>;
  stop(): Promise<void>;
}

const TOPIC = "obs";

export async function createServer(opts: ServerOptions = {}): Promise<ObservatoryServer> {
  let mode: Mode = opts.mode ?? "game";
  const sources: Partial<Record<Mode, DataSource>> = {};
  const starting: Partial<Record<Mode, Promise<DataSource>>> = {};
  const unsub: Partial<Record<Mode, () => void>> = {};
  let server!: Server<unknown>;

  const broadcast = (m: Mode, d: ObsDelta) => {
    if (m !== mode || !server) return;
    if (!d.reset && !d.members && !d.edges && !d.opportunities && !d.feed && !d.stats && !d.engineRuns && !d.env && !d.removedOpportunities && !d.game) {
      server.publish(TOPIC, JSON.stringify({ type: "clock", clock: d.clock, version: d.version }));
      return;
    }
    server.publish(TOPIC, JSON.stringify({ type: "delta", mode: m, delta: d }));
  };

  async function source(m: Mode = mode): Promise<DataSource> {
    if (sources[m]) return sources[m]!;
    starting[m] ??= (async () => {
      const s: DataSource = m === "game" ? new GameSource(opts.game) : new RealSource(opts.real);
      await s.init();
      sources[m] = s;
      unsub[m] = s.subscribe(d => broadcast(m, d));
      return s;
    })();
    return starting[m]!;
  }

  async function setMode(m: Mode) {
    if (m !== "game" && m !== "real") throw new Error(`unknown mode ${m}`);
    if (mode === m && sources[m]) return;
    if (sources.game && m === "real") await sources.game.control({ type: "pause" });
    mode = m;
    await source(m);
    server?.publish(TOPIC, JSON.stringify({ type: "mode", mode: m }));
  }

  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

  await source(mode);
  server = Bun.serve({
    port: opts.port ?? 4747,
    development: opts.development ?? process.env.NODE_ENV !== "production",
    routes: {
      "/": index,
      "/api/health": () => json({ ok: true, mode }),
      "/api/levels": () => json(SCENARIOS.map(x => ({ id: x.id, title: x.title, description: x.description, days: x.days }))),
      "/api/mode": {
        GET: () => json({ mode, realConfigured: !!(opts.real?.url ?? process.env.NETWORK_DATABASE_URL ?? process.env.DATABASE_URL) }),
        POST: async req => {
          const body = await req.json().catch(() => ({})) as { mode?: Mode };
          try { await setMode(body.mode as Mode); return json({ ok: true, mode }); } catch (e) { return json({ ok: false, error: (e as Error).message }, 400); }
        },
      },
      "/api/state": async () => json((await source()).state()),
      "/api/member/:id": async req => {
        const d = await (await source()).member(decodeURIComponent(req.params.id));
        return d ? json(d) : json({ error: "not found" }, 404);
      },
      "/api/opportunity/:id": async req => {
        const d = await (await source()).opportunity(decodeURIComponent(req.params.id));
        return d ? json(d) : json({ error: "not found" }, 404);
      },
      "/api/control": {
        POST: async req => {
          const cmd = await req.json().catch(() => null) as ControlCommand | null;
          if (!cmd || typeof cmd.type !== "string") return json({ ok: false, error: "bad command" }, 400);
          const r = await (await source()).control(cmd);
          return json(r, r.ok ? 200 : 409);
        },
      },
    },
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") return srv.upgrade(req, { data: undefined }) ? undefined : new Response("upgrade failed", { status: 400 });
      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws: ServerWebSocket<unknown>) { ws.subscribe(TOPIC); ws.send(JSON.stringify({ type: "hello", mode })); },
      message() { /* the client sends commands over REST */ },
      close(ws: ServerWebSocket<unknown>) { ws.unsubscribe(TOPIC); },
    },
  });

  return {
    server, url: `http://localhost:${server.port}`, mode: () => mode, source, setMode,
    async stop() {
      for (const m of ["game", "real"] as Mode[]) { unsub[m]?.(); await sources[m]?.dispose(); }
      server.stop(true);
    },
  };
}

if (import.meta.main) {
  const { values: a } = parseArgs({ options: {
    port: { type: "string", default: process.env.PORT ?? "4747" }, mode: { type: "string", default: "game" },
    seed: { type: "string", default: "1" }, personas: { type: "string", default: "0" }, engine: { type: "string", default: "engine-v1" },
    days: { type: "string", default: "60" }, "db-url": { type: "string" }, network: { type: "string", default: "consent" },
    city: { type: "string", default: "nyc" }, level: { type: "string" },
  } });
  const obs = await createServer({
    port: Number(a.port), mode: a.mode as Mode,
    game: { seed: Number(a.seed), personas: Number(a.personas), engine: a.engine as GameOptions["engine"], days: Number(a.days), network: a.network as "consent" | "stub", city: a.city as "nyc" | "all", scenario: a.level ?? null },
    real: { url: a["db-url"] },
  });
  console.log(`The Network Observatory → ${obs.url}  (mode: ${obs.mode()})`);
}
