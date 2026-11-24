import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../src/server.ts";
import type { GameOptions } from "../src/sources/game.ts";
import type { AuditEntry } from "../src/types.ts";

const T = 300_000;
const ADMIN = "mode-switch-admin".padEnd(32, "-0123456789abcdef");
const DATABASE_ENV = ["NETWORK_DATABASE_URL", "DATABASE_URL"] as const;
const kept = new Map<string, string | undefined>();
let dir: string;

beforeAll(async () => {
  for (const name of DATABASE_ENV) { kept.set(name, process.env[name]); delete process.env[name]; }
  dir = await mkdtemp(join(tmpdir(), "obs-mode-"));
});
afterAll(async () => {
  for (const [name, value] of kept) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  await rm(dir, { recursive: true, force: true });
});

const headers = (mode?: string) => ({ authorization: `Bearer ${ADMIN}`, "content-type": "application/json", ...(mode ? { "x-observatory-mode": mode } : {}) });

test("a staff command admitted in game mode never runs on real data after a mode switch during its audit write", async () => {
  const audit: AuditEntry[] = [];
  let release: (() => void) | undefined;
  let reached!: () => void;
  const atAudit = new Promise<void>(resolve => { reached = resolve; });
  const obs = await createServer({
    port: 0, development: false, mode: "game", tokens: `admin:${ADMIN}`, staffRolesUrl: false, peopleUrl: false,
    lab: { dir: join(dir, "lab-race") }, game: { seed: 1, pushMs: 3_600_000, tickMs: 3_600_000 },
    real: { url: undefined, pollMs: 3_600_000, pushMs: 3_600_000, service: false },
    audit: {
      kind: "file", list: async () => audit, close: async () => {},
      write: async row => {
        audit.push(row);
        if (row.action === "matching" && row.detail?.phase === "requested") { reached(); await new Promise<void>(resolve => { release = resolve; }); }
      },
    },
  });
  try {
    const pending = fetch(`${obs.url}/api/control`, { method: "POST", headers: headers("game"), body: JSON.stringify({ type: "matching", on: false }) });
    await atAudit;
    await obs.setMode("real");
    release!();
    const answer = await pending;
    expect([answer.status, (await answer.json()).code]).toEqual([409, "mode_changed"]);
    expect(audit.filter(row => row.action === "matching").map(row => [row.detail?.phase, row.ok, row.detail?.code])).toEqual([
      ["requested", true, undefined], ["result", false, "mode_changed"],
    ]);
    expect((await (await obs.source("game")).config()).matchingEnabled).toBe(true);
  } finally {
    release?.();
    await obs.stop();
  }
}, T);

test("a mode whose source fails to start is not entered, and the next switch starts the source again", async () => {
  const game: GameOptions = { seed: 1, pushMs: 3_600_000, tickMs: 3_600_000, dataDir: join(dir, "missing-world") };
  const obs = await createServer({
    port: 0, development: false, mode: "real", tokens: `admin:${ADMIN}`, staffRolesUrl: false, peopleUrl: false,
    audit: { dir: join(dir, "audit-start") }, lab: { dir: join(dir, "lab-start") }, game,
    real: { url: undefined, pollMs: 3_600_000, pushMs: 3_600_000, service: false },
  });
  try {
    const refused = await fetch(`${obs.url}/api/mode`, { method: "POST", headers: headers(), body: JSON.stringify({ mode: "game" }) });
    expect(refused.status).toBe(400);
    expect(obs.mode()).toBe("real");
    expect(await (await fetch(`${obs.url}/api/mode`, { headers: headers() })).json()).toMatchObject({ mode: "real" });
    expect((await fetch(`${obs.url}/api/state`, { headers: headers() })).status).toBe(200);
    delete game.dataDir;
    await obs.setMode("game");
    expect(obs.mode()).toBe("game");
    expect(((await (await fetch(`${obs.url}/api/state`, { headers: headers() })).json()) as { env: { mode: string } }).env.mode).toBe("game");
  } finally {
    await obs.stop();
  }
}, T);
