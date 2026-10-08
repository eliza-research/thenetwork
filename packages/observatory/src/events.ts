// Product events (PRD 32.19) in one shape for both modes. Game mode turns simulator run records into
// event rows; the writer stores the same rows in network.events; real mode reads them back. The
// member timeline, the opportunity history and conversation search describe the rows the same way
// in both modes. The Network's feedback and "learned" logs (a member's words and private facts) are
// not stored as events, and leak-guard reasons keep only their kind. One exception, as before:
// feedback_given keeps the feedback text in its payload; describe() never shows it.
import type { MemberId } from "@thenetwork/core";
import type { RunRecord } from "@thenetwork/judge";
import { desireById } from "@thenetwork/engine/src/packs/network/vocabulary.ts";
import { SLOT_KINDS, type SendKind } from "@thenetwork/network";
import type { SystemEvent } from "./types.ts";

export interface EventRow {
  at: Date | string | number;
  actor_type: "member" | "agent" | "engine" | "reviewer" | "admin" | "sim";
  actor_id: string | null;
  type: string;
  object_type: string | null;
  object_id: string | null;
  payload: Record<string, unknown>;
}

/** Network log kinds stored as events (packages/network ctx.log). "learned" and "feedback" hold member facts or words: never stored. */
export const NETWORK_EVENT_KINDS: ReadonlySet<string> = new Set([
  "review_queued", "review_decision", "review_expired", "review_invalidated", "review_refused", "review_mode", "matching_switch",
  "probe_started", "probe_sent", "probe_answer", "probe_replaced", "probe_closed", "proposal_skipped", "opportunity_closed", "venue",
  "request", "request_result", "request_withdrawn_want", "trust", "abuse", "safety_action", "guard_blocked", "send_refused", "send_skipped",
  "age_unknown", "age_resolved", "age_conflict", "minor_signal", "join_declined", "invite", "growth_ask", "reengagement",
  "only_when_asked", "outreach_resumed", "ask_sent", "ask_answered",
  // The send path and the booked plan (attention v1.2, network.md 4 and 6.4): what waited and why, what
  // the engine proposed and the gates stopped, the times offered and picked, cancellations, and the
  // availability opt-ins. Codes, keys and tags only, never the member's words.
  "send_deferred", "gate_reason", "time_answer", "booked_cancelled", "availability_stated", "availability_offer",
  "calendar_consent", "weekly_checkin_consent", "checkin_sent",
  // An opportunity closed because the members' picked times had nothing in common left, and a member
  // record that now says under 18 (a staff age correction).
  "no_common_time", "minor_record", "minor_after_contact",
]);
const STAFF_ACTOR: Record<string, EventRow["actor_type"]> = { review_decision: "reviewer", review_refused: "reviewer", review_mode: "admin", matching_switch: "admin", safety_action: "admin" };
/** Payload keys that could hold text a member wrote. */
const NEVER = new Set(["text", "body", "message"]);

const scalar = (v: unknown): v is string | number | boolean | null => v === null || ["string", "number", "boolean"].includes(typeof v);

/** A network log's detail as an event payload: scalars and string lists only; a proposal becomes its participants, kind and category. */
function payloadOf(kind: string, d: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (NEVER.has(k) || v === undefined) continue;
    if (k === "proposal" && v && typeof v === "object") {
      const p = v as { id?: string; participants?: string[]; kind?: string; category?: string };
      out.participants = [...(p.participants ?? [])]; out.kind = p.kind ?? null; out.category = p.category ?? null;
      if (!d.oppId && p.id) out.oppId = p.id;
    } else if (k === "reasons" && Array.isArray(v)) {
      // Leak-guard reasons: only the kind ("forbidden", "canary", "phone"...), never what matched.
      out.reasons = [...new Set(v.map(x => String(x).split(":")[0]))];
    } else if (scalar(v)) out[k] = v;
    else if (Array.isArray(v) && v.every(x => typeof x === "string")) out[k] = [...v];
  }
  if (kind === "review_decision" && Array.isArray(d.edited)) out.edited = [...(d.edited as string[])];
  return out;
}

