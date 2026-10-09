// What each staff member receives, per role and per app (admin-console 4.1; audit observatory-2,
// -5, -6, -13, -15, -16, -18, -21, -M3), on a running server in game mode:
//  - OBS-06: an analyst's /api/state, opportunity detail and WebSocket deltas carry no name, age, minor
//    flag or trust level, and feed lines lose the names in them; full roles still get them.
//  - OBS-07: every route and the WebSocket refuse a role@slop token for every other app.
//  - The oracle's verdict (hidden truth) stays off opportunities until they are resolved.
//  - Commands for the other mode, prototype keys as command types, client fields in audit rows,
//    reveals per mode and their revocation, and refused reveals in the audit log.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY } from "@thenetwork/core";
import { APP_IDS } from "../src/apps.ts";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import type { AuditEntry, ObsDelta, ObsState, OpportunityDetail, RevealGrant } from "../src/types.ts";

const T = 300_000;
const long = (t: string) => t.padEnd(32, "-0123456789abcdef");
const TOK = { admin: long("admin"), analyst: long("analyst-ntwrk"), safety: long("safety"), rev: long("rev-slop"), saf: long("saf-slop"), ana: long("ana-slop"), adm: long("adm-slop") };
let dir: string;
let obs: ObservatoryServer;
const as = (tok: string, path: string, init: RequestInit = {}) =>
  fetch(obs.url + path, { ...init, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", ...(init.headers as Record<string, string> ?? {}) } });
const post = (tok: string, path: string, body: unknown, headers: Record<string, string> = {}) => as(tok, path, { method: "POST", body: JSON.stringify(body), headers });
const state = async (tok: string) => (await (await as(tok, "/api/state")).json()) as ObsState;

/** A socket opened with the header; collects deltas until closed. */
function socket(tok: string, app = "ntwrk") {
  const ws = new WebSocket(`${obs.url.replace("http", "ws")}/ws?app=${app}`, { headers: { authorization: `Bearer ${tok}` } } as never);
  const deltas: ObsDelta[] = [];
  let closed: { code: number; reason: string } | undefined;
  ws.onmessage = e => { const m = JSON.parse(e.data as string); if (m.type === "delta") deltas.push(m.delta); };
  ws.onclose = e => { closed = { code: e.code, reason: e.reason }; };
  const open = new Promise<void>((ok, no) => { ws.onopen = () => ok(); ws.onerror = () => no(new Error("socket refused")); });
  return { ws, deltas, open, closed: () => closed };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "obs-staff-apps-"));
  obs = await createServer({
    port: 0, development: false, audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
    tokens: `admin:${TOK.admin},analyst@ntwrk:${TOK.analyst},safety@ntwrk:${TOK.safety},reviewer@slop:${TOK.rev},safety@slop:${TOK.saf},analyst@slop:${TOK.ana},admin@slop:${TOK.adm}`,
    game: { seed: 1, review: "auto", pushMs: 50, tickMs: 3_600_000 },
  });
  expect((await post(TOK.admin, "/api/control", { type: "step", ms: 3 * DAY })).status).toBe(200);
}, T);
afterAll(async () => { await obs?.stop(); await rm(dir, { recursive: true, force: true }); });

