import type { MemberId } from "@thenetwork/core";
import {
  agentOptOutParticipation, agentPauseConfirmation, agentSignalAfterDecision, agentSignalEvidenceShown, agentSignalRoute, agentSignalWaitsForStaff,
  type AgentPauseConfirmation, type AgentSignalPhase,
} from "../../core/src/generated/staffSafetyService.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { PgNotifyStore } from "../../notify/src/pg-store.ts";
import { allowed } from "../../../apps/observatory/src/staff.ts";
import type { StaffRole, StaffUser } from "../../../apps/observatory/src/types.ts";
import type { AppId, AppInfo } from "../../platform/src/apps.ts";
import { readCapped } from "../../platform/src/body.ts";
import { ledgerOptedOut } from "./consent-ledger-read.ts";
import type { NetworkRuntime } from "./runtime.ts";

type AgentSignalKind = "opt_out" | "travel" | "safety_concern";
type AgentSignal = { kind: AgentSignalKind; evidence: string };

const KINDS: readonly AgentSignalKind[] = ["opt_out", "travel", "safety_concern"];
const WAITING_TAGS = KINDS.filter(kind => agentSignalWaitsForStaff(kind)).map(kind => `signal:${kind}`);
const SIGNAL_PATH = /^\/signals\/([^/]{1,600})$/;
const BODY_LIMIT = 4096;
const FACET_STATUS = { SignalWaiting: "proposed", SignalReviewed: "confirmed", SignalDismissed: "rejected" } as const satisfies Record<AgentSignalPhase, string>;
const PHASE: Record<string, AgentSignalPhase> = { proposed: "SignalWaiting", confirmed: "SignalReviewed", rejected: "SignalDismissed" };

export function parseAgentSignals(input: unknown): AgentSignal[] | undefined {
  if (!Array.isArray(input) || input.length > 20) return;
  const signals: AgentSignal[] = [];
  for (const signal of input) {
    if (!signal || typeof signal !== "object" || Array.isArray(signal) || Object.keys(signal).length !== 2) return;
    const { kind, evidence } = signal as Record<string, unknown>;
    if (!KINDS.includes(kind as AgentSignalKind) || typeof evidence !== "string" || !evidence.trim() || evidence.length > 500) return;
    signals.push({ kind: kind as AgentSignalKind, evidence });
  }
  return signals;
}

const AGENT_PAUSE_CONFIRMATION_TYPE = "agent_pause_confirmation";

function agentPauseConfirmationText(app: Pick<AppInfo, "name">, confirmation: Exclude<AgentPauseConfirmation, "PauseNotConfirmed">): string {
  return confirmation === "PauseConfirmedByReplyText"
    ? `Matching is paused on ${app.name}, as you asked. Say ‘resume matching’ when you want new introductions again.`
    : `Matching on ${app.name} was paused, as you asked. To undo it, text ‘resume matching’ on the ${app.name} line. If you turned texts off, reply START first.`;
}

