// Health alerts (admin-console 3.10), the PRD 28.2 scorecard and growth, computed the same way in
// both modes. Each source gathers the inputs (game: run records and the Network; real: rows and
// events) and these functions do the arithmetic, so the two modes cannot drift apart.
import { DAY, HOUR, type MemberId } from "@thenetwork/core";
import { SIM_AUTO_REVIEWER, URGENT_REPORTS } from "@thenetwork/network";
import { ENJOYED } from "./projector.ts";
import { matchingAllowed, type AppId } from "./apps.ts";
import type { AppHealth, CohortActivation, GrowthStats, HealthAlert, ObsMember, ObsOpportunity, ObsRequest, ObsSafetyCase, ObsState, ReportKind, SafetyInfo, SafetyReport, ScoreMetric } from "./types.ts";

/** Alerts look at the last 24 hours (sim time in game mode) unless they say otherwise. */
export const ALERT_WINDOW = DAY;
/** An open review item due within this long is "near its SLA". */
export const NEAR_SLA = HOUR;
/** The engine runs once a day; no run for longer than this is a missed heartbeat. */
export const HEARTBEAT = 26 * HOUR;
/** Deferred sends waiting for their window: warn at this many. */
export const DEFERRED_WARN = 25;

export interface AlertInput {
  now: number;
  /** Open review items. */
  reviewOpen: { deadline: number; queuedAt?: number }[];
  /** The app's review SLA (src/apps.ts): an open item queued longer ago is an SLA miss. */
  sla?: { app: string; hours: number };
  /** Review items that expired unsent in the window. */
  reviewExpired: number;
  /** Sends waiting for the sending window (null: unknown). */
  deferred: number | null;
  /** Sends refused in the window, by reason. */
  refusals: Record<string, number>;
  /** Leak-guard blocks in the window. */
  guardBlocked: number;
  /** Last engine run (undefined: none yet). */
  lastEngineRun?: number;
  /** Is the matcher expected to run (consent Network or a production matcher)? */
  expectEngine: boolean;
  matchingEnabled: boolean;
  /** The app's engine pack has not shipped: matching stays off whatever the switch says. */
  matchingLocked?: boolean;
  /** When the world or the data starts (the heartbeat allows the first day to pass). */
  start: number;
  invariants: number | null; canaryLeaks: number | null; minorContacts: number | null;
  /** Alerts a source adds (real mode: the Network service's health). */
  extra?: HealthAlert[];
}

const LEVEL = { bad: 0, warn: 1, info: 2 } as const;