describe("per-role shaping (OBS-06)", () => {
  test("an analyst's state has no name, age, minor flag or trust; feed lines have no names; full roles keep them", async () => {
    const full = await state(TOK.admin), ana = await state(TOK.analyst);
    expect(ana.members.length).toBe(full.members.length);
    expect(full.members.some(m => m.minor) && full.members.some(m => m.age !== undefined)).toBe(true);
    for (const m of ana.members) {
      expect(m.name).toMatch(/^Member /);
      for (const k of ["age", "minor", "ageUnknown", "trust", "occupation"]) expect([m.id, k, k in m]).toEqual([m.id, k, false]);
    }
    const names = full.members.filter(m => m.joined).flatMap(m => [m.name, m.name.split(" ")[0]!]).filter(n => n.length >= 3);
    const feed = ana.feed.map(f => f.text).join("\n");
    expect(full.feed.some(f => names.some(n => f.text.includes(n)))).toBe(true);
    for (const n of names) expect([n, new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(feed)]).toEqual([n, false]);
    expect(ana.opportunities.every(o => o.objective === "" && Object.keys(o.explanations).length === 0)).toBe(true);
    expect(ana.truth).toBeUndefined();
  }, T);

  test("an analyst's opportunity detail has the shape only: no members' names, no messages", async () => {
    const o = (await state(TOK.admin)).opportunities.find(x => x.participants.length >= 2)!;
    const d = await (await as(TOK.analyst, `/api/opportunity/${encodeURIComponent(o.id)}`)).json() as OpportunityDetail;
    expect(d.messages).toEqual([]);
    expect(d.members.every(m => m.name.startsWith("Member ") && !("minor" in m))).toBe(true);
    const full = await (await as(TOK.admin, `/api/opportunity/${encodeURIComponent(o.id)}`)).json() as OpportunityDetail;
    expect(full.members.some(m => !m.name.startsWith("Member "))).toBe(true);
  }, T);

  test("WebSocket deltas are shaped per socket: the analyst's carry no names or ages, the admin's do", async () => {
    const a = socket(TOK.analyst), b = socket(TOK.admin);
    await Promise.all([a.open, b.open]);
    expect((await post(TOK.admin, "/api/control", { type: "step", ms: DAY })).status).toBe(200);
    await Bun.sleep(400);
    const am = a.deltas.flatMap(d => d.members ?? []), bm = b.deltas.flatMap(d => d.members ?? []);
    expect(bm.length).toBeGreaterThan(0);
    expect(am.length).toBe(bm.length);
    expect(am.every(m => m.name.startsWith("Member ") && !("age" in m) && !("minor" in m))).toBe(true);
    expect(bm.some(m => !m.name.startsWith("Member ") && "minor" in m)).toBe(true);
    const names = new Set(bm.filter(m => m.joined).map(m => m.name.split(" ")[0]!).filter(n => n.length >= 3));
    const af = a.deltas.flatMap(d => d.feed ?? []).map(f => f.text).join("\n");
    for (const n of names) expect([n, new RegExp(`\\b${n}\\b`).test(af)]).toEqual([n, false]);
    a.ws.close(); b.ws.close();
  }, T);

  test("the oracle's verdict stays off unresolved opportunities for everyone without the truth lens", async () => {
    const inside = (await obs.source("game", "ntwrk")).state({ truth: true });
    const open = inside.opportunities.filter(o => o.oracle && !["COMPLETED", "FEEDBACK_COLLECTED", "ABANDONED"].includes(o.state) && !o.oracle.unsafe);
    expect(open.length).toBeGreaterThan(0);
    for (const tok of [TOK.admin, TOK.analyst, TOK.safety]) {
      const s = await state(tok);
      for (const o of open) expect([o.id, s.opportunities.find(x => x.id === o.id)?.oracle]).toEqual([o.id, undefined]);
    }
  }, T);
});

