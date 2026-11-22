import { expect, test } from "vitest";
import { SimClock } from "@thenetwork/core";
import { serveHttp } from "../../core/src/runtime/http.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { NetworkService } from "../../network/service/service.ts";
import { createServer } from "../src/server.ts";
import type { AuditEntry } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const PLAN = "0b6c2c2e-8a4e-4a39-9d53-0f9a5d2c7e11";
const REQUEST = "5d0c1f2a-3b4c-4d5e-8f60-718293a4b5c6";

test.skipIf(!pgAvailable)("console staff steps carry the signed-in person to the staff API, and the staff API refuses a shared token", async () => {
  const url = await testDb();
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 2, 16));
  const consoleToken = "fixture-console-service-token-0001", rawToken = "fixture-shared-peon-admin-token-01";
  const network = new NetworkService({ url, clock, photoStorage: null, notify: false, log: () => {},
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off" },
    networks: [{ id: "ntwrk:nyc", matchingEnabled: false }, { id: "peon:nyc", matchingEnabled: false }, { id: "slop:nyc", matchingEnabled: false }],
    tokens: `admin@*:${consoleToken},admin@peon:${rawToken}`, consoleToken,
  });
  const delegated: Array<{ method: string; path: string; actor: string | null; status: number }> = [];
  const audit: AuditEntry[] = [];
  const auditAt: number[] = [];
  const peonAdmin = "fixture-peon-admin", peonSafety = "fixture-peon-safety", peonReviewer = "fixture-peon-reviewer";
  const slopReviewer = "fixture-slop-reviewer", globalAdmin = "fixture-global-admin", ntwrkAdmin = "fixture-ntwrk-admin";
  let http: Awaited<ReturnType<typeof serveHttp>> | undefined;
  let consoleServer: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    await network.start();
    http = await serveHttp({ hostname: "127.0.0.1", port: 0, fetch: async req => {
      const answer = await network.fetch(req);
      if (new URL(req.url).pathname !== "/health") delegated.push({ method: req.method, path: new URL(req.url).pathname, actor: req.headers.get("x-network-staff-id"), status: answer.status });
      return answer;
    } });
    const observatory = consoleServer = await createServer({ hostname: "127.0.0.1", port: 0, mode: "real", realOnly: true, platformEnv: "dev",
      tokens: [`admin@peon:${peonAdmin}`, `safety@peon:${peonSafety}`, `reviewer@peon:${peonReviewer}`, `reviewer@slop:${slopReviewer}`,
        `admin@*:${globalAdmin}`, `admin@ntwrk:${ntwrkAdmin}`].join(","), minTokenLength: 10,
      staffRolesUrl: false, peopleUrl: false,
      real: { url, service: { url: http.url.href, token: consoleToken } },
      audit: { kind: "file", async write(entry) { audit.push(entry); auditAt.push(delegated.length); }, async list() { return audit; }, async close() {} },
    });
    const api = (path: string, token: string | null, body?: object, extra: Record<string, string> = {}) => fetch(new URL(path, observatory.url), {
      method: body ? "POST" : "GET",
      headers: { "x-observatory-mode": "real", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}), ...extra },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const idOf = async (token: string) => (await (await api("/api/me", token)).json()).id as string;
    const reason = "support ticket 4411 checked";

    const steps: Array<{ token: string; path: string; body?: object; service: string; action: string; targetId?: string }> = [
      { token: peonReviewer, path: "/api/staff/postings?app=peon&managerId=m-1", service: "/postings", action: "step_read_postings" },
      { token: peonAdmin, path: "/api/staff/postings?app=peon", body: { managerId: "m-1", must: [], nice: [] }, service: "/postings", action: "step_save_posting" },
      { token: peonAdmin, path: "/api/staff/postings/post-1/close?app=peon", body: { reason: "filled" }, service: "/postings/post-1/close", action: "step_close_posting", targetId: "post-1" },
      { token: peonAdmin, path: "/api/staff/employers/m-1/verify?app=peon", body: { company: "Acme", note: "registry checked" }, service: "/employers/m-1/verify", action: "step_verify_employer", targetId: "m-1" },
      { token: peonSafety, path: "/api/staff/home-help?app=peon", service: "/safety/home-help", action: "step_read_home_help" },
      { token: peonSafety, path: `/api/staff/home-help/${PLAN}?app=peon`, body: { action: "close", revision: 1 }, service: `/safety/home-help/${PLAN}`, action: "step_decide_home_help", targetId: PLAN },
      { token: peonReviewer, path: "/api/staff/member-invitations?app=peon", service: "/review/member-invitations", action: "step_read_member_invitations" },
      { token: peonSafety, path: "/api/staff/member-invitations?app=peon", body: { id: "inv-1", decision: "deny" }, service: "/review/member-invitations", action: "step_decide_member_invitation" },
      { token: ntwrkAdmin, path: "/api/staff/invite/seed?app=ntwrk", body: {}, service: "/apps/ntwrk/invite/seed", action: "step_seed_invitations" },
      { token: peonSafety, path: "/api/staff/members/m-1/verify?app=peon", body: { check: "age", result: "pass", note: "document checked" }, service: "/members/m-1/verify", action: "step_verify_member", targetId: "m-1" },
      { token: ntwrkAdmin, path: "/api/staff/invite?app=ntwrk", body: { phone: "+12125550142" }, service: "/invite", action: "step_invite_member" },
      { token: peonReviewer, path: "/api/staff/signals?app=peon", service: "/signals", action: "step_read_agent_signals" },
      { token: peonSafety, path: "/api/staff/signals/sig-1?app=peon", body: { decision: "dismiss", reason }, service: "/signals/sig-1", action: "step_decide_agent_signal", targetId: "sig-1" },
      { token: globalAdmin, path: "/api/staff/privacy/requests", body: { reason }, service: "/privacy/requests", action: "step_open_privacy_request" },
      { token: globalAdmin, path: `/api/staff/privacy/requests/${REQUEST}/confirm`, body: { reason }, service: `/privacy/requests/${REQUEST}/confirm`, action: "step_confirm_privacy_request", targetId: REQUEST },
      { token: globalAdmin, path: "/api/staff/privacy/replay", body: { reason }, service: "/privacy/replay", action: "step_replay_privacy" },
      { token: globalAdmin, path: "/api/staff/inbound/resolve", body: { id: "msg:blooio:never-stuck" }, service: "/inbound/resolve", action: "step_resolve_inbound_turn" },
      { token: globalAdmin, path: "/api/staff/turn-watch", service: "/ops/turns", action: "step_read_turn_watch" },
    ];
    for (const s of steps) {
      const person = await idOf(s.token);
      const before = delegated.length, auditBefore = audit.length;
      const answer = await api(s.path, s.token, s.body);
      expect([401, 403], `${s.path} answered ${answer.status}`).not.toContain(answer.status);
      const sent = delegated.slice(before);
      expect(sent.map(row => [row.path, row.actor]), s.path).toEqual([[s.service, person]]);
      const rows = audit.slice(auditBefore).map((row, i) => ({ row, forwards: auditAt[auditBefore + i] })).filter(r => r.row.action === s.action);
      expect(rows.map(r => [r.row.actor, r.row.detail?.phase ?? null, r.forwards, r.row.targetId ?? null]), s.path).toEqual(s.body
        ? [[person, "requested", before, s.targetId ?? null], [person, "result", before + 1, s.targetId ?? null]]
        : [[person, null, before, s.targetId ?? null]]);
      expect(rows[0]!.row).toMatchObject({ app: expect.any(String), ok: true });
    }
    const resolved = await api("/api/staff/inbound/resolve", globalAdmin, { id: "msg:blooio:never-stuck" });
    expect([resolved.status, await resolved.json()]).toEqual([409, { ok: false, reason: "not_stuck" }]);
    const watch = await api("/api/staff/turn-watch", globalAdmin);
    expect([watch.status, await watch.json()]).toEqual([200, { ok: true, conditions: expect.any(Array) }]);
    expect((await sql`select count(*)::int as n from network.staff_audit where action = 'read_turn_watch' and actor = ${await idOf(globalAdmin)}`)[0]).toEqual({ n: 2 });
    expect(audit.filter(row => row.action === "step_resolve_inbound_turn").map(row => [row.detail?.phase, row.ok]))
      .toEqual([["requested", true], ["result", false], ["requested", true], ["result", false]]);
    const replay = audit.filter(row => row.action === "step_replay_privacy");
    expect(replay.map(row => [row.actor, row.detail?.phase, row.ok])).toEqual([[await idOf(globalAdmin), "requested", true], [await idOf(globalAdmin), "result", true]]);

    const people = await Promise.all([peonAdmin, peonSafety, peonReviewer, globalAdmin, ntwrkAdmin].map(idOf));
    const serviceActors = (await sql`select distinct actor from network.staff_audit order by actor`).map((row: any) => row.actor as string);
    expect(serviceActors.length).toBeGreaterThan(0);
    expect(serviceActors.every(actor => people.includes(actor)), serviceActors.join(",")).toBe(true);
    expect((await sql`select actor from network.staff_audit where action = 'verify_employer'`).map((row: any) => row.actor)).toEqual([await idOf(peonAdmin)]);
    expect((await sql`select distinct actor from network.staff_audit where action = 'privacy_replay'`).map((row: any) => row.actor)).toEqual([await idOf(globalAdmin)]);

    const verify = "/api/staff/employers/m-1/verify?app=peon", decision = { company: "Acme", note: "registry checked" };
    const quiet = delegated.length;
    expect((await api(verify, null, decision)).status).toBe(401);
    expect((await api(verify, peonSafety, decision)).status).toBe(403);
    expect((await api(verify, peonReviewer, decision)).status).toBe(403);
    expect((await api(verify, slopReviewer, decision)).status).toBe(403);
    expect((await api("/api/staff/postings?app=peon", slopReviewer)).status).toBe(403);
    expect((await api("/api/staff/signals?app=peon", slopReviewer)).status).toBe(403);
    expect((await api("/api/staff/employers/m-1/verify?app=slop", globalAdmin, decision)).status).toBe(403);
    expect((await api("/api/staff/privacy/replay", peonAdmin, { reason })).status).toBe(403);
    expect((await api("/api/staff/privacy/replay", ntwrkAdmin, { reason })).status).toBe(403);
    expect((await api("/api/staff/inbound/resolve?app=ntwrk", ntwrkAdmin, { id: "msg:blooio:never-stuck" })).status).toBe(403);
    expect((await api("/api/staff/turn-watch?app=peon", peonAdmin)).status).toBe(403);
    expect((await api("/api/staff/home-help?app=peon", peonAdmin.replace("admin", "nobody"))).status).toBe(401);
    expect(delegated.length).toBe(quiet);
    expect(audit.filter(row => row.action === "step_verify_employer" && row.detail?.refused === "forbidden").length).toBe(4);

    const forged = await api(verify, peonAdmin, decision, { "x-network-staff-id": "mallory@example.org" });
    expect(forged.status).toBe(409);
    expect(delegated.at(-1)).toMatchObject({ path: "/employers/m-1/verify", actor: await idOf(peonAdmin) });
    expect((await sql`select count(*)::int as n from network.staff_audit where actor = 'mallory@example.org'`)[0]).toEqual({ n: 0 });

    const direct = (token: string, staff?: string) => network.fetch(new Request("http://127.0.0.1/employers/m-1/verify?app=peon", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(staff ? { "x-network-staff-id": staff } : {}) }, body: JSON.stringify(decision),
    }));
    for (const answer of [await direct(rawToken), await direct(rawToken, "mallory@example.org"), await direct(consoleToken)]) {
      expect(answer.status).toBe(403);
      expect(await answer.json()).toMatchObject({ ok: false, code: "named_reviewer_required" });
    }
    const decisions: Array<[string, object]> = [
      ["/review/opp-never-queued", { decision: "approve", revision: 0 }],
      ["/safety/hold", { memberId: "m-1", note: "report checked" }],
      ["/safety/ban", { memberId: "m-1", by: "person", note: "report checked" }],
      ["/safety/dismiss", { reportId: "r-1", note: "report checked" }],
      ["/safety/lift", { memberId: "m-1", note: "report checked" }],
      ["/safety/close", { caseId: "sc-1", note: "report checked" }],
      ["/safety/clear-minor", { memberId: "m-1", note: "age checked by staff" }],
    ];
    const decide = (path: string, payload: object, token: string, staff?: string) => network.fetch(new Request(`http://127.0.0.1${path}?app=peon`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(staff ? { "x-network-staff-id": staff } : {}) }, body: JSON.stringify(payload),
    }));
    for (const [path, payload] of decisions) {
      for (const answer of [await decide(path, payload, rawToken), await decide(path, payload, rawToken, "mallory@example.org"), await decide(path, payload, consoleToken)]) {
        expect([path, answer.status, (await answer.json()).code]).toEqual([path, 403, "named_reviewer_required"]);
      }
      const named = await decide(path, payload, consoleToken, "ops.lead@example.org");
      expect([path, named.status === 403 ? (await named.json()).code : "admitted"]).toEqual([path, "admitted"]);
    }
    const relay = await network.fetch(new Request("http://127.0.0.1/staff/relay/held?app=peon", { headers: { authorization: `Bearer ${rawToken}` } }));
    expect(relay.status).toBe(403);
    expect((await direct(consoleToken, "ops.lead@example.org")).status).toBe(409);
    const finalActors = (await sql`select distinct actor from network.staff_audit`).map((row: any) => row.actor as string);
    expect(finalActors.filter(actor => !people.includes(actor))).toEqual(["ops.lead@example.org"]);

    const lonelyAudit: AuditEntry[] = [];
    const lonely = await createServer({ hostname: "127.0.0.1", port: 0, mode: "real", realOnly: true, platformEnv: "dev",
      tokens: `admin@*:${globalAdmin}`, minTokenLength: 10, staffRolesUrl: false, peopleUrl: false,
      real: { url, service: false },
      audit: { kind: "file", async write(entry) { lonelyAudit.push(entry); }, async list() { return lonelyAudit; }, async close() {} },
    });
    try {
      const unserved = await fetch(new URL("/api/staff/invite?app=ntwrk", lonely.url), { method: "POST",
        headers: { "x-observatory-mode": "real", authorization: `Bearer ${globalAdmin}`, "content-type": "application/json" }, body: JSON.stringify({ phone: "+12125550143" }) });
      expect([unserved.status, (await unserved.json()).code]).toEqual([503, "read_only"]);
      expect(lonelyAudit.filter(row => row.action === "step_invite_member")).toEqual([]);
    } finally { await lonely.stop(); }
  } finally {
    await consoleServer?.stop();
    await http?.stop(true);
    await network.close();
    await sql.close();
    await dropTestDb();
  }
}, 120_000);
