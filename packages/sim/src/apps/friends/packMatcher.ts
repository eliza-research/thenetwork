// friendsPack in the simulator: the snapshot becomes an engine World with friendsPack, availability
// evidence comes from what the Network knows (stated free slots, this week's check-in, attended and
// accepted times), and the pack's weekly planner (packs/friends/planner.ts, built on the shared plans
// planner) returns crew sessions, crew offers, "same table again" repeats and new plans, which map
// one-to-one onto harness proposals. Reads only the snapshot.
import type { MemberId } from "@thenetwork/core";
import { DAY, canBeMatched } from "@thenetwork/core";
import { runEngine } from "@thenetwork/engine/src/engine.ts";
import type { EngineProposal } from "@thenetwork/engine/src/types.ts";
import { resolveConfig } from "@thenetwork/engine/src/config.ts";
import { localEmbed } from "@thenetwork/engine/src/embed.ts";
import { activityAllAges, venueAllAges } from "@thenetwork/engine/src/packs/network/activities.ts";
import { localParts } from "@thenetwork/core";
import {
  DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS, SLOT_TIME, friendsInfo, friendsPack, hood, planFriendsWeek,
  type FriendsPlan, type FriendsPolicy,
} from "@thenetwork/engine/src/packs/friends/index.ts";
import type { PlanEvidence } from "@thenetwork/engine/src/plans.ts";
import type { PlansConfig } from "@thenetwork/engine/src/config.ts";
import type { EngineInput } from "@thenetwork/engine/src/types.ts";
import { World } from "@thenetwork/engine/src/world.ts";
import { FRIEND_ACTIVITIES, SLOTS } from "./persona.ts";
import { slotTime, type FriendsSnapshot } from "./snapshot.ts";
import { NYC_TZ } from "./persona.ts";
import { VENUES, rosterAge, teenSlotAllowed, type FriendsMatcher, type FriendsProposal } from "./world.ts";
import { teenShape } from "../../teen.ts";

/** Weekly slot index of an instant (local weekday and hour; nearest template hour). */
export function slotIndexOf(t: number): number {
  const lp = localParts(t, NYC_TZ);
  const day = (lp.weekday + 1) % 7;
  let best = -1, bd = Infinity;
  SLOTS.forEach((s, k) => { const st = SLOT_TIME[s]; if (st.day !== day) return; const d = Math.abs(st.hour - lp.hour); if (d < bd) { bd = d; best = k; } });
  return best;
}

export function engineInputOf(s: FriendsSnapshot): EngineInput {
  return {
    now: s.now, members: s.members, facets: s.facets, intents: s.intents, presence: s.presence, edges: s.edges, recentProposals: [], interactions: s.interactions, feedback: s.feedback, safetyHolds: s.safetyHolds,
    ...(s.teenIntros ? { teenIntros: true } : {}),
  };
}

const TEEN_SLOTS = (["sat_am", "sat_pm", "sun_am", "sun_pm"] as const).map(s => SLOTS.indexOf(s));
const TEEN_ACTIVITIES = new Map<string, (typeof FRIEND_ACTIVITIES)[number]>();
for (const a of FRIEND_ACTIVITIES) if (activityAllAges(a) && a.dayparts.includes("weekend_day")) for (const t of a.tags) if (!TEEN_ACTIVITIES.has(t)) TEEN_ACTIVITIES.set(t, a);
const TEEN_VENUES = VENUES.filter(venueAllAges);

const teenOptions = (durationMin: number): number[] => TEEN_SLOTS.filter(k => teenSlotAllowed(k, durationMin));

function teenVenueOf(activityId: string, homeArea: string | undefined) {
  const home = hood(homeArea);
  if (!home) return undefined;
  const at = TEEN_VENUES.filter(v => v.activities.includes(activityId));
  return at.find(v => hood(v.area)?.id === home.id) ?? at.find(v => hood(v.area)?.zone === home.zone);
}

