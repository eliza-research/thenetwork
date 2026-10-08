// Event-sourced projection: simulator run records (packages/judge/src/runlog.ts) -> observatory
// state. Opportunities follow the PRD 32.10 state machine as far as the records reveal it; the
// edges the Network learns follow PRD 32.13 (introduced, met, enjoyed, would_interact_again, avoid).
import { UNDER_MIN_AGE_DECLINE, type MemberId, type Proposal } from "@thenetwork/core";
import type { RunRecord } from "@thenetwork/judge";
import { requestLabel } from "./events.ts";
import { emptyCounters, type Store } from "./store.ts";
import type { MemberStatus, ObsOpportunity, OppSource, OppState, ParticipantStatus, ReviewInfo, ReviewReason, TimeChoice } from "./types.ts";

export const ENJOYED = 0.6, WOULD_AGAIN = 0.75, AVOID = 0.2;
const TERMINAL: ReadonlySet<OppState> = new Set<OppState>([
  "COMPLETED", "FEEDBACK_COLLECTED", "DECLINED", "EXPIRED", "CANCELLED", "SKIPPED", "ABANDONED", "QUORUM_FAILED",
]);
export const isTerminal = (s: OppState) => TERMINAL.has(s);

export interface ProjectorOptions {
  /** State a member takes when they join (from their profile: normal, quiet...). */
  joinState?: (id: MemberId) => MemberStatus;
  /** Engine run id that produced a proposal (engine capture). */
  runOf?: (proposalId: string) => string | undefined;
  /** Called after an opportunity changes (game scoring, missions). */
  onOpp?: (o: ObsOpportunity, rec: RunRecord) => void;
  /** True when a simulated reviewer approves everything (review "auto"): no feed item per queued opportunity. */
  quietReview?: () => boolean;
}

export class Projector {
  private meetings = new Map<string, string>(); // meetingId -> proposalId
  /** The member who last received the under-13 decline (join_declined itself carries no member id). */
  private declineTo?: MemberId;
  /** Opportunities already counted in their participants' proposal counters. */
  private counted = new Set<string>();
  /** Booked-plan messages (SimMeta.booked): the plan is booked when it reaches the member; only a typed "can't" or no undoes it. */
  private booked = new Set<string>();
  /** The last times offered to each member (a requester's time question names no opportunity; its answer does). */
  private lastOptions = new Map<MemberId, TimeChoice[]>();
  constructor(private store: Store, private opts: ProjectorOptions = {}) {}

  private name(id: MemberId) { return this.store.member(id)?.name.split(" ")[0] ?? id; }
  private names(ids: MemberId[]) {
    const n = ids.map(id => this.name(id));
    return n.length <= 2 ? n.join(" & ") : `${n.slice(0, -1).join(", ")} & ${n[n.length - 1]}`;
  }
  private counters(id: MemberId) {
    const m = this.store.member(id);
    if (!m) return undefined;
    this.store.touchMember(id);
    return m.counters;
  }
  /** State each opportunity was in when last seen (time in state). */
  private lastState = new Map<string, OppState>();
  private changed(o: ObsOpportunity, rec: RunRecord) {
    o.updatedAt = rec.t;
    if (this.lastState.get(o.id) !== o.state) { this.lastState.set(o.id, o.state); o.stateSince = rec.t; }
    this.store.touchOpp(o.id);
    this.opts.onOpp?.(o, rec);
  }
  /**
   * Proposal counters: an opportunity counts for its participants once, when it can reach them. One
   * that waits for review (PRD 32.8) counts only when a reviewer approves it.
   */
  private count(o: { id: string; participants: MemberId[] }, delta: 1 | -1 = 1) {
    if ((delta === 1) === this.counted.has(o.id)) return;
    if (delta === 1) this.counted.add(o.id); else this.counted.delete(o.id);
    for (const id of o.participants) { const k = this.counters(id); if (k) k.proposals += delta; }
  }
  private setState(o: ObsOpportunity, s: OppState, reason?: string) {
    if (o.state === s) return;
    o.state = s;
    if (reason) o.reason = reason;
  }

