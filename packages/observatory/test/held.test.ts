// The console's "Held texts" panel (docs/admin-console.md 3.7.2): the leak guard's parked texts and held
// relay items, read from the Network service's staff API and released or rejected through it. A local
// fake of the service; the console in real mode on a running server. Per app, audited, safety or admin
// only, never a score, never a minor's text; a queue the service does not have yet is "not available".
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import type { AuditEntry, HeldText } from "../src/types.ts";

const T = 120_000;
const long = (t: string) => t.padEnd(32, "-0123456789abcdef");
const TOK = { admin: long("adm-held"), safety: long("saf-held"), reviewer: long("rev-held"), analyst: long("ana-held") };
const calls: { method: string; path: string; app: string | null; staff: string | null; body?: any }[] = [];
let fake: ReturnType<typeof Bun.serve>;
let obs: ObservatoryServer;
let dir: string;
const keep = { NETWORK_DATABASE_URL: process.env.NETWORK_DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL };
const as = (tok: string, path: string, init: RequestInit = {}) => fetch(obs.url + path, { ...init, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" } });
const post = (tok: string, path: string, body: unknown) => as(tok, path, { method: "POST", body: JSON.stringify(body) });

beforeAll(async () => {
  delete process.env.NETWORK_DATABASE_URL; delete process.env.DATABASE_URL;
  // The leak review routes exist (messaging pipeline contract); the relay routes do not (404 without a reason).
  fake = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(req) {
      const u = new URL(req.url);
      calls.push({ method: req.method, path: u.pathname, app: u.searchParams.get("app"), staff: req.headers.get("x-network-staff-id"), body: req.method === "POST" ? await req.json() : undefined });
      if (u.pathname === "/health") return Response.json({ ok: false, error: "fake" });
      if (u.pathname === "/queue/leak-review" && req.method === "GET") return Response.json({ ok: true, items: [
        { id: "leak:1", kind: "probe", to: "+12125550142", text: "call me at 212 555 0142", reasons: ["phone_number"], createdAt: Date.now() - 60_000, attractiveness: 0.91, score: 7 },
        { id: "leak:2", kind: "relay", to: "…07", text: "a minor's words", reasons: ["contact"], minor: true },
        { kind: "no id" },
      ] });
      if (u.pathname === "/queue/leak-review/leak%3A1" || u.pathname === "/queue/leak-review/leak:1") return Response.json({ ok: true });
      if (u.pathname.startsWith("/queue/leak-review/")) return Response.json({ ok: false, reason: "not_parked" }, { status: 409 });
      // The relay route as packages/network/service/service.ts answers it (itemId, from and to member ids), on slop only.
      if (u.pathname === "/staff/relay/held" && req.method === "GET" && u.searchParams.get("app") === "slop") return Response.json({ ok: true, network: "slop:nyc", items: [
        { itemId: "rl_1", app: "slop", kind: "text", from: "slop_m1", to: "slop_m2", reasons: ["clef:scam"], createdAt: Date.now() - 30_000, text: "send me a gift card" },
      ] });
      if (u.pathname === "/staff/relay/rl_1/release" && req.method === "POST") return Response.json({ ok: true, delivered: true });
      return Response.json({ error: "no route" }, { status: 404 });
    },
  });
  dir = await mkdtemp(join(tmpdir(), "obs-held-"));
  obs = await createServer({
    port: 0, development: false, mode: "real", audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") }, peopleUrl: false, staffRolesUrl: false,
    tokens: `admin:${TOK.admin},safety@slop:${TOK.safety},reviewer@slop:${TOK.reviewer},analyst@slop:${TOK.analyst}`,
    real: { url: undefined, pollMs: 3_600_000, pushMs: 3_600_000, service: { url: fake.url.href, token: long("console-svc") } },
  });
}, T);
afterAll(async () => {
  await obs?.stop(); fake?.stop(true);
  for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("held texts in the console", () => {
  test("leak review: safety reads the app's queue (no score, phone masked, a minor's text hidden); other roles cannot", async () => {
    for (const tok of [TOK.reviewer, TOK.analyst]) expect((await as(tok, "/api/held?app=slop&queue=leak")).status).toBe(403);
    expect((await as(TOK.safety, "/api/held?app=peon&queue=leak")).status).toBe(403);
    expect((await as(TOK.safety, "/api/held?app=slop&queue=other")).status).toBe(400);
    const r = await as(TOK.safety, "/api/held?app=slop&queue=leak");
    expect(r.status).toBe(200);
    const body = await r.json() as { ok: boolean; items: HeldText[] };
    expect(body.items.map(x => x.id)).toEqual(["leak:1", "leak:2"]);
    expect(body.items[0]).toMatchObject({ queue: "leak", kind: "probe", to: "…42", text: "call me at 212 555 0142", reasons: ["phone_number"] });
    expect(body.items[1]).toMatchObject({ textHidden: "minor" });
    expect(body.items[1]!.text).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/attractiveness|0\.91|score|a minor's words|\+12125550142/);
    // The console asked for this app, as the signed-in staff member.
    expect(calls.filter(c => c.path === "/queue/leak-review").every(c => c.app === "slop" && !!c.staff)).toBe(true);
  }, T);

  test("release and reject need a reason; each decision goes to the service and is audited before and after", async () => {
    expect((await post(TOK.safety, "/api/held?app=slop", { queue: "leak", id: "leak:1", decision: "release", reason: "no" })).status).toBe(400);
    expect((await post(TOK.safety, "/api/held?app=slop", { queue: "leak", id: "leak:1", decision: "send", reason: "a public number" })).status).toBe(400);
    expect((await post(TOK.reviewer, "/api/held?app=slop", { queue: "leak", id: "leak:1", decision: "release", reason: "a public number" })).status).toBe(403);
    const ok = await post(TOK.safety, "/api/held?app=slop", { queue: "leak", id: "leak:1", decision: "release", reason: "a public business number" });
    expect([ok.status, (await ok.json()).ok]).toEqual([200, true]);
    const sent = calls.filter(c => c.method === "POST" && c.path.startsWith("/queue/leak-review/"));
    expect(sent.at(-1)!.body).toEqual({ decision: "release", reason: "a public business number" });
    const no = await post(TOK.safety, "/api/held?app=slop", { queue: "leak", id: "leak:9", decision: "reject", reason: "contact details" });
    expect([no.status, (await no.json()).code]).toEqual([409, "not_parked"]);
    expect(calls.filter(c => c.method === "POST" && c.path.startsWith("/queue/leak-review/")).at(-1)!.body).toEqual({ decision: "drop", reason: "contact details" });
    const audit = await (await as(TOK.admin, "/api/audit?app=slop")).json() as { entries: AuditEntry[] };
    const rows = audit.entries.filter(e => e.action.startsWith("held_") || e.action === "read_held_texts");
    expect(rows.some(e => e.action === "read_held_texts" && e.app === "slop")).toBe(true);
    const phases = rows.filter(e => e.action === "held_release").map(e => `${e.detail?.phase}:${e.ok}`).sort();
    expect(phases).toEqual(["requested:true", "result:true"]);
    expect(rows.filter(e => e.action === "held_reject").map(e => `${e.detail?.phase}:${e.ok}`).sort()).toEqual(["requested:true", "result:false"]);
  }, T);

  test("held relay: the service's own item shape (itemId, from) is listed, and a decision sends the reason as the service's note", async () => {
    // Regression: the console read only `id`, so every held relay item was dropped and the panel was always empty.
    const r = await as(TOK.safety, "/api/held?app=slop&queue=relay");
    expect(r.status).toBe(200);
    const body = await r.json() as { ok: boolean; items: HeldText[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: "rl_1", queue: "relay", kind: "text", memberId: "slop_m1", reasons: ["clef:scam"], text: "send me a gift card" });
    const p = await post(TOK.safety, "/api/held?app=slop", { queue: "relay", id: "rl_1", decision: "release", reason: "consent checked by staff" });
    expect([p.status, (await p.json()).ok]).toEqual([200, true]);
    expect(calls.filter(c => c.method === "POST" && c.path === "/staff/relay/rl_1/release").at(-1)!.body).toEqual({ reason: "consent checked by staff", note: "consent checked by staff" });
  }, T);

  test("a queue the service does not answer is not available (and acts on nothing)", async () => {
    const r = await as(TOK.admin, "/api/held?app=peon&queue=relay");
    expect([r.status, (await r.json()).code]).toEqual([404, "not_available"]);
    const p = await post(TOK.admin, "/api/held?app=peon", { queue: "relay", id: "rl1", decision: "release", reason: "consent checked" });
    expect([p.status, (await p.json()).code]).toEqual([404, "service_missing"]);
  }, T);
});
