// friends.help's weekly planner: group-first, near home, the same people again.
//
// The wedge (domain research C2 "Group dinner formats"): Timeleft, 222, Pie, Les Amis and Bumble BFF
// groups reshuffle strangers every time. Friendship needs repetition and proximity: about 50 hours
// together for a casual friend, about 90 for a friend, 200+ for a close friend (Hall 2018); seat
// neighbours become friends (Back, Schmukle & Egloff 2008); proximity, repeated unplanned interaction
// and a setting to confide (Adams). So, each week, in this order:
//
//   1. crew sessions: crews meet weekly at the same time and place; each session is opt-in; the
//      crew is handed to its own group chat after 3 sessions (plans.crewSessionPlan, handOffAfterSessions);
//   2. crew offers: after ONE great plan (>= 3 attendees would do it again; plans.detectCrews,
//      founder decision 2026-10-08), the attendees are offered a weekly crew with a first session;
//   3. same table again: 2 attendees who both would do it again (or a whole group when crews are
//      off) are offered the same activity at the same time next week;
//   4. new plans: plans.planProposals (the shared plans planner: least misery, quorum, partner plans
//      as the fallback when no group clears the floors) run PER PLANNING ZONE, so groups form among
//      neighbours; then a borough pass for members no zone plan reached. Familiarity is a bonus
//      (one familiar face who enjoyed meeting them, never a clique penalty: repeat bias).
//   Venue: the public venue offering the activity that minimizes the group's LONGEST estimated trip;
//   invitees whose trip would exceed their stated tolerance (x slack) are dropped.
//   Time options: the plan's time plus up to two more (distinct days) where the most invitees are
//   likely free; the probe carries them and the group books the option most yes-sayers picked.
//
// Engine-visible inputs only (the World, availability evidence, the Network's own outcome records).
import type { MemberId } from "@thenetwork/core";
import { DAY, HOUR } from "@thenetwork/core";
import { candidateSlots, type TimeSlot } from "../../attention.ts";
import { DEFAULT_ATTENTION, DEFAULT_PLANS, type AttentionConfig, type PlansConfig } from "../../config.ts";
import { isMinor, memberReason } from "../../filters.ts";
import { localParts } from "@thenetwork/core";
import {
  activityFit, crewSessionPlan, daypartOf, detectCrews, hasWindow, planFreeProb, planMemberReason, planProposals, scorePlanGroup,
  type Crew, type Plan, type PlanEvidence, type PlanMemberInput, type PlanOutcomeRecord,
} from "../../plans.ts";
import { makeCompat } from "../../group.ts";
import { fnv1a, EngineRng as Rng } from "@thenetwork/core";
import { sha256 } from "../../hash.ts";
import { activityPartner } from "./generators.ts";
import type { World } from "../../world.ts";
import { activityById, type Venue } from "../network/activities.ts";
import { BOROUGHS, chooseVenue, hood, NEIGHBORHOODS, transitMinutes, ZONES, type Neighborhood } from "./geo.ts";
import { friendsInfo } from "./info.ts";

/** friends.help plans config (its own version; DEFAULT_PLANS is unchanged). */
export const FRIENDS_PLANS: PlansConfig = {
  ...DEFAULT_PLANS,
  version: "friends-plans-0.1.0",
  // The weekly run (Monday 09:00 local) plans Tuesday evening through Sunday.
  minLeadHours: 30, horizonDays: 6.5, memberCooldownDays: 6,
  size: { min: 3, max: 6, target: 6, partner: 2 },
  minInvite: 4, poolSize: 18, alternates: 6,
  // Many zones, so a generous per-run cap; one plan per member per run still holds.
  maxPlansPerCityRun: 60,
  // Repeat bias: one familiar face who enjoyed meeting you is a plus; two are not a "clique" penalty here.
  familiarity: { oneBonus: 0.08, cliquePenalty: 0, maxBonus: 0.24, maxPenalty: 0.2 },
  crews: { enabled: true, minMembers: 3, minPlans: 1, cadenceDays: 7, handOffAfterSessions: 3 },
};