  apply(r: RunRecord) {
    const s = this.store, c = s.counts;
    switch (r.type) {
      case "join": {
        const m = s.member(r.memberId);
        if (!m) return;
        m.joined = true; m.joinedAt = r.t;
        if (m.state === "not_joined") m.state = this.opts.joinState?.(m.id) ?? "normal";
        s.touchMember(m.id);
        s.pushFeed({ t: r.t, kind: "join", text: `${m.name} joined the Network`, members: [m.id] });
        return;
      }
      case "message": {
        const msg = r.msg;
        if (msg.system) return;
        c.messages++;
        const k = this.counters(msg.memberId);
        if (msg.direction === "inbound") { c.inbound++; if (k) k.msgsIn++; return; }
        c.outbound++;
        if (k) k.msgsOut++;
        if (msg.body === UNDER_MIN_AGE_DECLINE) this.declineTo = msg.memberId;
        if (msg.meta?.proactive && msg.status === "delivered") { c.proactive++; if (k) k.proactive++; }
        if (msg.meta?.booked) this.booked.add(msg.id);
        this.timesAndBooking(msg, r);
        const pid = msg.meta?.proposalId;
        const o = pid ? s.opps.get(pid) : undefined;
        if (!o) return;
        if (msg.meta?.type === "proposal") {
          c.invites++;
          if (o.status[msg.memberId] === "pending") o.status[msg.memberId] = "invited";
          if (o.state === "PROPOSED") this.setState(o, "INVITING");
          this.changed(o, r);
        } else if (msg.meta?.type === "cancellation" && /calling this one off/i.test(msg.body) && !isTerminal(o.state)) {
          this.setState(o, "CANCELLED", "participant dropped");
          this.changed(o, r);
          s.pushFeed({ t: r.t, kind: "skip", text: `${this.names(o.participants)}: called off after a drop`, members: o.participants, opportunityId: o.id, severity: "warn" });
        }
        return;
      }
      case "proposal": {
        const p = r.proposal;
        const source = r.source as OppSource;
        const prev = s.opps.get(p.id);
        const o: ObsOpportunity = {
          origin: prev?.origin, venue: prev?.venue, review: prev?.review, ...(prev?.times ? { times: prev.times } : {}), ...(prev?.booked ? { booked: prev.booked } : {}),
          id: p.id, kind: p.kind, source, generator: p.generator, category: p.category, city: p.city,
          objective: p.objective, score: p.score, components: p.components, explanations: p.explanations ?? {},
          exploration: p.exploration, participants: [...p.participants], alternates: [...(p.alternates ?? [])],
          state: "PROPOSED", status: Object.fromEntries(p.participants.map(id => [id, "pending" as ParticipantStatus])),
          enjoyment: {}, createdAt: prev?.createdAt ?? r.t, updatedAt: r.t, oracle: r.oracle, runId: prev?.runId ?? this.opts.runOf?.(p.id),
        };
        s.upsertOpp(o);
        if (!prev) this.count(o);
        this.opts.onOpp?.(o, r);
        if (source === "player" || source === "scenario") {
          s.pushFeed({ t: r.t, kind: "proposal", text: `${source === "player" ? "You proposed" : "Scenario proposed"} ${p.kind.replace(/_/g, " ")}: ${this.names(p.participants)}`, members: p.participants, opportunityId: p.id });
        }
        return;
      }
      case "decision": {
        const o = r.proposalId ? s.opps.get(r.proposalId) : undefined;
        if (!o || !(r.memberId in o.status)) return;
        let st: ParticipantStatus | undefined;
        // A booked plan (the reveal with an opt-out) is a yes when it arrives (below); only a typed no or "can't" changes it.
        const bookedMsg = this.booked.has(r.messageId);
        if (bookedMsg && r.intent !== "decline" && r.intent !== "booked_cancel") return;
        const said = bookedMsg ? "decline" : r.intent;
        if (r.messageType === "proposal") {
          if (said === "accept") st = "accepted";
          else if (said === "decline") st = "declined";
          else if (said === "counter") st = "countered";
          else if (said === "ignore" || said === "ack" || said === "none") st = "ignored";
        } else if (r.intent === "flake_notice") st = "cancelled_with_notice";
        if (!st || isTerminal(o.state) && st !== "cancelled_with_notice") return;
        const prev = o.status[r.memberId];
        if (prev === st) return;
        o.status[r.memberId] = st;
        if (st === "accepted" || st === "countered") { c.accepts++; const k = this.counters(r.memberId); if (k) k.accepted++; }
        if (st === "declined") { c.declines++; if (prev === "accepted" || prev === "countered" || prev === "confirmed") c.accepts--; }
        if (st === "accepted" || st === "declined") {
          s.pushFeed({ t: r.t, kind: st === "accepted" ? "accept" : "decline", text: `${this.name(r.memberId)} ${st === "accepted" ? "said yes to" : "passed on"} ${o.participants.length > 2 ? "a group" : "meeting " + this.names(o.participants.filter(x => x !== r.memberId))}`, members: [r.memberId], opportunityId: o.id, severity: st === "accepted" ? "good" : undefined });
        }
        this.recomputeConsent(o, r);
        this.changed(o, r);
        return;
      }
      case "meeting_scheduled": {
        const o = s.opps.get(r.proposalId);
        if (!this.meetings.has(r.meetingId)) { c.meetingsScheduled++; this.meetings.set(r.meetingId, r.proposalId); }
        if (!o) return;
        this.setState(o, "SCHEDULED");
        o.meetingAt = r.at;
        for (const id of r.participants) {
          // A booked plan (attention v1.2) is booked before anyone is told: a member who had not said yes in
          // words is in by default (silence = in), so they count as a yes here.
          if (o.status[id] !== "accepted" && o.status[id] !== "countered" && o.status[id] !== "cancelled_with_notice") { c.accepts++; const k = this.counters(id); if (k) k.accepted++; }
          if (o.status[id] !== "cancelled_with_notice") o.status[id] = "confirmed";
        }
        for (const [id, st] of Object.entries(o.status)) if (st === "pending" || st === "invited" || st === "ignored") o.status[id] = "dropped";
        this.changed(o, r);
        s.pushFeed({ t: r.t, kind: "meeting", text: `Meeting set: ${this.names(r.participants)}`, members: r.participants, opportunityId: o.id, severity: "good" });
        return;
      }
      case "outcome": {
        const o = s.opps.get(r.proposalId);
        const showed = Object.entries(r.attendance).filter(([, a]) => a.showed).map(([id]) => id);
        for (const [id, a] of Object.entries(r.attendance)) {
          // A member who said no to a booked plan was not expected: not a no-show (the plan is booked first).
          if (!a.showed && o?.status[id] === "declined") continue;
          if (a.showed) c.attended++; else if (a.cancelledWithNotice) c.cancelledWithNotice++; else c.noShows++;
          if (o) {
            o.status[id] = a.showed ? "attended" : a.cancelledWithNotice ? "cancelled_with_notice" : "no_show";
            if (a.showed) o.enjoyment[id] = a.enjoyment;
          }
          if (a.showed) {
            const k = this.counters(id);
            if (k) { k.meetings++; if (showed.length >= 2) { k.enjoymentSum += a.enjoyment; k.enjoymentN++; } }
          }
        }
        const held = showed.length >= 2;
        if (held) {
          c.meetingsHeld++;
          for (const id of showed) { c.enjoymentSum += r.attendance[id]!.enjoyment; c.enjoymentN++; }
          this.learnEdges(showed, r.attendance, r.t);
        }
        if (o) { this.setState(o, held ? "COMPLETED" : "ABANDONED", held ? undefined : "not enough people showed"); this.changed(o, r); }
        const mean = held ? showed.reduce((a, id) => a + r.attendance[id]!.enjoyment, 0) / showed.length : 0;
        const ids = Object.keys(r.attendance);
        s.pushFeed({
          t: r.t, kind: "outcome", members: ids, opportunityId: r.proposalId,
          text: held ? `${this.names(showed)} met · enjoyment ${(mean * 100).toFixed(0)}%` : `${this.names(ids)}: meeting fell through`,
          severity: !held ? "warn" : mean >= ENJOYED ? "good" : mean < AVOID ? "bad" : "info",
        });
        return;
      }
      case "feedback": {
        const o = r.proposalId ? s.opps.get(r.proposalId) : undefined;
        if (!o) return;
        (o.feedback ??= []).push({ memberId: r.memberId, text: r.text });
        if (o.state === "COMPLETED") this.setState(o, "FEEDBACK_COLLECTED");
        this.changed(o, r);
        s.pushFeed({ t: r.t, kind: "feedback", text: `${this.name(r.memberId)}: "${r.text.slice(0, 90)}"`, members: [r.memberId], opportunityId: o.id });
        return;
      }
      case "block": {
        c.blocks++;
        s.addEdge({ from: r.from, to: r.to, type: "blocked", strength: 1, createdAt: r.t, origin: "learned" });
        s.pushFeed({ t: r.t, kind: "block", text: `${this.name(r.from)} blocked ${this.name(r.to)}`, members: [r.from, r.to], severity: "warn" });
        return;
      }
      case "opt_out": {
        c.optOuts++;
        const m = s.member(r.memberId);
        if (m) { m.state = "opted_out"; s.touchMember(m.id); }
        s.pushFeed({ t: r.t, kind: "opt_out", text: `${this.name(r.memberId)} texted STOP`, members: [r.memberId], severity: "warn" });
        return;
      }
      case "adversarial_attempt":
        c.adversarialAttempts++;
        s.pushFeed({ t: r.t, kind: "adversarial", text: `${this.name(r.memberId)}: ${r.kind.replace(/_/g, " ")} attempt`, members: [r.memberId], severity: "bad" });
        return;
      case "invariant_violation":
        c.invariantViolations++;
        s.pushFeed({ t: r.t, kind: "invariant", text: `Invariant ${r.rule}: ${r.detail}`, members: r.memberId ? [r.memberId] : undefined, severity: "bad" });
        return;
      case "network_error":
        c.errors++;
        s.pushFeed({ t: r.t, kind: "error", text: r.error.split("\n")[0]!.slice(0, 200), severity: "bad" });
        return;
      case "network_log": {
        if (this.consentLog(r)) return;
        const pid = r.detail.proposalId as string | undefined;
        const o = pid ? s.opps.get(pid) : undefined;
        if (!o) return;
        if (r.kind === "proposal_skipped") {
          this.setState(o, "SKIPPED", String(r.detail.reason ?? "skipped"));
          this.changed(o, r);
          if (o.source === "player") s.pushFeed({ t: r.t, kind: "skip", text: `Your intro for ${this.names(o.participants)} was not sent: ${o.reason}`, members: o.participants, opportunityId: o.id, severity: "warn" });
        } else if (r.kind === "opportunity_closed" && !isTerminal(o.state) && o.state !== "SCHEDULED") {
          const reason = String(r.detail.reason ?? "closed");
          this.setState(o, reason === "declined" ? "DECLINED" : reason === "expired" ? "EXPIRED" : "CANCELLED", reason);
          if (reason === "expired") for (const [id, st] of Object.entries(o.status)) if (st === "invited" || st === "ignored") o.status[id] = "expired";
          this.changed(o, r);
        }
        return;
      }
      case "scenario":
        if (r.action === "propose") return;
        s.pushFeed({ t: r.t, kind: "scenario", text: `World: ${r.action.replace(/_/g, " ")}${r.detail?.persona ? ` (${this.name(String(r.detail.persona))})` : ""}`, members: r.detail?.persona ? [String(r.detail.persona)] : undefined });
        return;
      default:
        return;
    }
  }