describe("per-app grant matrix (OBS-07)", () => {
  const routes: [string, string, unknown?][] = [
    ["GET", "/api/state"], ["GET", "/api/member/x"], ["GET", "/api/member/x/timeline"], ["GET", "/api/member/x/app"], ["GET", "/api/opportunity/x"],
    ["GET", "/api/reveal"], ["GET", "/api/safety"], ["GET", "/api/config"], ["GET", "/api/audit"], ["GET", "/api/search?q=ab"], ["GET", "/api/runs/diff?a=x&b=y"], ["GET", "/api/lab"],
    ["POST", "/api/control", { type: "step", ms: 1 }], ["POST", "/api/safety", { action: "close", caseId: "c" }], ["POST", "/api/reveal", { memberId: "x", reason: "checking" }],
    ["POST", "/api/lab/run", { arms: ["consent"], seeds: [1], days: 1 }], ["POST", "/api/ws-ticket", {}], ["POST", "/api/member/x/photos", { reason: "checking" }], ["DELETE", "/api/reveal?memberId=x"],
  ];
  test("every route and the WebSocket: a role@slop token gets 403 for every other app", async () => {
    const others = APP_IDS.filter(a => a !== "slop");
    expect(others.length).toBe(3);
    for (const tok of [TOK.rev, TOK.saf, TOK.ana, TOK.adm]) for (const app of others) {
      for (const [method, path, body] of routes) {
        const url = `${path}${path.includes("?") ? "&" : "?"}app=${app}`;
        const r = await as(tok, url, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
        expect([method, path, app, r.status]).toEqual([method, path, app, 403]);
      }
      const ws = await fetch(`${obs.url}/ws?app=${app}`, { headers: { authorization: `Bearer ${tok}`, upgrade: "websocket", connection: "upgrade", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13" } });
      expect(["/ws", app, ws.status]).toEqual(["/ws", app, 403]);
    }
    // And the same token reaches slop.
    expect((await as(TOK.ana, "/api/state?app=slop")).status).toBe(200);
  }, T);
});

describe("small fixes (OBS-11)", () => {
  test("a change sent for the other mode is refused (409 mode_changed); the right mode or none is fine", async () => {
    const r = await post(TOK.admin, "/api/control", { type: "pause" }, { "x-observatory-mode": "real" });
    expect([r.status, (await r.json()).code]).toEqual([409, "mode_changed"]);
    expect((await post(TOK.admin, "/api/control", { type: "pause" }, { "x-observatory-mode": "game" })).status).toBe(200);
    expect((await post(TOK.admin, "/api/control", { type: "pause" })).status).toBe(200);
  }, T);

  test("prototype keys are not commands (400), and an error never sends internals", async () => {
    for (const type of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      const r = await post(TOK.admin, "/api/control", { type });
      expect([type, r.status, (await r.json()).error]).toEqual([type, 400, "unknown command"]);
    }
  }, T);

  test("audit rows keep the allowed command fields only; a corrupt line does not break the audit log", async () => {
    expect((await post(TOK.admin, "/api/control", { type: "matching", on: false, injected: "x".repeat(5000), nested: { a: 1 }, note: "why I did it" })).status).toBe(200);
    expect((await post(TOK.admin, "/api/control", { type: "matching", on: true })).status).toBe(200);
    await appendFile(join(dir, "audit", "audit.jsonl"), "{not json\n\n[1,2]\n");
    const r = await as(TOK.admin, "/api/audit?limit=500");
    expect(r.status).toBe(200);
    const rows = ((await r.json()) as { entries: AuditEntry[] }).entries.filter(e => e.action === "matching");
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const e of rows) {
      expect(e.detail).not.toHaveProperty("injected");
      expect(e.detail).not.toHaveProperty("nested");
    }
    expect(rows.some(e => (e.detail as { noteLength?: number }).noteLength === 12)).toBe(true);
  }, T);

  test("a reveal for an unknown member is refused and audited; reveals are per mode and can be ended early", async () => {
    const before = await (await as(TOK.admin, "/api/audit?limit=500")).json() as { entries: AuditEntry[] };
    expect((await post(TOK.safety, "/api/reveal", { memberId: "nobody-here", reason: "probing membership" })).status).toBe(404);
    const after = await (await as(TOK.admin, "/api/audit?limit=500")).json() as { entries: AuditEntry[] };
    expect(after.entries.length).toBe(before.entries.length + 2); // the refused reveal, and the admin's first audit read
    expect(after.entries.find(e => e.targetId === "nobody-here")).toMatchObject({ action: "reveal", ok: false, detail: { refused: "unknown_member" } });
    const m = (await state(TOK.safety)).members.find(x => x.joined)!;
    expect((await post(TOK.safety, "/api/reveal", { memberId: m.id, reason: "checking a report" })).status).toBe(200);
    const mine = async () => (await (await as(TOK.safety, "/api/reveal")).json()) as RevealGrant[];
    expect((await mine()).map(g => g.memberId)).toEqual([m.id]);
    // A reveal in game mode is not a reveal in real mode (another member with the same id there).
    expect((await post(TOK.admin, "/api/mode", { mode: "real" })).status).toBe(200);
    expect(await mine()).toEqual([]);
    expect((await post(TOK.admin, "/api/mode", { mode: "game" })).status).toBe(200);
    expect((await mine()).map(g => g.memberId)).toEqual([m.id]);
    // Ended early, audited.
    expect((await as(TOK.safety, `/api/reveal?memberId=${encodeURIComponent(m.id)}`, { method: "DELETE" })).status).toBe(200);
    expect(await mine()).toEqual([]);
    const rows = (await (await as(TOK.admin, `/api/audit?limit=50&targetId=${encodeURIComponent(m.id)}`)).json() as { entries: AuditEntry[] }).entries;
    expect(rows[0]).toMatchObject({ action: "reveal_revoke", ok: true });
  }, T);
});
