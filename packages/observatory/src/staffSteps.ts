import { staffStepAdmitted, type StaffStep } from "../../core/src/generated/staffPermissions.ts";
import { readCappedText } from "../../platform/src/body.ts";
import type { AppId } from "./apps.ts";
import { globalRolesFor, rolesFor } from "./staff.ts";
import { isTimeout, serviceTimeout } from "./sources/service.ts";
import type { AuditEntry, Mode, StaffUser } from "./types.ts";

type Method = "GET" | "POST";
type Target = NonNullable<AuditEntry["targetType"]>;
type Routed = Request & { params: Record<string, string> };

interface ConsoleStep {
  step: StaffStep;
  method: Method;
  console: string;
  service: (id: string, app: AppId, revision: string) => string;
  action: string;
  target?: Target;
  query?: readonly string[];
}

const ID = /^(?!\.{1,2}$)[^\s/]{1,600}$/;
const REVISION = /^\d{1,9}$/;

export const CONSOLE_STAFF_STEPS: readonly ConsoleStep[] = [
  { step: "ReadPostings", method: "GET", console: "/api/staff/postings", service: () => "/postings", action: "step_read_postings", query: ["managerId"] },
  { step: "SavePosting", method: "POST", console: "/api/staff/postings", service: () => "/postings", action: "step_save_posting" },
  { step: "ClosePosting", method: "POST", console: "/api/staff/postings/:id/close", service: id => `/postings/${id}/close`, action: "step_close_posting", target: "case" },
  { step: "VerifyEmployer", method: "POST", console: "/api/staff/employers/:id/verify", service: id => `/employers/${id}/verify`, action: "step_verify_employer", target: "member" },
  { step: "ReadHomeHelp", method: "GET", console: "/api/staff/home-help", service: () => "/safety/home-help", action: "step_read_home_help" },
  { step: "DecideHomeHelp", method: "POST", console: "/api/staff/home-help/:id", service: id => `/safety/home-help/${id}`, action: "step_decide_home_help", target: "case" },
  { step: "ReadMemberInvitations", method: "GET", console: "/api/staff/member-invitations", service: () => "/review/member-invitations", action: "step_read_member_invitations" },
  { step: "DecideMemberInvitation", method: "POST", console: "/api/staff/member-invitations", service: () => "/review/member-invitations", action: "step_decide_member_invitation" },
  { step: "SeedInvitations", method: "POST", console: "/api/staff/invite/seed", service: (_id, app) => `/apps/${app}/invite/seed`, action: "step_seed_invitations" },
  { step: "VerifyMember", method: "POST", console: "/api/staff/members/:id/verify", service: id => `/members/${id}/verify`, action: "step_verify_member", target: "member" },
  { step: "InviteMember", method: "POST", console: "/api/staff/invite", service: () => "/invite", action: "step_invite_member" },
  { step: "ReadAgentSignals", method: "GET", console: "/api/staff/signals", service: () => "/signals", action: "step_read_agent_signals" },
  { step: "DecideAgentSignal", method: "POST", console: "/api/staff/signals/:id", service: id => `/signals/${id}`, action: "step_decide_agent_signal", target: "case" },
  { step: "OpenPrivacyRequest", method: "POST", console: "/api/staff/privacy/requests", service: () => "/privacy/requests", action: "step_open_privacy_request" },
  { step: "ConfirmPrivacyRequest", method: "POST", console: "/api/staff/privacy/requests/:id/confirm", service: id => `/privacy/requests/${id}/confirm`, action: "step_confirm_privacy_request", target: "case" },
  { step: "ReplayPrivacy", method: "POST", console: "/api/staff/privacy/replay", service: () => "/privacy/replay", action: "step_replay_privacy" },
  { step: "ResolveInboundTurn", method: "POST", console: "/api/staff/inbound/resolve", service: () => "/inbound/resolve", action: "step_resolve_inbound_turn" },
  { step: "ReadTurnWatch", method: "GET", console: "/api/staff/turn-watch", service: () => "/ops/turns", action: "step_read_turn_watch" },
  { step: "ReadJudgedReviews", method: "GET", console: "/api/staff/review/judged", service: () => "/review/judged", action: "step_read_review_judged", query: ["since"] },
  { step: "ReadJudgedReviews", method: "GET", console: "/api/staff/review/judged/:id/:revision", service: (id, _app, revision) => `/review/judged/${id}/${revision}`, action: "step_read_review_judged", target: "opportunity" },
  { step: "StopApprovedReview", method: "POST", console: "/api/staff/review/:id/stop", service: id => `/review/${id}/stop`, action: "step_stop_review", target: "opportunity" },
];