  /** Events from the consent-first Network (packages/network). Returns true when handled. */
  private consentLog(r: Extract<RunRecord, { type: "network_log" }>): boolean {
    const s = this.store, d = r.detail as Record<string, any>;
    switch (r.kind) {
      case "review_queued": {
        // PRD 32.8: the opportunity waits for a reviewer; no member has heard about it yet.
        const p = d.proposal as Proposal;
        const prev = s.opps.get(p.id);
        if (prev && d.rerolled && prev.state === "IN_REVIEW") {
          // A re-roll: a participant was swapped for an alternate; it waits again with a new deadline.
          prev.participants = [...p.participants]; prev.alternates = [...(p.alternates ?? [])];
          prev.explanations = { ...(p.explanations ?? {}) };
          prev.status = Object.fromEntries(p.participants.map(id => [id, "pending" as ParticipantStatus]));
          prev.review = { ...prev.review!, deadline: Number(d.deadline) };
          this.changed(prev, r);
          return true;
        }
        if (prev && (prev.review || prev.state !== "PROPOSED")) return true;
        // A staff-composed or scenario proposal is already on the board (its "proposal" record); it waits too.
        const o = prev ? { ...prev, origin: String(d.origin ?? "player") } : this.consentOpp(p, String(d.origin ?? "network"), r.t, d.runId);
        o.state = "IN_REVIEW"; o.reason = "waiting for review (nobody contacted)";
        o.status = Object.fromEntries(p.participants.map(id => [id, "pending" as ParticipantStatus]));
        o.review = { queuedAt: r.t, deadline: Number(d.deadline) };
        o.stateSince = r.t; this.lastState.set(o.id, o.state);
        s.upsertOpp(o);
        // Not a proposal to anyone yet: it counts when a reviewer approves it (a staff-composed one
        // counted at its "proposal" record is taken back until then).
        this.count(o, -1);
        if (!this.opts.quietReview?.()) s.pushFeed({ t: r.t, kind: "review", text: `In review: ${originLabel(o.origin!).toLowerCase()} for ${this.names(p.participants)}`, members: p.participants, opportunityId: p.id });
        return true;
      }
      case "review_decision": {
        const o = s.opps.get(d.oppId);
        if (!o) return true;
        const rv: ReviewInfo = { ...(o.review ?? { queuedAt: r.t, deadline: r.t }) };
        if (typeof d.secondsSpent === "number") rv.secondsSpent = (rv.secondsSpent ?? 0) + d.secondsSpent;
        if (d.decision === "reroll") {
          // The item stays in review (a "review_queued" with rerolled follows) or closes back to the engine.
          rv.rerolls = (rv.rerolls ?? 0) + 1;
          o.review = rv;
          if (d.next === "engine" && !isTerminal(o.state)) this.setState(o, "SKIPPED", "re-rolled in review (no alternate; back to the engine)");
          this.changed(o, r);
          s.pushFeed({ t: r.t, kind: "review", text: `Review: re-rolled ${this.names(o.participants)}${d.in ? ` (${this.name(d.out)} → ${this.name(d.in)})` : " (no alternate)"}${d.reviewer ? ` (${d.reviewer})` : ""}`, members: o.participants, opportunityId: o.id });
          return true;
        }
        const decision = d.decision === "reject" ? "reject" : "approve";
        Object.assign(rv, { decision, reason: (d.reason ?? undefined) as ReviewReason | undefined, note: d.note ?? undefined, reviewer: d.reviewer ?? undefined, decidedAt: r.t });
        for (const k of ["reason", "note", "reviewer"] as const) if (rv[k] === undefined) delete rv[k];
        if (Array.isArray(d.edited) && d.edited.length) rv.edits = [...(rv.edits ?? []), ...d.edited];
        o.review = rv;
        if (decision === "reject" && !isTerminal(o.state)) this.setState(o, "SKIPPED", `rejected in review${d.reason ? ` (${String(d.reason).replace(/_/g, " ")})` : ""}`);
        if (decision === "approve") this.count(o);
        this.changed(o, r);
        if (!this.opts.quietReview?.() || decision === "reject") s.pushFeed({ t: r.t, kind: "review", text: `Review: ${decision === "approve" ? (rv.edits?.length ? "edited and approved" : "approved") : "rejected"} ${this.names(o.participants)}${d.reviewer ? ` (${d.reviewer})` : ""}`, members: o.participants, opportunityId: o.id, severity: decision === "approve" ? "good" : "warn" });
        return true;
      }
      case "review_invalidated": {
        // Approved, but a gate failed on the re-check: nobody was contacted.
        const o = s.opps.get(d.oppId);
        if (!o) return true;
        o.review = { ...(o.review ?? { queuedAt: r.t, deadline: r.t }), invalidated: String(d.reason) };
        this.count(o, -1);
        if (!isTerminal(o.state)) this.setState(o, "SKIPPED", `approved, then stopped on the re-check (${String(d.reason).replace(/_/g, " ")})`);
        this.changed(o, r);
        s.pushFeed({ t: r.t, kind: "review", text: `Approval stopped on the re-check: ${this.names(o.participants)} (${String(d.reason).replace(/_/g, " ")}); nobody contacted`, members: o.participants, opportunityId: o.id, severity: "warn" });
        return true;
      }
      case "review_refused": return true;
      case "matching_switch":
        s.pushFeed({ t: r.t, kind: "config", text: `Proactive matching turned ${d.on ? "ON" : "OFF"}${d.actor ? ` by ${d.actor}` : ""}`, severity: d.on ? "info" : "warn" });
        return true;
      case "safety_action":
        s.pushFeed({ t: r.t, kind: "trust", text: `Staff ${String(d.action).replace(/_/g, " ")}: ${this.name(d.memberId)}${d.actor ? ` (${d.actor})` : ""}`, members: d.memberId ? [d.memberId] : undefined });
        return true;
      case "age_unknown": {
        // No valid age: treated as a minor until they say.
        const m = s.member(d.memberId);
        if (m && (!m.minor || !m.ageUnknown)) { m.minor = true; m.ageUnknown = true; s.touchMember(m.id); }
        s.pushFeed({ t: r.t, kind: "trust", text: `${this.name(d.memberId)}: no valid age, treated as under 18 until they say`, members: [d.memberId], severity: "warn" });
        return true;
      }
      case "age_resolved": {
        const m = s.member(d.memberId);
        if (m && (m.minor !== !!d.minor || m.ageUnknown)) { m.minor = !!d.minor; delete m.ageUnknown; s.touchMember(m.id); }
        s.pushFeed({ t: r.t, kind: "trust", text: `${this.name(d.memberId)} gave their age: ${d.minor ? "under 18 (single-player only)" : "18 or over"}`, members: [d.memberId] });
        return true;
      }
      case "review_expired": {
        const o = s.opps.get(d.oppId);
        if (!o) return true;
        o.review = { ...(o.review ?? { queuedAt: r.t, deadline: r.t }), decision: "expired", decidedAt: r.t };
        if (!isTerminal(o.state)) this.setState(o, "SKIPPED", "review expired (never sent)");
        this.changed(o, r);
        s.pushFeed({ t: r.t, kind: "review", text: `Review expired: ${this.names(o.participants)} (never sent)`, members: o.participants, opportunityId: o.id, severity: "warn" });
        return true;
      }
      case "review_mode":
        s.pushFeed({ t: r.t, kind: "review", text: `Review mode: ${d.mode}` });
        return true;
      case "probe_started": {
        const p = d.proposal as Proposal;
        const primed = new Set<string>(d.primed ?? []);
        const origin = String(d.origin ?? "network");
        const prev = s.opps.get(p.id);
        if (prev && prev.state !== "IN_REVIEW") return true;
        const o = this.consentOpp(p, origin, prev?.createdAt ?? r.t, d.runId);
        o.review = prev?.review; o.updatedAt = r.t;
        // Keep what the "proposal" record set for staff-composed and scenario proposals (source, oracle verdict).
        if (prev) { o.source = prev.source; o.oracle = prev.oracle; o.runId = prev.runId ?? o.runId; }
        o.state = "PROPOSED"; o.reason = "checking availability (no names yet)";
        o.status = Object.fromEntries(p.participants.map(id => [id, (primed.has(id) ? "available" : "checking") as ParticipantStatus]));
        s.upsertOpp(o);
        if (!prev) this.count(o);
        if (origin !== "engine") s.pushFeed({ t: r.t, kind: "probe", text: `${originLabel(origin)}: checking with ${this.names(p.participants.filter(id => !primed.has(id)))} (no names yet)`, members: p.participants, opportunityId: p.id });
        return true;
      }
      case "probe_answer": case "time_answer": {
        const o = s.opps.get(d.oppId);
        if (!o) return true;
        if (r.kind === "probe_answer" && o.state === "PROPOSED") o.status[d.memberId] = d.yes ? "available" : "unavailable";
        // The keys they picked from the times offered (empty: none fit).
        if (Array.isArray(d.picked)) o.times = { ...o.times, [d.memberId]: { offered: o.times?.[d.memberId]?.offered ?? this.lastOptions.get(d.memberId) ?? [], picked: [...d.picked] } };
        this.changed(o, r);
        return true;
      }
      case "booked_cancelled": {
        const o = s.opps.get(d.oppId);
        if (o?.booked) { o.booked = { ...o.booked, cancelled: { ...o.booked.cancelled, [d.memberId]: { at: r.t, told: !!d.told } } }; this.changed(o, r); }
        s.pushFeed({ t: r.t, kind: "decline", text: `${this.name(d.memberId)} called off a booked plan${d.told ? "" : " (silently)"}`, members: [d.memberId], opportunityId: d.oppId, severity: "warn" });
        return true;
      }
      case "calendar_consent": case "weekly_checkin_consent": {
        const m = s.member(d.memberId);
        if (m) { if (r.kind === "calendar_consent") m.calendar = d.on !== false; else m.weekly = d.on !== false; s.touchMember(m.id); }
        return true;
      }
      case "probe_replaced": {
        const o = s.opps.get(d.oppId);
        if (!o) return true;
        o.participants = o.participants.map(x => (x === d.out ? d.in : x));
        delete o.status[d.out]; o.status[d.in] = "checking";
        // The Network rebuilds every reason after a swap; show the new ones.
        if (d.proposal?.explanations) o.explanations = { ...d.proposal.explanations };
        this.changed(o, r);
        return true;
      }
      case "probe_closed": {
        const o = s.opps.get(d.proposalId);
        if (o && !isTerminal(o.state)) { this.setState(o, "SKIPPED", String(d.reason ?? "not sent")); this.changed(o, r); }
        return true;
      }
      case "venue": {
        const o = s.opps.get(d.oppId);
        if (o) { o.venue = { name: d.venue, lat: d.lat, lng: d.lng }; this.changed(o, r); }
        return true;
      }
      case "request":
        // What was asked for (the want or the category), never the member's own words.
        s.pushFeed({ t: r.t, kind: "request", text: `${this.name(d.memberId)} asked: ${requestLabel(d)}`, members: [d.memberId] });
        return true;
      case "request_result":
        if (d.outcome === "fulfilled") s.pushFeed({ t: r.t, kind: "request", text: `Request fulfilled for ${this.name(d.memberId)} in ${d.hours}h`, members: [d.memberId], severity: "good" });
        else if (d.outcome === "waiting") s.pushFeed({ t: r.t, kind: "request", text: `No one fits ${this.name(d.memberId)}'s ask yet: standing request (${d.reason})`, members: [d.memberId], severity: "warn" });
        return true;
      case "abuse":
        s.pushFeed({ t: r.t, kind: "adversarial", text: `${this.name(d.memberId)}: ${(d.kinds as string[]).join(", ").replace(/_/g, " ")} handled`, members: [d.memberId], severity: "bad" });
        return true;
      case "trust": {
        const m = s.member(d.memberId);
        if (m) { m.trust = d.to; s.touchMember(m.id); }
        s.pushFeed({ t: r.t, kind: "trust", text: `${this.name(d.memberId)} → ${String(d.to).toUpperCase()} (${String(d.why).replace(/_/g, " ")})`, members: [d.memberId], severity: d.to === "ok" ? "info" : "bad" });
        return true;
      }
      case "invite":
        s.pushFeed({ t: r.t, kind: "growth", text: `${this.name(d.from)} invited ${d.newMemberId ? this.name(d.newMemberId) : "a friend (they didn't join)"}`, members: [d.from], severity: "good" });
        return true;
      case "growth_ask":
        s.pushFeed({ t: r.t, kind: "growth", text: `Growth ask to ${this.name(d.memberId)} (${d.kind})`, members: [d.memberId] });
        return true;
      case "minor_signal": {
        const m = s.member(d.memberId);
        if (m && !m.minor) { m.minor = true; s.touchMember(m.id); }
        s.pushFeed({ t: r.t, kind: "trust", text: `${this.name(d.memberId)} is under 18: single-player only, never introduced`, members: [d.memberId], severity: "warn" });
        return true;
      }
      case "age_conflict": {
        // A looser statement under 13 (no explicit age): never a decline. Treated as a minor until staff check it.
        const m = s.member(d.memberId);
        if (m && !m.minor) { m.minor = true; s.touchMember(m.id); }
        const why = d.attestedAge === undefined ? "said an age under 13, not as an explicit age" : "stated age conflicts with the age on record";
        s.pushFeed({ t: r.t, kind: "trust", text: `${this.name(d.memberId)}: ${why}. Treated as under 18; staff to check`, members: [d.memberId], severity: "warn" });
        return true;
      }
      case "join_declined": {
        // Under 13: declined once, nothing kept. The feed item names nobody.
        const m = this.declineTo ? s.member(this.declineTo) : undefined;
        if (m) { m.minor = true; m.declined = true; s.touchMember(m.id); }
        this.declineTo = undefined;
        s.pushFeed({ t: r.t, kind: "trust", text: "Someone under 13 tried to join: declined kindly, nothing kept", severity: "warn" });
        return true;
      }
      case "guard_blocked":
        // The leak guard stopped a message. The text is never logged or shown.
        s.pushFeed({ t: r.t, kind: "guard", text: `Leak guard stopped a ${String(d.kind ?? "message").replace(/_/g, " ")} to ${this.name(d.memberId)}${d.fallback ? " (sent a generic version)" : " (nothing sent)"}`, members: d.memberId ? [d.memberId] : undefined, severity: "warn" });
        return true;
      case "learned": case "feedback": return r.kind === "learned";
      default: return false;
    }
  }

