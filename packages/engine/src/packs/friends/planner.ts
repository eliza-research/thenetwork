// friends.help's weekly planner: group-first, near home, the same people again. The simulator runs
// every pass; production (packages/network ConsentNetwork for the friends app) runs this function
// too, with no crews and no outcomes, so it takes only the new plans and the activity partners.
//
// The wedge (domain research C2 "Group dinner formats"): Timeleft, 222, Pie, Les Amis and Bumble BFF
// groups reshuffle strangers every time. Friendship needs repetition and proximity: about 50 hours
// together for a casual friend, about 90 for a friend, 200+ for a close friend (Hall 2018); seat
// neighbours become friends (Back, Schmukle & Egloff 2008); proximity, repeated unplanned interaction
// and a setting to confide (Adams). So, each week, in this order (spec/friendsWeek.md):
//
//   1. crew sessions: crews meet weekly at the same time and place; each session is opt-in; the
//      crew is handed to its own group chat after 3 sessions (plans.crewSessionPlan, handOffAfterSessions);
//   2. crew offers: after ONE great plan (>= 3 attendees would do it again; plans.detectCrews,
//      founder decision 2026-10-08), the attendees are offered a weekly crew with a first session;
//   3. same table again: 2 attendees who both would do it again (or a whole group when crews are
//      off) are offered the same activity at the same time next week;
//   4. new plans: open tables of neighbours. Each pass pools the members near a planning zone (then a
//      borough) who fit one activity and are free at its time, and grows one table from the priority
//      seed, trying others if every neighbour is blocked from that seed. It adds a member someone at the table
//      would see again first, then the member who keeps the lowest pair value at the table highest.
//      Every pair at the table (alternates too) reaches the Friend circle pair floor through the one
//      pair gate, and the seated invitees pass circle admission (spec/groupFormation.md). Dinner and coffee
//      first, then stated activities, then activities in a family the member likes, and last a
//      smaller table for the members no larger table reached. Only times at which a venue is open;
//   5. activity partners: each plannable member's searched partners, best pair value first,
//      one-to-one rules (groups first).
//   Venue: the public venue offering the activity that minimizes the group's LONGEST estimated trip;
//   invitees whose trip would exceed their stated tolerance (x slack) are dropped.
//   Time options: the plan's time plus up to two more (distinct days) where the most invitees are
//   likely free; the probe carries them and the group books the option most yes-sayers picked.
//
// Engine-visible inputs only (the World, availability evidence, the Network's own outcome records).
import type { Category, MemberId } from "@thenetwork/core";
import { CITY_TZ, DAY, HOUR, MINUTE, fromLocal, localParts } from "@thenetwork/core";
import {
  canReservePartner, type Event as WeekEvent, initial as initialWeek, newPlanAlternateCanRemain, newPlanAvailable,
  recurringAvailable, step as stepWeek,
} from "../../../../core/src/generated/friendsWeek.ts";
import { circleCoherent } from "../../../../core/src/generated/groupFormation.ts";
import { laneLimits } from "../../../../core/src/generated/matchLane.ts";
import { noPairValue, pairValueScale } from "../../../../core/src/generated/pairValue.ts";
import { isPlanAlternate } from "../../../../core/src/generated/planFormation.ts";
import { candidateSlots, type TimeSlot } from "../../attention.ts";
import { DEFAULT_ATTENTION, DEFAULT_PLANS, type AttentionConfig, type PlansConfig } from "../../config.ts";
import { isMinor, memberReason, pairReason } from "../../filters.ts";
import { sha256 } from "../../hash.ts";
import { circleEvidence, type Circle } from "../../match/circles.ts";
import { compareText } from "../../match/profile.ts";
import { activityFit, crewSessionPlan, daypartOf, detectCrews, hasWindow, planFreeProb, planMemberReason, venueOpenForSlot as venueOpen, type Crew, type Plan, type PlanEvidence, type PlanOutcomeRecord } from "../../plans.ts";
import { pairKey, World } from "../../world.ts";
import { activityById, type ActivityType, type Venue } from "../network/activities.ts";
import { familiarCircle } from "./generators.ts";
import { chooseVenue, FRIENDS_CITY, hood, NEIGHBORHOODS, transitMinutes, type Neighborhood } from "./geo.ts";
import { friendsInfo } from "./info.ts";