/** Product events from simulator records. Messages have their own table. */
export function eventOf(rec: RunRecord): EventRow | undefined {
  const at = new Date(rec.t);
  const ev = (actor_type: EventRow["actor_type"], actor_id: string | null, type: string, object_type: string | null, object_id: string | null, payload: Record<string, unknown> = {}): EventRow =>
    ({ at, actor_type, actor_id, type, object_type, object_id, payload });
  switch (rec.type) {
    case "join": return ev("member", rec.memberId, "member_joined", "member", rec.memberId);
    case "proposal": return ev(rec.source === "engine" ? "engine" : rec.source === "player" ? "admin" : "agent", null, "opportunity_proposed", "opportunity", rec.proposal.id, { participants: rec.proposal.participants, kind: rec.proposal.kind, source: rec.source });
    case "decision":
      if (rec.messageType !== "proposal" || !["accept", "decline"].includes(rec.intent)) return undefined;
      return ev("member", rec.memberId, rec.intent === "accept" ? "member_accepted" : "member_declined", "opportunity", rec.proposalId ?? null);
    case "meeting_scheduled": return ev("agent", null, "meeting_scheduled", "opportunity", rec.proposalId, { participants: rec.participants, at: rec.at });
    case "outcome": return ev("sim", null, "interaction_occurred", "opportunity", rec.proposalId, { attendance: rec.attendance });
    case "feedback": return ev("member", rec.memberId, "feedback_given", "opportunity", rec.proposalId ?? null, { text: rec.text });
    case "block": return ev("member", rec.from, "member_blocked", "member", rec.to);
    case "opt_out": return ev("member", rec.memberId, "member_opted_out", "member", rec.memberId);
    case "adversarial_attempt": return ev("sim", rec.memberId, "safety_flag", "member", rec.memberId, { kind: rec.kind });
    case "invariant_violation": return ev("sim", rec.memberId ?? null, "invariant_violation", null, null, { rule: rec.rule, detail: rec.detail });
    case "network_log": {
      if (!NETWORK_EVENT_KINDS.has(rec.kind)) return undefined;
      const d = rec.detail as Record<string, unknown>;
      const payload = payloadOf(rec.kind, d);
      const opp = (payload.oppId ?? payload.proposalId) as string | undefined;
      const member = (payload.memberId ?? payload.from) as string | undefined;
      const staff = STAFF_ACTOR[rec.kind];
      const actorId = staff ? String(d.reviewer ?? d.actor ?? "") || null : null;
      return ev(staff ?? "agent", actorId, rec.kind, opp ? "opportunity" : member ? "member" : null, opp ?? member ?? null, payload);
    }
    default: return undefined;
  }
}

/** Every member a row names (who acted, who it is about, who it names). */
export function membersOf(row: Pick<EventRow, "actor_type" | "actor_id" | "object_type" | "object_id" | "payload">): MemberId[] {
  const p = row.payload ?? {};
  const ids = new Set<string>();
  if (row.actor_type === "member" && row.actor_id) ids.add(row.actor_id);
  if (row.object_type === "member" && row.object_id) ids.add(row.object_id);
  for (const k of ["memberId", "from", "newMemberId", "out", "in"]) if (typeof p[k] === "string") ids.add(p[k] as string);
  if (Array.isArray(p.participants)) for (const x of p.participants) ids.add(String(x));
  // gate_reason: the members of an engine proposal the gates stopped.
  if (Array.isArray(p.members)) for (const x of p.members) ids.add(String(x));
  if (p.attendance && typeof p.attendance === "object") for (const x of Object.keys(p.attendance)) ids.add(x);
  return [...ids];
}

/** The member a row is about (one person), if any. */
function subjectOf(row: EventRow): MemberId | undefined {
  const p = row.payload ?? {};
  if (typeof p.memberId === "string") return p.memberId;
  if (row.actor_type === "member" && row.actor_id) return row.actor_id;
  if (row.object_type === "member" && row.object_id) return row.object_id;
  return undefined;
}

