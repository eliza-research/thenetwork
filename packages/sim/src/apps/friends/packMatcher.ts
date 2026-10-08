// friendsPack in the simulator: the snapshot becomes an engine World with friendsPack, availability
// evidence comes from what the Network knows (stated free slots, this week's check-in, attended and
// accepted times), and the pack's weekly planner (packs/friends/planner.ts, built on the shared plans
// planner) returns crew sessions, crew offers, "same table again" repeats and new plans, which map
// one-to-one onto harness proposals. Reads only the snapshot.
import type { MemberId } from "@thenetwork/core";
import { DAY } from "@thenetwork/core";
import { resolveConfig } from "@thenetwork/engine/src/config.ts";
import { localEmbed } from "@thenetwork/engine/src/embed.ts";
import { localParts } from "@thenetwork/core";
import {
  DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS, SLOT_TIME, friendsInfo, friendsPack, hood, planFriendsWeek,
  type FriendsPlan, type FriendsPolicy,
} from "@thenetwork/engine/src/packs/friends/index.ts";
import type { PlanEvidence } from "@thenetwork/engine/src/plans.ts";
import type { PlansConfig } from "@thenetwork/engine/src/config.ts";
import type { EngineInput } from "@thenetwork/engine/src/types.ts";
import { World } from "@thenetwork/engine/src/world.ts";
import { SLOTS } from "./persona.ts";
import { NYC_TZ, slotTime, type FriendsSnapshot } from "./snapshot.ts";
import { VENUES, type FriendsMatcher, type FriendsProposal } from "./world.ts";

/** Weekly slot index of an instant (local weekday and hour; nearest template hour). */
export function slotIndexOf(t: number): number {
  const lp = localParts(t, NYC_TZ);
  const day = (lp.weekday + 1) % 7;
  let best = -1, bd = Infinity;
  SLOTS.forEach((s, k) => { const st = SLOT_TIME[s]; if (st.day !== day) return; const d = Math.abs(st.hour - lp.hour); if (d < bd) { bd = d; best = k; } });
  return best;
}

export function engineInputOf(s: FriendsSnapshot): EngineInput {
  return { now: s.now, members: s.members, facets: s.facets, intents: s.intents, presence: s.presence, edges: s.edges, recentProposals: [], interactions: s.interactions, feedback: s.feedback, safetyHolds: s.safetyHolds };
}

/** Availability evidence from the snapshot: standing slots, this week's check-in, accepted and attended times. */
export function evidenceOf(w: World, s: FriendsSnapshot): Map<MemberId, PlanEvidence> {
  const info = friendsInfo(w);
  const hist = new Map<MemberId, { at: number; outcome: "accepted" | "attended" | "declined_time" }[]>();
  for (const r of s.interactions) if (r.outcome === "completed") for (const id of r.participants) { if (!hist.has(id)) hist.set(id, []); hist.get(id)!.push({ at: r.at, outcome: "attended" }); }
  const out = new Map<MemberId, PlanEvidence>();
  for (const id of w.ids) {
    const fi = info.get(id)!;
    const ci = s.checkIns[id];
    const ev: PlanEvidence = { memberId: id, tz: NYC_TZ, quietHours: [22, 8], standing: fi.standing, history: hist.get(id) ?? [] };
    if (ci) {
      const weekStart = s.now - 9 * 3600_000;
      ev.stated = { windows: ci.map(sl => { const t = slotTime(s.week, SLOTS.indexOf(sl)); return { start: t - 30 * 60_000, end: t + 4 * 3600_000 }; }), at: s.now, until: weekStart + 7 * DAY };
    }
    if (!ev.standing?.length && !ev.history?.length && !ev.stated) continue;
    out.set(id, ev);
  }
  return out;
}

export function planToProposal(p: FriendsPlan, crewOffer?: FriendsPlan["crewId"]): FriendsProposal | null {
  const options = [...new Set(p.options.map(o => slotIndexOf(o.start)).filter(k => k >= 0))];
  if (!options.length) return null;
  const vh = hood(p.place.area);
  if (!vh) return null;
  void crewOffer;
  return {
    kind: p.source === "new" ? "plan" : p.source, invited: [...p.invited], alternates: [...p.alternates], activity: p.activityId,
    venueHood: vh.id, ...(p.venueId ? { venueId: p.venueId } : {}), options, quorum: p.quorum, ...(p.crewId ? { crewId: p.crewId } : {}),
  };
}

export function friendsPackMatcher(o: { policy?: Partial<FriendsPolicy>; pcfg?: Partial<PlansConfig>; name?: string } = {}): FriendsMatcher {
  const pol: FriendsPolicy = { ...DEFAULT_FRIENDS_POLICY, ...(o.policy ?? {}) };
  const pcfg: PlansConfig = { ...FRIENDS_PLANS, ...(o.pcfg ?? {}) };
  return {
    name: o.name ?? "friends-pack",
    propose(ctx) {
      const s = ctx.snapshot;
      const w = new World(engineInputOf(s), resolveConfig({ seed: ctx.week + 1 }), localEmbed, friendsPack);
      const lastPlannedAt = new Map(Object.entries(s.lastPlannedAt));
      const week = planFriendsWeek(w, { now: s.now, tz: NYC_TZ, evidence: evidenceOf(w, s), venues: VENUES, crews: s.crews.filter(c => !c.handedOff), outcomes: s.outcomes, offered: s.offered, lastPlannedAt }, pol, pcfg);
      const out: FriendsProposal[] = [];
      for (const p of week.sessions) { const x = planToProposal(p); if (x) out.push(x); }
      for (const { crew, first } of week.offers) { const x = planToProposal(first); if (x) out.push({ ...x, kind: "crew_offer", crew }); }
      for (const p of week.repeats) { const x = planToProposal(p); if (x) out.push(x); }
      for (const p of week.plans) {
        const x = planToProposal(p);
        if (!x) continue;
        // Open table: the alternates are asked at the same time; the first yes-sayers fill the seats.
        if (pol.openTable && !p.partner) out.push({ ...x, invited: [...x.invited, ...x.alternates], alternates: [], maxSeats: p.size.max, split: pol.split });
        else out.push(x);
      }
      for (const p of week.partners) { const x = planToProposal(p); if (x) out.push(x); }
      return out;
    },
  };
}