export function healthAlerts(x: AlertInput): HealthAlert[] {
  const out: HealthAlert[] = [];
  const add = (level: HealthAlert["level"], key: string, count: number, text: string) => out.push({ level, key, count, text });
  if (x.reviewExpired > 0) add("bad", "review_sla_missed", x.reviewExpired, `${x.reviewExpired} review item(s) expired unsent in the last 24 h (SLA missed)`);
  const overdue = x.reviewOpen.filter(r => r.deadline <= x.now).length;
  const near = x.reviewOpen.filter(r => r.deadline > x.now && r.deadline - x.now <= NEAR_SLA).length;
  if (overdue) add("bad", "review_overdue", overdue, `${overdue} review item(s) past the SLA and not yet expired`);
  const slaMs = x.sla ? x.sla.hours * HOUR : Infinity;
  const late = x.reviewOpen.filter(r => r.queuedAt !== undefined && x.now - r.queuedAt > slaMs && r.deadline > x.now).length;
  if (late && x.sla) add("bad", "review_app_sla", late, `${late} review item(s) waiting longer than the ${x.sla.app} SLA (${x.sla.hours} h)`);
  if (near) add("warn", "review_near_sla", near, `${near} review item(s) due within 1 hour`);
  if (x.reviewOpen.length) add("info", "review_queue", x.reviewOpen.length, `${x.reviewOpen.length} item(s) waiting for review`);
  if (x.deferred !== null && x.deferred > 0)
    add(x.deferred >= DEFERRED_WARN ? "warn" : "info", "deferred_backlog", x.deferred, `${x.deferred} send(s) waiting for the sending window`);
  for (const [reason, n] of Object.entries(x.refusals).sort((a, b) => b[1] - a[1]))
    if (n > 0) add("info", `send_refused:${reason}`, n, `${n} send(s) refused in the last 24 h: ${reason.replace(/_/g, " ")}`);
  if (x.guardBlocked > 0) add("warn", "guard_blocked", x.guardBlocked, `The leak guard stopped ${x.guardBlocked} message(s) in the last 24 h`);
  if (x.expectEngine) {
    if (x.matchingLocked) add("info", "matching_off", 0, "Proactive matching is off until this app's engine pack ships: joins, onboarding and safety only");
    else if (!x.matchingEnabled) add("info", "matching_off", 0, "Proactive matching is off (admin switch): no engine runs");
    else if (x.lastEngineRun === undefined) { if (x.now - x.start > HEARTBEAT) add("bad", "matcher_heartbeat", 0, "No engine run yet"); }
    else if (x.now - x.lastEngineRun > HEARTBEAT) {
      const h = Math.round((x.now - x.lastEngineRun) / HOUR);
      add("bad", "matcher_heartbeat", h, `Last engine run was ${h} h ago (expected daily)`);
    }
  }
  if (x.invariants) add("bad", "invariant_violations", x.invariants, `${x.invariants} invariant violation(s)`);
  if (x.canaryLeaks) add("bad", "canary_leaks", x.canaryLeaks, `${x.canaryLeaks} canary leak(s)`);
  if (x.minorContacts) add("bad", "minor_contacts", x.minorContacts, `${x.minorContacts} minor contact(s)`);
  out.push(...(x.extra ?? []));
  return out.sort((a, b) => LEVEL[a.level] - LEVEL[b.level]);
}

/** A message without its text (scorecard input). */
export interface MsgMeta { memberId: MemberId; ts: number; direction: "inbound" | "outbound"; proactive?: boolean; status: string }

export interface ScoreInput {
  now: number; start: number;
  members: ObsMember[]; opps: ObsOpportunity[]; messages: MsgMeta[]; requests: ObsRequest[];
  /** When each member opted out. */
  optOutAt: Map<MemberId, number>;
  invites: number; accepts: number;
  /** Review seconds recorded, and the proposals a person approved that started (not invalidated; the simulated reviewer excluded). */
  reviewSeconds: number; sentProposals: number;
  inviters: number;
  minorContacts: number | null; leaks: number | null;
}

const HELD = new Set(["COMPLETED", "FEEDBACK_COLLECTED"]);
const AGREED = new Set(["MUTUALLY_ACCEPTED", "QUORUM_MET", "SCHEDULED", "COMPLETED", "FEEDBACK_COLLECTED", "ABANDONED"]);
const ANSWER_WINDOW = 72 * HOUR;
const FIRST_VALUE_DAYS = 14;
const REPEAT_DAYS = 60;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
function metric(m: Omit<ScoreMetric, "met">): ScoreMetric {
  const t = m.target, v = m.value;
  const met = v === null || !t ? undefined : t.op === ">=" ? v >= t.value : t.op === "<=" ? v <= t.value : v === t.value;
  return { ...m, value: v === null ? null : r3(v), ...(met === undefined ? {} : { met }) };
}
const share = (a: number, b: number) => (b > 0 ? a / b : null);

/** When each member first got something of value: an attended meeting, a fulfilled people request, or an answered plans request. */
export function firstValue(opps: ObsOpportunity[], requests: ObsRequest[]): Map<MemberId, number> {
  const first = new Map<MemberId, number>();
  const see = (id: MemberId, t: number | undefined) => { if (t !== undefined && t < (first.get(id) ?? Infinity)) first.set(id, t); };
  for (const o of opps) {
    if (o.source === "shadow" || !HELD.has(o.state)) continue;
    for (const id of o.participants) if (o.status[id] === "attended") see(id, o.meetingAt ?? o.updatedAt);
  }
  for (const r of requests) {
    if (r.outcome === "fulfilled") see(r.memberId, r.fulfilledAt ?? r.openedAt);
    else if (r.outcome === "answered") see(r.memberId, r.openedAt);
  }
  return first;
}