export async function recordAgentSignals(tx: SQL, o: {
  runtime: Pick<NetworkRuntime, "app" | "system">; memberId: MemberId; personId: string; e164: string; actionId: string; signals: AgentSignal[]; now: number;
}): Promise<{ recorded: number }> {
  const app = o.runtime.app.id, at = new Date(o.now);
  for (const [index, signal] of o.signals.entries()) {
    const status = agentSignalRoute(signal.kind) === "SignalPausesApp" ? FACET_STATUS.SignalReviewed : FACET_STATUS.SignalWaiting;
    await tx`insert into network.facets(app_id,id,member_id,kind,value,tags,privacy_scope,provenance,source,status,valid_from)
      values(${app},${`service-signal:${o.actionId}:${index}`},${o.memberId},'fact',${signal.evidence},${tx.array([`signal:${signal.kind}`], "TEXT")},
        'agent_private','inferred','chat',${status},${at})`;
  }
  if (o.signals.length) await tx`insert into network.events(app_id,at,actor_type,actor_id,type,object_type,object_id,payload)
    values(${app},${at},'agent',${o.memberId},'network_signals_proposed','member',${o.memberId},${{ kinds: o.signals.map(signal => signal.kind), count: o.signals.length }}::jsonb)`;
  const pause = o.signals.find(signal => agentSignalRoute(signal.kind) === "SignalPausesApp");
  if (!pause) return { recorded: o.signals.length };
  const [member] = await tx<{ participation_state: string; opted_out: boolean }[]>`select participation_state,opted_out from network.members
    where app_id=${app} and id=${o.memberId}`;
  if (!member) throw new Error("Agent opt-out member is unavailable");
  const state = agentOptOutParticipation(pause.kind, member.participation_state);
  const saved = await tx`update network.members set participation_state=${state}, participation_window=null
    where app_id=${app} and id=${o.memberId} and (participation_state is distinct from ${state} or participation_window is not null) returning id`;
  if (saved.length) await tx`insert into network.events(app_id,at,actor_type,actor_id,type,object_type,object_id,payload)
    values(${app},${at},'agent',${o.memberId},'member_state_requested','member',${o.memberId},${{ state, from: null, until: null, source: "agent_signal" }}::jsonb)`;
  const textsOff = saved.length > 0 && (member.opted_out || await ledgerOptedOut(tx, o.e164, app));
  const confirmation = agentPauseConfirmation(pause.kind, saved.length > 0, textsOff);
  switch (confirmation) {
    case "PauseNotConfirmed":
      break;
    case "PauseConfirmedByReplyText":
      o.runtime.system(o.memberId, `agent-pause:${o.actionId}`, agentPauseConfirmationText(o.runtime.app, confirmation), "reply", AGENT_PAUSE_CONFIRMATION_TYPE);
      break;
    case "PauseConfirmedInInbox":
      await new PgNotifyStore(tx).addItem({ personId: o.personId, app, eventType: AGENT_PAUSE_CONFIRMATION_TYPE, subjectId: o.actionId,
        urgency: "requested", summary: agentPauseConfirmationText(o.runtime.app, confirmation) }, o.now);
      break;
    default: {
      const exhaustive: never = confirmation;
      throw new Error(`Unknown agent pause confirmation ${String(exhaustive)}`);
    }
  }
  return { recorded: o.signals.length };
}

export function agentSignalsOpenCase(signals: readonly AgentSignal[]): boolean {
  return signals.some(signal => agentSignalWaitsForStaff(signal.kind));
}

interface AgentSignalReviewDeps {
  app: AppId;
  user: StaffUser;
  now(): number;
  scoped<T>(run: (tx: SQL) => Promise<T>): Promise<T>;
  openCases(memberIds: string[]): Promise<Map<string, string>>;
  ageInDoubt(memberIds: string[]): Promise<Set<string>>;
}

type Json = (body: unknown, status?: number) => Response;
const json: Json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function audit(tx: SQL, d: AgentSignalReviewDeps, entry: { action: string; ok: boolean; memberId?: string; reason?: string; detail: Record<string, unknown> }) {
  await tx`insert into network.staff_audit (at, actor, roles, action, target_type, target_id, reason, mode, ok, detail, app_id)
    values (${new Date(d.now())}, ${d.user.id}, ${tx.array(d.user.roles as StaffRole[], "TEXT")}, ${entry.action}, ${entry.memberId ? "member" : null},
      ${entry.memberId ?? null}, ${entry.reason ?? null}, 'real', ${entry.ok}, ${entry.detail}::jsonb, ${d.app})`;
}

function parseDecision(input: unknown): { dismiss: boolean; reason: string } | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 2) return;
  const { decision, reason } = input as Record<string, unknown>;
  if ((decision !== "reviewed" && decision !== "dismissed") || typeof reason !== "string" || reason.length > 2000 || reason.trim().length < 5) return;
  return { dismiss: decision === "dismissed", reason: reason.trim() };
}

