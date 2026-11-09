// SD-288: a staff action that the Network service applies, but whose answer comes after the console's
// request timeout. The console must not report it as an action that did not run: the outcome is
// unknown, and the audit result row and the answer must say so. A local fake of the service; the
// console in real mode on a running server.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import type { AuditEntry } from "../src/types.ts";

const T = 120_000;
const long = (t: string) => t.padEnd(32, "-0123456789abcdef");
const SAFETY = long("saf-timeout");
const held: string[] = [];
let fake: ReturnType<typeof Bun.serve>;
let obs: ObservatoryServer;
let dir: string;
const keep = { NETWORK_DATABASE_URL: process.env.NETWORK_DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL };

beforeAll(async () => {
  delete process.env.NETWORK_DATABASE_URL; delete process.env.DATABASE_URL;
  fake = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/health") return Response.json({ ok: false, error: "fake" });
      // The hold commits at once; the answer comes after the console's timeout.
      if (u.pathname === "/safety/hold" && req.method === "POST") { held.push(((await req.json()) as { memberId: string }).memberId); await Bun.sleep(1_000); return Response.json({ ok: true }); }
      return Response.json({ error: "no route" }, { status: 404 });
    },
  });
  dir = await mkdtemp(join(tmpdir(), "obs-svc-timeout-"));
  obs = await createServer({
    port: 0, development: false, mode: "real", audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") }, peopleUrl: false, staffRolesUrl: false,
    tokens: `safety@slop:${SAFETY}`,
    real: { url: undefined, pollMs: 3_600_000, pushMs: 3_600_000, service: { url: fake.url.href, token: long("console-svc"), timeoutMs: 200 } },
  });
}, T);
afterAll(async () => {
  await obs?.stop(); fake?.stop(true);
  for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("a staff action whose answer comes after the timeout", () => {
  test("the console says the outcome is unknown, not that the service did not act", async () => {
    const r = await fetch(obs.url + "/api/safety?app=slop", {
      method: "POST", headers: { authorization: `Bearer ${SAFETY}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "hold", memberId: "slop_m1", note: "report of a scam message" }),
    });
    const out = await r.json() as { ok: boolean; code?: string; error?: string };
    expect(held).toEqual(["slop_m1"]);
    expect(out.code).toBe("service_timeout");
    expect(out.error).toContain("may have");
    const files = await readdir(join(dir, "audit"));
    const rows = (await Promise.all(files.map(f => readFile(join(dir, "audit", f), "utf8")))).join("").trim().split("\n").map(l => JSON.parse(l) as AuditEntry);
    const result = rows.find(e => e.action === "safety_hold" && (e.detail as { phase?: string })?.phase === "result");
    expect((result?.detail as { code?: string })?.code).toBe("service_timeout");
  }, T);
});