export const toMs = (at: EventRow["at"]) => (typeof at === "number" ? at : new Date(at).getTime());
const human = (s: unknown) => String(s ?? "").replace(/_/g, " ");
const NY_TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });
/** "Thu 12:00 PM" in New York (the Network's send times are New York times). */
const nyTime = (t: unknown) => (typeof t === "number" && Number.isFinite(t) ? NY_TIME.format(t) : "later");
/** Picked time keys ("a", "c"), or "none". */
const picks = (p: unknown) => (Array.isArray(p) ? (p.length ? p.join(", ") : "none") : undefined);
/** Availability tags ("evening:Tue") as words ("Tue evening"). */
const availability = (tags: unknown) => (Array.isArray(tags) ? tags.map(t => { const [part, day] = String(t).split(":"); return day ? `${day} ${part}` : human(part); }).join(", ") : "");

/** A request's want as the Network phrases it ("find a weekend tennis partner"), never the member's words. */
export function requestLabel(d: { kind?: unknown; desireId?: unknown; tags?: unknown; category?: unknown }): string {
  if (d.kind === "plans") return "plans nearby";
  const want = d.desireId ? desireById.get(String(d.desireId))?.text : undefined;
  if (want) return want;
  const tag = Array.isArray(d.tags) && d.tags[0] ? human(d.tags[0]) : undefined;
  return tag ? `someone into ${tag}` : `a ${String(d.category ?? "social")} request`;
}

/**
 * One line for staff. `name` turns a member id into a display name (scrubbed in real mode). Notes
 * and objectives are never included: only codes, kinds and counts.
 */
