// HTTP + WebSocket API in both modes: state, details, controls, live deltas, mode switching,
// that the web app is served, and access control (token, Host and Origin checks: audit P1-1).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { DAY } from "@thenetwork/core";
import { rowsFromDataset, writeRows } from "../db/writer.ts";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import type { MemberDetail, ObsState } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const T = 120_000;
const TOKEN = "test-token-7f3a-0123456789abcdef0123";
const AUTH = { authorization: `Bearer ${TOKEN}` };
let obs: ObservatoryServer;
let base: string;
let dir: string;
const get = <R,>(path: string) => fetch(base + path, { headers: AUTH }).then(r => r.json() as Promise<R>);
const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { ...AUTH, "content-type": "application/json" }, body: JSON.stringify(body) });
/** Resolves "open" when the WebSocket connects, or "refused" when it closes or fails first. */
const connect = (url: string, init?: { headers: Record<string, string> }) => new Promise<"open" | "refused">(resolve => {
  const ws = new WebSocket(url, init as never);
  ws.onopen = () => { resolve("open"); ws.close(); };
  ws.onerror = () => resolve("refused");
  ws.onclose = () => resolve("refused");
});

beforeAll(async () => {
  let realUrl: string | undefined;
  if (pgAvailable) {
    realUrl = await testDb();
    const sql = new SQL(realUrl);
    await writeRows(sql, await rowsFromDataset(), { truncate: true });
    await sql.close();
  }
  dir = await mkdtemp(join(tmpdir(), "obs-server-"));
  obs = await createServer({ port: 0, development: false, token: TOKEN, audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") }, game: { seed: 2, personas: 50, days: 10, engine: "engine-v1", network: "stub", city: "all" }, real: { url: realUrl, pollMs: 3_600_000 } });
  base = obs.url;
}, T);
afterAll(async () => { await obs?.stop(); await dropTestDb(); await rm(dir, { recursive: true, force: true }); });

describe("observatory server", () => {
  test("serves the web app", async () => {
    const html = await fetch(base + "/").then(r => r.text()); // public: no token
    expect(html).toContain('<div id="root">');
    expect(html).toContain("Network Observatory");
  });

  test("the API needs the token; the page does not", async () => {
    expect(base).toStartWith("http://127.0.0.1:");
    // The page URL carries the token in the #fragment: a browser never sends it to a server or in a Referer.
    expect(obs.openUrl).toBe(`${base}/#token=${TOKEN}`);
    expect((await fetch(base + "/")).status).toBe(200);
    for (const path of ["/api/state", "/api/health", "/api/levels", "/api/mode", "/api/member/x", "/api/nope"]) {
      expect([path, (await fetch(base + path)).status]).toEqual([path, 401]);
      expect([path, (await fetch(base + path, { headers: { authorization: "Bearer wrong-token" } })).status]).toEqual([path, 401]);
    }
    expect((await fetch(base + "/api/control", { method: "POST", body: JSON.stringify({ type: "play" }) })).status).toBe(401);
    const ok = await fetch(base + "/api/state", { headers: AUTH });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as ObsState).env.authRequired).toBe(true);
    // A token in the URL is refused (it would stay in the history, in logs and in Referer headers).
    expect((await fetch(`${base}/api/health?token=${TOKEN}`)).status).toBe(401);
    // Every answer carries the security headers.
    expect(Object.fromEntries(["x-frame-options", "x-content-type-options", "referrer-policy"].map(h => [h, ok.headers.get(h)]))).toEqual({ "x-frame-options": "DENY", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
    expect(ok.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    // The page sets its own policy: no script from elsewhere, no Referer.
    const html = await fetch(base + "/").then(r => r.text());
    expect(html).toContain("script-src 'self'");
    expect(html).toContain('<meta name="referrer" content="no-referrer"');
  });

  test("Host and Origin checks: DNS rebinding and cross-site requests are refused", async () => {
    // A foreign Origin is refused even with the token; the server's own origin is fine.
    expect((await fetch(base + "/api/state", { headers: { ...AUTH, origin: "http://evil.example" } })).status).toBe(403);
    expect((await fetch(base + "/api/state", { headers: { ...AUTH, origin: base } })).status).toBe(200);
    // A rebinding page reaches the server under its own host name.
    expect((await fetch(base + "/api/state", { headers: { ...AUTH, host: `evil.example:${obs.server.port}` } })).status).toBe(403);
    expect((await fetch(base + "/api/state", { headers: { ...AUTH, host: `localhost:${obs.server.port}` } })).status).toBe(200);
  });

  test("the WebSocket upgrade needs a one-use ticket (or the header) and a same-site Origin", async () => {
    const ws = base.replace("http", "ws") + "/ws";
    const ticket = async () => ((await (await post("/api/ws-ticket", {})).json()) as { ticket: string }).ticket;
    expect(await connect(ws)).toBe("refused");
    expect(await connect(`${ws}?token=${TOKEN}`)).toBe("refused"); // never a token in the URL
    expect(await connect(`${ws}?ticket=wrong`)).toBe("refused");
    expect(await connect(`${ws}?ticket=${await ticket()}`, { headers: { origin: "http://evil.example" } })).toBe("refused");
    const t = await ticket();
    expect(await connect(`${ws}?ticket=${t}`)).toBe("open");
    expect(await connect(`${ws}?ticket=${t}`)).toBe("refused"); // one use
    expect(await connect(`${ws}?app=slop&ticket=${await ticket()}`)).toBe("refused"); // a ticket is for its app (ntwrk)
    expect(await connect(ws, { headers: AUTH })).toBe("open");
  });

  test("game state, member detail, controls and WebSocket deltas", async () => {
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws`, { headers: AUTH } as never);
    const msgs: any[] = [];
    ws.onmessage = e => msgs.push(JSON.parse(e.data as string));
    await new Promise(r => (ws.onopen = r));
    const s0 = await get<ObsState>("/api/state");
    expect(s0.env.mode).toBe("game");
    expect(s0.members.length).toBe(50);
    expect(s0.game?.sparksPerDay).toBe(6);
    const step = await post("/api/control", { type: "step", ms: 2 * DAY });
    expect(step.status).toBe(200);
    const s1 = await get<ObsState>("/api/state");
    expect(s1.clock.now).toBe(s0.clock.now + 2 * DAY);
    expect(s1.stats.joined).toBeGreaterThan(0);
    const id = s1.members.find(m => m.joined)!.id;
    const d = await get<MemberDetail>(`/api/member/${id}`);
    expect(d.member.id).toBe(id);
    expect(d.messages.length).toBeGreaterThan(0);
    expect((await fetch(base + "/api/member/nope", { headers: AUTH })).status).toBe(404);
    const opp = s1.opportunities[0];
    if (opp) expect((await get<any>(`/api/opportunity/${opp.id}`)).opportunity.id).toBe(opp.id);
    const bad = await post("/api/control", { type: "propose", participants: [id] });
    expect(bad.status).toBe(409);
    expect((await bad.json()).error).toContain("pick 2");
    expect((await post("/api/control", { nope: 1 })).status).toBe(400);
    await Bun.sleep(400);
    expect(msgs[0]).toEqual({ type: "hello", mode: "game", app: "ntwrk" });
    const deltas = msgs.filter(m => m.type === "delta");
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.some(m => m.delta.members?.length || m.delta.feed?.length)).toBe(true);
    ws.close();
  }, T);

  test.skipIf(!pgAvailable)("switch to real-world mode and back", async () => {
    const r = await post("/api/mode", { mode: "real" });
    expect(await r.json()).toEqual({ ok: true, mode: "real" });
    const s = await get<ObsState>("/api/state");
    expect(s.env.mode).toBe("real");
    expect(s.env.capabilities.readOnly).toBe(true);
    expect(s.members.length).toBe(500);
    expect(s.game).toBeUndefined();
    const play = await post("/api/control", { type: "play" });
    expect(play.status).toBe(409);
    expect((await play.json()).error).toContain("read-only");
    const shadow = await post("/api/control", { type: "shadow_run", city: "sf" });
    expect(shadow.status).toBe(200);
    expect((await get<ObsState>("/api/state")).engineRuns.some(x => x.shadow && x.city === "sf")).toBe(true);
    expect((await post("/api/mode", { mode: "bogus" })).status).toBe(400);
    await post("/api/mode", { mode: "game" });
    const g = await get<ObsState>("/api/state");
    expect(g.env.mode).toBe("game");
    expect(g.clock.playing).toBe(false); // switching away paused the world
  }, T);
});