export function scorecard(x: ScoreInput): ScoreMetric[] {
  const joined = x.members.filter(m => m.joined && !m.declined);
  const opps = x.opps.filter(o => o.source !== "shadow");

  // Worthwhile-interruption proxy: a proactive message the member answered within 72 h, and no STOP in that time.
  const byMember = new Map<MemberId, MsgMeta[]>();
  for (const m of x.messages) { if (!byMember.has(m.memberId)) byMember.set(m.memberId, []); byMember.get(m.memberId)!.push(m); }
  let proactive = 0, worthwhile = 0;
  for (const [id, ms] of byMember) {
    ms.sort((a, b) => a.ts - b.ts);
    const inbound = ms.filter(m => m.direction === "inbound").map(m => m.ts);
    const stop = x.optOutAt.get(id);
    for (const m of ms) {
      if (m.direction !== "outbound" || !m.proactive || m.status !== "delivered") continue;
      if (x.now - m.ts < ANSWER_WINDOW && !inbound.some(t => t > m.ts)) continue; // still inside its window
      proactive++;
      const answered = inbound.some(t => t > m.ts && t - m.ts <= ANSWER_WINDOW);
      const stopped = stop !== undefined && stop >= m.ts && stop - m.ts <= ANSWER_WINDOW;
      if (answered && !stopped) worthwhile++;
    }
  }

  // Completion: held meetings over mutually accepted opportunities whose meeting time has passed.
  const agreed = opps.filter(o => AGREED.has(o.state) && !(o.state === "SCHEDULED" && (o.meetingAt ?? 0) > x.now) && o.state !== "MUTUALLY_ACCEPTED" && o.state !== "QUORUM_MET");
  const held = opps.filter(o => HELD.has(o.state));

  // Repeat edges: pairs whose first held meeting was positive for both, who met again within 60 days.
  const meetings = held.map(o => ({ t: o.meetingAt ?? o.updatedAt, ids: o.participants.filter(id => o.status[id] === "attended"), o })).sort((a, b) => a.t - b.t);
  const firstMeet = new Map<string, { t: number; positive: boolean }>();
  const again = new Set<string>();
  for (const m of meetings) for (let i = 0; i < m.ids.length; i++) for (let j = i + 1; j < m.ids.length; j++) {
    const a = m.ids[i]!, b = m.ids[j]!, key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const f = firstMeet.get(key);
    if (!f) firstMeet.set(key, { t: m.t, positive: (m.o.enjoyment[a] ?? 0) >= ENJOYED && (m.o.enjoyment[b] ?? 0) >= ENJOYED });
    else if (f.positive && m.t - f.t <= REPEAT_DAYS * DAY) again.add(key);
  }
  const positive = [...firstMeet.values()].filter(f => f.positive).length;

  // First meaningful outcome within 14 days of joining, for members who joined at least 14 days ago.
  const first = firstValue(opps, x.requests);
  const due = joined.filter(m => m.joinedAt !== undefined && x.now - m.joinedAt >= FIRST_VALUE_DAYS * DAY);
  const fast = due.filter(m => { const t = first.get(m.id); return t !== undefined && t - m.joinedAt! <= FIRST_VALUE_DAYS * DAY; }).length;

  // Shadow precision (PRD 34.6 and the 32.8 precision gate): engine proposals a person decided (shadow runs
  // included; the simulated reviewer and expiries left out), approved without an edit, over approved plus
  // rejected. The baseline that must hold before matching is switched on.
  const decided = x.opps.filter(o => (o.source === "engine" || o.source === "shadow") && o.review?.reviewer && o.review.reviewer !== SIM_AUTO_REVIEWER
    && (o.review.decision === "approve" || o.review.decision === "reject"));
  const clean = decided.filter(o => o.review!.decision === "approve" && !(o.review!.edits?.length)).length;

  const weeks = Math.max((x.now - x.start) / (7 * DAY), 1 / 7);
  const delivered = x.messages.filter(m => m.direction === "outbound" && m.proactive && m.status === "delivered").length;
  const optedOut = joined.filter(m => m.state === "opted_out").length;

  return [
    metric({ key: "worthwhile_interruption", label: "Worthwhile interruptions (proxy)", value: share(worthwhile, proactive), unit: "share", n: proactive, target: { op: ">=", value: 0.7 },
      how: "Proactive messages the member answered within 72 hours without a STOP. The PRD measure asks a sample 'Was that worth a text?', which is not built." }),
    metric({ key: "opt_in", label: "Opt-in rate", value: share(x.accepts, x.invites), unit: "share", n: x.invites, target: { op: ">=", value: 0.4 },
      how: "Yes answers to sent proposals (reveals) over proposals sent to a member." }),
    metric({ key: "completion", label: "Completion", value: share(held.length, agreed.length), unit: "share", n: agreed.length, target: { op: ">=", value: 0.7 },
      how: "Meetings held over mutually accepted opportunities whose meeting time has passed." }),
    metric({ key: "repeat_edges", label: "Second interactions", value: share(again.size, positive), unit: "share", n: positive, target: { op: ">=", value: 0.2 },
      how: "Pairs whose first meeting both enjoyed (>= 0.6) who met again through the Network within 60 days. Direct meetings are not seen, so this is a lower bound." }),
    metric({ key: "first_value_14d", label: "First outcome in 14 days", value: share(fast, due.length), unit: "share", n: due.length, target: { op: ">=", value: 0.6 },
      how: "Members who joined at least 14 days ago and attended a meeting, or had a request fulfilled or answered, within 14 days of joining." }),
    metric({ key: "attention_burden", label: "Proactive messages per member per week", value: joined.length ? delivered / joined.length / weeks : null, unit: "per_member_week", n: delivered,
      how: "Delivered agent-started messages, per joined member, per week of the period." }),
    metric({ key: "reviewer_minutes", label: "Reviewer minutes per sent proposal", value: x.reviewSeconds > 0 && x.sentProposals > 0 ? x.reviewSeconds / 60 / x.sentProposals : null, unit: "minutes", n: x.sentProposals, target: { op: "<=", value: 2 },
      how: "Recorded review time over opportunities a person approved that started (the simulated reviewer is left out). No value until reviewers record time." }),
    metric({ key: "shadow_precision", label: "Shadow precision (approved without edits)", value: share(clean, decided.length), unit: "share", n: decided.length, target: { op: ">=", value: 0.8 },
      how: "Engine proposals (shadow runs included) a person approved without an edit, over those a person approved or rejected. The simulated reviewer and expired items are left out. PRD 32.8 precision gate; PRD 34.6 shadow mode." }),
    metric({ key: "opt_outs", label: "Opt-out rate", value: share(optedOut, joined.length), unit: "share", n: joined.length, target: { op: "<=", value: 0.05 },
      how: "Joined members who texted STOP (the PRD mute and complaint rate; mutes are not recorded separately)." }),
    metric({ key: "invite_rate", label: "Members who invited someone", value: share(x.inviters, joined.length), unit: "share", n: joined.length, target: { op: ">=", value: 0.3 },
      how: "Joined members who sent at least one invite." }),
    metric({ key: "minors_contacted", label: "Minor contacts", value: x.minorContacts, unit: "count", n: x.minorContacts ?? 0, target: { op: "==", value: 0 },
      how: "Members under 18 contacted about another member (judge scorer in game mode; in real mode, messages about an opportunity while the recipient or anyone in it was treated as under 18, by the record age or the Network's age state)." }),
    metric({ key: "leaks", label: "Leaks", value: x.leaks, unit: "count", n: x.leaks ?? 0, target: { op: "==", value: 0 },
      how: "Canary leaks (judge scorer in game mode; leak or canary invariant events in real mode)." }),
  ];
}