export function teenProposalOf(p: EngineProposal, s: FriendsSnapshot): FriendsProposal | null {
  const pair = p.participants.length === 2;
  const shape: Omit<FriendsProposal, "activity" | "venueHood" | "options"> = {
    kind: pair ? "partner" : "plan", invited: [...p.participants], alternates: [...p.alternates], quorum: pair ? 2 : 3, category: p.category,
    generator: p.generator, ...(p.format !== undefined ? { format: p.format } : {}), roles: { ...p.roles },
    ...(p.via !== undefined ? { via: p.via } : {}), ...(p.anchor ? { anchor: { type: p.anchor.type, id: p.anchor.id } } : {}),
  };
  const tag = p.anchor?.type === "interest" ? p.anchor.id : undefined;
  const activity = tag ? TEEN_ACTIVITIES.get(tag) : undefined;
  const options = activity ? teenOptions(activity.durationMin) : [];
  const first = [...p.participants].sort()[0];
  const venue = activity ? teenVenueOf(activity.id, s.presence.find(x => x.memberId === first && x.type === "home")?.areas[0]) : undefined;
  const venueHood = venue ? hood(venue.area) : undefined;
  if (activity && options.length && venue && venueHood) return { ...shape, activity: activity.id, venueHood: venueHood.id, venueId: venue.id, options };
  return teenShape("friends", [...p.participants, ...p.alternates], shape).laneOk ? null : { ...shape, activity: p.anchor?.id ?? "", venueHood: "", options: [] };
}

export function friendsTeenMatcher(base: FriendsMatcher = friendsPackMatcher()): FriendsMatcher {
  return {
    name: `${base.name}+teen`,
    async propose(ctx) {
      const out = [...await base.propose(ctx)];
      const s = ctx.snapshot;
      const members = new Map(s.members.map(m => [m.id, m]));
      const minor = (id: MemberId) => !canBeMatched(members.get(id)?.age);
      const taken = new Set<MemberId>(out.flatMap(p => {
        const roster = [...p.invited, ...p.alternates, ...(p.hostId !== undefined ? [p.hostId] : [])];
        return roster.some(minor) ? roster : [];
      }));
      const { proposals } = await runEngine(engineInputOf(s), { seed: ctx.week + 1 }, { pack: friendsPack });
      for (const p of proposals) {
        const roster = [...p.participants, ...p.alternates];
        if (!roster.some(minor)) continue;
        const proposal = teenProposalOf(p, s);
        if (!proposal) continue;
        if (rosterAge(s, members, roster, proposal, ctx.week).ruleOk) {
          if (roster.some(id => taken.has(id))) continue;
          for (const id of roster) taken.add(id);
        }
        out.push(proposal);
      }
      return out;
    },
  };
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

const PLAN_GENERATOR: Record<FriendsPlan["source"], string> = { new: "plan", partner: "plan", repeat: "friends_repeat", crew_session: "crew", crew_offer: "crew" };

export function planToProposal(p: FriendsPlan): FriendsProposal | null {
  const options = [...new Set(p.options.map(o => slotIndexOf(o.start)).filter(k => k >= 0))];
  if (!options.length) return null;
  const vh = hood(p.place.area);
  if (!vh) return null;
  const seats = [...p.invited, ...p.alternates, ...(p.hostId !== undefined ? [p.hostId] : [])];
  return {
    kind: p.source === "new" ? "plan" : p.source, invited: [...p.invited], alternates: [...p.alternates], activity: p.activityId,
    venueHood: vh.id, ...(p.venueId ? { venueId: p.venueId } : {}), options, quorum: p.quorum, ...(p.crewId ? { crewId: p.crewId } : {}),
    category: p.category, generator: PLAN_GENERATOR[p.source], format: p.partner ? "one_to_one" : "small_group",
    roles: Object.fromEntries(seats.map(id => [id, id === p.hostId ? "host" : p.partner ? "peer" : "guest"])), ...(p.hostId !== undefined ? { hostId: p.hostId } : {}),
    times: [p.window, ...p.options].map(t => ({ start: t.start, end: t.end })),
    anchor: p.eventId !== undefined ? { type: "event", id: p.eventId } : { type: "interest", id: p.activityId },
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
