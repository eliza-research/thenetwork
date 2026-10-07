// Harness-side engine-input augmentation for the simulator experiments. Everything added here is
// information a production Network would have (its own proposal outcomes, member replies, meeting
// feedback, public event listings, what it skipped), rebuilt from the sim's run records. Nothing
// here passes hidden persona truth to the engine.
import type { MemberId } from "@thenetwork/core";
import { DAY, HOUR } from "@thenetwork/core";
import type { EngineInput, FeedbackRecord, InteractionRecord, NetworkEvent } from "../src/types.ts";
import type { RunRecord } from "../../judge/src/index.ts";

export interface History {
  interactions: InteractionRecord[];
  feedback: FeedbackRecord[];
  /** Members in an open opportunity (invite pending or meeting scheduled in the future). */
  busy: Set<MemberId>;
  /** Proposals the network never dispatched (participants busy / opted out). */
  skipped: Set<string>;
  /** Per member: invites answered yes / total invites resolved (engine-visible behaviour). */
  accept: Map<MemberId, { yes: number; n: number }>;
}

export function historyFromRecords(records: RunRecord[], now: number): History {
  const props = new Map<string, any>();
  const skipped = new Set<string>();
  const declines = new Map<string, MemberId[]>(), yes = new Map<string, Set<MemberId>>(), invited = new Map<string, Map<MemberId, number>>();
  const scheduled = new Map<string, number>();
  const outcome = new Map<string, any>();
  const decided = new Set<string>();
  for (const r of records as any[]) {
    if (r.t > now) break;
    if (r.type === "proposal") props.set(r.proposal.id, r.proposal);
    else if (r.type === "network_log" && r.kind === "proposal_skipped") skipped.add(r.detail.proposalId);
    else if (r.type === "message" && r.msg.meta?.type === "proposal" && r.msg.meta.proposalId) {
      const pid = r.msg.meta.proposalId; if (!invited.has(pid)) invited.set(pid, new Map()); invited.get(pid)!.set(r.msg.memberId, r.msg.ts);
    } else if (r.type === "decision" && r.messageType === "proposal" && r.proposalId) {
      decided.add(`${r.proposalId}|${r.memberId}`);
      if (r.decision === "decline") { if (!declines.has(r.proposalId)) declines.set(r.proposalId, []); declines.get(r.proposalId)!.push(r.memberId); }
      else if (r.decision === "accept" || r.decision === "counter") { if (!yes.has(r.proposalId)) yes.set(r.proposalId, new Set()); yes.get(r.proposalId)!.add(r.memberId); }
    } else if (r.type === "meeting_scheduled") scheduled.set(r.proposalId, r.at);
    else if (r.type === "outcome") outcome.set(r.proposalId, r);
  }
  const interactions: InteractionRecord[] = [];
  const feedback: FeedbackRecord[] = [];
  const busy = new Set<MemberId>();
  const accept = new Map<MemberId, { yes: number; n: number }>();
  const bump = (id: MemberId, ok: boolean) => { const a = accept.get(id) ?? { yes: 0, n: 0 }; a.n++; if (ok) a.yes++; accept.set(id, a); };
  for (const [pid, p] of props) {
    if (skipped.has(pid)) continue;
    const inv = invited.get(pid) ?? new Map();
    for (const [id, ts] of inv) {
      if (decided.has(`${pid}|${id}`)) bump(id, yes.get(pid)?.has(id) ?? false);
      else if (now - ts > 48 * HOUR) bump(id, false); // expired invite = an implicit no
    }
    let out: InteractionRecord["outcome"] = "pending";
    let at = p.createdAt;
    const dec = declines.get(pid);
    const o = outcome.get(pid);
    if (dec?.length) out = "declined";
    else if (o) {
      const shows = Object.entries(o.attendance as Record<string, any>).filter(([, a]) => a.showed);
      out = shows.length >= 2 ? "completed" : "no_show"; at = o.at;
      if (shows.length >= 2) for (const [a, x] of shows) for (const [b] of shows) if (a !== b) {
        const e = x.enjoyment as number;
        feedback.push({ id: `fb:${pid}:${a}:${b}`, from: a, about: b, opportunityId: pid, at: o.at + 3 * HOUR, sentiment: e >= 0.6 ? "positive" : e < 0.4 ? "negative" : "neutral", wouldMeetAgain: e >= 0.6 });
      }
    } else if (scheduled.has(pid)) { out = "accepted"; if (scheduled.get(pid)! > now) p.participants.forEach((id: MemberId) => busy.add(id)); }
    else if (now - p.createdAt > 3 * DAY) out = "expired";
    else p.participants.forEach((id: MemberId) => busy.add(id));
    interactions.push({ id: pid, kind: p.kind, category: p.category ?? "social", participants: p.participants, at, outcome: out, ...(dec?.length ? { declinedBy: dec } : {}) });
  }
  return { interactions, feedback, busy, skipped, accept };
}