export interface GrowthInput {
  members: ObsMember[]; opps: ObsOpportunity[]; requests: ObsRequest[];
  /** Members who joined through an invite made in the Network. */
  invitees: ReadonlySet<MemberId>;
  invitesSent: number; growthAsks: number; inviters: number;
}

export function growthStats(x: GrowthInput): GrowthStats {
  const first = firstValue(x.opps, x.requests);
  const cohort = (ms: ObsMember[]): CohortActivation => {
    const joined = ms.filter(m => m.joined && !m.declined);
    const activated = joined.filter(m => first.has(m.id)).length;
    return { members: ms.length, joined: joined.length, activated, rate: joined.length ? r3(activated / joined.length) : null };
  };
  const all = x.members.filter(m => !m.declined);
  const joined = all.filter(m => m.joined).length;
  return {
    invitesSent: x.invitesSent, inviteesJoined: all.filter(m => x.invitees.has(m.id) && m.joined).length, growthAsks: x.growthAsks,
    inviterShare: joined ? r3(x.inviters / joined) : null,
    seed: cohort(all.filter(m => !x.invitees.has(m.id))), invitees: cohort(all.filter(m => x.invitees.has(m.id))),
  };
}

/** Hours, rounded to 0.1. */
export const hours = (ms: number) => Math.round((ms / HOUR) * 10) / 10;

