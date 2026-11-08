// SD-286: a staff action carries the mode its page shows (x-observatory-mode). The server checks that
// header, then reads the body and writes the audit row. When an admin switches the mode in that time,
// the action must still run in the mode that the check saw, and its audit rows must name that mode.
// Skipped without Postgres (real mode reads a test database).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY } from "@thenetwork/core";
import { createServer, MODE_HEADER, type ObservatoryServer } from "../src/server.ts";
import type { AuditEntry, ObsState } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const T = 300_000;
const TOKEN = "mode-race-admin-token".padEnd(32, "-0123456789abcdef");

describe.skipIf(!pgAvailable)("the mode header check and a mode switch during the request (Postgres)", () => {
  let dir: string;
  let obs: ObservatoryServer;
  const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
  const call = (path: string, init: RequestInit = {}) => fetch(obs.url + path, { ...init, headers: { ...headers, ...Object.fromEntries(new Headers(init.headers)) } });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "obs-mode-race-"));
    obs = await createServer({
      port: 0, development: false, token: TOKEN, mode: "game", audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") }, peopleUrl: false, staffRolesUrl: false,
      game: { seed: 1, review: "human", pushMs: 3_600_000, tickMs: 3_600_000 }, real: { url: await testDb(), pollMs: 3_600_000, pushMs: 3_600_000, service: false },
    });
    expect((await call("/api/control", { method: "POST", body: JSON.stringify({ type: "step", ms: DAY }) })).status).toBe(200);
  }, T);
  afterAll(async () => {
    await obs?.stop(); await dropTestDb();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test("a review sent from the game page runs in game mode when the console switches to real before its body arrives", async () => {
    const s = await (await call("/api/state")).json() as ObsState;
    const item = s.opportunities.find(o => o.state === "IN_REVIEW")!;
    expect(item).toBeDefined();
    // The body arrives only after the switch: the header check passes first.
    let send!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(c) { send = () => { c.enqueue(new TextEncoder().encode(JSON.stringify({ type: "review", oppId: item.id, decision: "approve", secondsSpent: 20 }))); c.close(); }; },
    });
    const pending = fetch(obs.url + "/api/control", { method: "POST", headers: { ...headers, [MODE_HEADER]: "game" }, body, duplex: "half" } as RequestInit);
    await Bun.sleep(300);
    const sw = await call("/api/mode", { method: "POST", body: JSON.stringify({ mode: "real" }) });
    expect(await sw.json()).toEqual({ ok: true, mode: "real" });
    send();
    const r = await pending;
    const out = await r.json() as { ok: boolean; code?: string };
    expect(out).toMatchObject({ ok: true });
    expect(r.status).toBe(200);
    // The audit rows of the review name the mode the action ran in.
    const files = await readdir(join(dir, "audit"));
    const rows = (await Promise.all(files.map(f => readFile(join(dir, "audit", f), "utf8")))).join("").trim().split("\n").map(l => JSON.parse(l) as AuditEntry);
    const review = rows.filter(e => e.action === "review" && e.targetId === item.id);
    expect(review.map(e => [(e.detail as { phase?: string })?.phase, e.mode])).toEqual([["requested", "game"], ["result", "game"]]);
  }, T);
});