/** friends.help plans config (its own version; DEFAULT_PLANS is unchanged). */
export const FRIENDS_PLANS: PlansConfig = {
  ...DEFAULT_PLANS,
  version: "friends-plans-0.2.0",
  // The weekly run (Monday 09:00 local) plans Tuesday evening through Sunday.
  minLeadHours: 30, horizonDays: 6.5, memberCooldownDays: 6,
  size: { min: 3, max: 6, target: 6, partner: 2 },
  alternates: 6,
  crews: { enabled: true, minMembers: 3, minPlans: 1, cadenceDays: 7, handOffAfterSessions: 3 },
};

export interface FriendsPolicy {
  /** Same table again (pairs and, without crews, groups). */
  repeat: boolean;
  /** Crew offers after one great plan, weekly sessions, hand-off after 3. */
  crews: boolean;
  /** Crew sessions also carry up to two other times (else the same weekday and time only). */
  crewOptions: boolean;
  /** Count an attendee as "would do it again" when a "see again" was mutual with another attendee. */
  mutualPositive: boolean;
  /** Days an outcome stays eligible for a crew offer or a repeat. */
  repeatWindowDays: number;
  /** Members with a crew session, crew offer or repeat this week get no new plan (spreads seats). */
  spreadNew: boolean;
  /** Drop an invitee whose estimated trip exceeds tolerance x this. */
  toleranceSlack: number;
  /** Up to 2 extra time options per recurring or partner plan. */
  timeOptions: boolean;
  /** Time options per circle table (1-3), on distinct days where the most invitees are free. */
  tableOptions: number;
  /** The probe asks the alternates together with the invitees ("open table": the first yes-sayers fill up to 6 seats). */
  openTable: boolean;
  /** Yes-sayers beyond one table form a second table at another option (else they hear "it filled up"). */
  split: boolean;
  /** Dinner and coffee are open to every circle, at fit `universalFit`. */
  universal: boolean; universalFit: number;
  /** One-to-one activity partners a week per member (separate allowance; groups first). */
  partnerIntros: number;
}
/** Tuned on seeds 1-4 (docs/results/2026-10-08-friends-pack.md, tuning trail). */
export const DEFAULT_FRIENDS_POLICY: FriendsPolicy = {
  repeat: true, crews: true, crewOptions: false, mutualPositive: true, repeatWindowDays: 10, spreadNew: false,
  toleranceSlack: 1.15, timeOptions: true, tableOptions: 1, openTable: true, split: false,
  universal: true, universalFit: 0.75, partnerIntros: 1,
};

/** Activities open to anyone who wants to meet people (most people enjoy a dinner or a coffee with others). */
export const FRIENDS_UNIVERSAL: readonly string[] = ["restaurant_dinner", "coffee_crawl"];

/** The fewest invitees for a new table, so that a quorum of 3 is likely. */
const FRIENDS_TABLE_MIN_INVITE = 6;
/**
 * The members one table build reads: the best fit and availability among the members of one area who
 * are free at the table's time. It bounds the pair values that one area and activity reads to
 * FRIENDS_TABLE_POOL x FRIENDS_TABLE_POOL (each pair value is read once a run).
 */
const FRIENDS_TABLE_POOL = 36;
/** Neighbour pools: the members within these minutes of a planning zone's hub (or in the zone), nearest first. */
const ZONE_RADII = [25, 35] as const;

const ZONES: readonly string[] = [...new Set(NEIGHBORHOODS.map(n => n.zone))];
const BOROUGHS: readonly string[] = [...new Set(NEIGHBORHOODS.map(n => n.borough))];
/** The hub of a planning zone: its neighbourhood with the shortest longest trip to the others (then id). */
const ZONE_HUB: ReadonlyMap<string, Neighborhood> = new Map(ZONES.map(zone => {
  const inZone = NEIGHBORHOODS.filter(n => n.zone === zone);
  const worst = (h: Neighborhood) => Math.max(...inZone.map(n => transitMinutes(h, n)));
  return [zone, [...inZone].sort((x, y) => (worst(x) - worst(y)) || compareText(x.id, y.id))[0]!];
}));

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

/** The activity a pair shares that allows two (both fit; the first by id). */
function pairActivity(w: World, a: MemberId, b: MemberId, pcfg: PlansConfig) {
  const fa = activityFit(w, a, pcfg), fb = activityFit(w, b, pcfg);
  return (w.pack.plans?.activities ?? []).filter(x => x.groupSize[0] <= 2 && (fa.get(x.id) ?? 0) >= 1 && (fb.get(x.id) ?? 0) >= 1)
    .sort((x, y) => (x.id < y.id ? -1 : 1))[0];
}