  /**
   * Times a message offered (attention v1.2: a probe, the requester's time question, other times after
   * "neither") and the booked plan it carries (SimMeta.timeOptions, SimMeta.booked).
   */
  private timesAndBooking(msg: Extract<RunRecord, { type: "message" }>["msg"], r: RunRecord) {
    const meta = (msg.meta ?? {}) as { timeOptions?: { key: string; label: string; start: number }[]; probe?: { key?: string }; proposalId?: string; booked?: { proposalId: string; at: number; optOutHours: number } };
    if (meta.timeOptions?.length) {
      const offered = meta.timeOptions.map(x => ({ key: x.key, label: x.label, start: x.start }));
      this.lastOptions.set(msg.memberId, offered);
      const o = this.store.opps.get(meta.probe?.key ?? meta.proposalId ?? "");
      if (o) { o.times = { ...o.times, [msg.memberId]: { offered } }; this.changed(o, r); }
    }
    const b = meta.booked;
    const o = b ? this.store.opps.get(b.proposalId) : undefined;
    if (b && o) {
      o.booked = { at: b.at, optOutHours: b.optOutHours, told: { ...o.booked?.told, [msg.memberId]: msg.ts }, cancelled: { ...o.booked?.cancelled } };
      this.changed(o, r);
    }
  }