export function describe(row: EventRow, name: (id: string) => string = id => id): SystemEvent {
  const p = (row.payload ?? {}) as Record<string, any>;
  const t = toMs(row.at);
  const opportunityId = row.object_type === "opportunity" ? row.object_id ?? undefined : (p.oppId ?? p.proposalId) as string | undefined;
  let text: string = row.type.replace(/_/g, " ");
  let severity: SystemEvent["severity"];
  const detail: Record<string, string | number | boolean | null> = {};
  const keep = (...keys: string[]) => { for (const k of keys) if (scalar(p[k]) && p[k] !== undefined) detail[k] = p[k]; };
  switch (row.type) {
    case "member_joined": text = "Joined the Network"; break;
    case "opportunity_proposed": text = `${human(p.source ?? "engine")} proposed a ${human(p.kind ?? "opportunity")}`; keep("source", "kind"); break;
    case "member_accepted": text = `${name(row.actor_id ?? "")} said yes`; severity = "good"; break;
    case "member_declined": text = `${name(row.actor_id ?? "")} passed`; break;
    case "meeting_scheduled": text = "Meeting scheduled"; severity = "good"; break;
    case "interaction_occurred": {
      const showed = Object.values(p.attendance ?? {}).filter((a: any) => a?.showed).length;
      text = `Meeting happened (${showed} showed)`; severity = showed >= 2 ? "good" : "warn"; detail.showed = showed; break;
    }
    case "feedback_given": text = `${name(row.actor_id ?? "")} gave feedback`; break;
    case "member_blocked": text = `${name(row.actor_id ?? "")} blocked ${name(row.object_id ?? "")}`; severity = "warn"; break;
    case "member_opted_out": text = "Texted STOP (opted out)"; severity = "warn"; break;
    case "safety_flag": text = `Safety flag: ${human(p.kind)}`; severity = "bad"; keep("kind"); break;
    case "invariant_violation": text = `Invariant violation: ${human(p.rule)}`; severity = "bad"; keep("rule"); break;
    case "review_queued": text = `${p.rerolled ? "Re-rolled and queued" : "Queued"} for review (${human(p.origin)}); nobody contacted`; keep("origin", "deadline", "rerolled"); break;
    case "review_decision": {
      const by = p.reviewer ? ` by ${p.reviewer}` : "";
      if (p.decision === "reroll") { text = `Re-rolled${by}: ${p.out ? name(p.out) : "nobody"} out, ${p.in ? name(p.in) : "no alternate (back to the engine)"}`; keep("out", "in", "next"); }
      else if (p.decision === "reject") { text = `Rejected in review${by}${p.reason ? ` (${human(p.reason)})` : ""}`; severity = "warn"; }
      else { text = `Approved${Array.isArray(p.edited) && p.edited.length ? " with edits" : ""}${by}`; severity = "good"; }
      keep("decision", "reason", "reviewer", "secondsSpent");
      if (Array.isArray(p.edited)) detail.edited = p.edited.join(",");
      break;
    }
    case "review_expired": text = "Review SLA missed: expired, never sent"; severity = "warn"; break;
    case "review_invalidated": text = `Approved, then stopped on the re-check (${human(p.reason)}): nobody contacted`; severity = "warn"; keep("reason"); break;
    case "review_refused": text = `Review action refused: ${human(p.decision)} (${human(p.reason)})`; severity = "warn"; keep("decision", "reason"); break;
    case "review_mode": text = `Review mode set to ${p.mode}`; keep("mode"); break;
    case "matching_switch": text = `Proactive matching turned ${p.on ? "on" : "off"}${p.actor ? ` by ${p.actor}` : ""}`; severity = p.on ? "info" : "warn"; keep("on", "actor"); break;
    case "probe_started": text = `Availability check started (${human(p.origin)})${typeof p.first === "string" ? `: ${name(p.first)} first, one at a time` : ""}; no names yet`; keep("origin", "first"); break;
    case "probe_sent":
      text = `Probe sent${p.category ? ` (${p.category})` : ""}${p.options ? ` with ${p.options} time option${p.options === 1 ? "" : "s"}` : ""}${p.invite === true ? " · initial invite (counts on the cap)" : p.invite === false ? " · requester's time question" : ""}`;
      keep("category", "options", "invite"); break;
    case "probe_answer": {
      const pk = picks(p.picked);
      text = p.expired ? `${name(p.memberId)}: probe expired unanswered` : `${name(p.memberId)}: ${p.yes ? "available" : "not available"}${p.yes && pk ? ` · picked ${pk}` : ""}`;
      severity = p.yes ? "good" : undefined; keep("yes", "expired"); if (pk) detail.picked = pk; break;
    }
    case "time_answer": { const pk = picks(p.picked); text = `${name(p.memberId)}: other times offered · picked ${pk ?? "none"}`; if (pk) detail.picked = pk; break; }
    case "send_deferred":
      // Interruptions (probes, asks, the weekly check-in) wait for the member's send window; logistics only for quiet hours (network.md 6.4).
      text = `${human(p.kind)} waits for ${p.kind === "probe" || SLOT_KINDS.has(p.kind as SendKind) ? "their send window" : "quiet hours to end"} (until ${nyTime(p.until)} New York)`;
      keep("kind", "until"); break;
    case "gate_reason": {
      const who = Array.isArray(p.members) ? (p.members as string[]).map(name).join(" + ") : "";
      text = `Engine proposal${who ? ` for ${who}` : ""} not started: ${human(p.reason)}`; keep("reason", "proposalKey"); break;
    }
    case "booked_cancelled": text = `${name(p.memberId)} called off the booked plan${p.told ? " (told us)" : " (no reply to us)"}; the others hear it is off, not why`; severity = "warn"; keep("told"); break;
    case "availability_offer": text = "Offered calendar free/busy (CALENDAR) and the weekly check-in (WEEKLY), once, in the first booked plan"; break;
    case "calendar_consent": text = p.on === false ? "Calendar free/busy turned off" : "Calendar free/busy: consent recorded (no calendar source yet)"; keep("on"); break;
    case "weekly_checkin_consent": text = p.on === false ? "Weekly check-in turned off" : "Weekly check-in on (Sundays, in their send window)"; keep("on"); break;
    case "checkin_sent": text = "Weekly check-in sent (\"What's your week like?\")"; break;
    case "availability_stated": text = `Stated availability for 7 days: ${availability(p.tags) || "none read"}`; if (Array.isArray(p.tags)) detail.tags = (p.tags as string[]).join(","); break;
    case "probe_replaced": text = `Swapped ${name(p.out)} for ${name(p.in)}`; keep("out", "in"); break;
    case "probe_closed": text = `Check closed: ${human(p.reason ?? "not sent")}`; keep("reason"); break;
    case "proposal_skipped": text = `Not sent: ${human(p.reason)}`; severity = "warn"; keep("reason"); break;
    case "opportunity_closed": text = `Closed: ${human(p.reason)}`; keep("reason"); break;
    case "venue": text = `Venue: ${p.venue}`; keep("venue", "meetingAt"); break;
    case "request": text = `Asked for ${requestLabel(p)}`; keep("kind", "category", "desireId"); break;
    case "request_result":
      text = p.outcome === "fulfilled" ? `Request fulfilled in ${p.hours}h` : p.outcome === "probing" ? `Request: checking ${p.candidates ?? ""} candidates`.replace("  ", " ") : `Request waiting (${human(p.reason)})`;
      severity = p.outcome === "fulfilled" ? "good" : p.outcome === "waiting" ? "warn" : undefined; keep("outcome", "reason", "hours", "candidates"); break;
    case "request_withdrawn_want": text = "Request closed: the want was withdrawn"; break;
    case "trust": text = `Trust ${String(p.from).toUpperCase()} → ${String(p.to).toUpperCase()} (${human(p.why)})`; severity = p.to === "ok" ? "info" : "bad"; keep("from", "to", "why", "score"); break;
    case "abuse": text = `Abuse handled: ${(p.kinds as string[] | undefined)?.map(human).join(", ") ?? "?"}`; severity = "bad"; keep("risk"); break;
    case "safety_action": text = `Staff ${human(p.action)}${p.actor ? ` by ${p.actor}` : ""}${p.caseId ? ` (case ${p.caseId})` : ""}`; keep("action", "caseId", "actor", "held"); break;
    case "guard_blocked": text = `Leak guard stopped a ${human(p.kind ?? "message")} (${(p.reasons as string[] | undefined)?.join(", ") ?? "leak"}): ${p.fallback ? "a generic version was sent" : "nothing sent"}`; severity = "warn"; keep("kind", "fallback"); if (Array.isArray(p.reasons)) detail.reasons = p.reasons.join(","); break;
    case "send_refused": text = `Send refused: ${human(p.kind)} (${human(p.reason)})`; severity = "warn"; keep("kind", "reason"); break;
    case "send_skipped": text = `Send skipped: ${human(p.kind)} (${human(p.reason)})`; keep("kind", "reason"); break;
    case "age_unknown": text = "No valid age: treated as under 18 until they say"; severity = "warn"; break;
    case "age_resolved": text = `Age given: ${p.minor ? "under 18 (single-player only)" : "18 or over"}`; keep("minor"); break;
    case "age_conflict": text = p.attestedAge === undefined ? "Said an age under 13, not as an explicit age: treated as under 18; staff to check" : "Stated age conflicts with the age on record: treated as under 18; staff to check"; severity = "warn"; break;
    case "minor_signal": text = "Under 18: single-player only, never introduced"; severity = "warn"; break;
    case "join_declined": text = "Someone under 13 tried to join: declined, nothing kept"; severity = "warn"; break;
    case "invite": text = `Invited a friend${p.newMemberId ? ` (${name(p.newMemberId)} joined)` : " (they did not join)"}`; severity = "good"; break;
    case "growth_ask": text = `Growth ask (${human(p.kind)})`; keep("kind"); break;
    case "reengagement": text = "Re-engagement message (the one allowed after silence)"; break;
    case "only_when_asked": text = `Moved to "only when I ask" after ${p.unanswered} unanswered`; severity = "warn"; keep("unanswered"); break;
    case "outreach_resumed": text = "Outreach resumed (they wrote again)"; break;
    case "ask_sent": text = `Profile question sent (${human(p.reason)})`; keep("reason"); break;
    case "ask_answered": text = `Profile question answered (${human(p.reason)})`; keep("reason"); break;
    default: break;
  }
  const memberId = subjectOf(row);
  return { t, type: row.type, text, ...(severity ? { severity } : {}), ...(memberId ? { memberId } : {}), ...(opportunityId ? { opportunityId } : {}), ...(Object.keys(detail).length ? { detail } : {}) };
}

/**
 * Does a row belong on this member's timeline? Rows that name them, and opportunity-level rows (no
 * single subject) for opportunities they are in. Another member's own answer is not shown.
 */
export function onTimeline(row: EventRow, memberId: MemberId, theirOpps: ReadonlySet<string>): boolean {
  const subject = subjectOf(row);
  if (subject) return subject === memberId || (row.type === "member_blocked" && row.object_id === memberId);
  if (membersOf(row).includes(memberId)) return true;
  return row.object_type === "opportunity" && !!row.object_id && theirOpps.has(row.object_id);
}
