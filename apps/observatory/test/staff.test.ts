// Staff access on the server (docs/admin-console.md section 4): role tokens and the old admin token,
// Cloudflare Access SSO, per-command and per-route role checks, the reviewer of record, the per-member
// PII reveal, the audit log (written before data is returned), the production switch
// (OBSERVATORY_REAL_ONLY) and the simulation lab.
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY } from "@thenetwork/core";
import { SQL } from "../../../packages/core/src/runtime/postgres.ts";
import { Lab, LAB_LIMITS, labEnv, resultsOf, validateLab } from "../src/lab.ts";
import { createServer, WS_EXPIRED, WS_FORBIDDEN, type ObservatoryServer } from "../src/server.ts";
import { AccessVerifier, parseTokenGrants } from "../src/staff.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";
import { HIDDEN_MESSAGE } from "../src/sources/real.ts";
import { GameSource } from "../src/sources/game.ts";
import { rowsFromGame, writeRows } from "../db/writer.ts";
import type { AuditEntry, ConfigInfo, LabRun, MemberDetail, MemberTimeline, ObsState, OpportunityDetail, SafetyInfo, StaffUser } from "../src/types.ts";
import { webSocketUpgradeStatus } from "./websocket.ts";

const T = 300_000;
/** Staff tokens are at least 32 characters (the server refuses shorter ones). */
const long = (t: string) => t.padEnd(32, "-0123456789abcdef");
const TOK = { admin: long("adm-7c1e"), reviewer: long("rev-2b9d"), safety: long("saf-55aa"), analyst: long("ana-0f3c"), legacy: long("old-admin-9911") };
let dir: string;
let obs: ObservatoryServer;
let base: string;
const as = (tok: string, path: string, init: RequestInit = {}) =>
  fetch(base + path, { ...init, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", ...(init.headers as Record<string, string> ?? {}) } });
const post = (tok: string, path: string, body: unknown) => as(tok, path, { method: "POST", body: JSON.stringify(body) });
const control = (tok: string, body: unknown) => post(tok, "/api/control", body);

const AUD = "4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2", ISS = "https://ntwrk.cloudflareaccess.com";
const b64 = (x: string | ArrayBuffer) => Buffer.from(typeof x === "string" ? x : new Uint8Array(x)).toString("base64url");
/** A local Access signing key (kid "k1"), a mocked certs endpoint that counts its calls, and a forger with another key. */
async function accessKeys() {
  const gen = () => crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;
  const [real, other] = [await gen(), await gen()];
  const jwk = { ...(await crypto.subtle.exportKey("jwk", real.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  let n = 0;
  const sign = async (key: CryptoKey, claims: Record<string, unknown>, kid: string) => {
    const head = `${b64(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }))}.${b64(JSON.stringify(claims))}`;
    return `${head}.${b64(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head)))}`;
  };
  return {
    fetch: async (url: string) => { n++; expect(url).toBe(`${ISS}/cdn-cgi/access/certs`); return Response.json({ keys: [jwk], public_cert: { kid: "k1", cert: "-----BEGIN CERTIFICATE-----" } }); },
    calls: () => n,
    sign: (claims: Record<string, unknown>, kid = "k1") => sign(real.privateKey, claims, kid),
    forge: (claims: Record<string, unknown>) => sign(other.privateKey, claims, "k1"),
  };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "obs-staff-"));
  obs = await createServer({
    port: 0, development: false, token: TOK.legacy, tokens: `admin:${TOK.admin},reviewer:${TOK.reviewer},safety:${TOK.safety},analyst:${TOK.analyst}`,
    audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
    game: { seed: 1, judge: "hold-every-item", pushMs: 3_600_000, tickMs: 3_600_000 },
  });
  base = obs.url;
  expect((await control(TOK.admin, { type: "step", ms: DAY })).status).toBe(200);
}, T);
afterAll(async () => { await obs?.stop(); await rm(dir, { recursive: true, force: true }); });

describe("staff roles, audit and PII reveal", () => {
  test("reading safety cases and reports requires an audit for the selected app", async () => {
    const viewer = await (await as(TOK.safety, "/api/me?app=friends")).json() as StaffUser;
    const read = () => as(TOK.safety, "/api/safety?app=friends");
    expect((await read()).status).toBe(200);
    const rows = await obs.audit.list({ actions: ["read_safety"], apps: ["friends"] });
    expect(rows).toEqual([expect.objectContaining({ actor: viewer.id, app: "friends", ok: true })]);

    const write = obs.audit.write;
    obs.audit.write = async () => { throw new Error("fixture: safety audit unavailable"); };
    try {
      const refused = await read();
      expect(refused.status).toBe(503);
      expect(await refused.json()).toEqual({ error: "audit log unavailable: request refused" });
    } finally {
      obs.audit.write = write;
    }
  }, T);

  test("tokens map to roles; the old OBSERVATORY_TOKEN is an admin; a wrong token is refused", async () => {
    const me = async (tok: string) => (await (await as(tok, "/api/me")).json()) as StaffUser;
    expect((await me(TOK.reviewer)).roles).toEqual(["reviewer"]);
    expect((await me(TOK.analyst)).roles).toEqual(["analyst"]);
    expect((await me(TOK.legacy)).roles).toEqual(["admin"]);
    const r = await me(TOK.reviewer);
    expect(r.id).toMatch(/^token:reviewer#[0-9a-f]{8}$/);
    expect(r.id).not.toContain(TOK.reviewer);
    expect((await as("nope", "/api/state")).status).toBe(401);
    expect((await fetch(base + "/api/state")).status).toBe(401);
    expect(((await (await as(TOK.analyst, "/api/state")).json()) as ObsState).env.authRequired).toBe(true);
  });

  test("per-command and per-route role checks on the server", async () => {
    const s = (await (await as(TOK.analyst, "/api/state")).json()) as ObsState;
    const item = s.opportunities.find(o => o.state === "IN_REVIEW" && o.review?.exceptionReason)!;
    expect(item).toBeDefined();
    const inReview = item.participants[0]!;
    const busy = new Set(s.opportunities.filter(o => o.state === "IN_REVIEW").flatMap(o => o.participants));
    const other = s.members.find(m => m.joined && !busy.has(m.id))!.id;
    const code = async (tok: string, path: string, body?: unknown) => (body === undefined ? await as(tok, path) : await post(tok, path, body)).status;
    // Analyst: read only.
    expect(await code(TOK.analyst, "/api/config")).toBe(200);
    expect(await code(TOK.analyst, "/api/lab")).toBe(200);
    expect(await code(TOK.analyst, `/api/member/${inReview}`)).toBe(403);
    expect(await code(TOK.analyst, `/api/member/${inReview}/timeline`)).toBe(403);
    expect(await code(TOK.analyst, "/api/control", { type: "review", oppId: item.id, decision: "approve" })).toBe(403);
    expect(await code(TOK.analyst, "/api/control", { type: "step", ms: 60_000 })).toBe(403);
    for (const p of ["/api/safety", "/api/audit", "/api/search?q=coffee"]) expect([p, await code(TOK.analyst, p)]).toEqual([p, 403]);
    // Reviewer: review, and open members in open review items only; no config, reset or matching switch.
    expect(await code(TOK.reviewer, `/api/member/${inReview}`)).toBe(200);
    expect(await code(TOK.reviewer, `/api/member/${other}`)).toBe(403);
    expect(await code(TOK.reviewer, "/api/control", { type: "matching", on: false })).toBe(403);
    expect(await code(TOK.reviewer, "/api/control", { type: "review_mode", mode: "auto" })).toBe(400);
    expect(await code(TOK.reviewer, "/api/control", { type: "reset" })).toBe(403);
    expect(await code(TOK.reviewer, "/api/config")).toBe(403);
    expect(await code(TOK.reviewer, "/api/reveal", { memberId: inReview, reason: "checking a report" })).toBe(403);
    // Safety: any member, the safety console, search; no review.
    expect(await code(TOK.safety, `/api/member/${other}`)).toBe(200);
    expect(await code(TOK.safety, "/api/safety")).toBe(200);
    expect(await code(TOK.safety, "/api/control", { type: "review", oppId: item.id, decision: "reject", reason: "tone" })).toBe(403);
    // The reviewer of record is the authenticated staff id; the server still refuses "other" without a note.
    const noNote = await control(TOK.reviewer, { type: "review", oppId: item.id, decision: "reject", reason: "other" });
    expect([noNote.status, (await noNote.json()).code]).toEqual([409, "note_required"]);
    const ok = await control(TOK.reviewer, { type: "review", oppId: item.id, decision: "approve", secondsSpent: 30 });
    expect(ok.status).toBe(200);
    const reviewer = ((await (await as(TOK.reviewer, "/api/me")).json()) as StaffUser).id;
    const after = ((await (await as(TOK.analyst, "/api/state")).json()) as ObsState).opportunities.find(o => o.id === item.id)!;
    expect(after.review).toMatchObject({ decision: "approve", reviewer, secondsSpent: 30 });
  }, T);

  test("an analyst's members carry no age band: no age, minor flag, under-13 decline, weekly or calendar opt-in or community", async () => {
    const game = (await obs.source()) as GameSource;
    const marked = [...game.store.members.values()].slice(0, 3);
    expect(marked.length).toBe(3);
    const flags = [["declined", marked[0]!], ["weekly", marked[1]!], ["calendar", marked[2]!]] as const;
    const before = flags.map(([key, member]) => [key, member, Object.prototype.hasOwnProperty.call(member, key), member[key]] as const);
    try {
      for (const [key, member] of flags) member[key] = true;
      const full = (await (await as(TOK.admin, "/api/state")).json()) as ObsState;
      expect(full.members.filter(m => m.declined || m.weekly || m.calendar).length).toBeGreaterThanOrEqual(3);
      const s = (await (await as(TOK.analyst, "/api/state")).json()) as ObsState;
      expect(s.members.length).toBeGreaterThan(0);
      const ageBand = ["age", "minor", "ageUnknown", "declined", "weekly", "calendar", "community"];
      expect(s.members.flatMap(m => Object.keys(m).filter(k => ageBand.includes(k)))).toEqual([]);
    } finally {
      for (const [key, member, had, value] of before) {
        if (had) member[key] = value as boolean;
        else delete member[key];
      }
    }
  }, T);

  test("matching switch and config history: admin only, with the staff id", async () => {
    const admin = ((await (await as(TOK.admin, "/api/me")).json()) as StaffUser).id;
    expect((await control(TOK.admin, { type: "matching", on: false })).status).toBe(200);
    expect((await control(TOK.admin, { type: "matching", on: true })).status).toBe(200);
    const cfg = (await (await as(TOK.analyst, "/api/config")).json()) as ConfigInfo;
    expect(cfg.history.map(h => [h.key, h.to, h.actor])).toEqual([["matching", false, admin], ["matching", true, admin]]);
  }, T);

  test("PII reveal: safety or admin, with a reason, for 5, 10 or 15 minutes only; audited before data; staff access shown on the member", async () => {
    const s = (await (await as(TOK.analyst, "/api/state")).json()) as ObsState;
    const m = s.members.find(x => x.joined)!;
    expect((await post(TOK.safety, "/api/reveal", { memberId: m.id, reason: "x" })).status).toBe(400);
    expect((await post(TOK.safety, "/api/reveal", { memberId: "nobody", reason: "checking a report" })).status).toBe(404);
    for (const minutes of [90, 1, 7, 0, "15"]) {
      const refused = await post(TOK.safety, "/api/reveal", { memberId: m.id, reason: "checking a safety report", minutes });
      expect([minutes, refused.status, (await refused.json()).code]).toEqual([minutes, 400, "bad_minutes"]);
    }
    expect(((await (await as(TOK.safety, "/api/reveal")).json()) as unknown[])).toEqual([]);
    const g = await (await post(TOK.safety, "/api/reveal", { memberId: m.id, reason: "checking a safety report" })).json() as { ok: boolean; until: number; at: number };
    expect(g.ok).toBe(true);
    expect(g.until - g.at).toBe(15 * 60_000);
    const d = (await (await as(TOK.safety, `/api/member/${m.id}`)).json()) as MemberDetail;
    expect(d.revealed?.until).toBe(g.until);
    expect(d.staffAccess!.map(x => x.action)).toEqual(expect.arrayContaining(["reveal", "read_member"]));
    const tl = (await (await as(TOK.safety, `/api/member/${m.id}/timeline`)).json()) as MemberTimeline;
    expect(tl.entries.length).toBeGreaterThan(0);
    // Another staff member has no reveal for this member.
    expect(((await (await as(TOK.admin, `/api/member/${m.id}`)).json()) as MemberDetail).revealed).toBeUndefined();
    // Audit log: admin only, newest first, every read and the reveal with its reason; tokens never written.
    expect((await as(TOK.safety, "/api/audit")).status).toBe(403);
    const { entries, sink } = (await (await as(TOK.admin, "/api/audit?limit=500")).json()) as { entries: AuditEntry[]; sink: string };
    expect(sink).toBe("file");
    const safetyId = ((await (await as(TOK.safety, "/api/me")).json()) as StaffUser).id;
    const mine = entries.filter(e => e.actor === safetyId && e.targetId === m.id);
    expect(mine.slice(0, 3).map(e => e.action)).toEqual(["read_timeline", "read_member", "reveal"]);
    expect(mine.find(e => e.action === "reveal")).toMatchObject({ reason: "checking a safety report", ok: true, detail: { minutes: 15 } });
    expect(mine.filter(e => e.action === "reveal" && !e.ok).map(e => e.detail)).toEqual(Array(5).fill({ refused: "bad_minutes" }));
    expect(entries.some(e => e.action === "review" && e.ok && (e.detail as any)?.phase === "result")).toBe(true);
    expect(entries.some(e => e.action === "matching" && e.targetType === "config")).toBe(true);
    expect(entries.some(e => e.action === "review" && !e.ok && (e.detail as any)?.refused === "forbidden")).toBe(true);
    const file = await readFile(join(dir, "audit", "audit.jsonl"), "utf8");
    for (const t of Object.values(TOK)) expect(file.includes(t)).toBe(false);
  }, T);

  test("audit: repeated reads of one member by one staff member within 60 s write one row (the first); a reveal starts a new one", async () => {
    const s = (await (await as(TOK.analyst, "/api/state")).json()) as ObsState;
    const m = s.members.filter(x => x.joined).at(-1)!;
    for (let i = 0; i < 3; i++) {
      expect((await as(TOK.safety, `/api/member/${m.id}`)).status).toBe(200);
      expect((await as(TOK.safety, `/api/member/${m.id}/timeline`)).status).toBe(200);
    }
    // Another staff member's read is their own row.
    expect((await as(TOK.admin, `/api/member/${m.id}`)).status).toBe(200);
    const adminId = ((await (await as(TOK.admin, "/api/me")).json()) as StaffUser).id;
    const rows = async () => ((await (await as(TOK.admin, `/api/audit?limit=1000&targetId=${m.id}`)).json()) as { entries: AuditEntry[] }).entries.filter(e => e.action.startsWith("read_"));
    const safetyId = ((await (await as(TOK.safety, "/api/me")).json()) as StaffUser).id;
    expect((await rows()).filter(e => e.actor === safetyId).map(e => e.action).sort()).toEqual(["read_member", "read_timeline"]);
    expect((await rows()).filter(e => e.actor === adminId).map(e => e.action)).toEqual(["read_member"]);
    expect((await post(TOK.safety, "/api/reveal", { memberId: m.id, reason: "checking a safety report" })).status).toBe(200);
    expect((await as(TOK.safety, `/api/member/${m.id}`)).status).toBe(200);
    expect((await as(TOK.safety, `/api/member/${m.id}`)).status).toBe(200);
    const mine = (await rows()).filter(e => e.actor === safetyId);
    expect(mine.map(e => [e.action, !!(e.detail as { revealed?: boolean } | undefined)?.revealed])).toEqual([["read_member", true], ["read_timeline", false], ["read_member", false]]);
  }, T);

  test("safety console over HTTP and search", async () => {
    const sf = (await (await as(TOK.safety, "/api/safety")).json()) as SafetyInfo;
    expect(sf.canAct).toBe(true);
    expect(sf.minors.inOpportunities).toEqual([]);
    expect((await post(TOK.analyst, "/api/safety", { action: "close", caseId: "sc1" })).status).toBe(403);
    expect((await post(TOK.safety, "/api/safety", { action: "nope" })).status).toBe(400);
    expect((await as(TOK.safety, "/api/search?q=a")).status).toBe(400);
    const hits = (await (await as(TOK.safety, "/api/search?q=probe")).json()) as unknown[];
    expect(Array.isArray(hits)).toBe(true);
    // The search text never goes into the append-only audit (staff search for names and phones): only its length.
    await as(TOK.safety, "/api/search?q=%2B12125550101");
    const { entries } = (await (await as(TOK.admin, "/api/audit?limit=500")).json()) as { entries: AuditEntry[] };
    const searches = entries.filter(e => e.action === "search");
    expect(searches.map(e => e.detail)).toContainEqual({ qLength: 12 });
    expect(JSON.stringify(searches)).not.toMatch(/2125550101|probe/);
  }, T);

  test("truth lens: safety or admin only, per staff member, audited; inbound text in an opportunity only for staff who may open the member", async () => {
    expect((await control(TOK.reviewer, { type: "lens", on: true })).status).toBe(403);
    expect((await control(TOK.safety, { type: "lens", on: true })).status).toBe(200);
    const state = async (tok: string) => (await (await as(tok, "/api/state")).json()) as ObsState;
    const mine = await state(TOK.safety);
    expect(Object.keys(mine.truth ?? {}).length).toBeGreaterThan(0);
    for (const tok of [TOK.analyst, TOK.reviewer, TOK.admin]) expect((await state(tok)).truth).toBeUndefined();
    const safetyId = ((await (await as(TOK.safety, "/api/me")).json()) as StaffUser).id;
    const { entries } = (await (await as(TOK.admin, "/api/audit?limit=500")).json()) as { entries: AuditEntry[] };
    expect(entries.filter(e => e.actor === safetyId && e.action === "lens").map(e => (e.detail as any)?.phase)).toEqual(["result", "requested"]);
    expect((await control(TOK.safety, { type: "lens", on: false })).status).toBe(200);
    expect((await state(TOK.safety)).truth).toBeUndefined();
    // Opportunity detail: the analyst never gets a member's words; safety (who may open any member) does.
    for (const o of (await state(TOK.analyst)).opportunities.filter(x => x.state === "IN_REVIEW" && x.review?.exceptionReason)) {
      const decided = await control(TOK.reviewer, { type: "review", oppId: o.id, decision: "approve" });
      expect([o.id, decided.status]).toEqual([o.id, 200]);
    }
    expect((await control(TOK.admin, { type: "step", ms: 2 * DAY })).status).toBe(200);
    let checked = 0;
    for (const o of (await state(TOK.analyst)).opportunities) {
      const read = async (tok: string) => (await (await as(tok, `/api/opportunity/${encodeURIComponent(o.id)}`)).json()) as OpportunityDetail;
      const saf = (await read(TOK.safety)).messages.filter(m => m.direction === "inbound" && !m.system);
      if (!saf.length) continue;
      // A reviewer may open only members in an open review item: past items show the length, not the words.
      const rev = await read(TOK.reviewer);
      const open = new Set((await state(TOK.analyst)).opportunities.filter(x => x.state === "IN_REVIEW" && x.review?.exceptionReason).flatMap(x => x.participants));
      const hidden = rev.messages.filter(m => m.direction === "inbound" && !m.system && !open.has(m.memberId));
      expect(hidden.map(m => m.body)).toEqual(hidden.map(() => HIDDEN_MESSAGE));
      // The analyst gets the opportunity's shape only: no messages, no names (audit observatory-18).
      const ana = await read(TOK.analyst);
      expect(ana.messages).toEqual([]);
      expect(ana.members.every(m => m.name.startsWith("Member ") && m.age === undefined)).toBe(true);
      // The event history keeps its shape: no line names a member, and no event points at one.
      const full = await read(TOK.safety);
      expect(ana.events.map(e => e.type)).toEqual(full.events.map(e => e.type));
      const people = full.members.map(m => m.name.split(" ")[0]!);
      expect(ana.events.filter(e => e.memberId || e.detail || people.some(p => e.text.includes(p)))).toEqual([]);
      expect(saf.length).toBeGreaterThan(0);
      if (++checked >= 3) break;
    }
    expect(checked).toBeGreaterThan(0);
  }, T);
});

describe("SSO and the production switch", () => {
  test("Cloudflare Access: the JWT is verified (signature, audience, issuer, expiry, issue time) before the email is trusted", async () => {
    const k = await accessKeys();
    const now = Math.floor(Date.now() / 1000);
    const claims = (email: string, more: Record<string, unknown> = {}) => ({ aud: [AUD], iss: ISS, email, iat: now - 30, exp: now + 3600, type: "app", amr: ["pwd", "mfa"], ...more });
    // Unit: each check refuses on its own; the keys are fetched once and cached.
    const v = new AccessVerifier({ team: "ntwrk", aud: AUD, fetch: k.fetch });
    expect(v.certsUrl).toBe("https://ntwrk.cloudflareaccess.com/cdn-cgi/access/certs");
    expect(await v.verify(await k.sign(claims("Rev@Example.org")))).toEqual({ email: "rev@example.org", exp: (now + 3600) * 1000, secondFactor: true });
    expect(await v.verify(await k.sign(claims("rev@example.org", { amr: ["pwd"] })))).toEqual({ email: "rev@example.org", exp: (now + 3600) * 1000, secondFactor: false });
    expect(await v.verify(await k.sign(claims("rev@example.org", { amr: undefined })))).toEqual({ email: "rev@example.org", exp: (now + 3600) * 1000, secondFactor: false });
    for (const [amr, secondFactor] of [[["otp"], false], [["swk"], false], [["hwk"], false], [["sc"], false], [["OTP", "otp"], false], [["otp", ""], false], [["pwd", "otp"], true], [["MFA"], true]] as const) {
      expect([amr, await v.verify(await k.sign(claims("rev@example.org", { amr: [...amr] })))]).toEqual([amr, { email: "rev@example.org", exp: (now + 3600) * 1000, secondFactor }]);
    }
    expect(await v.verify(await k.sign(claims("rev@example.org", { aud: ["other-app"] })))).toEqual({ error: "wrong audience" });
    expect(await v.verify(await k.sign(claims("rev@example.org", { iss: "https://evil.cloudflareaccess.com" })))).toEqual({ error: "wrong issuer" });
    expect(await v.verify(await k.sign(claims("rev@example.org", { exp: now - 120 })))).toEqual({ error: "expired" });
    expect(await v.verify(await k.sign(claims("rev@example.org", { iat: now + 600 })))).toEqual({ error: "issued in the future" });
    expect(await v.verify(await k.sign(claims("rev@example.org", { email: undefined, common_name: "svc" })))).toEqual({ error: "no email in the token" });
    expect(await v.verify(await k.forge(claims("rev@example.org")))).toEqual({ error: "bad signature" });
    expect(await v.verify("x.y.z")).toEqual({ error: "malformed token" });
    expect(k.calls()).toBe(1);
    // An unknown key id fetches the keys again (rotation), at most every 30 s.
    expect(await v.verify(await k.sign(claims("rev@example.org"), "k2"))).toEqual({ error: "unknown signing key" });
    expect(await v.verify(await k.sign(claims("rev@example.org"), "k3"))).toEqual({ error: "unknown signing key" });
    expect(k.calls()).toBe(1); // fetched less than 30 s ago
    const later = new AccessVerifier({ team: "ntwrk.cloudflareaccess.com", aud: AUD, fetch: k.fetch, now: () => Date.now() });
    expect((await later.verify(await k.sign(claims("ana@example.org"))) as { email: string }).email).toBe("ana@example.org");

    // Server: SSO without a team and an audience refuses to start.
    await expect(createServer({ port: 0, development: false, mode: "real", trustCfAccess: true, roles: "ana@example.org:admin", cfAccess: { team: "", aud: "" }, audit: { dir: join(dir, "audit-sso0") }, lab: { dir: join(dir, "lab-sso0") }, real: { url: undefined, pollMs: 3_600_000, service: false } })).rejects.toThrow("OBSERVATORY_CF_ACCESS");
    const sso = await createServer({ port: 0, development: false, mode: "real", trustCfAccess: true, roles: "ana@example.org:admin,rev@example.org:reviewer,rev@example.org:safety", cfAccess: { team: "ntwrk", aud: AUD, fetch: k.fetch }, audit: { dir: join(dir, "audit-sso") }, lab: { dir: join(dir, "lab-sso") }, real: { url: undefined, pollMs: 3_600_000, service: false } });
    try {
      expect(sso.token).toBeUndefined();
      const get = async (path: string, h: Record<string, string>) => fetch(sso.url + path, { headers: h });
      const jwt = (email: string, more?: Record<string, unknown>) => k.sign(claims(email, more));
      const me = await get("/api/me", { "cf-access-authenticated-user-email": "Rev@Example.org", "cf-access-jwt-assertion": await jwt("rev@example.org") });
      expect(await me.json()).toMatchObject({ id: "rev@example.org", roles: ["reviewer", "safety"], via: "sso" });
      // The token alone is enough (its email); the email header alone is not.
      expect((await get("/api/me", { "cf-access-jwt-assertion": await jwt("ana@example.org") })).status).toBe(200);
      expect((await get("/api/me", { "cf-access-authenticated-user-email": "rev@example.org" })).status).toBe(401);
      // A header that names someone else, a forged or expired token, or a token for another app: 401.
      expect((await get("/api/me", { "cf-access-authenticated-user-email": "ana@example.org", "cf-access-jwt-assertion": await jwt("rev@example.org") })).status).toBe(401);
      expect((await get("/api/me", { "cf-access-authenticated-user-email": "ana@example.org", "cf-access-jwt-assertion": "x.y.z" })).status).toBe(401);
      expect((await get("/api/me", { "cf-access-jwt-assertion": await k.forge(claims("ana@example.org")) })).status).toBe(401);
      expect((await get("/api/me", { "cf-access-jwt-assertion": await jwt("ana@example.org", { exp: now - 600 }) })).status).toBe(401);
      expect((await get("/api/me", { "cf-access-jwt-assertion": await jwt("ana@example.org", { aud: "another-app" }) })).status).toBe(401);
      // A verified person without a staff role: 403. Roles still apply per route.
      expect((await get("/api/me", { "cf-access-jwt-assertion": await jwt("stranger@example.org") })).status).toBe(403);
      expect((await get("/api/audit", { "cf-access-jwt-assertion": await jwt("rev@example.org") })).status).toBe(403);
      expect((await get("/api/audit", { "cf-access-jwt-assertion": await jwt("ana@example.org") })).status).toBe(200);
      const oneFactor = await jwt("ana@example.org", { amr: ["pwd"] });
      const identity = await get("/api/me", { "cf-access-jwt-assertion": oneFactor });
      expect([identity.status, await identity.json()]).toEqual([200, expect.objectContaining({ id: "ana@example.org", roles: ["admin"], via: "sso", secondFactor: false })]);
      expect(await (await get("/api/me", { "cf-access-jwt-assertion": await jwt("ana@example.org") })).json()).toMatchObject({ secondFactor: true });
      for (const single of [oneFactor, await jwt("ana@example.org", { amr: ["otp"] }), await jwt("ana@example.org", { amr: ["swk"] })]) {
        expect(await (await get("/api/me", { "cf-access-jwt-assertion": single })).json()).toMatchObject({ secondFactor: false });
        for (const path of ["/api/audit", "/api/state", "/api/health", "/api/staff/home-help"]) {
          const refused = await get(path, { "cf-access-jwt-assertion": single });
          expect([path, refused.status, (await refused.json()).code]).toEqual([path, 403, "second_factor_required"]);
        }
      }
      const ticket = await fetch(sso.url + "/api/ws-ticket", { method: "POST", headers: { "cf-access-jwt-assertion": oneFactor } });
      expect([ticket.status, (await ticket.json()).code]).toEqual([403, "second_factor_required"]);
      expect(await webSocketUpgradeStatus(`${sso.url}/ws`, { "cf-access-jwt-assertion": oneFactor })).toBe(403);
      expect(k.calls()).toBe(3); // one fetch per verifier: the two above, then the server's, once for all its requests
    } finally { await sso.stop(); }
    // Not enabled: the headers mean nothing.
    expect((await fetch(base + "/api/me", { headers: { "cf-access-authenticated-user-email": "ana@example.org", "cf-access-jwt-assertion": await k.sign(claims("ana@example.org")) } })).status).toBe(401);
  }, T);

  test.skipIf(!pgAvailable)("an in-flight reveal cannot publish after the current safety grant is removed", async () => {
    // spec/consoleMemberView.md, "Serving revealed details requires current staff authority"
    const url = await testDb();
    const sql = new SQL(url);
    const game = new GameSource({ seed: 1, judge: "hold-every-item", tickMs: 3_600_000, pushMs: 3_600_000 });
    let startAudit!: () => void, finishAudit!: () => void;
    const auditStarted = new Promise<void>(resolve => { startAudit = resolve; });
    const auditCanFinish = new Promise<void>(resolve => { finishAudit = resolve; });
    let srv: ObservatoryServer | undefined;
    try {
      await game.init();
      await game.control({ type: "step", ms: DAY });
      const id = game.state().opportunities.find(item => item.state === "IN_REVIEW")?.participants[0];
      expect(id).toBeDefined();
      await writeRows(sql, rowsFromGame(game), { truncate: true });
      await sql`insert into platform.staff_roles (email, role, app_id, granted_by) values ('rev@example.org','safety','ntwrk','test')`;
      const keys = await accessKeys();
      const now = Math.floor(Date.now() / 1000);
      const jwt = await keys.sign({ aud: [AUD], iss: ISS, email: "rev@example.org", iat: now - 30, exp: now + 3600, amr: ["mfa"] });
      srv = await createServer({
        port: 0, development: false, trustCfAccess: true, roles: "rev@example.org:reviewer@ntwrk", mode: "real", platformEnv: "dev",
        real: { url, pollMs: 3_600_000, service: false }, staffRolesUrl: url, staffRolesEveryMs: 25,
        cfAccess: { team: "ntwrk", aud: AUD, fetch: keys.fetch },
        audit: {
          kind: "file", list: async () => [], close: async () => {},
          write: async row => {
            if (row.action === "read_timeline" && row.detail?.revealed) {
              startAudit();
              await auditCanFinish;
            }
          },
        },
      });
      const request = (path: string, init?: RequestInit) => fetch(srv!.url + path, {
        ...init, headers: { "cf-access-jwt-assertion": jwt, "content-type": "application/json" },
      });
      expect((await request("/api/reveal", { method: "POST", body: JSON.stringify({ memberId: id, reason: "review of the report", minutes: 5 }) })).status).toBe(200);
      const member = await (await request(`/api/member/${id}`)).json() as MemberDetail;
      expect(member.revealed).toBeDefined();
      const timeline = `/api/member/${id}/timeline`;
      const pending = request(timeline);
      await within(auditStarted, 5_000);

      await sql`delete from platform.staff_roles where email='rev@example.org'`;
      await expect.poll(async () => ((await (await request("/api/me")).json()) as StaffUser).roles, { timeout: 5_000 }).toEqual(["reviewer"]);
      finishAudit();

      expect((await pending).status).toBe(403);
      expect(await (await request("/api/reveal")).json()).toEqual([]);
      const next = await request(timeline);
      expect(next.status).toBe(200);
      const redacted = await next.json() as MemberTimeline;
      expect(redacted.revealed).toBeUndefined();
      const messages = redacted.entries.filter(entry => entry.kind === "message" && entry.message.direction === "inbound");
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.every(entry => entry.kind === "message" && entry.message.body === HIDDEN_MESSAGE)).toBe(true);
    } finally {
      finishAudit();
      await srv?.stop();
      await game.dispose();
      await sql.close();
      await dropTestDb();
    }
  }, T);

  test("OBSERVATORY_REAL_ONLY: no game mode, no game controls, no lab", async () => {
    const prod = await createServer({ port: 0, development: false, realOnly: true, platformEnv: "dev", token: long("prod-admin"), audit: { dir: join(dir, "audit-prod") }, lab: { dir: join(dir, "lab-prod") }, real: { url: undefined, pollMs: 3_600_000 } });
    try {
      const h = { authorization: `Bearer ${long("prod-admin")}`, "content-type": "application/json" };
      expect(prod.mode()).toBe("real");
      const st = (await (await fetch(prod.url + "/api/state", { headers: h })).json()) as ObsState;
      expect(st.env).toMatchObject({ mode: "real", realOnly: true });
      expect((await fetch(prod.url + "/api/mode", { method: "POST", headers: h, body: JSON.stringify({ mode: "game" }) })).status).toBe(403);
      for (const type of ["play", "step", "propose", "reset", "god"]) {
        const r = await fetch(prod.url + "/api/control", { method: "POST", headers: h, body: JSON.stringify({ type, ms: 1 }) });
        expect([type, r.status, (await r.json()).code]).toEqual([type, 403, "real_only"]);
      }
      expect(await (await fetch(prod.url + "/api/levels", { headers: h })).json()).toEqual([]);
      expect((await fetch(prod.url + "/api/lab/run", { method: "POST", headers: h, body: JSON.stringify({ arms: ["consent"], seeds: [1], days: 1 }) })).status).toBe(403);
      await expect(prod.source("game")).rejects.toThrow("OBSERVATORY_REAL_ONLY");
    } finally { await prod.stop(); }
  }, T);

  test("real mode: the judged reviews and the stop of an approved review are open to reviewer, safety and admin only (D15 to D17)", async () => {
    const real = await createServer({ port: 0, development: false, realOnly: true, platformEnv: "dev",
      tokens: `admin:${TOK.admin},reviewer:${TOK.reviewer},safety:${TOK.safety},analyst:${TOK.analyst}`,
      audit: { dir: join(dir, "audit-judged") }, lab: { dir: join(dir, "lab-judged") }, real: { url: undefined, pollMs: 3_600_000 } });
    try {
      const call = (tok: string, path: string, body?: unknown) => fetch(real.url + path, {
        method: body ? "POST" : "GET", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const steps: [string, unknown?][] = [["/api/staff/review/judged?app=ntwrk&since=0"], ["/api/staff/review/judged/opp-1/0?app=ntwrk"], ["/api/staff/review/opp-1/stop?app=ntwrk", { revision: 0 }]];
      for (const [path, body] of steps) {
        const refused = await call(TOK.analyst, path, body);
        expect([path, refused.status, (await refused.json()).code]).toEqual([path, 403, "forbidden"]);
        for (const tok of [TOK.reviewer, TOK.safety, TOK.admin]) {
          const admitted = await call(tok, path, body);
          expect([path, admitted.status, (await admitted.json()).code]).toEqual([path, 503, "read_only"]);
        }
      }
    } finally { await real.stop(); }
  }, T);
});

describe("the start guard fails closed (docs/deploy.md 2.6)", () => {
  const LOCAL = "postgres://u@localhost:54339/x", REMOTE = "postgres://u:p@db.railway.internal:5432/railway";
  test("real data without PLATFORM_ENV, or with tokens outside dev on local databases, refuses to start", async () => {
    const start = (o: Parameters<typeof createServer>[0]) => createServer({ port: 0, development: false, audit: { dir: join(dir, "audit-guard") }, lab: { dir: join(dir, "lab-guard") }, staffRolesUrl: false, peopleUrl: false, ...o })
      .then(async s => { await s.stop(); return "started"; }, e => String((e as Error).message));
    const keep = { PLATFORM_ENV: process.env.PLATFORM_ENV, NETWORK_DATABASE_URL: process.env.NETWORK_DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL };
    delete process.env.PLATFORM_ENV; delete process.env.NETWORK_DATABASE_URL; delete process.env.DATABASE_URL;
    try {
      const real = (url: string) => ({ url, pollMs: 3_600_000, service: false as const });
      // OBSERVATORY_REAL_ONLY=1 with no PLATFORM_ENV: refused (it used to start with a token).
      expect(await start({ realOnly: true, token: long("guard-admin"), real: real(LOCAL) })).toMatch(/refusing to start: real data .* needs PLATFORM_ENV/);
      expect(await start({ realOnly: true, platformEnv: "prod", token: long("guard-admin"), real: real(LOCAL) })).toMatch(/unknown PLATFORM_ENV "prod"/);
      expect(await start({ realOnly: true, platformEnv: "prod", trustCfAccess: true, cfAccess: { team: "ntwrk", aud: AUD, fetch: async () => Response.json({ keys: [] }) }, real: real(LOCAL) })).toMatch(/unknown PLATFORM_ENV "prod"/);
      // A game server whose real-mode database is remote: PLATFORM_ENV is required too, and dev with a remote host needs Access.
      expect(await start({ mode: "game", token: long("guard-admin"), real: real(REMOTE), game: { seed: 1, pushMs: 3_600_000, tickMs: 3_600_000 } })).toMatch(/needs PLATFORM_ENV/);
      expect(await start({ mode: "game", platformEnv: "dev", token: long("guard-admin"), real: real(REMOTE), game: { seed: 1, pushMs: 3_600_000, tickMs: 3_600_000 } })).toMatch(/tokens are for local databases only/);
      // Staging and production: Cloudflare Access, as before.
      for (const env of ["staging", "production"]) expect(await start({ realOnly: true, platformEnv: env, token: long("guard-admin"), real: real(LOCAL) })).toMatch(/needs Cloudflare Access/);
      // Allowed: dev with local databases and a token; a game server with no remote database and no PLATFORM_ENV.
      expect(await start({ realOnly: true, platformEnv: "dev", token: long("guard-admin"), real: real(LOCAL) })).toBe("started");
      expect(await start({ mode: "game", token: long("guard-admin"), real: real(LOCAL), game: { seed: 1, pushMs: 3_600_000, tickMs: 3_600_000 } })).toBe("started");
    } finally {
      for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  }, T);
});

describe("simulation lab", () => {
  test("requests are validated; at most 2 children run at once; results are parsed and saved", async () => {
    expect(validateLab({ arms: ["consent"], seeds: [1], days: 0 })).toContain("days");
    expect(validateLab({ arms: ["bogus"], seeds: [1], days: 3 })).toContain("arms");
    expect(validateLab({ arms: ["consent"], seeds: [1, 2, 3, 4, 5, 6], days: 3 })).toContain("seeds");
    // The fixture is outside the package, so .mts sets ESM for its top-level await.
    const script = join(dir, "fake-arm.mts");
    await writeFile(script, `import { setTimeout } from 'node:timers/promises'; await setTimeout(600); const seed = Number(process.argv[process.argv.indexOf("--seed") + 1]);
      if (seed === 3) { console.error("boom"); process.exit(2); }
      console.log("[llm] a log line before the results");
      console.log(JSON.stringify({ results: [{ arm: "consent", proposalAllYesRate: 0.5, inviteAcceptRate: 0.4, meetingsHeld: seed }] }, null, 2));`);
    expect(resultsOf(`{\n  "results": [\n    { "arm": "consent" }\n  ]\n}`)?.results).toHaveLength(1);
    expect(resultsOf("no json here")).toBeUndefined();
    const lab = new Lab({ dir: join(dir, "lab-fake"), script });
    const run = await lab.start({ arms: ["consent"], seeds: [1, 2, 3, 4], days: 2 }, "tester");
    let peak = 0;
    // get() returns a status only after its save: no deadline here, so a loaded machine only makes it slower.
    let done = (await lab.get(run.id))!;
    const observed = done;
    const observedValue = structuredClone(observed);
    while (done.status === "queued" || done.status === "running") { peak = Math.max(peak, lab.running); await sleep(25); done = (await lab.get(run.id))!; }
    expect(observed).toEqual(observedValue);
    expect(peak).toBe(2);
    expect(done.status).toBe("failed"); // seed 3 failed
    expect(done.error).toContain("seed 3: exit 2");
    expect(done.results.map(r => [r.seed, r.meetings, r.everyoneYes, r.judgeInvariants])).toEqual([[1, 1, 0.5, null], [2, 2, 0.5, null], [4, 4, 0.5, null]]);
    const saved = JSON.parse(await readFile(done.file, "utf8")) as LabRun;
    expect(saved).toEqual(done);
    expect(saved.results.length).toBe(3);
    // A new Lab on the same folder loads it again.
    expect((await new Lab({ dir: join(dir, "lab-fake"), script }).list()).map(r => r.id)).toEqual([run.id]);
  }, T);

  test.each(["before spawn", "with an active child"])("server shutdown persists an interrupted run (%s)", async phase => {
    // spec/consolePanels.md, "Stopping the console closes the lab and finishes interrupted runs"
    const stoppingBeforeSpawn = phase === "before spawn";
    const instance = stoppingBeforeSpawn ? "before-spawn" : "active-child";
    const labDir = join(dir, `lab-shutdown-${instance}`);
    const marker = join(dir, `shutdown-child-started-${instance}`);
    const script = join(dir, `shutdown-arm-${instance}.mts`);
    await writeFile(script, `import { writeFile } from 'node:fs/promises';
      import { setTimeout } from 'node:timers/promises';
      await writeFile(${JSON.stringify(marker)}, "started");
      await setTimeout(2000);
      console.log(JSON.stringify({ results: [] }));`);
    const server = await createServer({ port: 0, development: false, token: TOK.legacy, peopleUrl: false, staffRolesUrl: false,
      audit: { dir: join(dir, `audit-shutdown-${instance}`) }, lab: { dir: labDir, script, concurrency: 1 },
      game: { seed: 1, personas: 24, days: 1, pushMs: 3_600_000, tickMs: 3_600_000 } });
    const { lab } = server;
    let stopped = false;
    try {
      const run = await lab.start({ arms: ["consent"], seeds: [1, 2], days: 1 }, "tester");
      if (!stoppingBeforeSpawn) await expect.poll(() => readFile(marker, "utf8").catch(() => "")).toBe("started");
      await server.stop();
      stopped = true;
      const atStop = { active: lab.running, queued: lab.queued, status: (await lab.get(run.id))?.status };
      expect(atStop).toEqual({ active: 0, queued: 0, status: "failed" });
      const saved = JSON.parse(await readFile(run.file, "utf8")) as LabRun;
      expect(saved).toMatchObject({ status: "failed", finishedAt: expect.any(Number), progress: { done: stoppingBeforeSpawn ? 0 : 1, total: 2 }, results: [] });
      expect(await new Lab({ dir: labDir }).get(run.id)).toEqual(saved);
      if (stoppingBeforeSpawn) await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      await expect(lab.start({ arms: ["consent"], seeds: [3], days: 1 }, "tester")).rejects.toThrow("stopped");
    } finally {
      if (!stopped) await server.stop();
      const deadline = performance.now() + 5000;
      while (lab.running && performance.now() < deadline) await sleep(10);
    }
  }, T);

  test("accepting a lab run in the same second after restart preserves both files", async () => {
    // spec/consolePanels.md, "A lab run starts only in the simulated world with a valid request"
    const labDir = join(dir, "lab-run-identities");
    const labs: Lab[] = [];
    const newLab = () => {
      const lab = new Lab({ dir: labDir });
      labs.push(lab);
      return lab;
    };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-22T18:30:00Z"));
    try {
      const first = newLab();
      const prior = await first.start({ arms: ["consent"], seeds: [1], days: 1 }, "first-instance");
      await first.dispose();
      const saved = await readFile(prior.file, "utf8");
      const second = newLab();
      const next = await second.start({ arms: ["consent"], seeds: [2], days: 1 }, "second-instance");
      await second.dispose();
      expect(next.createdAt).toBe(prior.createdAt);
      expect(next.id).not.toBe(prior.id);
      expect(await readFile(prior.file, "utf8")).toBe(saved);
      const reloaded = await newLab().list();
      expect(reloaded.map(run => [run.id, run.request.seeds]).sort()).toEqual([[prior.id, [1]], [next.id, [2]]].sort());
    } finally {
      vi.useRealTimers();
      await Promise.all(labs.map(lab => lab.dispose()));
    }
  }, T);

  test("a real one-day consent run over HTTP reports the judge counts (all 0)", async () => {
    const res = await post(TOK.analyst, "/api/lab/run", { arms: ["consent"], seeds: [1], days: 1 });
    expect(res.status).toBe(200);
    const { run } = (await res.json()) as { run: LabRun };
    let cur = run;
    for (let i = 0; i < 1200 && (cur.status === "queued" || cur.status === "running"); i++) {
      await sleep(250);
      cur = ((await (await as(TOK.analyst, "/api/lab")).json()) as { runs: LabRun[] }).runs.find(r => r.id === run.id)!;
    }
    expect(cur.error).toBeUndefined();
    expect(cur.status).toBe("done");
    expect(cur.results).toHaveLength(1);
    const r = cur.results[0]!;
    expect(r).toMatchObject({ arm: "consent", seed: 1, judgeInvariants: 0, canaryLeaks: 0, minorContacts: 0 });
    expect(r.meetings).not.toBeNull();
    expect(r.accept).not.toBeNull();
  }, T);
});

/** A socket opened with these headers: its messages, and how it closed. */
function openSocket(url: string, headers: Record<string, string>) {
  const ws = new WebSocket(url, { headers } as never);
  const msgs: any[] = [];
  let closed: number | undefined;
  ws.onmessage = e => msgs.push(JSON.parse(e.data as string));
  const done = new Promise<number>(ok => { ws.onclose = e => { closed = e.code; ok(e.code); }; });
  const open = new Promise<void>((ok, no) => { ws.onopen = () => ok(); ws.onerror = () => no(new Error("refused")); });
  return { ws, msgs, open, done, closed: () => closed };
}
const within = <X>(p: Promise<X>, ms: number) => Promise.race([p, sleep(ms, undefined, { ref: false }).then(() => "timeout" as const)]);

/** The HTTP status of a raw WebSocket upgrade to this URL with these headers (101 when accepted). */
function upgradeStatus(url: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const finish = (status: number | undefined) => status === undefined ? reject(new Error("upgrade returned no HTTP status")) : resolve(status);
    import("node:http").then(({ get }) => {
      get(url, { agent: false, signal: AbortSignal.timeout(15_000), headers: { ...headers, upgrade: "websocket", connection: "Upgrade", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13" } },
        res => { res.resume(); finish(res.statusCode); })
        .once("upgrade", (res, socket) => { socket.destroy(); finish(res.statusCode); })
        .once("error", reject);
    }, reject);
  });
}
/** A one-use WS ticket from POST /api/ws-ticket with this Access assertion. */
async function wsTicket(base: string, jwt: string): Promise<string> {
  const r = await fetch(`${base}/api/ws-ticket`, { method: "POST", headers: { "cf-access-jwt-assertion": jwt, "content-type": "application/json" }, body: "{}" });
  expect(r.status).toBe(200);
  return ((await r.json()) as { ticket: string }).ticket;
}

describe("live sockets are authorized again (OBS-04, OBS-05)", () => {
  test("OBS-04: after a switch to real mode an engineer's socket is closed (4403) and gets no member; an admin's stays", async () => {
    const eng = long("eng-socket"), adm = long("adm-socket");
    const srv = await createServer({ port: 0, development: false, tokens: `engineer:${eng},admin:${adm}`, audit: { dir: join(dir, "audit-ws") }, lab: { dir: join(dir, "lab-ws") }, game: { seed: 1, pushMs: 50, tickMs: 3_600_000 }, real: { url: undefined, pollMs: 3_600_000, pushMs: 50, service: false } });
    try {
      const wsUrl = `${srv.url.replace("http", "ws")}/ws`;
      const e = openSocket(wsUrl, { authorization: `Bearer ${eng}` }), a = openSocket(wsUrl, { authorization: `Bearer ${adm}` });
      await Promise.all([e.open, a.open]);
      const sw = await fetch(`${srv.url}/api/mode`, { method: "POST", headers: { authorization: `Bearer ${adm}`, "content-type": "application/json" }, body: JSON.stringify({ mode: "real" }) });
      expect(sw.status).toBe(200);
      expect(await within(e.done, 3000)).toBe(WS_FORBIDDEN);
      const n = e.msgs.length;
      await sleep(300);
      expect(e.msgs.length).toBe(n);
      expect(e.msgs.some(m => m.type === "delta" && m.mode === "real")).toBe(false);
      expect(a.closed()).toBeUndefined();
      // A new socket for the engineer is refused in real mode.
      expect(await webSocketUpgradeStatus(`${srv.url}/ws`, eng)).toBe(403);
      a.ws.close();
    } finally { await srv.stop(); }
  }, T);

  test("OBS-05: an SSO socket closes when the Access token expires (4401); tokens are refused when SSO is on", async () => {
    const k = await accessKeys();
    const now = Math.floor(Date.now() / 1000);
    const jwt = (email: string, exp: number) => k.sign({ aud: [AUD], iss: ISS, email, iat: now - 30, exp, type: "app", amr: ["mfa"] });
    const srv = await createServer({ port: 0, development: false, trustCfAccess: true, tokens: `admin:${long("static-admin")}`, roles: "ana@example.org:admin", cfAccess: { team: "ntwrk", aud: AUD, fetch: k.fetch }, audit: { dir: join(dir, "audit-ws2") }, lab: { dir: join(dir, "lab-ws2") }, game: { seed: 1, pushMs: 50, tickMs: 3_600_000 }, socketCheckMs: 100 });
    try {
      // A static token is refused while single sign-on is on (audit observatory-8).
      expect((await fetch(`${srv.url}/api/me`, { headers: { authorization: `Bearer ${long("static-admin")}` } })).status).toBe(401);
      const s = openSocket(`${srv.url.replace("http", "ws")}/ws`, { "cf-access-jwt-assertion": await jwt("ana@example.org", now + 2) });
      await s.open;
      expect(await within(s.done, 5000)).toBe(WS_EXPIRED);
    } finally { await srv.stop(); }
  }, T);

  test("OBS-05: a WS ticket issued before expiry does not open a socket after the sign-in expires", async () => {
    const k = await accessKeys();
    const now = Math.floor(Date.now() / 1000);
    const jwt = (exp: number) => k.sign({ aud: [AUD], iss: ISS, email: "ana@example.org", iat: now - 30, exp, type: "app" });
    const srv = await createServer({ port: 0, development: false, trustCfAccess: true, roles: "ana@example.org:admin", cfAccess: { team: "ntwrk", aud: AUD, fetch: k.fetch }, audit: { dir: join(dir, "audit-ws4") }, lab: { dir: join(dir, "lab-ws4") }, game: { seed: 1, pushMs: 50, tickMs: 3_600_000 }, socketCheckMs: 60_000 });
    try {
      const exp = Math.floor(Date.now() / 1000) + 6;
      const short = await jwt(exp);
      const ticket = await wsTicket(srv.url, short);
      // A live ticket opens a socket while the sign-in holds (control: a second ticket).
      expect(await upgradeStatus(`${srv.url}/ws?ticket=${await wsTicket(srv.url, short)}`)).toBe(101);
      await sleep(exp * 1000 - Date.now() + 600);
      // The ticket is still inside its 30 s, but the sign-in has expired: the upgrade is refused,
      // as the header upgrade is.
      expect(await upgradeStatus(`${srv.url}/ws?ticket=${ticket}`)).toBe(401);
      expect(await upgradeStatus(`${srv.url}/ws`, { "cf-access-jwt-assertion": short })).toBe(401);
    } finally { await srv.stop(); }
  }, T);

  test.skipIf(!pgAvailable)("OBS-05: a WS ticket issued before a role is taken away does not open a socket after it", async () => {
    const url = await testDb();
    const sql = new SQL(url);
    const k = await accessKeys();
    const now = Math.floor(Date.now() / 1000);
    await sql`insert into platform.staff_roles (email, role, app_id, granted_by) values ('rev@example.org', 'reviewer', null, 'test')`;
    const srv = await createServer({ port: 0, development: false, trustCfAccess: true, roles: "", cfAccess: { team: "ntwrk", aud: AUD, fetch: k.fetch }, staffRolesUrl: url, staffRolesEveryMs: 100, socketCheckMs: 60_000, audit: { dir: join(dir, "audit-ws5") }, lab: { dir: join(dir, "lab-ws5") }, game: { seed: 1, pushMs: 50, tickMs: 3_600_000 } });
    try {
      const jwt = await k.sign({ aud: [AUD], iss: ISS, email: "rev@example.org", iat: now - 30, exp: now + 3600 });
      const ticket = await wsTicket(srv.url, jwt);
      expect(await upgradeStatus(`${srv.url}/ws?ticket=${await wsTicket(srv.url, jwt)}`)).toBe(101);
      await sql`delete from platform.staff_roles where email = 'rev@example.org'`;
      await sleep(600);
      expect(await upgradeStatus(`${srv.url}/ws?ticket=${ticket}`)).toBe(403);
      expect(await upgradeStatus(`${srv.url}/ws`, { "cf-access-jwt-assertion": jwt })).toBe(403);
    } finally { await srv.stop(); await sql.close(); await dropTestDb(); }
  }, T);

  test.skipIf(!pgAvailable)("OBS-05: an SSO socket closes when its role is taken away in platform.staff_roles (4403)", async () => {
    const url = await testDb();
    const sql = new SQL(url);
    const k = await accessKeys();
    const now = Math.floor(Date.now() / 1000);
    await sql`insert into platform.staff_roles (email, role, app_id, granted_by) values ('rev@example.org', 'reviewer', null, 'test')`;
    const srv = await createServer({ port: 0, development: false, trustCfAccess: true, roles: "", cfAccess: { team: "ntwrk", aud: AUD, fetch: k.fetch }, staffRolesUrl: url, staffRolesEveryMs: 100, socketCheckMs: 100, audit: { dir: join(dir, "audit-ws3") }, lab: { dir: join(dir, "lab-ws3") }, game: { seed: 1, pushMs: 50, tickMs: 3_600_000 } });
    try {
      const s = openSocket(`${srv.url.replace("http", "ws")}/ws`, { "cf-access-jwt-assertion": await k.sign({ aud: [AUD], iss: ISS, email: "rev@example.org", iat: now - 30, exp: now + 3600, amr: ["mfa"] }) });
      await s.open;
      await sleep(300);
      expect(s.closed()).toBeUndefined();
      await sql`delete from platform.staff_roles where email = 'rev@example.org'`;
      expect(await within(s.done, 5000)).toBe(WS_FORBIDDEN);
    } finally { await srv.stop(); await sql.close(); await dropTestDb(); }
  }, T);
});

describe("tokens, Access keys and the lab (OBS-11)", () => {
  test("staff tokens are at least 32 characters on a server", async () => {
    expect(() => parseTokenGrants("admin:short", { minLength: 32 })).toThrow("shorter than 32");
    expect(parseTokenGrants(`admin:${long("x")}`, { minLength: 32 }).size).toBe(1);
    await expect(createServer({ port: 0, development: false, tokens: "admin:short-token", audit: { dir: join(dir, "audit-short") }, lab: { dir: join(dir, "lab-short") }, game: { seed: 1, pushMs: 3_600_000, tickMs: 3_600_000 } })).rejects.toThrow("shorter than 32");
  });

  test("Access certs: a hung request fails within the timeout; a failed refetch keeps the last keys for a while (stale grace)", async () => {
    const k = await accessKeys();
    const now0 = Math.floor(Date.now() / 1000);
    const claims = { aud: [AUD], iss: ISS, email: "ana@example.org", iat: now0 - 30, exp: now0 + 3600 };
    const hung = new AccessVerifier({ team: "ntwrk", aud: AUD, timeoutMs: 200, fetch: () => new Promise<Response>(() => {}) });
    const t0 = Date.now();
    expect(await hung.verify(await k.sign(claims))).toEqual({ error: expect.stringContaining("timed out") });
    expect(Date.now() - t0).toBeLessThan(2000);
    let clock = Date.now(), up = true;
    const v = new AccessVerifier({ team: "ntwrk", aud: AUD, cacheMs: 60_000, staleMs: 600_000, now: () => clock, fetch: async u => { if (!up) throw new Error("down"); return k.fetch(u); } });
    expect(await v.verify(await k.sign(claims))).toMatchObject({ email: "ana@example.org" });
    up = false;
    clock += 120_000; // past the cache: the refetch fails, the old keys still verify
    expect(await v.verify(await k.sign(claims))).toMatchObject({ email: "ana@example.org" });
    clock += 3_600_000; // past the grace: refused
    expect(await v.verify(await k.sign(claims))).toEqual({ error: expect.stringContaining("signing keys unavailable") });
  });

  test("lab: children get no secrets; the queue is capped", async () => {
    const env = labEnv({ PATH: "/bin", HOME: "/h", OPENAI_API_KEY: "sk-x", SURPLUS_API_KEY: "y", DATABASE_URL: "postgres://x", OBSERVATORY_TOKENS: "admin:z", LIVE_TESTS: "1", NETWORK_SERVICE_TOKEN: "t" });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h" });
    const script = join(dir, "slow-arm.mts");
    await writeFile(script, "import { setTimeout } from 'node:timers/promises'; await setTimeout(5000); console.log(JSON.stringify({ results: [] }));");
    const lab = new Lab({ dir: join(dir, "lab-cap"), script, concurrency: 1 });
    try {
      for (let i = 0; i < LAB_LIMITS.maxQueued / 5; i++) await lab.start({ arms: ["consent"], seeds: [1, 2, 3, 4, 5], days: 1 }, "tester");
      expect(lab.queued).toBe(LAB_LIMITS.maxQueued - 1); // one is running
      await lab.start({ arms: ["consent"], seeds: [1], days: 1 }, "tester");
      await expect(lab.start({ arms: ["consent"], seeds: [1], days: 1 }, "tester")).rejects.toThrow("queue is full");
    } finally {
      await lab.dispose();
      expect(lab.running).toBe(0);
    }
  });

  test("lab: disposal prevents a seed waiting on its first save from starting", async () => {
    const script = join(dir, "disposed-arm.mts");
    const started = join(dir, "disposed-arm-started");
    await writeFile(script, `import { writeFile } from 'node:fs/promises';
      await writeFile(${JSON.stringify(started)}, 'started');
      console.log(JSON.stringify({ results: [] }));`);
    const lab = new Lab({ dir: join(dir, "lab-dispose"), script });
    const run = await lab.start({ arms: ["consent"], seeds: [1], days: 1 }, "tester");
    await lab.dispose();

    expect(lab.running).toBe(0);
    await expect(readFile(started)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await lab.get(run.id)).toMatchObject({ status: "failed", error: "the server stopped before the run finished" });
  });
});
