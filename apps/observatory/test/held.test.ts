// The console's "Held texts" panel (docs/admin-console.md 3.7.2): the leak guard's parked texts and held
// relay items, read from the Network service's staff API and released or rejected through it. A local
// fake of the service; the console in real mode on a running server. Per app, audited, safety or admin
// only, never a score, never a minor's text; a queue the service does not have yet is "not available".
import { setTimeout as sleep } from "node:timers/promises";
import { serveHttp, type HttpServer } from "../../../packages/core/src/runtime/http.ts";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import type { AuditEntry, HeldText } from "../src/types.ts";

const T = 120_000;
const long = (t: string) => t.padEnd(32, "-0123456789abcdef");
const TOK = { admin: long("adm-held"), safety: long("saf-held"), reviewer: long("rev-held"), analyst: long("ana-held") };
const SERVICE_TIMEOUT_MS = 500, SLOW_SERVICE_MS = 2_000;
const HELD_PHOTO = "pri_" + "e".repeat(32);
const calls: { method: string; path: string; app: string | null; staff: string | null; body?: any }[] = [];
let fake: HttpServer;
let obs: ObservatoryServer;
let dir: string;
const keep = { NETWORK_DATABASE_URL: process.env.NETWORK_DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL };
const as = (tok: string, path: string, init: RequestInit = {}) => fetch(obs.url + path, { ...init, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", ...Object.fromEntries(new Headers(init.headers)) } });
const post = (tok: string, path: string, body: unknown) => as(tok, path, { method: "POST", body: JSON.stringify(body) });

beforeAll(async () => {
  delete process.env.NETWORK_DATABASE_URL; delete process.env.DATABASE_URL;
  // The leak review routes exist (messaging pipeline contract); the relay routes do not (404 without a reason).
  fake = await serveHttp({
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
      if (u.pathname === "/staff/relay/held" && req.method === "GET" && u.searchParams.get("app") === "slop") return Response.json({ ok: true, network: "slop:nyc", items: [
        { id: HELD_PHOTO, itemId: HELD_PHOTO, app: "slop", kind: "photo", memberId: "slop_m1", from: "slop_m1", reasons: ["photo:review"], createdAt: 1_000, deadline: 2_000 },
      ] });
      if(/^\/staff\/relay\/pri_[a-f0-9]{32}\/photo$/.test(u.pathname)){
        if(u.pathname.includes("pri_"+"b".repeat(32)))return Response.json({error:"unavailable"},{status:403});
        const bad=u.pathname.includes("pri_"+"c".repeat(32)),leads=u.pathname.includes("pri_"+"d".repeat(32));
        return new Response(bad?"<svg/>":Uint8Array.from([255,216,255,218,0,2,1,255,217]),{headers:{"content-type":bad?"image/svg+xml":"image/jpeg","x-network-photo-review-token":`${Date.now()+(leads?10*60_000:60_000)}.${"a".repeat(64)}`}});
      }
      if(/^\/staff\/relay\/pri_[a-f0-9]{32}\/(release|reject)$/.test(u.pathname)&&req.method==="POST"&&u.searchParams.get("app")==="slop")return Response.json({ok:true,delivered:false});
      if ((u.pathname === "/safety/hold" || u.pathname === "/invite") && req.method === "POST") { await sleep(SLOW_SERVICE_MS); return Response.json({ ok: true }); }
      return Response.json({ error: "no route" }, { status: 404 });
    },
  });
  dir = await mkdtemp(join(tmpdir(), "obs-held-"));
  obs = await createServer({
    port: 0, development: false, mode: "real", audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") }, peopleUrl: false, staffRolesUrl: false,
    tokens: `admin:${TOK.admin},safety@slop:${TOK.safety},reviewer@slop:${TOK.reviewer},analyst@slop:${TOK.analyst}`,
    real: { url: undefined, pollMs: 3_600_000, pushMs: 3_600_000, service: { url: fake.url.href, token: long("console-svc"), timeoutMs: SERVICE_TIMEOUT_MS } },
  });
}, T);
afterAll(async () => {
  await obs?.stop(); await fake?.stop(true);
  for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("held texts in the console", () => {
  test("leak review: safety reads the app's queue (no score, phone masked, a minor's text hidden); other roles cannot", async () => {
    for (const tok of [TOK.reviewer, TOK.analyst]) expect((await as(tok, "/api/held?app=slop&queue=leak")).status).toBe(403);
    expect((await as(TOK.safety, "/api/held?app=peon&queue=leak")).status).toBe(403);
    const relayCalls = calls.length;
    const reviewerRelay = await as(TOK.reviewer, "/api/held?app=slop&queue=relay");
    expect([reviewerRelay.status, (await reviewerRelay.json()).error]).toEqual([403, "forbidden: ReadHeldRelay needs admin or safety for slop"]);
    expect(calls.length).toBe(relayCalls);
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
    const release = rows.filter(e => e.action === "held_release");
    expect(release.filter(e => e.detail?.refused).map(e => `${e.detail?.refused}:${e.ok}:${e.roles.join(",")}`)).toEqual(["forbidden:false:reviewer"]);
    const phases = release.filter(e => !e.detail?.refused).map(e => `${e.detail?.phase}:${e.ok}`).sort();
    expect(phases).toEqual(["requested:true", "result:true"]);
    expect(rows.filter(e => e.action === "held_reject").map(e => `${e.detail?.phase}:${e.ok}`).sort()).toEqual(["requested:true", "result:false"]);
  }, T);

  test("held relay lists the service's photo items with no text, and a relay id that is not a held photo is refused before the service", async () => {
    const r = await as(TOK.safety, "/api/held?app=slop&queue=relay");
    expect(r.status).toBe(200);
    const body = await r.json() as { ok: boolean; items: HeldText[] };
    expect(body.items).toEqual([{ id: HELD_PHOTO, queue: "relay", kind: "photo", memberId: "slop_m1", reasons: ["photo:review"], createdAt: 1_000, deadline: 2_000 }]);
    const before = calls.length;
    const text = await post(TOK.safety, "/api/held?app=slop", { queue: "relay", id: "rl_1", decision: "release", reason: "consent checked by staff" });
    expect([text.status, (await text.json()).code]).toEqual([400, "bad_action"]);
    expect(calls.length).toBe(before);
  }, T);

  test("a queue the service does not answer is not available (and acts on nothing)", async () => {
    const r = await as(TOK.admin, "/api/held?app=peon&queue=relay");
    expect([r.status, (await r.json()).code]).toEqual([404, "not_available"]);
    const p = await post(TOK.admin, "/api/held?app=peon", { queue: "relay", id: HELD_PHOTO, decision: "reject", reason: "consent checked" });
    expect([p.status, (await p.json()).code]).toEqual([404, "service_missing"]);
  }, T);
});

test("selected photo proxy binds staff/app/item preview before release; denied or invalid preview leaves rejection available",async()=>{
  const id="pri_"+"a".repeat(32),path=`/api/held/${id}/photo?app=slop`,headers={"x-network-reason":"Check this voluntarily selected item"};
  const decision={queue:"relay",id,decision:"release",reason:"Selected item consent and safety checked",photoReviewed:true};
  expect((await post(TOK.safety,"/api/held?app=slop",decision)).status).toBe(409);
  const before=calls.filter(c=>c.path.endsWith("/photo")).length;
  for(const token of [TOK.reviewer,TOK.analyst])expect((await as(token,path,{headers})).status).toBe(403);
  expect(calls.filter(c=>c.path.endsWith("/photo"))).toHaveLength(before);
  const preview=await as(TOK.safety,path,{headers});expect(preview.status).toBe(200);expect(preview.headers.get("content-type")).toBe("image/jpeg");expect(preview.headers.get("x-network-photo-review-token")).toBeNull();
  expect([...new Uint8Array(await preview.arrayBuffer())]).toEqual([255,216,255,218,0,2,1,255,217]);
  expect((await post(TOK.admin,"/api/held?app=slop",decision)).status).toBe(409);
  expect((await post(TOK.safety,"/api/held?app=slop",{...decision,photoReviewed:false})).status).toBe(409);
  expect((await post(TOK.safety,"/api/held?app=slop",decision)).status).toBe(200);
  const call=calls.filter(c=>c.path===`/staff/relay/${id}/release`).at(-1)!;expect(call.app).toBe("slop");expect(call.staff).toBeTruthy();expect(call.body.photoReviewToken).toMatch(/^[1-9]\d+\.[a-f0-9]{64}$/);
  expect(call.body).toMatchObject({reason:decision.reason,note:decision.reason});
  expect((await post(TOK.safety,"/api/held?app=slop",decision)).status).toBe(409);
  for(const [suffix,status]of [["b",403],["c",502]] as const){
    const unavailable="pri_"+suffix.repeat(32);expect((await as(TOK.safety,`/api/held/${unavailable}/photo?app=slop`,{headers})).status).toBe(status);
    expect((await post(TOK.safety,"/api/held?app=slop",{...decision,id:unavailable})).status).toBe(409);
    expect((await post(TOK.safety,"/api/held?app=slop",{...decision,id:unavailable,decision:"reject"})).status).toBe(200);
    expect(calls.filter(c=>c.path===`/staff/relay/${unavailable}/reject`).at(-1)!.body).toEqual({reason:decision.reason,note:decision.reason});
  }
  const audited=await (await as(TOK.admin,"/api/audit?app=slop")).json() as {entries:AuditEntry[]};
  expect(audited.entries.some(e=>e.action==="read_relay_photo"&&e.reason===headers["x-network-reason"])).toBe(true);
  expect(JSON.stringify(audited)).not.toMatch(/photoReviewToken|https?:.*sig=/);
},T);

test("a photo preview from a service clock that leads is kept for the console's five minutes, not refused as expired", async () => {
  const id = "pri_" + "d".repeat(32), headers = { "x-network-reason": "Check this voluntarily selected item" };
  const loadedAt = Date.now();
  const preview = await as(TOK.safety, `/api/held/${id}/photo?app=slop`, { headers });
  expect(preview.status).toBe(200);
  expect([...new Uint8Array(await preview.arrayBuffer())]).toEqual([255, 216, 255, 218, 0, 2, 1, 255, 217]);
  const release = await post(TOK.safety, "/api/held?app=slop", { queue: "relay", id, decision: "release", reason: "Selected item consent and safety checked", photoReviewed: true });
  expect(release.status).toBe(200);
  const call = calls.filter(c => c.path === `/staff/relay/${id}/release`).at(-1)!;
  expect(Number(String(call.body.photoReviewToken).split(".")[0])).toBeGreaterThan(loadedAt + 5 * 60_000);
}, T);

test("a staff action whose service answer times out is reported and audited as an unknown outcome, not as a failure", async () => {
  const hold = await post(TOK.safety, "/api/safety?app=slop", { action: "hold", memberId: "slop_m1", note: "two reports of threats" });
  expect(hold.status).toBe(504);
  expect(await hold.json()).toMatchObject({ ok: false, code: "service_timeout", error: expect.stringContaining("may have run") });
  const step = await post(TOK.admin, "/api/staff/invite?app=ntwrk", { phone: "+12125550188", note: "founder referral" });
  expect(step.status).toBe(504);
  expect(await step.json()).toMatchObject({ ok: false, code: "service_timeout" });
  const slop = await (await as(TOK.admin, "/api/audit?app=slop")).json() as { entries: AuditEntry[] };
  expect(slop.entries.filter(e => e.action === "safety_hold").map(e => e.detail)).toEqual(expect.arrayContaining([
    expect.objectContaining({ phase: "requested" }),
    expect.objectContaining({ phase: "result", code: "service_timeout", outcome: "unknown" }),
  ]));
  const ntwrk = await (await as(TOK.admin, "/api/audit?app=ntwrk")).json() as { entries: AuditEntry[] };
  expect(ntwrk.entries.filter(e => e.action === "step_invite_member").map(e => e.detail)).toEqual(expect.arrayContaining([
    expect.objectContaining({ phase: "requested" }),
    expect.objectContaining({ phase: "result", code: "service_timeout", outcome: "unknown" }),
  ]));
  expect(calls.filter(c => c.method === "POST" && (c.path === "/safety/hold" || c.path === "/invite"))).toHaveLength(2);
}, T);