/** The same local weekday and time as `at`, at least `minLeadHours` after now (weekly cadence). */
export function nextSameSlot(at: number, now: number, pcfg: PlansConfig, tz = CITY_TZ.nyc): number {
  const lp = localParts(at, tz);
  let t = at, weeks = 0;
  // A local week can be 167 or 169 hours across DST. Keep the original wall-clock slot.
  while (t < now + pcfg.minLeadHours * HOUR) {
    const d = new Date(Date.UTC(lp.year, lp.month - 1, lp.day + ++weeks * 7));
    t = fromLocal(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), lp.hour, tz) + lp.minute * MINUTE + at % MINUTE;
  }
  return t;
}

/** Keep the crew's turn order, skipping hosts removed by eligibility or travel limits. */
function retainedCrewHost(crew: Crew, invited: readonly MemberId[]): MemberId {
  for (let i = 0; i < crew.hostRotation.length; i++) {
    const host = crew.hostRotation[(crew.sessions.length + i) % crew.hostRotation.length]!;
    if (invited.includes(host)) return host;
  }
  return invited[crew.sessions.length % invited.length]!;
}

/** Current pack eligibility for an activity partner, including prior group attendance on both sides. */
export function friendsPartnerEligible(w: World, first: MemberId, second: MemberId, category: Category = "hobby"): boolean {
  const check = { category, role: "peer", format: "one_to_one", timeSensitive: false } as const;
  return memberReason(w, first, check) === null && memberReason(w, second, check) === null
    && pairReason(w, first, second, category) === null;
}

/** The mean pair value of a circle over 1 (a plan's score). */
const circleScore = (circle: Circle) => Math.round((1e4 * circle.evidence.pairValueTotal) / (circle.evidence.pairCount * pairValueScale)) / 1e4;

/**
 * The World of the members this week can plan for, so a search keeps only partners who can be asked:
 * `w` itself when everyone can be planned. Blocks, feedback and history stay whole, so the pair gate
 * is unchanged.
 */
function seatWorld(w: World, seat: (id: MemberId) => boolean): World {
  if (w.ids.every(seat)) return w;
  const keep = (x: { memberId: MemberId }) => seat(x.memberId);
  const { input } = w;
  return new World({
    ...input, members: input.members.filter(m => seat(m.id)), facets: input.facets.filter(keep), intents: input.intents.filter(keep), presence: input.presence.filter(keep),
  }, w.cfg, w.embed, w.pack);
}

