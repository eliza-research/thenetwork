// Real mode's write path: the Network service's staff API (packages/network/service, runbook-real
// 6.5). The Observatory's own database login stays read-only; review decisions, safety actions and
// the matching switch go to the service, which runs them under its lock, writes the Network's logs and
// network.staff_audit, and answers with the Network's reason when it refuses.
//   NETWORK_SERVICE_URL   the service (for example http://127.0.0.1:4848)
//   NETWORK_SERVICE_TOKEN a token the service lists in NETWORK_SERVICE_TOKENS with the admin role
//                         (or reviewer + safety + admin): the Observatory checks each staff member's
//                         own role first, and the service checks the token's.
// Header contract (the reviewer of record, platform plan 5.1; docs/admin-console.md 4.6):
//   X-Network-Staff-Id  the signed-in staff member (an SSO email, or "token:<role>#<hash>"). The
//                       console sends it on every staff action, after its own role check for the app.
//                       The service must take it as the reviewer of record only from a request that
//                       carries the console's own token (one it lists for the console), and ignore it
//                       from any other token. Without it, the token's own id is the actor.
//   ?app=<app> and X-Network-App: the app ("ntwrk", "slop", ...) whose network the action is for
//                       (the service routes on ?app=; the header repeats it for its logs).
// Safety reports, hold, ban and photos (docs/admin-console.md 3.7.1 is the contract; the console side
// is built against it, the service side comes from the platform work):
//   GET  /safety/reports                -> { ok, reports: [{ id, kind, reporterId, subjectId, opportunityId?, at, status, priorReports? }] }
//   POST /safety/hold    { memberId, note, reportId? }            hold the person on every app
//   POST /safety/ban     { memberId, by: "phone"|"person", note, reportId? }
//   POST /safety/dismiss { reportId, note }
//   GET  /members/<id>/photos  (X-Network-Reason: the typed reason) -> { ok, photos: [{ id, url, expiresAt? }] }
//   GET  /bias                          -> { ok, reports: BiasReportView[] } (the weekly bias monitor; admin or analyst)
// 409 { reason } is a refusal with the Network's reason; 404 means the service has no such route yet.
import type { BiasReportView, ControlCommand, ControlResult, HealthAlert, MemberPhoto, ReportKind, SafetyAction, SafetyReport } from "../types.ts";
import { REVIEW_BLOCK_ERRORS, SAFETY_ERRORS } from "./source.ts";

export interface ServiceConfig {
  url: string;
  token: string;
  /** The app the console acts for: sent in X-Network-App (one service runs every app's network). */
  app?: string;
  /** Request timeout in ms (default 15000). */
  timeoutMs?: number;
}

/** The service's GET /health (packages/network/service/service.ts health()). */
export interface ServiceHealth {
  ok: boolean; instance: string; channel: string; reviewMode: "human"; matchingEnabled: boolean;
  lastTick: { thisInstance: { at: number; ran: boolean } | null; stored: number | null; savedAt: number | null };
  lockHolder: { pid: number; application: string } | null;
  backlog: { review: number; reviewOverdue: number; deferred: number; outboundWaiting: number };
  refusals: { sendRefused: number; guardBlocked: number; channel: Record<string, number> };
}

/** The service's last tick is late (it ticks every minute): warn after 5 minutes, bad after 15. */
export const SERVICE_TICK_WARN = 5 * 60_000, SERVICE_TICK_BAD = 15 * 60_000;

/** NETWORK_SERVICE_URL and NETWORK_SERVICE_TOKEN, when both are set. */
export function serviceFromEnv(env: Record<string, string | undefined> = process.env): ServiceConfig | undefined {
  const url = env.NETWORK_SERVICE_URL?.trim(), token = env.NETWORK_SERVICE_TOKEN?.trim();
  return url && token ? { url, token } : undefined;
}

/** The staff member behind a console action (the reviewer of record). */
export const STAFF_HEADER = "x-network-staff-id";
/** The app the action is for. */
export const APP_HEADER = "x-network-app";
/** The typed reason for a photo read (the service writes it to its own audit). */
export const REASON_HEADER = "x-network-reason";
const REPORT_KINDS = new Set<ReportKind>(["harassment", "lying", "no_show", "unsafe", "scam", "minor", "other"]);
/** A report row as the service sends it, before the console adds urgency and due times. */
export type ServiceReport = Pick<SafetyReport, "id" | "kind" | "reporterId" | "subjectId" | "opportunityId" | "at" | "status"> & { priorReports?: number };

