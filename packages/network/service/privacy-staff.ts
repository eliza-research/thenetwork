// Export and erasure requests sent to help@ntwrk.party (Story F24), and the privacy replay after a restore,
// on the staff port. The decisions are generated; this file reads requests, writes the request record and the
// audit rows, and calls the member's own export and account erasure.
// spec/accountPrivacy.md, "Story: Staff carry out an export or erasure request sent to support"
// spec/databaseRestore.md, "Story: Carry privacy changes made after the backup into the restored database"
import { randomUUID } from "node:crypto";
import {
  privacySupportAllowed, privacySupportDecision, privacySupportExportApps, privacySupportScopeAllowed,
  type PrivacySupportDecision, type PrivacySupportOperation, type PrivacySupportScope,
} from "../../core/src/generated/accountPrivacy.ts";
import { APP_IDS, isAppId, type AppId } from "../../platform/src/apps.ts";
import { maskPhone, normalizePhone } from "../../platform/src/phone.ts";
import { globalRolesFor } from "../../observatory/src/staff.ts";
import type { AuditEntry, StaffUser } from "../../observatory/src/types.ts";
import type { NetworkService } from "./service.ts";

const REQUESTS = "/privacy/requests";
const REPLAY = "/privacy/replay";
const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/;

type Body = Record<string, unknown>;
interface SupportRequestRow {
  id: string; operation: "export" | "erase"; app_id: AppId; scope: "app" | "all"; phone_hash: string;
  person_id: string | null; created_at: Date; completed_at: Date | null; outcome: "exported" | "erased" | null;
}
interface ReplayRow { id: string; kind: "erase" | "leave" | "ban"; person_id: string; app_id: AppId | null; member_id: string | null }

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function readBody(req: Request): Promise<Body | undefined> {
  if (req.method !== "POST") return undefined;
  const parsed: unknown = await req.json().catch(() => undefined);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Body : undefined;
}

const OPERATIONS: Record<string, PrivacySupportOperation> = { export: "SupportExport", erase: "SupportErase" };
const SCOPES: Record<string, PrivacySupportScope> = { app: "SupportOneApp", all: "SupportEveryApp" };
const operationName = (o: PrivacySupportOperation) => (o === "SupportErase" ? "erase" : "export");
const scopeName = (s: PrivacySupportScope) => (s === "SupportEveryApp" ? "all" : "app");

/** The answer to a confirm that the decision refused. */
const REFUSALS: Record<Exclude<PrivacySupportDecision, "SupportProceeds" | "SupportAlreadyDone">, [string, number]> = {
  SupportUnavailable: ["request_unavailable", 404],
  SupportTargetChanged: ["target_changed", 409],
  SupportCodeRefused: ["code_refused", 403],
};

/** The staff privacy routes, or undefined for any other path. `user` is authenticated by the staff port. */
export async function handlePrivacyStaff(svc: NetworkService, req: Request, path: string, user: StaffUser): Promise<Response | undefined> {
  const confirm = path.match(/^\/privacy\/requests\/([^/]+)\/confirm$/);
  if (path !== REQUESTS && path !== REPLAY && !confirm) return undefined;
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const body = await readBody(req);
  if (!body) return json({ ok: false, error: "invalid_body" }, 400);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const roles = globalRolesFor(user);
  // spec/accountPrivacy.md, "Only a global admin with a stated reason opens or confirms a support request"
  if (!privacySupportAllowed(roles, reason.length)) {
    return roles.includes("admin") ? json({ ok: false, error: "reason_required" }, 400) : json({ ok: false, code: "forbidden", error: "needs role admin@*" }, 403);
  }
  if (path === REPLAY) return replay(svc, user, reason);
  const e164 = normalizePhone(body.phone);
  if (!e164) return json({ ok: false, error: "phone_required" }, 400);
  if (confirm) return confirmRequest(svc, user, reason, confirm[1]!, e164, body);
  return startRequest(svc, user, reason, e164, body);
}

