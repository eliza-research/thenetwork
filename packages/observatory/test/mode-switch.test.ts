// SD-285: the console mode switch on a server that is not real-only. A switch whose source fails to
// start must leave the server in the mode it was in, and a later switch must try again.
// Skipped without Postgres (real mode reads a test database).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATA_DIR } from "../../../scripts/synthetic/common.ts";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const T = 300_000;
const TOKEN = "mode-switch-admin-token".padEnd(32, "-0123456789abcdef");

describe.skipIf(!pgAvailable)("console mode switch when the game source cannot start (Postgres)", () => {
  let dir: string, data: string;
  let obs: ObservatoryServer;
  const call = (path: string, init: RequestInit = {}) => fetch(obs.url + path, { ...init, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" } });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "obs-mode-"));
    data = join(dir, "data"); // empty: the game source fails to start
    await Bun.write(join(data, ".keep"), "");
    obs = await createServer({
      port: 0, development: false, token: TOKEN, mode: "real", audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") }, peopleUrl: false,
      game: { dataDir: data, pushMs: 3_600_000, tickMs: 3_600_000 }, real: { url: await testDb(), pollMs: 3_600_000, pushMs: 3_600_000 },
    });
  }, T);
  afterAll(async () => {
    await obs?.stop(); await dropTestDb();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test("a failed switch to game keeps real mode; a switch after the data is there starts the game", async () => {
    const failed = await call("/api/mode", { method: "POST", body: JSON.stringify({ mode: "game" }) });
    expect(failed.status).toBe(400);
    expect((await (await call("/api/mode")).json()).mode).toBe("real");
    const st = await call("/api/state");
    expect(st.status).toBe(200);
    expect((await st.json()).env.mode).toBe("real");
    // The synthetic data arrives: the next switch tries again and works.
    for (const f of await readdir(DATA_DIR)) if (f !== ".keep") await symlink(join(DATA_DIR, f), join(data, f));
    const ok = await call("/api/mode", { method: "POST", body: JSON.stringify({ mode: "game" }) });
    expect(await ok.json()).toEqual({ ok: true, mode: "game" });
    expect((await (await call("/api/state")).json()).env.mode).toBe("game");
  }, T);
});