const SERVICE_STEPS: readonly [RegExp, StaffStep, StaffStep][] = [
  [/^\/postings$/, "ReadPostings", "SavePosting"],
  [/^\/postings\/[^/]+\/close$/, "ClosePosting", "ClosePosting"],
  [/^\/employers\/[^/]+\/verify$/, "VerifyEmployer", "VerifyEmployer"],
  [/^\/safety\/home-help$/, "ReadHomeHelp", "ReadHomeHelp"],
  [/^\/safety\/home-help\/.+$/, "DecideHomeHelp", "DecideHomeHelp"],
  [/^\/review\/member-invitations$/, "ReadMemberInvitations", "DecideMemberInvitation"],
  [/^\/invite\/seed$/, "SeedInvitations", "SeedInvitations"],
  [/^\/members\/[^/]+\/verify$/, "VerifyMember", "VerifyMember"],
  [/^\/invite$/, "InviteMember", "InviteMember"],
  [/^\/signals$/, "ReadAgentSignals", "ReadAgentSignals"],
  [/^\/signals\/.+$/, "DecideAgentSignal", "DecideAgentSignal"],
  [/^\/privacy\/requests$/, "OpenPrivacyRequest", "OpenPrivacyRequest"],
  [/^\/privacy\/requests\/[^/]+\/confirm$/, "ConfirmPrivacyRequest", "ConfirmPrivacyRequest"],
  [/^\/privacy\/replay$/, "ReplayPrivacy", "ReplayPrivacy"],
  [/^\/inbound\/resolve$/, "ResolveInboundTurn", "ResolveInboundTurn"],
  [/^\/ops\/turns$/, "ReadTurnWatch", "ReadTurnWatch"],
  [/^\/(?:staff\/)?relay\/held$/, "ReadHeldRelay", "ReadHeldRelay"],
  [/^\/(?:staff\/)?relay\/[^/]+\/photo$/, "ReadHeldRelay", "ReadHeldRelay"],
  [/^\/(?:staff\/)?relay\/[^/]+\/(?:release|reject)$/, "DecideHeldRelay", "DecideHeldRelay"],
  [/^\/review\/judged(\/[^/]+\/\d+)?$/, "ReadJudgedReviews", "ReadJudgedReviews"],
  [/^\/review\/[^/]+\/stop$/, "StopApprovedReview", "StopApprovedReview"],
  [/^\/review\/[^/]+$/, "DecideReviewItem", "DecideReviewItem"],
  [/^\/safety\/(?:hold|ban|dismiss|lift|close|clear-minor)$/, "DecideSafetyCase", "DecideSafetyCase"],
];

export function serviceStaffStep(method: string, path: string): StaffStep | undefined {
  const row = SERVICE_STEPS.find(([pattern]) => pattern.test(path));
  return row ? (method === "GET" ? row[1] : row[2]) : undefined;
}

export interface StaffStepAnswer { status: number; json: Record<string, unknown> }
export type StaffStepForward = (actor: string, method: Method, path: string, body: Record<string, unknown> | undefined) => Promise<StaffStepAnswer>;

export interface StaffStepDeps {
  identified: (handler: (req: Routed, user: StaffUser) => Promise<Response>) => (req: Routed) => Promise<Response>;
  appOf: (req: Request) => AppId | Response;
  mode: () => Mode;
  modeRefusal: (req: Request) => Response | undefined;
  record: (u: StaffUser, app: AppId, e: Omit<AuditEntry, "at" | "actor" | "roles" | "mode" | "app">) => Promise<Response | undefined>;
  forwarder: (app: AppId) => Promise<StaffStepForward | undefined>;
  json: (data: unknown, status?: number) => Response;
}

const BODY_LIMIT = 64 * 1024;