export interface FriendsPolicy {
  /** Pool new plans within planning zones (proximity). Off = one city-wide pool (ablation). */
  zones: boolean;
  /** Venue minimizes the group's longest trip. Off = the shared planner's area-coverage venue (ablation). */
  venueMinMax: boolean;
  /** Same table again (pairs and, without crews, groups) and the familiarity bonus. */
  repeat: boolean;
  /** Crew offers after one great plan, weekly sessions, hand-off after 3. */
  crews: boolean;
  /** Up to 2 extra time options per plan. */
  timeOptions: boolean;
  /** Activity-partner (2-person) plans when no group clears the floors. */
  partnerFallback: boolean;
  /** Drop an invitee whose estimated trip exceeds tolerance x this. */
  toleranceSlack: number;
  /** Members with a crew session, crew offer or repeat this week get no new plan (spreads seats). */
  spreadNew: boolean;
  /** Days an outcome stays eligible for a crew offer or a repeat. */
  repeatWindowDays: number;
  /** Probe the alternates together with the group ("open table": the first yes-sayers fill up to 6 seats) instead of one by one after a no. */
  openTable: boolean;
  /**
   * Activity-first tables: pool members who fit an activity and are free at ANY of up to 3 time
   * options (the probe carries the options), not at one slot. At low density a slot-first pool is
   * rarely 4 deep; the options are part of the consent flow anyway.
   */
  tables: boolean;
  /** Run the table builder before the single-slot planner passes. */
  tablesFirst: boolean;
  /** Yes-sayers beyond one table form a second table at another option (else they hear "it filled up"). */
  split: boolean;
  /** Time options per table (1-3). */
  tableOptions: number;
  /** Also run the shared planner's single-time passes (planProposals) after the tables. */
  singleSlot: boolean;
  /** Count an attendee as "would do it again" when a "see again" was mutual with another attendee. */
  mutualPositive: boolean;
  /** Invitees per open table (seats stay 3-6 per table; more yes-sayers form a second table at another option). */
  tableInvite: number;
  /** Minimum invitees for a table (quorum 3 needs several invitees when about a third say yes). */
  tableMinInvite: number;
  /**
   * One-to-one activity partners on the intro cap (the engine's activity_partner generator), for
   * members who already attended a group meetup (groups first), up to `partnerIntros` a week.
   */
  partnerIntros: number;
  /** Last: dinner / coffee tables open to any unplanned member nearby (with its own floor). */
  universal: boolean; universalFloor: number;
  /** Activity fit assumed for dinner / coffee when not stated; run the universal tables FIRST (Timeleft-style dinners as the base layer). */
  universalFit: number; universalFirst: boolean;
  /** Zones with fewer than `sparseZone` members with evidence: dinner / coffee tables with as few as `sparseMinInvite` invitees, within 45 minutes. */
  sparseMinInvite: number; sparseZone: number;
  /** Exposure floor: members without a meetup in 14 days seed tables first (and get `starvedBonus` when tables are built). */
  fairness: boolean; starvedBonus: number;
  /** Crew sessions also carry up to two other times (else the same weekday and time only). */
  crewOptions: boolean;
  /** Table building: bonus for adding someone a member already said they'd see again (repeat bias). */
  regroupBonus: number;
  /** A last pass for unplanned members: family-level activity fit and lower floors. */
  loosePass: boolean; looseFloor: number;
}
/** Tuned on seeds 1-4 (docs/results/2026-10-08-friends-pack.md, tuning trail). */
export const DEFAULT_FRIENDS_POLICY: FriendsPolicy = {
  // Geography and venues
  zones: true, venueMinMax: true, toleranceSlack: 1.15,
  // Repetition: same table again, crews after one great plan, regrouping people who said "see again"
  repeat: true, crews: true, mutualPositive: true, repeatWindowDays: 10, regroupBonus: 0.2, crewOptions: false,
  // New plans: dinner / coffee tables near home first, then activity tables, then the shared planner's single-time passes
  universal: true, universalFirst: true, universalFit: 0.75, universalFloor: 0.15,
  tables: true, tablesFirst: true, openTable: true, tableInvite: 12, tableMinInvite: 6, tableOptions: 1, split: false,
  singleSlot: true, timeOptions: true, partnerFallback: true, loosePass: true, looseFloor: 0.25,
  // Seats and one-to-one
  spreadNew: false, fairness: false, starvedBonus: 0.15, partnerIntros: 1, sparseMinInvite: 6, sparseZone: 15,
};

/** Activities open to anyone who wants to meet people (most people enjoy a dinner or a coffee with others). */
export const FRIENDS_UNIVERSAL: readonly string[] = ["restaurant_dinner", "coffee_crawl"];

