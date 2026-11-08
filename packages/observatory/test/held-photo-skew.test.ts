// SD-287: photo review of a held relay item when the Network service's clock runs ahead of the
// console's. The service sets the preview token's end to its own now + 5 minutes. The console must
// keep the preview (to at most 5 minutes on its own clock) so that the photo can be released.
// A local fake of the service; the console in real mode on a running server.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ObservatoryServer } from "../src/server.ts";

const T = 120_000;
const long = (t: string) => t.padEnd(32, "-0123456789abcdef");
const SAFETY = long("saf-skew");
const ITEM = "pri_" + "d".repeat(32);
/** The service clock leads the console clock by 2 s. */
const SKEW = 2_000;
const released: string[] = [];
let fake: ReturnType<typeof Bun.serve>;
let obs: ObservatoryServer;
let dir: string;
const keep = { NETWORK_DATABASE_URL: process.env.NETWORK_DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL };
const as = (path: string, init: RequestInit = {}) => fetch(obs.url + path, { ...init, headers: { authorization: `Bearer ${SAFETY}`, "content-type": "application/json", ...Object.fromEntries(new Headers(init.headers)) } });

beforeAll(async () => {
  delete process.env.NETWORK_DATABASE_URL; delete process.env.DATABASE_URL;
  fake = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/health") return Response.json({ ok: false, error: "fake" });
      // As packages/network/service/service.ts: until = the service's now + 5 minutes.
      if (u.pathname === `/staff/relay/${ITEM}/photo`) return new Response(Uint8Array.from([255, 216, 255, 218, 0, 2, 1, 255, 217]), {
        headers: { "content-type": "image/jpeg", "x-network-photo-review-token": `${Date.now() + SKEW + 5 * 60_000}.${"a".repeat(64)}` },
      });
      if (u.pathname === `/staff/relay/${ITEM}/release` && req.method === "POST") { released.push(u.pathname); return Response.json({ ok: true, delivered: true }); }
      return Response.json({ error: "no route" }, { status: 404 });
    },
  });
  dir = await mkdtemp(join(tmpdir(), "obs-photo-skew-"));
  obs = await createServer({
    port: 0, development: false, mode: "real", audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") }, peopleUrl: false, staffRolesUrl: false,
    tokens: `safety@slop:${SAFETY}`,
    real: { url: undefined, pollMs: 3_600_000, pushMs: 3_600_000, service: { url: fake.url.href, token: long("console-svc") } },
  });
}, T);
afterAll(async () => {
  await obs?.stop(); fake?.stop(true);
  for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("held photo review with a service clock ahead of the console", () => {
  test("the preview loads and the photo can be released", async () => {
    const photo = await as(`/api/held/${ITEM}/photo?app=slop`, { headers: { "x-network-reason": "checking a held photo" } });
    expect(photo.status).toBe(200);
    expect(photo.headers.get("x-network-photo-review-token")).toBeNull();
    expect(new Uint8Array(await photo.arrayBuffer())[0]).toBe(255);
    const r = await as("/api/held?app=slop", { method: "POST", body: JSON.stringify({ queue: "relay", id: ITEM, decision: "release", reason: "reviewed the photo", photoReviewed: true }) });
    expect(await r.json()).toMatchObject({ ok: true });
    expect(released).toEqual([`/staff/relay/${ITEM}/release`]);
  }, T);
});
