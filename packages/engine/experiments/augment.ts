// Harness-side engine-input augmentation for the simulator experiments. Everything added here is
// information a production Network would have (its own proposal outcomes, member replies, meeting
// feedback, public event listings, what it skipped), rebuilt from the sim's run records. Nothing
// here passes hidden persona truth to the engine.
import type { MemberId } from "@thenetwork/core";
import { DAY, HOUR } from "@thenetwork/core";
import type { EngineInput, FeedbackRecord, InteractionRecord, NetworkEvent } from "../src/types.ts";
import type { RunRecord } from "../../judge/src/index.ts";
import { networkStateFromRecords } from "../../sim/src/snapshot.ts";

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

/**
 * What the Network itself knows from the run records: invite answers read from the members' replies,
 * feedback read from answered feedback requests (sim snapshot `networkStateFromRecords`). It no longer
 * reads persona decisions or hidden meeting enjoyment (audit sim-worlds-1: the same leak was here).
 */
export function historyFromRecords(records: RunRecord[], now: number): History {
  let end = records.length;
  for (let i = 0; i < records.length; i++) if ((records[i] as { t: number }).t > now) { end = i; break; }
  const st = networkStateFromRecords(records.slice(0, end), now);
  const busy = new Set<MemberId>(st.openOpportunities.flatMap(o => o.participants));
  const accept = new Map<MemberId, { yes: number; n: number }>();
  const bump = (id: MemberId, ok: boolean) => { const a = accept.get(id) ?? { yes: 0, n: 0 }; a.n++; if (ok) a.yes++; accept.set(id, a); };
  for (const i of st.interactions) {
    for (const id of i.acceptedBy ?? []) bump(id, true);
    for (const id of i.declinedBy ?? []) bump(id, false);
    for (const id of i.noResponse ?? []) bump(id, false);
  }
  return { interactions: st.interactions as InteractionRecord[], feedback: st.feedback as FeedbackRecord[], busy, skipped: new Set(st.unsentProposalIds), accept };
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