// ---------------------------------------------------------------- safety console (gap 7)
/** Kinds that make a case urgent (PRD 36.3: 1-hour target). Others: 24 hours. */
const URGENT = new Set(["harassment", "scam_money", "contact_extraction"]);
const CLOSED_OPP = new Set(["COMPLETED", "FEEDBACK_COLLECTED", "DECLINED", "EXPIRED", "CANCELLED", "SKIPPED", "ABANDONED", "QUORUM_FAILED"]);

export interface SafetyInput {
  now: number;
  cases: { id: string; memberId: MemberId; opened: number; level: "ok" | "watch" | "hold"; status: ObsSafetyCase["status"]; events: ObsSafetyCase["events"]; closedAt?: number; closedBy?: string }[];
  members: ObsMember[]; opps: ObsOpportunity[];
  watch: MemberId[]; hold: MemberId[];
  canAct: boolean;
  /** Post-date reports (before urgency and due times), when the source has them. */
  reports?: Pick<SafetyReport, "id" | "kind" | "reporterId" | "subjectId" | "opportunityId" | "at" | "status">[];
  /** Hold and ban by phone or person can be sent (real mode with the Network service). */
  canBan?: boolean;
}

/** Report kinds with a 1-hour target (PRD 36.3): the Network's own set, so the two cannot drift. */
export { URGENT_REPORTS };

/**
 * Post-date reports from the Network's safety cases, when no report store answers (game mode, or real
 * mode without the service): each report_received event whose reporter and subject were both in an
 * opportunity that reached a meeting time (they had a date). The kind comes from the case's other
 * events (harassment, money scam), else "other".
 */
export function reportsFromCases(cases: SafetyInput["cases"], opps: ObsOpportunity[]): NonNullable<SafetyInput["reports"]> {
  const met = new Set<string>();
  const dateOf = new Map<string, string>();
  for (const o of opps) {
    if (o.source === "shadow" || o.meetingAt === undefined) continue;
    for (const a of o.participants) for (const b of o.participants) if (a !== b) { met.add(`${a}|${b}`); dateOf.set(`${a}|${b}`, o.id); }
  }
  const out: NonNullable<SafetyInput["reports"]> = [];
  for (const c of cases) {
    const kinds = new Set(c.events.map(e => e.kind));
    const kind: ReportKind = kinds.has("harassment") ? "harassment" : kinds.has("scam_money") ? "scam" : "other";
    for (const e of c.events) {
      if (e.kind !== "report_received" || !e.by || !met.has(`${e.by}|${c.memberId}`)) continue;
      const opp = dateOf.get(`${e.by}|${c.memberId}`);
      out.push({
        id: `${c.id}:${e.by}:${e.at}`, kind, reporterId: e.by, subjectId: c.memberId, at: e.at, ...(opp ? { opportunityId: opp } : {}),
        status: c.status === "closed" ? "dismissed" : c.level === "hold" || c.status === "held" ? "held" : "open",
      });
    }
  }
  return out;
}

