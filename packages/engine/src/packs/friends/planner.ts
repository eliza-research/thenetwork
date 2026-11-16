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
//   4. new plans: one table per circle of people who fit, formed only among the members the week can
//      seat (seatWorld; every pair has a real pair value, strongest circles first), at the activity
//      the circle fits best;
//   5. activity partners: the lane's best pairs (w.match.edges("Friend")), one-to-one rules (groups first).
//   Venue: the public venue offering the activity that minimizes the group's LONGEST estimated trip;
//   invitees whose trip would exceed their stated tolerance (x slack) are dropped.
//   Time options: the plan's time plus up to two more (distinct days) where the most invitees are
//   likely free; the probe carries them and the group books the option most yes-sayers picked.
//
// Engine-visible inputs only (the World, availability evidence, the Network's own outcome records).
import type { MemberId } from "@thenetwork/core";
import { CITY_TZ, DAY, HOUR, MINUTE, fromLocal, localParts } from "@thenetwork/core";
import {
  canReservePartner, type Event as WeekEvent, initial as initialWeek, newPlanAlternateCanRemain, newPlanAvailable,
  recurringAvailable, step as stepWeek,
} from "../../../../core/src/generated/friendsWeek.ts";
import { pairValueScale } from "../../../../core/src/generated/pairValue.ts";
import { isPlanAlternate } from "../../../../core/src/generated/planFormation.ts";
import { candidateSlots, type TimeSlot } from "../../attention.ts";
import { DEFAULT_ATTENTION, DEFAULT_PLANS, type AttentionConfig, type PlansConfig } from "../../config.ts";
import { isMinor, memberReason, pairReason } from "../../filters.ts";
import { sha256 } from "../../hash.ts";
import type { Circle } from "../../match/circles.ts";
import { activityFit, crewSessionPlan, daypartOf, detectCrews, hasWindow, planFreeProb, planMemberReason, type Crew, type Plan, type PlanEvidence, type PlanOutcomeRecord } from "../../plans.ts";
import { World } from "../../world.ts";
import { activityById, type ActivityType, type Venue } from "../network/activities.ts";
import { familiarCircle } from "./generators.ts";
import { chooseVenue, FRIENDS_CITY, hood, transitMinutes, type Neighborhood } from "./geo.ts";
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

const ONE_TO_ONE = { category: "hobby", role: "peer", format: "one_to_one", timeSensitive: false } as const;

/** The mean pair value of a circle over 1 (a plan's score). */
const circleScore = (circle: Circle) => Math.round((1e4 * circle.evidence.pairValueTotal) / (circle.evidence.pairCount * pairValueScale)) / 1e4;

