// HTTP + WebSocket API in both modes: state, details, controls, live deltas, mode switching,
// and that the web app is served.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY } from "@thenetwork/core";
import { rowsFromDataset, writeRows } from "../db/writer.ts";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import type { MemberDetail, ObsState } from "../src/types.ts";
import { pgAvailable, testDb } from "./pg.ts";

const T = 120_000;
let obs: ObservatoryServer;
let base: string;
const get = <R,>(path: string) => fetch(base + path).then(r => r.json() as Promise<R>);
const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  let realUrl: string | undefined;
  if (pgAvailable) {
    realUrl = await testDb();
    const sql = new SQL(realUrl);
    await writeRows(sql, await rowsFromDataset(), { truncate: true });
    await sql.close();
  }
  obs = await createServer({ port: 0, development: false, game: { seed: 2, personas: 50, days: 10, engine: "engine-v1", network: "stub", city: "all" }, real: { url: realUrl, pollMs: 3_600_000 } });
  base = obs.url;
}, T);
afterAll(async () => { await obs?.stop(); });

describe("observatory server", () => {
  test("serves the web app", async () => {
    const html = await fetch(base + "/").then(r => r.text());
    expect(html).toContain('<div id="root">');
    expect(html).toContain("Network Observatory");
  });

  test("game state, member detail, controls and WebSocket deltas", async () => {
    const ws = new WebSocket(base.replace("http", "ws") + "/ws");
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
    expect((await fetch(base + "/api/member/nope")).status).toBe(404);
    const opp = s1.opportunities[0];
    if (opp) expect((await get<any>(`/api/opportunity/${opp.id}`)).opportunity.id).toBe(opp.id);
    const bad = await post("/api/control", { type: "propose", participants: [id] });
    expect(bad.status).toBe(409);
    expect((await bad.json()).error).toContain("pick 2");
    expect((await post("/api/control", { nope: 1 })).status).toBe(400);
    await Bun.sleep(400);
    expect(msgs[0]).toEqual({ type: "hello", mode: "game" });
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