/** The one weekly planner of friends.help (production and simulator). */
export function planFriendsWeek(w: World, inp: FriendsWeekInput, pol: FriendsPolicy = DEFAULT_FRIENDS_POLICY, pcfg: PlansConfig = FRIENDS_PLANS, att: AttentionConfig = DEFAULT_ATTENTION): FriendsWeek {
  const info = friendsInfo(w);
  const { now, tz } = inp;
  const homeOf = (id: MemberId): Neighborhood | undefined => info.get(id)?.home;
  const tolOf = (id: MemberId) => info.get(id)?.tolerance ?? 40;
  const eligible = (id: MemberId) => !!w.get(id) && !isMinor(w, id) && !planMemberReason(w, id);
  const venueById = new Map(inp.venues.map(v => [v.id, v]));
  let week = initialWeek;
  const reserve = (event: WeekEvent) => {
    const next = stepWeek(week, event);
    if (next === week) return false;
    week = next;
    return true;
  };
  const out: FriendsWeek = { sessions: [], offers: [], repeats: [], plans: [], partners: [] };
  const slotsAll = candidateSlots(tz, now, { window: { start: now + pcfg.minLeadHours * HOUR, end: now + pcfg.horizonDays * DAY } }, att);
  const dayKey = (t: number) => { const lp = localParts(t, tz); return `${lp.month}-${lp.day}`; };
  const freeBySlot = new Map<TimeSlot, Map<MemberId, number>>();
  /** hasWindow for a member with evidence at one of `slotsAll`, read once a run per member and slot. */
  const freeAt = (id: MemberId, slot: TimeSlot): number => {
    let row = freeBySlot.get(slot);
    if (!row) { row = new Map(); freeBySlot.set(slot, row); }
    let free = row.get(id);
    if (free === undefined) { free = hasWindow(inp.evidence.get(id)!, slot, now, pcfg, att); row.set(id, free); }
    return free;
  };

  // spec/planFormation.md, "Alternates must fit the entire offered group"
  const compatibleAlternates = (invited: readonly MemberId[], ranked: readonly MemberId[], limit: number): MemberId[] => {
    const table = invited.map(id => w.match.profileIn(id, "Friend"));
    const kept: MemberId[] = [];
    for (const id of ranked) {
      if (kept.length >= limit) break;
      const profile = w.match.profileIn(id, "Friend");
      if (!profile || !isPlanAlternate(!isMinor(w, id), table.every(peer => !!peer && w.match.value(profile, peer) >= 0))) continue;
      kept.push(id);
      table.push(profile);
    }
    return kept;
  };

  /** Estimated one-way minutes from a member's home to a place (45 when the place is unknown; 99 without a home). */
  const tripMinutes = (id: MemberId, at: Neighborhood | undefined): number => {
    const home = homeOf(id);
    return home ? (at ? transitMinutes(home, at) : 45) : 99;
  };
  /** The travel rule: an invitee's trip fits the stated tolerance (x slack). */
  const tripFits = (id: MemberId, at: Neighborhood | undefined) => tripMinutes(id, at) <= tolOf(id) * pol.toleranceSlack;
  /** Some venue in the city offers the activity and is open for it at this time. */
  const venueOpenFor = (a: ActivityType, slot: TimeSlot) =>
    inp.venues.some(v => v.city === FRIENDS_CITY && v.activities.includes(a.id) && venueOpen(v, slot, a.durationMin, tz, att));

  const finish = (p: Plan, source: FriendsPlanSource): FriendsPlan | null => {
    const a = activityById.get(p.activityId);
    if (!a) return null;
    let venue = p.venueId ? venueById.get(p.venueId) : undefined;
    const everyone = [...p.invited, ...p.alternates];
    const homes = new Map(everyone.map(id => [id, homeOf(id)] as const).filter((x): x is [MemberId, Neighborhood] => !!x[1]));
    if (source === "new" || source === "partner") {
      const inv = new Map(p.invited.filter(id => homes.has(id)).map(id => [id, homes.get(id)!]));
      const best = chooseVenue(inp.venues, inv, v => v.city === p.city && v.activities.includes(a.id) && v.ageMin <= Math.min(...p.invited.map(id => w.get(id)!.m.age)) && venueOpen(v, p.window, a.durationMin, tz, att));
      // A new plan without an open venue is not offered, so it holds no seats.
      if (!best) return null;
      venue = best.venue;
    }
    // A recurring plan's previous venue must still be open for this session.
    if (venue && !venueOpen(venue, p.window, a.durationMin, tz, att)) return null;
    const at = hood(venue?.area ?? p.place.area);
    const minutes: Record<MemberId, number> = {};
    for (const id of homes.keys()) minutes[id] = tripMinutes(id, at);
    const fits = (id: MemberId) => tripFits(id, at);
    const invited = p.invited.filter(fits);
    const alternates = p.alternates.filter(fits);
    // Moving an already compatible alternate into a seat preserves every pair at the table.
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
    const cands = slotsAll.filter(s => (a.dayparts as string[]).includes(daypartOf(s.start, tz, att)) && (!venue || venueOpen(venue, s, a.durationMin, tz, att)));
    const scored = cands.map(s => ({ s, e: p.invited.reduce((sum, id) => sum + (inp.evidence.get(id) ? planFreeProb(inp.evidence.get(id)!, s, now, pcfg, att).p : 0.3), 0) }))
      .filter(x => dayKey(x.s.start) !== dayKey(p.window.start)).sort((x, y) => (y.e - x.e) || (x.s.start - y.s.start));
    const opts: TimeSlot[] = [p.window];
    for (const x of scored) {
      if (opts.length >= 3) break;
      if (x.e < 1.5 || opts.some(o => dayKey(o.start) === dayKey(x.s.start))) continue;
      opts.push({ start: x.s.start, end: x.s.start + a.durationMin * 60_000 });
    }
    return opts.sort((x, y) => x.start - y.start);
  };

  const pairValues = new Map<string, number>();
  /** The Friend pair value of two members through the one pair gate (noPairValue when there is none). */
  const valueOf = (x: MemberId, y: MemberId): number => {
    const key = compareText(x, y) < 0 ? `${x}|${y}` : `${y}|${x}`;
    let value = pairValues.get(key);
    if (value === undefined) {
      const px = w.match.profileIn(x, "Friend"), py = w.match.profileIn(y, "Friend");
      value = px && py ? w.match.value(px, py) : noPairValue;
      pairValues.set(key, value);
    }
    return value;
  };

  // 1. crew sessions
  if (pol.crews) for (const crew of inp.crews) {
    if (crew.handedOff) continue;
    const v = crew.venueId ? venueById.get(crew.venueId) : undefined;
    // The pair values are read for the members the session can seat: eligible, and within travel tolerance.
    const members = crew.members.filter(id => eligible(id) && tripFits(id, hood(v?.area)));
    if (members.length < 2) continue;
    const p = crewSessionPlan(w, { ...crew, members }, now, v ? { name: v.name, area: v.area } : { name: "the usual spot" }, pcfg);
    if (!p) continue;
    const fp = finish({ ...p, quorum: Math.min(3, members.length) }, "crew_session");
    if (!fp || !reserve({ type: "reserveRecurring", kind: "Session", members: fp.invited })) continue;
    out.sessions.push({ ...fp, hostId: retainedCrewHost(crew, fp.invited) });
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
  week = stepWeek(week, { type: "beginCrewOffers" });
  if (pol.crews) {
    const proposed = detectCrews(recent, [...inp.crews, ...inp.offered], id => w.get(id)?.isHost ?? false, pcfg);
    for (const crew of proposed) {
      const v = crew.venueId ? venueById.get(crew.venueId) : undefined;
      const members = crew.members.filter(id => eligible(id) && recurringAvailable(week, id) && tripFits(id, hood(v?.area)));
      if (members.length < pcfg.crews.minMembers) continue;
      const c2: Crew = { ...crew, members, hostRotation: crew.hostRotation.filter(m => members.includes(m)).length ? crew.hostRotation.filter(m => members.includes(m)) : members };
      const p = crewSessionPlan(w, c2, now, v ? { name: v.name, area: v.area } : { name: "the usual spot" }, pcfg);
      if (!p) continue;
      const fp = finish({ ...p, quorum: Math.min(3, members.length) }, "crew_offer");
      if (!fp || !reserve({ type: "reserveRecurring", kind: "Offer", members: fp.invited })) continue;
      out.offers.push({ crew: c2, first: { ...fp, hostId: retainedCrewHost(c2, fp.invited) } });
    }
  }
  week = stepWeek(week, { type: "beginRepeats" });
  if (pol.repeat) {
    for (const o of [...recent].sort((x, y) => (y.at - x.at) || (x.planId < y.planId ? -1 : 1))) {
      const pos = o.positive.filter(id => eligible(id) && recurringAvailable(week, id));
      // Members offered a crew this week are taken; everyone else positive gets the same table again
      // (pairs, groups without crews, and groups whose crew offer did not form).
      // The same table again for the largest set of them (in order) in which every pair has a pair value.
      const ids = pos.slice(0, 6).sort().reduce<MemberId[]>((kept, id) => (kept.every(k => valueOf(k, id) >= 0) ? [...kept, id] : kept), []);
      if (ids.length < 2) continue;
      const circle = familiarCircle(w, ids);
      if (!circle) continue;
      const a = activityById.get(o.activityId);
      if (!a) continue;
      const start = nextSameSlot(o.at, now, pcfg, tz);
      if (start > now + pcfg.horizonDays * DAY + DAY) continue;
      const v = o.venueId ? venueById.get(o.venueId) : undefined;
      const partner = ids.length === 2;
      const alternates = compatibleAlternates(ids, o.attended.filter(id => !ids.includes(id) && eligible(id) && recurringAvailable(week, id)), partner ? 0 : 2);
      const base: Plan = {
        id: `plan_${sha256(`repeat|${o.planId}|${start}|${ids.join(",")}`).slice(0, 16)}`, city: FRIENDS_CITY, activityId: a.id, ...(v ? { venueId: v.id } : {}),
        place: v ? { name: v.name, area: v.area } : { name: "the same spot" }, window: { start, end: start + a.durationMin * 60_000 },
        invited: ids, alternates, partner,
        size: partner ? { min: 2, target: 2, max: 2 } : { min: 3, target: ids.length, max: 6 }, quorum: partner ? 2 : Math.min(3, ids.length),
        probeDeadline: start - pcfg.deadlineBeforeStartHours * HOUR, score: circleScore(circle), u: {}, familiar: {}, createdAt: now, category: "social",
      };
      const fp = finish(base, "repeat");
      if (!fp || !reserve({ type: "reserveRecurring", kind: "Repeat", members: [...fp.invited, ...fp.alternates] })) continue;
      out.repeats.push(fp);
    }
  }

  // 4. new plans: open tables of neighbours, every pair with a pair value (spec/friendsWeek.md,
  // "New plans reserve each invitee once": an open table holds its alternates too).
  week = stepWeek(week, { type: "beginNewPlans", spreadNew: pol.spreadNew });
  const fitCache = new Map<MemberId, Map<string, number>>();
  /** Activity fit; in a universal pass dinner and coffee fit anyone who wants to meet people. */
  const fitOf = (id: MemberId, a: ActivityType, universal: boolean): number => {
    let f = fitCache.get(id);
    if (!f) { f = activityFit(w, id, pcfg); fitCache.set(id, f); }
    const fit = f.get(a.id) ?? 0;
    return universal && FRIENDS_UNIVERSAL.includes(a.id) ? Math.max(fit, pol.universalFit) : fit;
  };
  const seatable = (id: MemberId) => inp.evidence.has(id) && now - (inp.lastPlannedAt?.get(id) ?? -Infinity) >= pcfg.memberCooldownDays * DAY;
  const open = (id: MemberId) => newPlanAvailable(week, id) && seatable(id) && eligible(id) && !!w.match.profileIn(id, "Friend");
  const placeable = (w.pack.plans?.activities ?? []).filter(a => inp.venues.some(v => v.city === FRIENDS_CITY && v.activities.includes(a.id)));

  // spec/groupFormation.md, "A primary circle values every pair and keeps a narrow standing spread"
  const friendLimits = laneLimits("Friend");
  /** Invitees and alternates of one open table: the first yes-sayers among them fill the seats. */
  const tableInvite = pcfg.size.max + pcfg.alternates;
  /**
   * One open table from a pool in priority order: start with `seed`, then add, in this order of
   * preference, a member whom someone at the table would see again (repeat bias first), the member
   * who keeps the lowest pair value at the table highest, the higher total, then priority. Every pair
   * at the table, alternates too, reaches the Friend circle pair floor, so any yes-sayers who fill
   * the seats form a circle.
   */
  const growTable = (order: readonly MemberId[], seed: MemberId): { members: MemberId[]; total: number; pairs: number } => {
    const members = [seed];
    const lowest = new Map<MemberId, number>(), total = new Map<MemberId, number>(), warm = new Map<MemberId, boolean>();
    const before = (x: MemberId, y: MemberId) => {
      if (warm.get(x) !== warm.get(y)) return warm.get(x)!;
      if (lowest.get(x) !== lowest.get(y)) return lowest.get(x)! > lowest.get(y)!;
      return total.get(x)! > total.get(y)!;
    };
    let counted = 0;
    while (members.length < tableInvite) {
      for (; counted < members.length; counted++) {
        const m = members[counted]!;
        for (const id of order) {
          if (members.includes(id) || (lowest.get(id) ?? pairValueScale) < friendLimits.circlePairFloor) continue;
          const value = valueOf(id, m);
          lowest.set(id, Math.min(lowest.get(id) ?? pairValueScale, value));
          total.set(id, (total.get(id) ?? 0) + value);
          warm.set(id, (warm.get(id) ?? false) || (pol.repeat && w.isWarm(id, m)));
        }
      }
      let best: MemberId | undefined;
      for (const id of order) {
        if (members.includes(id) || (lowest.get(id) ?? -1) < friendLimits.circlePairFloor) continue;
        if (best === undefined || before(id, best)) best = id;
      }
      if (best === undefined) break;
      members.push(best);
    }
    let tableTotal = 0, pairs = 0;
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) { tableTotal += valueOf(members[i]!, members[j]!); pairs++; }
    return { members, total: tableTotal, pairs };
  };
  /** The circle admission of the seated invitees (pairs without a value are not counted, so they fail it). */
  const seatedCircle = (invited: readonly MemberId[]): boolean => {
    const seated = invited.flatMap(id => { const p = w.match.profileIn(id, "Friend"); return p ? [p] : []; });
    if (seated.length !== invited.length) return false;
    const evidence = circleEvidence(seated, (x, y) => { const value = valueOf(x.memberId, y.memberId); return value >= 0 ? value : undefined; });
    return circleCoherent(evidence, friendLimits.circleMinimum, friendLimits.circleMaximum, friendLimits.circlePairFloor, friendLimits.rules.parityBand);
  };

  /** New tables among the members of one area, the activities most of them fit first. */
  const tables = (area: readonly MemberId[], universal: boolean, fitFloor: number, minInvite = FRIENDS_TABLE_MIN_INVITE) => {
    const pool = area.filter(open);
    if (pool.length < minInvite) return;
    const acts = placeable.map(a => ({ a, n: pool.filter(id => fitOf(id, a, universal) >= fitFloor).length }))
      .filter(x => x.n >= minInvite).sort((x, y) => (y.n - x.n) || compareText(x.a.id, y.a.id));
    for (const { a } of acts) {
      const cand = pool.filter(id => newPlanAvailable(week, id) && fitOf(id, a, universal) >= fitFloor && (w.get(id)?.m.age ?? 0) >= a.ageMin);
      if (cand.length < minInvite) continue;
      // Only times at which some venue offers the activity and is open.
      const slots = slotsAll.filter(sl => (a.dayparts as string[]).includes(daypartOf(sl.start, tz, att)) && venueOpenFor(a, sl));
      const pf = new Map(cand.map(id => [id, slots.map(sl => freeAt(id, sl))] as const));
      // Up to `tableOptions` options on distinct days where the MOST candidates are free (yes-sayers
      // must agree on one option for quorum, so overlap beats coverage).
      const ranked = slots.map((_, i) => ({ i, n: cand.filter(id => pf.get(id)![i]! > 0).length })).sort((x, y) => (y.n - x.n) || (slots[x.i]!.start - slots[y.i]!.start));
      const chosen: number[] = [];
      for (const r of ranked) {
        if (chosen.length >= pol.tableOptions || r.n < Math.max(pcfg.size.min, (ranked[0]?.n ?? 0) * 0.5)) break;
        if (chosen.some(c => dayKey(slots[c]!.start) === dayKey(slots[r.i]!.start))) continue;
        chosen.push(r.i);
      }
      const timeFit = (id: MemberId) => Math.max(0, ...chosen.map(i => pf.get(id)![i]!));
      const free = cand.filter(id => timeFit(id) > 0);
      if (free.length < minInvite) continue;
      const priority = (id: MemberId) => fitOf(id, a, universal) * timeFit(id);
      const order = [...free].sort((x, y) => (priority(y) - priority(x)) || compareText(x, y)).slice(0, FRIENDS_TABLE_POOL);
      const prioritySeed = order[0]!;
      const neighbours = order.slice(1);
      // A block applies to the pair, so a seed blocked from everyone cannot prevent a table for the others.
      const seeds = neighbours.every(id => w.blocked.has(pairKey(prioritySeed, id))) ? neighbours : [prioritySeed];
      for (const seed of seeds) {
        const table = growTable(order, seed);
        if (table.members.length < minInvite) continue;
        const first = chosen.map(i => ({ i, n: table.members.filter(id => pf.get(id)![i]! > 0).length })).sort((x, y) => (y.n - x.n) || (x.i - y.i))[0]!;
        const start = slots[first.i]!.start;
        const invited = table.members.slice(0, pcfg.size.max), alternates = table.members.slice(pcfg.size.max);
        const plan: Plan = {
          id: `plan_${sha256(`table|${a.id}|${start}|${[...invited].sort().join(",")}|${now}`).slice(0, 16)}`, city: FRIENDS_CITY, activityId: a.id,
          place: { name: a.label }, window: { start, end: start + a.durationMin * 60_000 }, invited, alternates, partner: false,
          size: { min: pcfg.size.min, target: invited.length, max: pcfg.size.max }, quorum: pcfg.quorum.group,
          probeDeadline: Math.min(start - pcfg.deadlineBeforeStartHours * HOUR, now + pcfg.probeWindowHours * HOUR),
          score: Math.round((1e4 * table.total) / (table.pairs * pairValueScale)) / 1e4, u: {}, familiar: {}, createdAt: now, category: "social",
        };
        // Venue: minimize the longest trip, then keep the options it is open for.
        const fp = finish(plan, "new");
        if (!fp || !seatedCircle(fp.invited)) continue;
        const venue = venueById.get(fp.venueId!)!;
        fp.options = chosen.map(i => slots[i]!).sort((x, y) => x.start - y.start)
          .filter(o => venueOpen(venue, o, a.durationMin, tz, att)).map(o => ({ start: o.start, end: o.start + a.durationMin * 60_000 }));
        if (!reserve({ type: "reserveNewPlan", invited: fp.invited, alternates: fp.alternates, reserveAlternates: pol.openTable })) continue;
        out.plans.push(fp);
        break;
      }
    }
  };

  // Neighbours first (each zone within 25, then 35 minutes of its hub), then the borough; dinner and
  // coffee open to anyone first, then stated activities, then activities in a family the member likes.
  const ids = [...inp.evidence.keys()].sort(compareText);
  const near = (zone: string, radius: number) => {
    const hub = ZONE_HUB.get(zone)!;
    return ids.filter(id => { const h = homeOf(id); return !!h && (h.zone === zone || transitMinutes(h, hub) <= radius); });
  };
  const inBorough = (borough: string) => ids.filter(id => homeOf(id)?.borough === borough);
  const universalFloor = Math.min(pcfg.minFit, pol.universalFit);
  if (pol.universal) for (const radius of ZONE_RADII) for (const z of ZONES) tables(near(z, radius), true, universalFloor);
  for (const radius of ZONE_RADII) for (const z of ZONES) tables(near(z, radius), false, pcfg.minFit);
  for (const b of BOROUGHS) tables(inBorough(b), false, pcfg.minFit);
  for (const z of ZONES) tables(near(z, ZONE_RADII[ZONE_RADII.length - 1]), pol.universal, pcfg.familyFit);
  for (const b of BOROUGHS) tables(inBorough(b), pol.universal, pcfg.familyFit);
  // Last, members no larger table reached: a table of as few as size.min invitees is better than none.
  for (const z of ZONES) tables(near(z, ZONE_RADII[ZONE_RADII.length - 1]), pol.universal, pcfg.familyFit, pcfg.size.min);

  // 5. activity partners (one-to-one, intro cap): each plannable member's searched partners, the
  // best pair value first; groups first.
  week = stepWeek(week, { type: "beginPartners" });
  if (pol.partnerIntros > 0) {
    const reach = seatWorld(w, id => inp.evidence.has(id));
    const pairs = new Map<string, { a: MemberId; b: MemberId; value: number }>();
    for (const profile of reach.match.profiles) {
      if (profile.lane !== "Friend") continue;
      for (const { profile: other, value } of reach.match.candidates(profile).kept) {
        const [a, b] = compareText(profile.memberId, other.memberId) < 0 ? [profile.memberId, other.memberId] : [other.memberId, profile.memberId];
        pairs.set(`${a}|${b}`, { a, b, value });
      }
    }
    for (const [key, { a, b, value }] of [...pairs].sort(([kx, x], [ky, y]) => (y.value - x.value) || compareText(kx, ky))) {
      const pair = { first: a, second: b };
      if (!canReservePartner(week, pair, pol.partnerIntros)) continue;
      if (!friendsPartnerEligible(w, a, b)) continue;
      const act = pairActivity(w, a, b, pcfg);
      if (!act) continue;
      const slots = slotsAll.filter(sl => (act.dayparts as string[]).includes(daypartOf(sl.start, tz, att)) && venueOpenFor(act, sl))
        .map(sl => ({ sl, p: Math.min(freeAt(a, sl), freeAt(b, sl)) }))
        .filter(x => x.p > 0).sort((x, y) => (y.p - x.p) || (x.sl.start - y.sl.start));
      if (!slots.length) continue;
      const start = slots[0]!.sl.start;
      const plan: Plan = {
        id: `plan_${sha256(`partner|${key}|${start}`).slice(0, 16)}`, city: FRIENDS_CITY, activityId: act.id, place: { name: act.label }, window: { start, end: start + act.durationMin * 60_000 },
        invited: [a, b], alternates: [], partner: true, size: { min: 2, target: 2, max: 2 }, quorum: 2, probeDeadline: start - pcfg.deadlineBeforeStartHours * HOUR,
        score: Math.round((1e4 * value) / pairValueScale) / 1e4, u: {}, familiar: {}, createdAt: now, category: "hobby",
      };
      const fp = finish(plan, "partner");
      if (!fp) continue;
      const venue = venueById.get(fp.venueId!)!;
      const days = new Set<string>();
      fp.options = slots.filter(x => venueOpen(venue, x.sl, act.durationMin, tz, att))
        .filter(x => { const d = dayKey(x.sl.start); if (days.has(d)) return false; days.add(d); return true; }).slice(0, 3).map(x => ({ start: x.sl.start, end: x.sl.start + act.durationMin * 60_000 })).sort((x, y) => x.start - y.start);
      if (!reserve({ type: "reservePartner", pair, limit: pol.partnerIntros })) continue;
      out.partners.push(fp);
    }
  }
  // Alternates are never invited elsewhere this run.
  week = stepWeek(week, { type: "finishWeek" });
  for (const p of out.plans) p.alternates = p.alternates.filter(id => newPlanAlternateCanRemain(week, id));
  return out;
}