export type FriendsPlanSource = "crew_session" | "crew_offer" | "repeat" | "new" | "partner";
export interface FriendsPlan extends Plan {
  /** Time options offered in the probe (the plan's window first). */
  options: TimeSlot[];
  /** Estimated one-way transit minutes per invitee and alternate to the venue. */
  minutes: Record<MemberId, number>;
  source: FriendsPlanSource;
}
export interface FriendsWeekInput {
  now: number; tz: string;
  evidence: ReadonlyMap<MemberId, PlanEvidence>;
  venues: readonly Venue[];
  /** Live crews (formed, opted in). */
  crews: readonly Crew[];
  /** The Network's post-plan records: who came, who would do it again. */
  outcomes: readonly PlanOutcomeRecord[];
  /** Crews already offered (formed or not): never re-offered. */
  offered: readonly Crew[];
  lastPlannedAt?: ReadonlyMap<MemberId, number>;
}
export interface FriendsWeek { sessions: FriendsPlan[]; offers: { crew: Crew; first: FriendsPlan }[]; repeats: FriendsPlan[]; plans: FriendsPlan[]; partners: FriendsPlan[] }

const venueOpen = (v: Venue, slot: TimeSlot, durMin: number, tz: string, att: AttentionConfig) => {
  const lp = localParts(slot.start, tz);
  const [o, c] = att.sendTime.weekendDays.includes((lp.weekday + 1) % 7) ? v.hours.weekend : v.hours.weekday;
  return lp.hour >= o && lp.hour + durMin / 60 <= c;
};

/** The same local weekday and time as `at`, at least `minLeadHours` after now (weekly cadence). */
/** The activity a pair shares that allows two (both fit; the best combined fit, then id). */
function pairActivity(w: World, a: MemberId, b: MemberId, pcfg: PlansConfig) {
  const fa = activityFit(w, a, pcfg), fb = activityFit(w, b, pcfg);
  return (w.pack.plans?.activities ?? []).filter(x => x.groupSize[0] <= 2 && (fa.get(x.id) ?? 0) >= 1 && (fb.get(x.id) ?? 0) >= 1)
    .sort((x, y) => (x.id < y.id ? -1 : 1))[0];
}

const hubs = new Map<string, Neighborhood>();
/** The most populous neighborhood of a planning zone (its hub). */
export function zoneHub(zone: string): Neighborhood {
  let h = hubs.get(zone);
  if (!h) { h = NEIGHBORHOODS.filter(n => n.zone === zone).sort((a, b) => (b.weight - a.weight) || (a.id < b.id ? -1 : 1))[0]!; hubs.set(zone, h); }
  return h;
}

export function nextSameSlot(at: number, now: number, pcfg: PlansConfig): number {
  let t = at;
  while (t < now + pcfg.minLeadHours * HOUR) t += 7 * DAY;
  return t;
}