/** One audit row before a step and one after it: an action is never left without its result row. */
async function audited(svc: NetworkService, user: StaffUser, entry: Pick<AuditEntry, "action" | "targetId" | "reason" | "detail">, run: () => Promise<{ ok: boolean; detail?: Record<string, unknown>; response: Response }>): Promise<Response> {
  const base = { actor: user.id, roles: user.roles, mode: "real" as const, targetType: "person" as const, ...entry };
  await svc.audit.write({ ...base, at: svc.clock.now(), ok: true, detail: { ...entry.detail, phase: "requested" } });
  let result: Awaited<ReturnType<typeof run>>;
  try { result = await run(); } catch (error) {
    await svc.audit.write({ ...base, at: svc.clock.now(), ok: false, detail: { ...entry.detail, phase: "result", failed: true } });
    throw error;
  }
  await svc.audit.write({ ...base, at: svc.clock.now(), ok: result.ok, detail: { ...entry.detail, ...result.detail, phase: "result" } });
  return result.response;
}

// spec/accountPrivacy.md, "A support export covers one app or every app, and an erasure covers every app"
async function startRequest(svc: NetworkService, user: StaffUser, reason: string, e164: string, body: Body): Promise<Response> {
  const operation = typeof body.operation === "string" ? OPERATIONS[body.operation] : undefined;
  const scope = typeof body.scope === "string" ? SCOPES[body.scope] : operation === "SupportErase" ? "SupportEveryApp" : undefined;
  if (!operation || !scope || !isAppId(body.app)) return json({ ok: false, error: "operation_scope_and_app_required" }, 400);
  if (!privacySupportScopeAllowed(operation, scope)) return json({ ok: false, error: "erase_covers_every_app" }, 400);
  const app = body.app;
  const phoneHash = svc.accounts.phoneHash(e164);
  return audited(svc, user, { action: "privacy_request", targetId: phoneHash.slice(0, 16), reason, detail: { operation: operationName(operation), scope: scopeName(scope), app } }, async () => {
    if (await svc.accounts.held(e164)) return { ok: false, detail: { refused: "held" }, response: json({ ok: false, error: "phone_held" }, 409) };
    const person = await svc.accounts.personFor(e164);
    const id = randomUUID();
    await svc.sql`insert into platform.privacy_requests (id, operation, app_id, scope, phone_hash, person_id, requested_by, created_at)
      values (${id}::uuid, ${operationName(operation)}, ${app}, ${scopeName(scope)}, ${phoneHash}, ${person?.id ?? null}::uuid, ${user.id}, ${new Date(svc.clock.now())})`;
    // The person reads this code back to support: it proves that the writer holds the number.
    const sent = await svc.publicApi.otp.start(svc.apps[app], e164, `staff:${user.id}`);
    if (!sent.ok) return { ok: false, detail: { request: id, refused: "rate_limited" }, response: json({ ok: false, error: "rate_limited", retryAfterMs: sent.retryAfterMs }, 429) };
    const memberships = person ? (await svc.people.memberships(person.id)).filter(m => m.state !== "removed").map(m => ({ app: m.app, state: m.state })) : [];
    return { ok: true, detail: { request: id }, response: json({ ok: true, requestId: id, personId: person?.id ?? null, phone: maskPhone(e164), memberships, codeSent: true }) };
  });
}