export class ServiceClient {
  readonly url: string;
  constructor(private c: ServiceConfig) { this.url = c.url.replace(/\/+$/, ""); }

  private async call(method: "GET" | "POST", path: string, staff?: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; json: Record<string, any> }> {
    // The service picks the app's network from ?app= (packages/network/service/service.ts fetch).
    const r = await fetch(this.url + path + (this.c.app ? `${path.includes("?") ? "&" : "?"}app=${encodeURIComponent(this.c.app)}` : ""), {
      method, signal: AbortSignal.timeout(this.c.timeoutMs ?? 15_000),
      headers: {
        authorization: `Bearer ${this.c.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(staff ? { [STAFF_HEADER]: staff } : {}), ...(this.c.app ? { [APP_HEADER]: this.c.app } : {}), ...extra,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, any> };
  }

  /** A staff action. 200: done. 409: the Network refused it (its reason as the code). Anything else: the service did not act. */
  private async act(path: string, staff: string, body: unknown, errors: Record<string, string>): Promise<ControlResult> {
    let res: { status: number; json: Record<string, any> };
    try { res = await this.call("POST", path, staff, body); } catch (e) {
      return { ok: false, code: "service_unavailable", error: `the Network service did not answer: ${(e as Error).message}` };
    }
    const { status, json } = res;
    if (status === 200 && json.ok) return { ok: true };
    if (status === 409) { const why = String(json.reason ?? "refused"); return { ok: false, code: why, error: errors[why] ?? `refused: ${why.replace(/_/g, " ")}` }; }
    if (status === 401 || status === 403) return { ok: false, code: "service_auth", error: `the Network service refused the console's token (${json.error ?? status})` };
    if (status === 404 && !json.reason) return { ok: false, code: "service_missing", error: `the Network service has no ${path} yet` };
    return { ok: false, code: "service_error", error: `the Network service answered ${status}${json.error ? `: ${json.error}` : ""}` };
  }

  review(staff: string, cmd: Extract<ControlCommand, { type: "review" }>): Promise<ControlResult> {
    const { decision, reason, note, explanations, objective, swapOut } = cmd;
    // Time on one item counts at most 30 minutes (a card left open is not review work; audit observatory-10).
    const secondsSpent = cmd.secondsSpent === undefined ? undefined : Math.min(1800, Math.max(0, Number(cmd.secondsSpent) || 0));
    return this.act(`/review/${encodeURIComponent(cmd.oppId)}`, staff, { decision, reason, note, secondsSpent, explanations, objective, swapOut }, REVIEW_BLOCK_ERRORS);
  }

  safety(staff: string, a: SafetyAction): Promise<ControlResult> {
    switch (a.action) {
      case "lift": return this.act("/safety/lift", staff, { memberId: a.memberId, note: a.note }, SAFETY_ERRORS);
      case "close": return this.act("/safety/close", staff, { caseId: a.caseId, note: a.note }, SAFETY_ERRORS);
      case "hold": return this.act("/safety/hold", staff, { memberId: a.memberId, note: a.note, reportId: a.reportId }, SAFETY_ERRORS);
      case "ban": return this.act("/safety/ban", staff, { memberId: a.memberId, by: a.by, note: a.note, reportId: a.reportId }, SAFETY_ERRORS);
      case "dismiss": return this.act("/safety/dismiss", staff, { reportId: a.reportId, note: a.note }, SAFETY_ERRORS);
    }
  }

  /** Post-date reports (GET /safety/reports). Rows the console cannot read are dropped. */
  async reports(): Promise<ServiceReport[] | { error: string }> {
    try {
      const { status, json } = await this.call("GET", "/safety/reports");
      if (status !== 200 || !json.ok || !Array.isArray(json.reports)) return { error: String(json.error ?? `HTTP ${status}`) };
      const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
      return (json.reports as Record<string, unknown>[]).flatMap((r): ServiceReport[] => {
        const id = str(r.id), reporterId = str(r.reporterId), subjectId = str(r.subjectId), at = Number(r.at);
        if (!id || !reporterId || !subjectId || !Number.isFinite(at)) return [];
        const kind = REPORT_KINDS.has(r.kind as ReportKind) ? r.kind as ReportKind : "other";
        const status = ["open", "held", "banned", "dismissed"].includes(String(r.status)) ? r.status as SafetyReport["status"] : "open";
        return [{ id, kind, reporterId, subjectId, at, status, ...(str(r.opportunityId) ? { opportunityId: str(r.opportunityId) } : {}), ...(Number.isFinite(Number(r.priorReports)) ? { priorReports: Number(r.priorReports) } : {}) }];
      });
    } catch (e) { return { error: (e as Error).message }; }
  }

  /** One member's photos (slop). The reason goes in X-Network-Reason; the service checks age and role again. */
  async photos(staff: string, memberId: string, reason: string): Promise<{ ok: true; photos: MemberPhoto[] } | ControlResult> {
    let res: { status: number; json: Record<string, any> };
    try { res = await this.call("GET", `/members/${encodeURIComponent(memberId)}/photos`, staff, undefined, { [REASON_HEADER]: reason.replace(/[\r\n]+/g, " ").slice(0, 500) }); } catch (e) {
      return { ok: false, code: "service_unavailable", error: `the Network service did not answer: ${(e as Error).message}` };
    }
    const { status, json } = res;
    if (status === 200 && json.ok && Array.isArray(json.photos)) {
      return { ok: true, photos: (json.photos as Record<string, unknown>[]).filter(p => typeof p.id === "string" && typeof p.url === "string" && /^https:\/\//.test(p.url as string))
        .map(p => ({ id: p.id as string, url: p.url as string, ...(Number.isFinite(Number(p.expiresAt)) ? { expiresAt: Number(p.expiresAt) } : {}) })) };
    }
    if (status === 404 && !json.reason) return { ok: false, code: "service_missing", error: "the Network service has no photo route yet" };
    return { ok: false, code: String(json.reason ?? "service_error"), error: String(json.error ?? `the Network service answered ${status}`) };
  }

  matching(staff: string, on: boolean): Promise<ControlResult> { return this.act("/matching", staff, { on }, {}); }

  /** The weekly bias monitor reports of the app's network, newest first (GET /bias; admin or analyst). */
  async bias(staff: string): Promise<{ ok: true; reports: BiasReportView[] } | { ok: false; error: string }> {
    try {
      const { status, json } = await this.call("GET", "/bias", staff);
      if (status !== 200 || !json.ok || !Array.isArray(json.reports)) return { ok: false, error: String(json.error ?? `HTTP ${status}`) };
      return { ok: true, reports: (json.reports as BiasReportView[]).filter(r => r && typeof r.at === "number" && r.report && typeof r.report === "object") };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  }

  async health(): Promise<ServiceHealth | { error: string }> {
    try {
      const { status, json } = await this.call("GET", "/health");
      return status === 200 && json.ok ? json as ServiceHealth : { error: String(json.error ?? `HTTP ${status}`) };
    } catch (e) { return { error: (e as Error).message }; }
  }
}

/** The service's health as alert lines (the Overview strip): unreachable, a late tick, channel refusals, and one line when all is well. */
export function serviceAlerts(h: ServiceHealth | { error: string }, now: number): HealthAlert[] {
  if ("error" in h) return [{ level: "bad", key: "service_down", count: 0, text: `Network service unreachable: ${h.error}. Review and safety actions cannot run.` }];
  const out: HealthAlert[] = [];
  const last = h.lastTick.stored ?? h.lastTick.savedAt;
  const late = last === null ? null : now - last;
  const ago = late === null ? "never" : late < 120_000 ? `${Math.max(0, Math.round(late / 1000))} s ago` : `${Math.round(late / 60_000)} min ago`;
  if (late === null || late > SERVICE_TICK_WARN) {
    out.push({ level: late === null || late > SERVICE_TICK_BAD ? "bad" : "warn", key: "service_tick", count: late === null ? 0 : Math.round(late / 60_000), text: `Network service: last tick ${ago} (expected every minute)` });
  }
  for (const [status, n] of Object.entries(h.refusals.channel)) if (n > 0) out.push({ level: "warn", key: `service_channel:${status}`, count: n, text: `Network service: ${n} message(s) ${status.replace(/_/g, " ")} by the channel` });
  if (h.backlog.outboundWaiting > 0) out.push({ level: "info", key: "service_outbound", count: h.backlog.outboundWaiting, text: `Network service: ${h.backlog.outboundWaiting} message(s) waiting to be delivered` });
  if (!out.some(a => a.key === "service_tick")) {
    out.push({ level: "info", key: "service_ok", count: 0, text: `Network service up: last tick ${ago}, channel ${h.channel}${h.lockHolder ? `, lock held by ${h.lockHolder.application}` : ""}` });
  }
  return out;
}