export function planFriendsWeek(w: World, inp: FriendsWeekInput, pol: FriendsPolicy = DEFAULT_FRIENDS_POLICY, pcfg: PlansConfig = FRIENDS_PLANS, att: AttentionConfig = DEFAULT_ATTENTION): FriendsWeek {
  const info = friendsInfo(w);
  const { now, tz } = inp;
  const homeOf = (id: MemberId): Neighborhood | undefined => info.get(id)?.home;
  const tolOf = (id: MemberId) => info.get(id)?.tolerance ?? 40;
  const eligible = (id: MemberId) => !!w.get(id) && !isMinor(w, id) && !planMemberReason(w, id);
  const venueById = new Map(inp.venues.map(v => [v.id, v]));
  const taken = new Set<MemberId>();
  const out: FriendsWeek = { sessions: [], offers: [], repeats: [], plans: [], partners: [] };

  const finish = (p: Plan, source: FriendsPlanSource, forceVenue = false): FriendsPlan | null => {
    const a = activityById.get(p.activityId);
    if (!a) return null;
    let venue = p.venueId ? venueById.get(p.venueId) : undefined;
    const everyone = [...p.invited, ...p.alternates];
    const homes = new Map(everyone.map(id => [id, homeOf(id)] as const).filter((x): x is [MemberId, Neighborhood] => !!x[1]));
    if ((pol.venueMinMax || forceVenue) && (source === "new" || source === "partner")) {
      const inv = new Map(p.invited.filter(id => homes.has(id)).map(id => [id, homes.get(id)!]));
      const best = chooseVenue(inp.venues, inv, v => v.city === p.city && v.activities.includes(a.id) && v.ageMin <= Math.min(...p.invited.map(id => w.get(id)!.m.age)) && venueOpen(v, p.window, a.durationMin, tz, att));
      if (best) venue = best.venue;
    }
    const at = hood(venue?.area ?? p.place.area);
    const minutes: Record<MemberId, number> = {};
    for (const [id, h] of homes) minutes[id] = at ? transitMinutes(h, at) : 45;
    const fits = (id: MemberId) => (minutes[id] ?? 99) <= tolOf(id) * pol.toleranceSlack;
    let invited = p.invited.filter(fits);
    let alternates = p.alternates.filter(fits);
    // Fill dropped seats from alternates (group plans only).
    while (!p.partner && invited.length < p.invited.length && alternates.length) invited.push(alternates.shift()!);
    if (invited.length < (p.partner ? 2 : Math.min(p.quorum, 3))) return null;
    if (!p.partner && invited.length < pcfg.size.min && source === "new") return null;
    const plan: FriendsPlan = {
      ...p, invited, alternates, minutes, source, options: [p.window],
      ...(venue ? { venueId: venue.id, place: { name: venue.name, area: venue.area } } : {}),
      quorum: p.partner ? 2 : Math.min(p.quorum, invited.length),
    };
    if (pol.timeOptions && (source !== "crew_session" || pol.crewOptions)) plan.options = timeOptions(plan, venue);
    return plan;
  };

  const timeOptions = (p: FriendsPlan, venue: Venue | undefined): TimeSlot[] => {
    const a = activityById.get(p.activityId)!;
    const cands = candidateSlots(tz, now, { window: { start: now + pcfg.minLeadHours * HOUR, end: now + pcfg.horizonDays * DAY } }, att)
      .filter(s => (a.dayparts as string[]).includes(daypartOf(s.start, tz, att)) && (!venue || venueOpen(venue, s, a.durationMin, tz, att)));
    const day = (t: number) => { const lp = localParts(t, tz); return `${lp.month}-${lp.day}`; };
    const scored = cands.map(s => ({ s, e: p.invited.reduce((sum, id) => sum + (inp.evidence.get(id) ? planFreeProb(inp.evidence.get(id)!, s, now, pcfg, att).p : 0.3), 0) }))
      .filter(x => day(x.s.start) !== day(p.window.start)).sort((x, y) => (y.e - x.e) || (x.s.start - y.s.start));
    const opts: TimeSlot[] = [p.window];
    for (const x of scored) {
      if (opts.length >= 3) break;
      if (x.e < 1.5 || opts.some(o => day(o.start) === day(x.s.start))) continue;
      opts.push({ start: x.s.start, end: x.s.start + a.durationMin * 60_000 });
    }
    return opts.sort((x, y) => x.start - y.start);
  };

  // 1. crew sessions
  if (pol.crews) for (const crew of inp.crews) {
    if (crew.handedOff) continue;
    const members = crew.members.filter(eligible);
    if (members.length < 2) continue;
    const v = crew.venueId ? venueById.get(crew.venueId) : undefined;
    const p = crewSessionPlan({ ...crew, members }, now, v ? { name: v.name, area: v.area } : { name: "the usual spot" }, pcfg, w.pack);
    if (!p) continue;
    const fp = finish({ ...p, quorum: Math.min(3, members.length) }, "crew_session");
    if (!fp) continue;
    out.sessions.push(fp);
    for (const id of fp.invited) taken.add(id);
  }

  // 2. crew offers (after one great plan) and 3. same table again
  // "Would do it again" = rated it positively, or (mutualPositive) said "see again" about someone who
  // said it back: the private answers after the meetup (domain research C4 consent flow step 5).
  const mutualSee = (o: PlanOutcomeRecord) => {
    const said = (a: MemberId, b: MemberId) => w.feedback.some(f => f.from === a && f.about === b && f.opportunityId === o.planId && f.wouldMeetAgain === true);
    return o.attended.filter(a => o.attended.some(b => b !== a && said(a, b) && said(b, a)));
  };
  const recent = inp.outcomes.filter(o => now - o.at < pol.repeatWindowDays * DAY && o.at <= now)
    .map(o => (pol.mutualPositive ? { ...o, positive: [...new Set([...o.positive, ...mutualSee(o)])].sort() } : o));
  if (pol.crews) {
    const proposed = detectCrews(recent, [...inp.crews, ...inp.offered], id => w.get(id)?.isHost ?? false, pcfg);
    for (const crew of proposed) {
      const members = crew.members.filter(id => eligible(id) && !taken.has(id));
      if (members.length < pcfg.crews.minMembers) continue;
      const v = crew.venueId ? venueById.get(crew.venueId) : undefined;
      const c2: Crew = { ...crew, members, hostRotation: crew.hostRotation.filter(m => members.includes(m)).length ? crew.hostRotation.filter(m => members.includes(m)) : members };
      const p = crewSessionPlan(c2, now, v ? { name: v.name, area: v.area } : { name: "the usual spot" }, pcfg, w.pack);
      if (!p) continue;
      const fp = finish({ ...p, quorum: Math.min(3, members.length) }, "crew_offer");
      if (!fp) continue;
      out.offers.push({ crew: c2, first: fp });
      for (const id of fp.invited) taken.add(id);
    }
  }
  if (pol.repeat) {
    for (const o of [...recent].sort((x, y) => (y.at - x.at) || (x.planId < y.planId ? -1 : 1))) {
      const pos = o.positive.filter(id => eligible(id) && !taken.has(id));
      // Members offered a crew this week are taken; everyone else positive gets the same table again
      // (pairs, groups without crews, and groups whose crew offer did not form).
      if (pos.length < 2) continue;
      const ids = pos.slice(0, 6).sort();
      if (ids.some((x, i) => ids.slice(i + 1).some(y => w.blocked.has(x < y ? `${x}|${y}` : `${y}|${x}`)))) continue;
      const a = activityById.get(o.activityId);
      if (!a) continue;
      const start = nextSameSlot(o.at, now, pcfg);
      if (start > now + pcfg.horizonDays * DAY + DAY) continue;
      const v = o.venueId ? venueById.get(o.venueId) : undefined;
      const partner = ids.length === 2;
      const base: Plan = {
        id: `plan_${sha256(`repeat|${o.planId}|${start}|${ids.join(",")}`).slice(0, 16)}`, city: "nyc", activityId: a.id, ...(v ? { venueId: v.id } : {}),
        place: v ? { name: v.name, area: v.area } : { name: "the same spot" }, window: { start, end: start + a.durationMin * 60_000 },
        invited: ids, alternates: o.attended.filter(id => !ids.includes(id) && eligible(id) && !taken.has(id)).slice(0, partner ? 0 : 2), partner,
        size: partner ? { min: 2, target: 2, max: 2 } : { min: 3, target: ids.length, max: 6 }, quorum: partner ? 2 : Math.min(3, ids.length),
        probeDeadline: start - pcfg.deadlineBeforeStartHours * HOUR, score: 0.7, u: {}, familiar: {}, createdAt: now, category: "social",
      };
      const fp = finish(base, "repeat");
      if (!fp) continue;
      out.repeats.push(fp);
      for (const id of [...fp.invited, ...fp.alternates]) taken.add(id);
    }
  }

  // Exposure floor: members with no meetup in the last 14 days are seeded first, and planning zones
  // with the largest share of them go first (they get first pick of shared neighbours).
  const lastMet = new Map<MemberId, number>();
  for (const r of w.interactions) if (r.outcome === "completed") for (const id of r.participants) lastMet.set(id, Math.max(lastMet.get(id) ?? -Infinity, r.at));
  const starved = new Set(w.ids.filter(id => now - (lastMet.get(id) ?? -Infinity) > 14 * DAY));
  const zoneOrder = pol.fairness ? [...ZONES].sort((x, y) => {
    const share = (z: string) => { const m = [...inp.evidence.keys()].filter(id => homeOf(id)?.zone === z); return m.length ? m.filter(id => starved.has(id)).length / m.length : 0; };
    return (share(y) - share(x)) || (x < y ? -1 : 1);
  }) : ZONES;
  const busy = pol.spreadNew ? taken : new Set<MemberId>();
  const used = new Set<MemberId>();
  // Activity-first table builder (multi-slot pools), scored by the shared planner's least misery.
  const compat = makeCompat(w, "social");
  const familiar = (a: MemberId, b: MemberId) => w.isWarm(a, b);
  const slotsAll = candidateSlots(tz, now, { window: { start: now + pcfg.minLeadHours * HOUR, end: now + pcfg.horizonDays * DAY } }, att);
  const dayKey = (t: number) => { const lp = localParts(t, tz); return `${lp.month}-${lp.day}`; };
  const tables = (members: MemberId[], cfg: PlansConfig, universal = false, minInvite = pol.tableMinInvite) => {
    const pool = members.filter(id => !busy.has(id) && !used.has(id) && inp.evidence.has(id) && eligible(id) && now - (inp.lastPlannedAt?.get(id) ?? -Infinity) >= cfg.memberCooldownDays * DAY);
    if (pool.length < cfg.size.min) return;
    const fits = new Map(pool.map(id => {
      const f = activityFit(w, id, cfg);
      // Universal pass: dinner and coffee are open to anyone who wants to meet people (fit = family level).
      if (universal) for (const a of FRIENDS_UNIVERSAL) f.set(a, Math.max(f.get(a) ?? 0, pol.universalFit));
      return [id, f] as const;
    }));
    const acts = [...(w.pack.plans?.activities ?? [])].map(a => ({ a, n: pool.filter(id => (fits.get(id)!.get(a.id) ?? 0) >= cfg.minFit).length }))
      .filter(x => x.n >= minInvite).sort((x, y) => (y.n - x.n) || (x.a.id < y.a.id ? -1 : 1));
    for (const { a } of acts) {
      const cand = pool.filter(id => !used.has(id) && (fits.get(id)!.get(a.id) ?? 0) >= cfg.minFit && (w.get(id)!.m.age ?? 0) >= a.ageMin);
      if (cand.length < minInvite) continue;
      const slots = slotsAll.filter(sl => (a.dayparts as string[]).includes(daypartOf(sl.start, tz, att)));
      const pf = new Map(cand.map(id => [id, slots.map(sl => hasWindow(inp.evidence.get(id)!, sl, now, cfg, att))] as const));
      // Up to 3 options on distinct days where the MOST candidates are free (yes-sayers must agree on
      // one option for quorum, so overlap beats coverage).
      const ranked = slots.map((sl, i) => ({ i, n: cand.filter(id => pf.get(id)![i]! > 0).length })).sort((x, y) => (y.n - x.n) || (slots[x.i]!.start - slots[y.i]!.start));
      const chosen: number[] = [];
      for (const r of ranked) {
        if (chosen.length >= pol.tableOptions || r.n < Math.max(3, (ranked[0]?.n ?? 0) * 0.5)) break;
        if (chosen.some(c => dayKey(slots[c]!.start) === dayKey(slots[r.i]!.start))) continue;
        chosen.push(r.i);
      }
      const covered = new Set(cand.filter(id => chosen.some(i => pf.get(id)![i]! > 0)));
      const free = cand.filter(id => covered.has(id));
      if (free.length < minInvite || !chosen.length) continue;
      const input = (id: MemberId): PlanMemberInput => ({ id, fit: fits.get(id)!.get(a.id)!, venueFit: 1, timeFit: Math.max(...chosen.map(i => pf.get(id)![i]!)) });
      // Greedy least-misery build up to size.max + alternates, seeded by the strongest fit x availability.
      const pri = (id: MemberId) => input(id).fit * input(id).timeFit + (pol.fairness && starved.has(id) ? 0.3 : 0);
      const order = [...free].sort((x, y) => (pri(y) - pri(x)) || (x < y ? -1 : 1));
      const g: MemberId[] = [order[0]!];
      const want = pol.openTable ? Math.max(cfg.size.max, pol.tableInvite) : cfg.size.max;
      while (g.length < want) {
        let best: { id: MemberId; s: number } | undefined;
        for (const id of order) {
          if (g.includes(id)) continue;
          const sc = scorePlanGroup([...g, id].map(input), compat, familiar, cfg);
          if (!sc || sc.min < cfg.minMemberU) continue;
          // Repeat bias ("same table again"): someone a member here said they'd see again.
          const v = sc.score + (pol.repeat && g.some(x => familiar(x, id)) ? pol.regroupBonus : 0) + (pol.fairness && starved.has(id) ? pol.starvedBonus : 0);
          if (!best || v > best.s) best = { id, s: v };
        }
        if (!best) break;
        g.push(best.id);
      }
      const sc = scorePlanGroup(g.map(input), compat, familiar, cfg);
      if (g.length < minInvite || !sc || sc.score < cfg.threshold) continue;
      const opts = chosen.map(i => slots[i]!).sort((x, y) => x.start - y.start);
      const best = chosen.map(i => ({ i, n: g.filter(id => pf.get(id)![i]! > 0).length })).sort((x, y) => (y.n - x.n) || (x.i - y.i))[0]!;
      const start = slots[best.i]!.start;
      const primary = g.slice(0, cfg.size.max), alternates = g.slice(cfg.size.max);
      const plan: Plan = {
        id: `plan_${sha256(`table|${a.id}|${start}|${[...primary].sort().join(",")}|${now}`).slice(0, 16)}`, city: "nyc", activityId: a.id,
        place: { name: a.label }, window: { start, end: start + a.durationMin * 60_000 }, invited: primary, alternates, partner: false,
        size: { min: cfg.size.min, target: primary.length, max: cfg.size.max }, quorum: cfg.quorum.group,
        probeDeadline: Math.min(start - cfg.deadlineBeforeStartHours * HOUR, now + cfg.probeWindowHours * HOUR), score: Math.round(sc.score * 1e4) / 1e4, u: sc.u, familiar: sc.familiar, createdAt: now, category: "social",
      };
      // Venue: minimize the longest trip (finish() always re-picks for new plans), then the options.
      const fp = finish(plan, "new", true);
      if (!fp) continue;
      fp.options = opts.map(o => ({ start: o.start, end: o.start + a.durationMin * 60_000 }));
      out.plans.push(fp);
      for (const id of [...fp.invited, ...fp.alternates]) used.add(id);
    }
  };

  // 4. new plans, per planning zone, then per borough for whoever no zone plan reached
  const pcfgNew: PlansConfig = { ...pcfg, partnerPlans: pol.partnerFallback, familiarity: pol.repeat ? pcfg.familiarity : DEFAULT_PLANS.familiarity };
  const run = (members: MemberId[], cfg: PlansConfig = pcfgNew) => {
    const ev = new Map<MemberId, PlanEvidence>();
    for (const id of members) { const e = inp.evidence.get(id); if (e && !busy.has(id) && !used.has(id)) ev.set(id, e); }
    if (ev.size < 2) return;
    const plans = planProposals(w, { now, city: "nyc", tz, evidence: ev, venues: inp.venues, lastPlannedAt: inp.lastPlannedAt, exclude: new Set([...busy, ...used]) }, cfg, att);
    for (const p of plans) {
      // Groups first: an activity-partner (one-to-one) plan only for members who already attended a group meetup.
      if (p.partner && p.invited.some(id => memberReason(w, id, { category: "hobby", role: "peer", format: "one_to_one", timeSensitive: true }) !== null)) continue;
      const fp = finish(p, "new");
      if (!fp) continue;
      if (fp.invited.some(id => used.has(id))) continue;
      out.plans.push(fp);
      for (const id of fp.invited) used.add(id);
      fp.alternates = fp.alternates.filter(id => !used.has(id));
    }
  };
  const ids = [...inp.evidence.keys()].sort();
  const near = (z: string, radius: number) => { const hub = zoneHub(z); return ids.filter(id => { const h = homeOf(id); return !!h && (h.zone === z || transitMinutes(h, hub) <= radius); }); };
  if (pol.zones) {
    if (pol.universalFirst && pol.tables) {
      const uni: PlansConfig = { ...pcfgNew, minFit: Math.min(pcfgNew.minFit, pol.universalFit), minMemberU: pol.universalFloor, threshold: pol.universalFloor };
      for (const radius of [25, 35]) for (const z of zoneOrder) tables(near(z, radius), uni, true);
    }
    if (pol.tablesFirst && pol.tables) {
      // Activity-first tables among neighbours (within 25, then 35 minutes of each zone hub), then
      // the shared planner (one time) for whoever is left, then the borough.
      for (const radius of [25, 35]) for (const z of zoneOrder) tables(near(z, radius), pcfgNew);
      if (pol.singleSlot) for (const z of ZONES) run(ids.filter(id => homeOf(id)?.zone === z));
      if (pol.singleSlot) for (const z of ZONES) run(near(z, 35));
      for (const b of BOROUGHS) { const xs = ids.filter(id => homeOf(id)?.borough === b); tables(xs, pcfgNew); if (pol.singleSlot) run(xs); }
    } else {
      // Neighbours first: the planning zone (one time, the shared planner), then activity-first tables
      // among everyone within 25 and 35 minutes of each zone hub, then the borough.
      for (const z of ZONES) run(ids.filter(id => homeOf(id)?.zone === z));
      for (const radius of [25, 35]) for (const z of ZONES) { if (pol.tables) tables(near(z, radius), pcfgNew); run(near(z, radius)); }
      for (const b of BOROUGHS) { const xs = ids.filter(id => homeOf(id)?.borough === b); if (pol.tables) tables(xs, pcfgNew); run(xs); }
    }
  } else { if (pol.tables) tables(ids, pcfgNew); run(ids); }
  if (pol.loosePass) {
    // Whoever is still unplanned: an activity in a family they like counts (family fit), lower floors;
    // then dinner or coffee tables open to anyone nearby who wants to meet people.
    const loose: PlansConfig = { ...pcfgNew, minFit: pcfgNew.familyFit, minMemberU: pol.looseFloor, threshold: pol.looseFloor };
    if (pol.zones) for (const z of ZONES) { if (pol.tables) tables(near(z, 35), loose); if (pol.singleSlot || !pol.tables) run(near(z, 35), loose); }
    for (const b of BOROUGHS) { const xs = ids.filter(id => homeOf(id)?.borough === b); if (pol.tables) tables(xs, loose); if (pol.singleSlot || !pol.tables) run(xs, loose); }
    if (pol.tables && pol.universal) {
      const uni: PlansConfig = { ...loose, minMemberU: pol.universalFloor, threshold: pol.universalFloor };
      if (pol.zones) for (const z of ZONES) tables(near(z, 35), uni, true);
      for (const b of BOROUGHS) tables(ids.filter(id => homeOf(id)?.borough === b), uni, true);
      // Sparse areas (few members within reach, e.g. Staten Island): smaller invite lists still form a table of 3.
      if (pol.sparseMinInvite < pol.tableMinInvite) for (const z of ZONES) {
        const xs = ids.filter(id => homeOf(id)?.zone === z);
        if (xs.length < pol.sparseZone) tables(near(z, 45), uni, true, pol.sparseMinInvite);
      }
    }
  }
  // 5. activity partners (one-to-one, intro cap), from the engine generator; groups first.
  if (pol.partnerIntros > 0) {
    const gen = activityPartner({ w, memberExclusions: {}, rng: new Rng(fnv1a(`friends-partner|${now}`)), unmatchedIntents: new Set() });
    const count = new Map<MemberId, number>();
    for (const c of gen) {
      const [a, b] = c.participants as [MemberId, MemberId];
      if (!inp.evidence.has(a) || !inp.evidence.has(b) || (count.get(a) ?? 0) >= pol.partnerIntros || (count.get(b) ?? 0) >= pol.partnerIntros) continue;
      const act = pairActivity(w, a, b, pcfg);
      if (!act) continue;
      const slots = slotsAll.filter(sl => (act.dayparts as string[]).includes(daypartOf(sl.start, tz, att)))
        .map(sl => ({ sl, p: Math.min(hasWindow(inp.evidence.get(a)!, sl, now, pcfg, att), hasWindow(inp.evidence.get(b)!, sl, now, pcfg, att)) }))
        .filter(x => x.p > 0).sort((x, y) => (y.p - x.p) || (x.sl.start - y.sl.start));
      if (!slots.length) continue;
      const start = slots[0]!.sl.start;
      const plan: Plan = {
        id: `plan_${sha256(`partner|${a}|${b}|${start}`).slice(0, 16)}`, city: "nyc", activityId: act.id, place: { name: act.label }, window: { start, end: start + act.durationMin * 60_000 },
        invited: [a, b], alternates: [], partner: true, size: { min: 2, target: 2, max: 2 }, quorum: 2, probeDeadline: start - pcfg.deadlineBeforeStartHours * HOUR,
        score: 0.5, u: {}, familiar: {}, createdAt: now, category: "hobby",
      };
      const fp = finish(plan, "partner", true);
      if (!fp) continue;
      const days = new Set<string>();
      fp.options = slots.filter(x => { const d = dayKey(x.sl.start); if (days.has(d)) return false; days.add(d); return true; }).slice(0, 3).map(x => ({ start: x.sl.start, end: x.sl.start + act.durationMin * 60_000 })).sort((x, y) => x.start - y.start);
      out.partners.push(fp);
      for (const id of [a, b]) count.set(id, (count.get(id) ?? 0) + 1);
    }
  }
  // Alternates are never invited elsewhere this run.
  for (const p of out.plans) p.alternates = p.alternates.filter(id => !p.invited.includes(id) && !out.plans.some(q => q !== p && q.invited.includes(id)));
  return out;
}