/**
 * The World of the members a new plan can seat, so circles form only among them (each member is in
 * at most one circle a run): `w` itself when everyone can be seated. Blocks, feedback and history
 * stay whole, so the pair gate is unchanged.
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

  const finish = (p: Plan, source: FriendsPlanSource): FriendsPlan | null => {
    const a = activityById.get(p.activityId);
    if (!a) return null;
    let venue = p.venueId ? venueById.get(p.venueId) : undefined;
    const everyone = [...p.invited, ...p.alternates];
    const homes = new Map(everyone.map(id => [id, homeOf(id)] as const).filter((x): x is [MemberId, Neighborhood] => !!x[1]));
    if (source === "new" || source === "partner") {
      const inv = new Map(p.invited.filter(id => homes.has(id)).map(id => [id, homes.get(id)!]));
      const best = chooseVenue(inp.venues, inv, v => v.city === p.city && v.activities.includes(a.id) && v.ageMin <= Math.min(...p.invited.map(id => w.get(id)!.m.age)) && venueOpen(v, p.window, a.durationMin, tz, att));
      if (best) venue = best.venue;
    }
    // A recurring plan's previous venue must still be open for this session.
    if (venue && !venueOpen(venue, p.window, a.durationMin, tz, att)) return null;
    const at = hood(venue?.area ?? p.place.area);
    const minutes: Record<MemberId, number> = {};
    for (const [id, h] of homes) minutes[id] = at ? transitMinutes(h, at) : 45;
    const fits = (id: MemberId) => (minutes[id] ?? 99) <= tolOf(id) * pol.toleranceSlack;
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

  // 1. crew sessions
  if (pol.crews) for (const crew of inp.crews) {
    if (crew.handedOff) continue;
    const members = crew.members.filter(eligible);
    if (members.length < 2) continue;
    const v = crew.venueId ? venueById.get(crew.venueId) : undefined;
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
      const members = crew.members.filter(id => eligible(id) && recurringAvailable(week, id));
      if (members.length < pcfg.crews.minMembers) continue;
      const v = crew.venueId ? venueById.get(crew.venueId) : undefined;
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
      if (pos.length < 2) continue;
      const ids = pos.slice(0, 6).sort();
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

  // 4. new plans: one table per circle (spec/groupFormation.md circles), strongest first.
  week = stepWeek(week, { type: "beginNewPlans", spreadNew: pol.spreadNew });
  const fitFloor = pol.universal ? Math.min(pcfg.minFit, pol.universalFit) : pcfg.minFit;
  const fitCache = new Map<MemberId, Map<string, number>>();
  const fitOf = (id: MemberId, a: ActivityType): number => {
    let f = fitCache.get(id);
    if (!f) { f = activityFit(w, id, pcfg); fitCache.set(id, f); }
    const fit = f.get(a.id) ?? 0;
    return pol.universal && FRIENDS_UNIVERSAL.includes(a.id) ? Math.max(fit, pol.universalFit) : fit;
  };
  const fitsActivity = (id: MemberId, a: ActivityType) => fitOf(id, a) >= fitFloor && (w.get(id)?.m.age ?? 0) >= a.ageMin;
  const seatable = (id: MemberId) => inp.evidence.has(id) && now - (inp.lastPlannedAt?.get(id) ?? -Infinity) >= pcfg.memberCooldownDays * DAY;
  const seats = seatWorld(w, seatable);
  const open = (id: MemberId) => newPlanAvailable(week, id) && seatable(id) && eligible(id);
  const placeable = (w.pack.plans?.activities ?? []).filter(a => inp.venues.some(v => v.city === FRIENDS_CITY && v.activities.includes(a.id)));

  /** The activity the circle fits best: the highest total fit among members who fit it, then the most members, then id. */
  const circleActivity = (members: readonly MemberId[]) => {
    let best: { a: ActivityType; invited: MemberId[]; total: number } | undefined;
    for (const a of placeable) {
      const invited = members.filter(id => fitsActivity(id, a));
      if (invited.length < pcfg.size.min) continue;
      const total = invited.reduce((sum, id) => sum + fitOf(id, a), 0);
      if (!best || total > best.total || (total === best.total && (invited.length > best.invited.length || (invited.length === best.invited.length && a.id < best.a.id)))) best = { a, invited, total };
    }
    return best;
  };

  /** Members the circle's own searches kept, who fit the activity and pair with every invitee (blocks win): most links, then value, then id. */
  const circleAlternates = (circle: Circle, invited: readonly MemberId[], a: ActivityType): MemberId[] => {
    const inCircle = new Set(circle.members);
    const links = new Map<MemberId, { count: number; total: number }>();
    for (const id of invited) {
      const profile = seats.match.profileIn(id, "Friend");
      if (!profile) continue;
      for (const { profile: other, value } of seats.match.candidates(profile).kept) {
        if (inCircle.has(other.id)) continue;
        const link = links.get(other.memberId) ?? { count: 0, total: 0 };
        links.set(other.memberId, { count: link.count + 1, total: link.total + value });
      }
    }
    const ranked = [...links].filter(([id]) => open(id) && fitsActivity(id, a))
      .sort(([x, lx], [y, ly]) => (ly.count - lx.count) || (ly.total - lx.total) || (x < y ? -1 : 1))
      .map(([id]) => id);
    return compatibleAlternates(invited, ranked, pcfg.alternates);
  };

  const circleTable = (circle: Circle): FriendsPlan | null => {
    const members = circle.members.flatMap(id => { const p = seats.match.profile(id); return p && open(p.memberId) ? [p.memberId] : []; });
    const choice = circleActivity(members);
    if (!choice) return null;
    const { a } = choice;
    const slots = slotsAll.filter(sl => (a.dayparts as string[]).includes(daypartOf(sl.start, tz, att)));
    const pf = new Map(choice.invited.map(id => [id, slots.map(sl => hasWindow(inp.evidence.get(id)!, sl, now, pcfg, att))] as const));
    // Up to `tableOptions` options on distinct days where the MOST invitees are free (yes-sayers must
    // agree on one option for quorum, so overlap beats coverage).
    const ranked = slots.map((_, i) => ({ i, n: choice.invited.filter(id => pf.get(id)![i]! > 0).length })).sort((x, y) => (y.n - x.n) || (slots[x.i]!.start - slots[y.i]!.start));
    const chosen: number[] = [];
    for (const r of ranked) {
      if (chosen.length >= pol.tableOptions || r.n < Math.max(pcfg.size.min, (ranked[0]?.n ?? 0) * 0.5)) break;
      if (chosen.some(c => dayKey(slots[c]!.start) === dayKey(slots[r.i]!.start))) continue;
      chosen.push(r.i);
    }
    const invited = choice.invited.filter(id => chosen.some(i => pf.get(id)![i]! > 0));
    if (invited.length < pcfg.size.min) return null;
    const first = chosen.map(i => ({ i, n: invited.filter(id => pf.get(id)![i]! > 0).length })).sort((x, y) => (y.n - x.n) || (x.i - y.i))[0]!;
    const start = slots[first.i]!.start;
    const plan: Plan = {
      id: `plan_${sha256(`circle|${a.id}|${start}|${[...invited].sort().join(",")}|${now}`).slice(0, 16)}`, city: FRIENDS_CITY, activityId: a.id,
      place: { name: a.label }, window: { start, end: start + a.durationMin * 60_000 }, invited, alternates: circleAlternates(circle, invited, a), partner: false,
      size: { min: pcfg.size.min, target: invited.length, max: pcfg.size.max }, quorum: pcfg.quorum.group,
      probeDeadline: Math.min(start - pcfg.deadlineBeforeStartHours * HOUR, now + pcfg.probeWindowHours * HOUR),
      score: circleScore(circle), u: {}, familiar: {}, createdAt: now, category: "social",
    };
    // Venue: minimize the longest trip (finish() picks it for new plans), then the options it is open for.
    const fp = finish(plan, "new");
    if (!fp) return null;
    const venue = fp.venueId ? venueById.get(fp.venueId) : undefined;
    fp.options = chosen.map(i => slots[i]!).sort((x, y) => x.start - y.start)
      .filter(o => !venue || venueOpen(venue, o, a.durationMin, tz, att)).map(o => ({ start: o.start, end: o.start + a.durationMin * 60_000 }));
    return fp;
  };

  // spec/friendsWeek.md, "New plans reserve each invitee once": an open table holds its alternates too.
  for (const circle of seats.match.circles("Friend")) {
    const fp = circleTable(circle);
    if (!fp || !reserve({ type: "reserveNewPlan", invited: fp.invited, alternates: fp.alternates, reserveAlternates: pol.openTable })) continue;
    out.plans.push(fp);
  }

  // 5. activity partners (one-to-one, intro cap): the lane's pairs, best value first; groups first.
  week = stepWeek(week, { type: "beginPartners" });
  if (pol.partnerIntros > 0) for (const edge of w.match.edges("Friend")) {
    const a = w.match.profile(edge.a)?.memberId, b = w.match.profile(edge.b)?.memberId;
    if (!a || !b || !inp.evidence.has(a) || !inp.evidence.has(b)) continue;
    const pair = { first: a, second: b };
    if (!canReservePartner(week, pair, pol.partnerIntros)) continue;
    if (memberReason(w, a, ONE_TO_ONE) !== null || memberReason(w, b, ONE_TO_ONE) !== null || pairReason(w, a, b, ONE_TO_ONE.category) !== null) continue;
    const act = pairActivity(w, a, b, pcfg);
    if (!act) continue;
    const slots = slotsAll.filter(sl => (act.dayparts as string[]).includes(daypartOf(sl.start, tz, att)))
      .map(sl => ({ sl, p: Math.min(hasWindow(inp.evidence.get(a)!, sl, now, pcfg, att), hasWindow(inp.evidence.get(b)!, sl, now, pcfg, att)) }))
      .filter(x => x.p > 0).sort((x, y) => (y.p - x.p) || (x.sl.start - y.sl.start));
    if (!slots.length) continue;
    const start = slots[0]!.sl.start;
    const plan: Plan = {
      id: `plan_${sha256(`partner|${a}|${b}|${start}`).slice(0, 16)}`, city: FRIENDS_CITY, activityId: act.id, place: { name: act.label }, window: { start, end: start + act.durationMin * 60_000 },
      invited: [a, b], alternates: [], partner: true, size: { min: 2, target: 2, max: 2 }, quorum: 2, probeDeadline: start - pcfg.deadlineBeforeStartHours * HOUR,
      score: Math.round((1e4 * edge.value) / pairValueScale) / 1e4, u: {}, familiar: {}, createdAt: now, category: "hobby",
    };
    const fp = finish(plan, "partner");
    if (!fp) continue;
    const venue = fp.venueId ? venueById.get(fp.venueId) : undefined;
    const days = new Set<string>();
    fp.options = slots.filter(x => !venue || venueOpen(venue, x.sl, act.durationMin, tz, att))
      .filter(x => { const d = dayKey(x.sl.start); if (days.has(d)) return false; days.add(d); return true; }).slice(0, 3).map(x => ({ start: x.sl.start, end: x.sl.start + act.durationMin * 60_000 })).sort((x, y) => x.start - y.start);
    if (!reserve({ type: "reservePartner", pair, limit: pol.partnerIntros })) continue;
    out.partners.push(fp);
  }
  // Alternates are never invited elsewhere this run.
  week = stepWeek(week, { type: "finishWeek" });
  for (const p of out.plans) p.alternates = p.alternates.filter(id => newPlanAlternateCanRemain(week, id));
  return out;
}
