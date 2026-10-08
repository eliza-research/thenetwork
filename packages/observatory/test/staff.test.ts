// Staff access on the server (docs/admin-console.md section 4): role tokens and the old admin token,
// Cloudflare Access SSO, per-command and per-route role checks, the reviewer of record, the per-member
// PII reveal, the audit log (written before data is returned), the production switch
// (OBSERVATORY_REAL_ONLY) and the simulation lab.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY } from "@thenetwork/core";
import { Lab, resultsOf, validateLab } from "../src/lab.ts";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import { AccessVerifier } from "../src/staff.ts";
import { HIDDEN_MESSAGE } from "../src/sources/real.ts";
import type { AuditEntry, ConfigInfo, LabRun, MemberDetail, MemberTimeline, ObsState, OpportunityDetail, SafetyInfo, StaffUser } from "../src/types.ts";

const T = 300_000;
const TOK = { admin: "adm-7c1e", reviewer: "rev-2b9d", safety: "saf-55aa", analyst: "ana-0f3c", legacy: "old-admin-9911" };
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
    game: { seed: 1, review: "human", pushMs: 3_600_000, tickMs: 3_600_000 },
  });
  base = obs.url;
  expect((await control(TOK.admin, { type: "step", ms: DAY })).status).toBe(200);
}, T);
afterAll(async () => { await obs?.stop(); await rm(dir, { recursive: true, force: true }); });

describe("staff roles, audit and PII reveal", () => {
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
    const item = s.opportunities.find(o => o.state === "IN_REVIEW")!;
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
    expect(await code(TOK.reviewer, "/api/control", { type: "review_mode", mode: "auto" })).toBe(403);
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

  test("matching switch and config history: admin only, with the staff id", async () => {
    const admin = ((await (await as(TOK.admin, "/api/me")).json()) as StaffUser).id;
    expect((await control(TOK.admin, { type: "matching", on: false })).status).toBe(200);
    expect((await control(TOK.admin, { type: "matching", on: true })).status).toBe(200);
    const cfg = (await (await as(TOK.analyst, "/api/config")).json()) as ConfigInfo;
    expect(cfg.history.map(h => [h.key, h.to, h.actor])).toEqual([["matching", false, admin], ["matching", true, admin]]);
  }, T);

  test("PII reveal: safety or admin, with a reason, at most 15 minutes; audited before data; staff access shown on the member", async () => {
    const s = (await (await as(TOK.analyst, "/api/state")).json()) as ObsState;
    const m = s.members.find(x => x.joined)!;
    expect((await post(TOK.safety, "/api/reveal", { memberId: m.id, reason: "x" })).status).toBe(400);
    expect((await post(TOK.safety, "/api/reveal", { memberId: "nobody", reason: "checking a report" })).status).toBe(404);
    const g = await (await post(TOK.safety, "/api/reveal", { memberId: m.id, reason: "checking a safety report", minutes: 90 })).json() as { ok: boolean; until: number; at: number };
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
    expect((await control(TOK.admin, { type: "review_mode", mode: "auto" })).status).toBe(200);
    expect((await control(TOK.admin, { type: "step", ms: 2 * DAY })).status).toBe(200);
    let checked = 0;
    for (const o of (await state(TOK.analyst)).opportunities) {
      const read = async (tok: string) => (await (await as(tok, `/api/opportunity/${encodeURIComponent(o.id)}`)).json()) as OpportunityDetail;
      const saf = (await read(TOK.safety)).messages.filter(m => m.direction === "inbound" && !m.system);
      if (!saf.length) continue;
      const ana = (await read(TOK.analyst)).messages.filter(m => m.direction === "inbound" && !m.system);
      expect(ana.map(m => [m.body, m.hiddenLength])).toEqual(saf.map(m => [HIDDEN_MESSAGE, m.body.length]));
      if (++checked >= 3) break;
    }
    expect(checked).toBeGreaterThan(0);
  }, T);
});