  /** A consent-network opportunity from its proposal (state and statuses set by the caller). */
  private consentOpp(p: Proposal, origin: string, createdAt: number, runId: unknown): ObsOpportunity {
    return {
      id: p.id, kind: p.kind, source: origin === "engine" ? "engine" : origin === "player" ? "player" : "network", origin,
      generator: p.generator, category: p.category, city: p.city, objective: p.objective, score: p.score, components: p.components,
      explanations: p.explanations ?? {}, exploration: p.exploration, participants: [...p.participants], alternates: [...(p.alternates ?? [])],
      state: "PROPOSED", status: {}, enjoyment: {}, createdAt, updatedAt: createdAt, runId: typeof runId === "string" ? runId : undefined,
    };
  }

  /** Consent state from per-participant statuses (pairs need both; groups need a quorum). */
  private recomputeConsent(o: ObsOpportunity, r: RunRecord) {
    if (o.state === "SCHEDULED" || isTerminal(o.state)) return;
    const sts = o.participants.map(id => o.status[id]);
    const yes = o.participants.filter(id => o.status[id] === "accepted" || o.status[id] === "countered");
    const group = o.participants.length > 2;
    if (!group && sts.includes("declined")) { this.setState(o, "DECLINED", "declined"); return; }
    const quorum = group ? Math.max(3, Math.ceil(o.participants.length * 0.66)) : 2;
    if (yes.length >= quorum) {
      const was = o.state;
      this.setState(o, group ? "QUORUM_MET" : "MUTUALLY_ACCEPTED");
      if (was !== o.state) {
        for (let i = 0; i < yes.length; i++) for (let j = i + 1; j < yes.length; j++)
          this.store.addEdge({ from: yes[i]!, to: yes[j]!, type: "introduced", strength: 0.3, createdAt: r.t, origin: "learned" });
      }
    } else if (yes.length) this.setState(o, "PARTIALLY_ACCEPTED");
  }