export interface AugmentOpts {
  /** Feed interactions + feedback (pair cooldowns, category cooldowns, second_encounter). */
  history?: boolean;
  /** Do not count proposals the network never dispatched against member budgets. */
  dropSkipped?: boolean;
  /** Carry exposure debt between nightly runs. */
  carryDebt?: boolean;
  /** Public event listings (synthetic: weekly meetups for the most common shareable interests). */
  events?: number;
  /** Members marked interest facets as shareable (enables theme groups). */
  shareInterests?: boolean;
  /**
   * Personal-growth wants ("learn to sail", "try ceramics", "join a writing group") are labelled
   * "growth" by the simulator, but the engine reserves "growth" for growing the Network and skips
   * those intents in every intent generator. Re-label them "hobby" (and opt the member in to hobby).
   */
  growthAsHobby?: boolean;
}

export function augment(snap: EngineInput, ctx: { world: any; state: Record<string, any>; now: number; city: string }, o: AugmentOpts): EngineInput {
  let out: EngineInput = { ...snap };
  if (o.history || o.dropSkipped) {
    const h = historyFromRecords(ctx.world.records, ctx.now);
    ctx.state.history = h;
    if (o.history) out = { ...out, interactions: h.interactions, feedback: h.feedback };
    if (o.dropSkipped) out = { ...out, recentProposals: out.recentProposals.filter(p => !h.skipped.has(p.id)) };
  }
  if (o.carryDebt && ctx.state.lastDebt) out = { ...out, exposureDebt: ctx.state.lastDebt };
  if (o.shareInterests) out = { ...out, facets: out.facets.map(f => (f.kind === "interest" && f.scope === "matchable" ? { ...f, scope: "shareable" as const } : f)) };
  if (o.events) out = { ...out, events: makeEvents(out, o.events) };
  if (o.growthAsHobby) {
    const who = new Set(out.intents.filter(i => i.category === "growth").map(i => i.memberId));
    out = {
      ...out,
      intents: out.intents.map(i => (i.category === "growth" ? { ...i, category: "hobby" as const } : i)),
      members: out.members.map(m => (who.has(m.id) && !m.prefs.categoriesOptIn.includes("hobby") ? { ...m, prefs: { ...m.prefs, categoriesOptIn: [...m.prefs.categoriesOptIn, "hobby" as const] } } : m)),
    };
  }
  return out;
}

/** k public events per city per week around the most common interest tags (deterministic). */
export function makeEvents(snap: EngineInput, perWeek: number): NetworkEvent[] {
  const events: NetworkEvent[] = [];
  for (const city of ["sf", "nyc"] as const) {
    const ids = new Set(snap.members.filter(m => m.homeCity === city).map(m => m.id));
    const counts = new Map<string, number>();
    for (const f of snap.facets) if (ids.has(f.memberId) && f.kind === "interest" && f.tags[0]) counts.set(f.tags[0], (counts.get(f.tags[0]) ?? 0) + 1);
    const tags = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1)).map(([t]) => t);
    const week = Math.floor(snap.now / (7 * DAY));
    for (let w = 0; w < 2; w++) for (let k = 0; k < perWeek; k++) {
      const tag = tags[(k + (week + w) * perWeek) % Math.max(1, tags.length)];
      if (!tag) continue;
      const start = (week + w) * 7 * DAY + ((k % 6) + 1) * DAY + (city === "sf" ? 26 : 23) * HOUR; // ~7pm local
      if (start < snap.now) continue;
      events.push({ id: `ev:${city}:${week + w}:${k}`, title: `${tag.replace(/_/g, " ")} night`, city, start, end: start + 3 * HOUR, tags: [tag], category: "social" });
    }
  }
  return events;
}