/** Post-date reports with urgency, due time and earlier reports about the same subject; open ones first (urgent, then oldest). */
export function reportQueue(now: number, rows: NonNullable<SafetyInput["reports"]>): SafetyReport[] {
  const out = rows.map((r): SafetyReport => {
    const urgent = URGENT_REPORTS.has(r.kind);
    const dueAt = r.at + (urgent ? HOUR : DAY);
    const priorReports = rows.filter(x => x.subjectId === r.subjectId && x.id !== r.id && x.at < r.at).length;
    return { ...r, urgent, dueAt, overdue: r.status === "open" && now > dueAt, priorReports };
  });
  const rank = (r: SafetyReport) => (r.status !== "open" ? 2 : r.urgent ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || a.at - b.at);
}

export function safetyInfo(x: SafetyInput): SafetyInfo {
  const name = new Map(x.members.map(m => [m.id, m.name]));
  const cases = x.cases.map((c): ObsSafetyCase => {
    const urgent = c.level === "hold" || c.events.some(e => URGENT.has(e.kind));
    const dueAt = c.opened + (urgent ? HOUR : DAY);
    return {
      id: c.id, memberId: c.memberId, memberName: name.get(c.memberId) ?? c.memberId, level: c.level, status: c.status, opened: c.opened,
      ...(c.closedAt !== undefined ? { closedAt: c.closedAt } : {}), ...(c.closedBy ? { closedBy: c.closedBy } : {}),
      events: c.events.map(e => ({ at: e.at, kind: e.kind, points: e.points, ...(e.by ? { by: e.by } : {}) })),
      urgent, dueAt, overdue: (c.status === "open" || c.status === "held") && x.now > dueAt,
    };
  });
  const rank = (c: ObsSafetyCase) => (c.status === "closed" ? 2 : c.urgent ? 0 : 1);
  cases.sort((a, b) => rank(a) - rank(b) || a.opened - b.opened);
  const treated = x.members.filter(m => m.minor && !m.declined && m.joined);
  const minors = treated.filter(m => !m.ageUnknown).map(m => m.id), unknownAge = treated.filter(m => m.ageUnknown).map(m => m.id);
  const minorSet = new Set(treated.map(m => m.id));
  const inOpportunities = x.opps
    .filter(o => o.source !== "shadow" && !CLOSED_OPP.has(o.state) && o.participants.length >= 2)
    .flatMap(o => o.participants.filter(id => minorSet.has(id)).map(id => ({ opportunityId: o.id, memberId: id, state: o.state })));
  return {
    cases, watch: x.watch, hold: x.hold, minors: { members: minors, unknownAge, inOpportunities }, canAct: x.canAct,
    ...(x.reports ? { reports: reportQueue(x.now, x.reports) } : {}), ...(x.canBan !== undefined ? { canBan: x.canBan } : {}),
  };
}

/**
 * One app's line in the "all apps" health view (platform plan 5: review backlog, SLA misses, send
 * failures). From the app's own state, so it shows the same numbers as the app's Overview.
 */
export function appHealth(app: AppId, st: ObsState, slaHours: number): AppHealth {
  const now = st.clock.now, alerts = st.stats.alerts ?? [];
  const open = st.opportunities.filter(o => o.state === "IN_REVIEW" && o.source !== "shadow");
  const late = open.filter(o => o.review && now - o.review.queuedAt > slaHours * HOUR).length;
  const expired = alerts.find(a => a.key === "review_sla_missed")?.count ?? 0;
  const failures = alerts.filter(a => a.key.startsWith("send_refused:") || a.key.startsWith("service_channel:") || a.key === "guard_blocked").reduce((n, a) => n + a.count, 0);
  const worst = alerts.map(a => a.level).sort((a, b) => LEVEL[a] - LEVEL[b])[0];
  return {
    app, available: !st.env.error, ...(st.env.error ? { error: st.env.error } : {}),
    members: st.members.filter(m => m.joined && !m.declined).length, reviewBacklog: open.length, slaMisses: late + expired, slaHours, sendFailures: failures,
    matching: !matchingAllowed(app) ? "locked" : st.network?.matchingEnabled === false ? "off" : "on", ...(worst ? { worst } : {}),
  };
}