  /** PRD 32.13 edge learning from a held meeting. */
  private learnEdges(showed: MemberId[], att: Record<MemberId, { enjoyment: number }>, t: number) {
    for (let i = 0; i < showed.length; i++) for (let j = i + 1; j < showed.length; j++) {
      const a = showed[i]!, b = showed[j]!;
      const ea = att[a]!.enjoyment, eb = att[b]!.enjoyment, lo = Math.min(ea, eb);
      this.store.addEdge({ from: a, to: b, type: "met", strength: 0.5, createdAt: t, origin: "learned" });
      if (lo >= ENJOYED) this.store.addEdge({ from: a, to: b, type: "enjoyed", strength: (ea + eb) / 2, createdAt: t, origin: "learned" });
      if (lo >= WOULD_AGAIN) this.store.addEdge({ from: a, to: b, type: "would_interact_again", strength: lo, createdAt: t, origin: "learned" });
      if (lo < AVOID) this.store.addEdge({ from: a, to: b, type: "avoid", strength: 1 - lo, createdAt: t, origin: "learned" });
    }
  }
}

const ORIGIN_LABEL: Record<string, string> = { request: "Request", plans: "Plans buddy", second_encounter: "Second encounter", newcomer_welcome: "Newcomer welcome", player: "Your intro", engine: "Engine" };
const originLabel = (o: string) => ORIGIN_LABEL[o] ?? o;

export { emptyCounters };