async function readObject(req: Request): Promise<Record<string, unknown> | "too_large" | undefined> {
  const raw = await readCappedText(req, BODY_LIMIT);
  if (raw === "too_large") return raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

function reasonOf(body: Record<string, unknown> | undefined): string | undefined {
  const text = typeof body?.reason === "string" ? body.reason : typeof body?.note === "string" ? body.note : undefined;
  const trimmed = text?.trim().slice(0, 500);
  return trimmed ? trimmed : undefined;
}

function handler(d: StaffStepDeps, s: ConsoleStep) {
  return d.identified(async (req, user) => {
    const app = d.appOf(req);
    if (app instanceof Response) return app;
    if (d.mode() !== "real") return d.json({ ok: false, error: "staff steps act on real data only", code: "real_only" }, 404);
    if (!staffStepAdmitted(s.step, app, [...rolesFor(user, app, "real")], globalRolesFor(user))) {
      const refused = await d.record(user, app, { action: s.action, ok: false, detail: { refused: "forbidden" } });
      return refused ?? d.json({ ok: false, error: `forbidden: ${s.step} is not open to this role for ${app}`, code: "forbidden" }, 403);
    }
    const changed = d.modeRefusal(req);
    if (changed) return changed;
    let id: string | undefined;
    try { id = req.params.id === undefined ? undefined : decodeURIComponent(req.params.id); } catch { id = ""; }
    if (id !== undefined && !ID.test(id)) return d.json({ ok: false, error: "invalid id", code: "bad_id" }, 400);
    const revision = req.params.revision;
    if (revision !== undefined && !REVISION.test(revision)) return d.json({ ok: false, error: "invalid revision", code: "bad_revision" }, 400);
    let body: Record<string, unknown> | undefined;
    if (s.method === "POST") {
      const read = await readObject(req);
      if (read === "too_large") return d.json({ ok: false, error: "body too large", code: "too_large" }, 413);
      if (!read) return d.json({ ok: false, error: "a JSON object is required", code: "bad_body" }, 400);
      body = read;
    }
    const url = new URL(req.url);
    const query = new URLSearchParams();
    for (const name of s.query ?? []) { const v = url.searchParams.get(name); if (v !== null) query.set(name, v); }
    const path = s.service(id === undefined ? "" : encodeURIComponent(id), app, revision ?? "") + (query.size ? `?${query}` : "");
    const target = s.target && id !== undefined ? { targetType: s.target, targetId: id } : {};
    const reason = reasonOf(body);
    const write = s.method === "POST";
    let forward: StaffStepForward | undefined;
    try { forward = await d.forwarder(app); } catch (e) {
      return d.json({ ok: false, error: `the Network service did not answer: ${(e as Error).message}`, code: "service_unavailable" }, 503);
    }
    if (!forward) return d.json({ ok: false, error: "staff steps go through the Network service: set NETWORK_SERVICE_URL and NETWORK_SERVICE_TOKEN", code: "read_only" }, 503);
    const refused = await d.record(user, app, { action: s.action, ...target, ok: true, ...(reason ? { reason } : {}), ...(write ? { detail: { phase: "requested" } } : {}) });
    if (refused) return refused;
    let answer: StaffStepAnswer;
    try { answer = await forward(user.id, s.method, path, body); } catch (e) {
      if (isTimeout(e)) {
        const timeout = serviceTimeout();
        if (write) await d.record(user, app, { action: s.action, ...target, ok: false, detail: { phase: "result", code: timeout.code, outcome: "unknown" } });
        return d.json(timeout, 504);
      }
      if (write) await d.record(user, app, { action: s.action, ...target, ok: false, detail: { phase: "result", code: "service_unavailable" } });
      return d.json({ ok: false, error: `the Network service did not answer: ${(e as Error).message}`, code: "service_unavailable" }, 503);
    }
    const ok = answer.status >= 200 && answer.status < 300 && answer.json.ok !== false;
    if (write) await d.record(user, app, { action: s.action, ...target, ok, detail: { phase: "result", status: answer.status } });
    if (answer.status === 401) return d.json({ ok: false, error: "the Network service refused the console's token", code: "service_auth" }, 502);
    return d.json(answer.json, answer.status);
  });
}

export function staffStepRoutes(d: StaffStepDeps): Record<string, Partial<Record<Method, (req: Routed) => Promise<Response>>>> {
  const routes: Record<string, Partial<Record<Method, (req: Routed) => Promise<Response>>>> = {};
  for (const s of CONSOLE_STAFF_STEPS) (routes[s.console] ??= {})[s.method] = handler(d, s);
  return routes;
}