describe("SSO and the production switch", () => {
  test("Cloudflare Access: the JWT is verified (signature, audience, issuer, expiry, issue time) before the email is trusted", async () => {
    const k = await accessKeys();
    const now = Math.floor(Date.now() / 1000);
    const claims = (email: string, more: Record<string, unknown> = {}) => ({ aud: [AUD], iss: ISS, email, iat: now - 30, exp: now + 3600, type: "app", ...more });
    // Unit: each check refuses on its own; the keys are fetched once and cached.
    const v = new AccessVerifier({ team: "ntwrk", aud: AUD, fetch: k.fetch });
    expect(v.certsUrl).toBe("https://ntwrk.cloudflareaccess.com/cdn-cgi/access/certs");
    expect(await v.verify(await k.sign(claims("Rev@Example.org")))).toEqual({ email: "rev@example.org" });
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
      expect(k.calls()).toBe(3); // one fetch per verifier: the two above, then the server's, once for all its requests
    } finally { await sso.stop(); }
    // Not enabled: the headers mean nothing.
    expect((await fetch(base + "/api/me", { headers: { "cf-access-authenticated-user-email": "ana@example.org", "cf-access-jwt-assertion": await k.sign(claims("ana@example.org")) } })).status).toBe(401);
  }, T);

  test("OBSERVATORY_REAL_ONLY: no game mode, no game controls, no lab", async () => {
    const prod = await createServer({ port: 0, development: false, realOnly: true, token: "prod-admin", audit: { dir: join(dir, "audit-prod") }, lab: { dir: join(dir, "lab-prod") }, real: { url: undefined, pollMs: 3_600_000 } });
    try {
      const h = { authorization: "Bearer prod-admin", "content-type": "application/json" };
      expect(prod.mode()).toBe("real");
      const st = (await (await fetch(prod.url + "/api/state", { headers: h })).json()) as ObsState;
      expect(st.env).toMatchObject({ mode: "real", realOnly: true });
      expect((await fetch(prod.url + "/api/mode", { method: "POST", headers: h, body: JSON.stringify({ mode: "game" }) })).status).toBe(403);
      for (const type of ["play", "step", "propose", "reset", "review_mode", "god"]) {
        const r = await fetch(prod.url + "/api/control", { method: "POST", headers: h, body: JSON.stringify({ type, ms: 1 }) });
        expect([type, r.status, (await r.json()).code]).toEqual([type, 403, "real_only"]);
      }
      expect(await (await fetch(prod.url + "/api/levels", { headers: h })).json()).toEqual([]);
      expect((await fetch(prod.url + "/api/lab/run", { method: "POST", headers: h, body: JSON.stringify({ arms: ["consent"], seeds: [1], days: 1 }) })).status).toBe(403);
      await expect(prod.source("game")).rejects.toThrow("OBSERVATORY_REAL_ONLY");
    } finally { await prod.stop(); }
  }, T);
});

describe("simulation lab", () => {
  test("requests are validated; at most 2 children run at once; results are parsed and saved", async () => {
    expect(validateLab({ arms: ["consent"], seeds: [1], days: 0 })).toContain("days");
    expect(validateLab({ arms: ["bogus"], seeds: [1], days: 3 })).toContain("arms");
    expect(validateLab({ arms: ["consent"], seeds: [1, 2, 3, 4, 5, 6], days: 3 })).toContain("seeds");
    // A stand-in child: waits, logs a line, then prints indented JSON the way experiment.ts does (no judge fields).
    const script = join(dir, "fake-arm.ts");
    await writeFile(script, `await Bun.sleep(600); const seed = Number(process.argv[process.argv.indexOf("--seed") + 1]);
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
    while (done.status === "queued" || done.status === "running") { peak = Math.max(peak, lab.running); await Bun.sleep(25); done = (await lab.get(run.id))!; }
    expect(peak).toBe(2);
    expect(done.status).toBe("failed"); // seed 3 failed
    expect(done.error).toContain("seed 3: exit 2");
    expect(done.results.map(r => [r.seed, r.meetings, r.everyoneYes, r.judgeInvariants])).toEqual([[1, 1, 0.5, null], [2, 2, 0.5, null], [4, 4, 0.5, null]]);
    const saved = JSON.parse(await readFile(done.file, "utf8")) as LabRun;
    expect(saved.results.length).toBe(3);
    // A new Lab on the same folder loads it again.
    expect((await new Lab({ dir: join(dir, "lab-fake"), script }).list()).map(r => r.id)).toEqual([run.id]);
  }, T);

  test("a real one-day consent run over HTTP reports the judge counts (all 0)", async () => {
    const res = await post(TOK.analyst, "/api/lab/run", { arms: ["consent"], seeds: [1], days: 1 });
    expect(res.status).toBe(200);
    const { run } = (await res.json()) as { run: LabRun };
    let cur = run;
    for (let i = 0; i < 1200 && (cur.status === "queued" || cur.status === "running"); i++) {
      await Bun.sleep(250);
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