export async function handleAgentSignalReview(req: Request, path: string, d: AgentSignalReviewDeps): Promise<Response | undefined> {
  const forbidden = (roles: StaffRole[]) => json({ ok: false, code: "forbidden", error: `needs role ${roles.map(role => `${role}@${d.app}`).join(" or ")}` }, 403);
  const safetyRole = allowed(d.user, ["safety"], d.app, "real");
  if (path === "/signals") {
    if (req.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
    if (!allowed(d.user, ["reviewer", "safety"], d.app, "real")) return forbidden(["reviewer", "safety"]);
    const rows = await d.scoped(async tx => {
      await audit(tx, d, { action: "read_agent_signals", ok: true, detail: {} });
      return tx<{ id: string; member_id: string; tags: string[]; value: string; valid_from: Date }[]>`select id,member_id,tags,value,valid_from from network.facets
        where app_id=${d.app} and status='proposed' and tags && ${tx.array(WAITING_TAGS, "TEXT")} order by valid_from desc, id limit 200`;
    });
    const members = [...new Set(rows.map(row => row.member_id))];
    const cases = await d.openCases(members);
    const doubt = await d.ageInDoubt(members);
    return json({ ok: true, signals: rows.map(row => ({ id: row.id, memberId: row.member_id,
      kind: row.tags.find(tag => WAITING_TAGS.includes(tag))!.slice("signal:".length),
      ...(agentSignalEvidenceShown(safetyRole, doubt.has(row.member_id)) ? { evidence: row.value } : { minor: true }), at: row.valid_from.getTime(),
      caseId: cases.get(row.member_id) ?? null })) });
  }
  const match = SIGNAL_PATH.exec(path);
  if (!match) return;
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!safetyRole) return forbidden(["safety"]);
  let id: string;
  try { id = decodeURIComponent(match[1]!); } catch { return json({ ok: false, error: "invalid_signal" }, 400); }
  const bytes = await readCapped(req, BODY_LIMIT);
  if (bytes === "too_large") return json({ ok: false, error: "payload_too_large" }, 413);
  let input: unknown;
  try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return json({ ok: false, error: "invalid_signal_decision" }, 400); }
  const decision = parseDecision(input);
  if (!decision) return json({ ok: false, error: "invalid_signal_decision" }, 400);
  const outcome = await d.scoped(async tx => {
    const [row] = await tx<{ member_id: string; status: string }[]>`select member_id,status from network.facets
      where app_id=${d.app} and id=${id} and tags && ${tx.array(WAITING_TAGS, "TEXT")} for update`;
    const detail = { signal: id, decision: decision.dismiss ? "dismissed" : "reviewed" };
    await audit(tx, d, { action: "decide_agent_signal", ok: true, memberId: row?.member_id, reason: decision.reason, detail: { ...detail, phase: "requested" } });
    const phase = row ? PHASE[row.status] : undefined;
    const next = phase && agentSignalAfterDecision(phase, safetyRole, decision.dismiss);
    if (!row || !phase || next === phase) {
      const refused = row ? "already_decided" : "unknown_signal";
      await audit(tx, d, { action: "decide_agent_signal", ok: false, memberId: row?.member_id, detail: { ...detail, phase: "refused", refused } });
      return { ok: false as const, reason: refused };
    }
    await tx`update network.facets set status=${FACET_STATUS[next!]} where app_id=${d.app} and id=${id}`;
    await tx`insert into network.events(app_id,at,actor_type,actor_id,type,object_type,object_id,payload)
      values(${d.app},${new Date(d.now())},'reviewer',${d.user.id},'agent_signal_decided','member',${row.member_id},${detail}::jsonb)`;
    return { ok: true as const };
  });
  return outcome.ok ? json({ ok: true }) : json(outcome, outcome.reason === "unknown_signal" ? 404 : 409);
}