// spec/accountPrivacy.md, "Staff act only on the confirmed person after a fresh code from the number";
// "A support request runs the member's own export or account erasure"
async function confirmRequest(svc: NetworkService, user: StaffUser, reason: string, id: string, e164: string, body: Body): Promise<Response> {
  if (!UUID.test(id)) return json({ ok: false, error: "request_unavailable" }, 404);
  const echoed = body.personId === null || typeof body.personId === "string" ? body.personId : undefined;
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (echoed === undefined) return json({ ok: false, error: "person_id_required" }, 400);
  return audited(svc, user, { action: "privacy_confirm", targetId: id, reason, detail: {} }, async () => {
    const [row] = await svc.sql<SupportRequestRow[]>`select id, operation, app_id, scope, phone_hash, person_id, created_at, completed_at, outcome
      from platform.privacy_requests where id = ${id}::uuid`;
    const now = svc.clock.now();
    const owner = (await svc.accounts.held(e164)) ? undefined : (await svc.accounts.personFor(e164))?.id ?? null;
    const facts = [
      !!row && row.phone_hash === svc.accounts.phoneHash(e164), !!row?.completed_at, row ? now - new Date(row.created_at).getTime() : -1,
      !!row && echoed === row.person_id, !!row && owner === row.person_id,
    ] as const;
    let decision = privacySupportDecision(...facts, true);
    if (decision === "SupportProceeds") decision = privacySupportDecision(...facts, await svc.publicApi.otp.verify(row!.app_id, e164, code, `staff:${user.id}`));
    if (decision === "SupportAlreadyDone") return { ok: true, detail: { already: row!.outcome }, response: json({ ok: true, outcome: row!.outcome, already: true }) };
    if (decision !== "SupportProceeds") {
      const [error, status] = REFUSALS[decision];
      return { ok: false, detail: { refused: error }, response: json({ ok: false, error }, status) };
    }
    const who = { e164, personId: row!.person_id };
    const complete = async (outcome: "exported" | "erased") => {
      await svc.sql`update platform.privacy_requests set completed_at = ${new Date(svc.clock.now())}, completed_by = ${user.id}, outcome = ${outcome}
        where id = ${id}::uuid and completed_at is null`;
    };
    if (row!.operation === "erase") {
      if (!(await svc.accounts.deleteAll(who))) return { ok: false, detail: { refused: "erasure_refused" }, response: json({ ok: false, error: "erasure_refused" }, 409) };
      await complete("erased");
      return { ok: true, detail: { outcome: "erased" }, response: json({ ok: true, outcome: "erased", personId: row!.person_id, phone: maskPhone(e164) }) };
    }
    const apps = privacySupportExportApps(SCOPES[row!.scope]!, row!.app_id, [...APP_IDS]).filter(isAppId);
    const exports: Record<string, unknown> = {};
    for (const app of apps) exports[app] = await svc.accounts.exportApp(svc.apps[app], who);
    await complete("exported");
    return { ok: true, detail: { outcome: "exported", apps }, response: json({ ok: true, outcome: "exported", personId: row!.person_id, phone: maskPhone(e164), exports }) };
  });
}

/** Run the erasures, leaves and bans that a restore queued (deploy/backup/privacy-replay.ts), each once. */
async function replay(svc: NetworkService, user: StaffUser, reason: string): Promise<Response> {
  return audited(svc, user, { action: "privacy_replay", targetId: "restore", reason, detail: {} }, async () => {
    const rows = await svc.sql<ReplayRow[]>`select id::text, kind, person_id::text, app_id, member_id from platform.privacy_replay
      where replayed_at is null order by case kind when 'erase' then 0 when 'leave' then 1 else 2 end, id`;
    const items: { kind: ReplayRow["kind"]; outcome: string }[] = [];
    for (const row of rows) {
      const outcome = await replayOne(svc, user, row);
      await svc.sql`update platform.privacy_replay set replayed_at = ${new Date(svc.clock.now())}, outcome = ${outcome}
        where id = ${row.id}::bigint and replayed_at is null`;
      items.push({ kind: row.kind, outcome });
    }
    return { ok: true, detail: { replayed: items.length }, response: json({ ok: true, items }) };
  });
}

async function replayOne(svc: NetworkService, user: StaffUser, row: ReplayRow): Promise<string> {
  const [phone] = await svc.sql<{ e164: string; hold: string | null }[]>`select e164, hold from platform.phone_identities
    where person_id = ${row.person_id}::uuid order by verified_at desc, e164 limit 1`;
  if (row.kind === "erase" || row.kind === "leave") {
    if (!phone) return "no_phone";
    if (phone.hold !== null) return "held";
    const who = { e164: phone.e164, personId: row.person_id };
    // spec/databaseRestore.md, "An erasure after the backup is replayed"
    if (row.kind === "erase") return (await svc.accounts.deleteAll(who)) ? "erased" : "refused";
    // spec/databaseRestore.md, "A leave after the backup is replayed"
    return (await svc.accounts.leave(svc.apps[row.app_id!], who, { expectedMemberId: row.member_id! })) ? "left" : "refused";
  }
  const [ban] = await svc.sql<{ scope: "phone" | "person" }[]>`select scope from platform.bans
    where projection_completed_at is null and (person_id = ${row.person_id}::uuid
      or phone_hash in (select phone_hash from platform.people where id = ${row.person_id}::uuid)) order by at, id limit 1`;
  if (!ban) return "projected";
  const member = (await svc.people.memberships(row.person_id)).find(m => m.state !== "removed" && m.state !== "invited");
  const rt = member && await svc.runtimeOfMember(member.app, member.memberId);
  if (!member || !rt) return "no_member";
  const resumed = await svc.ban(user, rt, member.memberId, ban.scope, "privacy replay after a restore");
  return resumed.ok ? "projected" : `refused:${(resumed as { reason?: string }).reason ?? "unknown"}`;
}
