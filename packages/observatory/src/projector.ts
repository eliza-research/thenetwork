// Event-sourced projection: simulator run records (packages/judge/src/runlog.ts) -> observatory
// state. Opportunities follow the PRD 32.10 state machine as far as the records reveal it; the
// edges the Network learns follow PRD 32.13 (introduced, met, enjoyed, would_interact_again, avoid).
import type { MemberId } from "@thenetwork/core";
import type { RunRecord } from "@thenetwork/judge";
import { emptyCounters, type Store } from "./store.ts";
import type { MemberStatus, ObsOpportunity, OppSource, OppState, ParticipantStatus } from "./types.ts";

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
}

export class Projector {
  private meetings = new Map<string, string>(); // meetingId -> proposalId
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
  private changed(o: ObsOpportunity, rec: RunRecord) {
    o.updatedAt = rec.t;
    this.store.touchOpp(o.id);
    this.opts.onOpp?.(o, rec);
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
        if (msg.meta?.proactive && msg.status === "delivered") { c.proactive++; if (k) k.proactive++; }
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
          origin: prev?.origin, venue: prev?.venue,
          id: p.id, kind: p.kind, source, generator: p.generator, category: p.category, city: p.city,
          objective: p.objective, score: p.score, components: p.components, explanations: p.explanations ?? {},
          exploration: p.exploration, participants: [...p.participants], alternates: [...(p.alternates ?? [])],
          state: "PROPOSED", status: Object.fromEntries(p.participants.map(id => [id, "pending" as ParticipantStatus])),
          enjoyment: {}, createdAt: prev?.createdAt ?? r.t, updatedAt: r.t, oracle: r.oracle, runId: prev?.runId ?? this.opts.runOf?.(p.id),
        };
        s.upsertOpp(o);
        if (!prev) for (const id of p.participants) { const k = this.counters(id); if (k) k.proposals++; }
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
        if (r.messageType === "proposal") {
          if (r.intent === "accept") st = "accepted";
          else if (r.intent === "decline") st = "declined";
          else if (r.intent === "counter") st = "countered";
          else if (r.intent === "ignore") st = "ignored";
        } else if (r.intent === "flake_notice") st = "cancelled_with_notice";
        if (!st || isTerminal(o.state) && st !== "cancelled_with_notice") return;
        const prev = o.status[r.memberId];
        if (prev === st) return;
        o.status[r.memberId] = st;
        if (st === "accepted" || st === "countered") { c.accepts++; const k = this.counters(r.memberId); if (k) k.accepted++; }
        if (st === "declined") c.declines++;
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
        for (const id of r.participants) if (o.status[id] !== "cancelled_with_notice") o.status[id] = "confirmed";
        for (const [id, st] of Object.entries(o.status)) if (st === "pending" || st === "invited" || st === "ignored") o.status[id] = "dropped";
        this.changed(o, r);
        s.pushFeed({ t: r.t, kind: "meeting", text: `Meeting set: ${this.names(r.participants)}`, members: r.participants, opportunityId: o.id, severity: "good" });
        return;
      }
      case "outcome": {
        const o = s.opps.get(r.proposalId);
        const showed = Object.entries(r.attendance).filter(([, a]) => a.showed).map(([id]) => id);
        for (const [id, a] of Object.entries(r.attendance)) {
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
      case "probe_started": {
        const p = d.proposal as import("@thenetwork/core").Proposal;
        if (s.opps.has(p.id)) return true;
        const primed = new Set<string>(d.primed ?? []);
        const origin = String(d.origin ?? "network");
        const o: ObsOpportunity = {
          id: p.id, kind: p.kind, source: origin === "engine" ? "engine" : origin === "player" ? "player" : "network", origin,
          generator: p.generator, category: p.category, city: p.city, objective: p.objective, score: p.score, components: p.components,
          explanations: p.explanations ?? {}, exploration: p.exploration, participants: [...p.participants], alternates: [...(p.alternates ?? [])],
          state: "PROPOSED", reason: "checking availability (no names yet)",
          status: Object.fromEntries(p.participants.map(id => [id, (primed.has(id) ? "available" : "checking") as ParticipantStatus])),
          enjoyment: {}, createdAt: r.t, updatedAt: r.t, runId: d.runId ?? undefined,
        };
        s.upsertOpp(o);
        for (const id of p.participants) { const k = this.counters(id); if (k) k.proposals++; }
        if (origin !== "engine") s.pushFeed({ t: r.t, kind: "probe", text: `${originLabel(origin)}: checking with ${this.names(p.participants.filter(id => !primed.has(id)))} (no names yet)`, members: p.participants, opportunityId: p.id });
        return true;
      }
      case "probe_answer": {
        const o = s.opps.get(d.oppId);
        if (o && o.state === "PROPOSED") { o.status[d.memberId] = d.yes ? "available" : "unavailable"; this.changed(o, r); }
        return true;
      }
      case "probe_replaced": {
        const o = s.opps.get(d.oppId);
        if (!o) return true;
        o.participants = o.participants.map(x => (x === d.out ? d.in : x));
        delete o.status[d.out]; o.status[d.in] = "checking";
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
        s.pushFeed({ t: r.t, kind: "request", text: `${this.name(d.memberId)} asked: ${d.kind === "plans" ? "plans nearby" : `"${String(d.text ?? d.desireId ?? "").slice(0, 80)}"`}`, members: [d.memberId] });
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
        s.pushFeed({ t: r.t, kind: "growth", text: `${this.name(d.from)} invited ${d.friendName}${d.newMemberId ? "" : " (they didn't join)"}`, members: [d.from], severity: "good" });
        return true;
      case "growth_ask":
        s.pushFeed({ t: r.t, kind: "growth", text: `Growth ask to ${this.name(d.memberId)} (${d.kind})`, members: [d.memberId] });
        return true;
      case "minor_signal":
        s.pushFeed({ t: r.t, kind: "trust", text: `${this.name(d.memberId)} mentioned being under 18: single-player only`, members: [d.memberId], severity: "warn" });
        return true;
      case "learned": case "feedback": return r.kind === "learned";
      default: return false;
    }
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
