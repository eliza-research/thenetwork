// Metrics for a friends.help run (harness side: they read hidden truth). Per-member rates use REAL
// members: true adults who are not adversaries. Definitions are in the results doc.
import { gini } from "@thenetwork/core";
export { gini };
import { canBeMatched, type AgeSide, type MemberId } from "@thenetwork/core";
import { ageOnDay } from "../../../../core/src/generated/memberAge.ts";
import { birthKeysWithinTwoYears, rosterHasMinor, sidesAllowed, teenFriendMaxAge, teenRosterSizeAllowed } from "../../../../core/src/generated/friendIntroAge.ts";
import { teenFriendCategory } from "../../../../core/src/generated/matchLane.ts";
import { friendAdversaryKnownAtProposal, friendCountsProbedProposal, friendCountsProposal } from "../../../../core/src/generated/friendsWeek.ts";
import type { HarmKind } from "./oracle.ts";
import { FRIENDS_START_DAY_KEY, friendsStatedOpen, hoodOf, isReal, openGroupOf } from "./persona.ts";
import { visibleRedFlag, weekTime } from "./snapshot.ts";
import { pk, type FlowRecord, type FriendsRunResult, type RosterAge } from "./world.ts";
import { UNKNOWN_AGE_SIDE } from "../../teen.ts";

export interface FriendsMetrics {
  matcher: string; seed: number; weeks: number; members: number; real: number;
  proposals: number; probes: number; probeYesRate: number; quorumRate: number; capDrops: number;
  meetups: number; meetupsByKind: Record<string, number>; attendance: number; meanGroupSize: number;
  goodRate: number; meanEnjoy: number;
  /** Meetups (held by day D-30) where >= 2 of the attendees met again (any app meetup) within 30 days. */
  repeatRate: number;
  /** Stricter: >= 3 of the attendees (or both of a pair) met again together within 30 days. */
  repeatGroupRate: number;
  /**
   * Repeat rate that also counts a crew handoff as a repeat: a meetup counts when >= 2 of its
   * attendees met again within 30 days OR are members of a crew that moved to its own chat
   * (graduation is a success, not a drop). Tracked, not a gate.
   */
  repeatRateWithHandoff: number;
  /** Meetups held by day D-30: the base of the three repeat rates. 0 when no meetup can have a 30-day follow-up window yet, so the rates above are 0/0, not a measured 0%. */
  repeatBase: number;
  crewsFormed: number; crewSessions: number; crewsHandedOff: number;
  /** Mean over real members of total hours with other members, and of the hours with their top person. */
  hoursPerMember: number; topPairHours: number;
  /** Pairs past Hall's thresholds (50 casual, 90 friend). */
  casualFriendPairs: number; friendPairs: number;
  /**
   * Share of real members with >= 1 friendship forming: a pair who met 3+ times (Network meetups or
   * their own hangouts) and both said they'd see each other again (domain research C1 "friends who
   * met 3+ times").
   */
  friendshipTrackShare: number;
  /** Stricter (Hall pace): >= 12 hours together and, at the last 4 weeks' pace, >= 50 hours by month six. */
  hallPaceShare: number;
  /** Share of real members with >= 1 pair past 50 hours. */
  casualFriendShare: number;
  timeToFirstMeetup: { medianDays: number | null; shareWithMeetup: number };
  v14: number; v14ByBorough: Record<string, { n: number; v14: number }>;
  /** Min over boroughs with >= 10 real members of V14(borough) / V14; and over boroughs with >= 30 (Staten Island has about 9-10 at 400 personas). */
  boroughRatioMin: number; boroughRatioMin30: number;
  /** V14 counting only meetups the Network arranged (excludes handed-off crews meeting on their own). */
  v14Arranged: number;
  travel: { medianGroupMax: number; meanSeat: number; overTolerance: number };
  giniMeetups: number; zeroMeetupShare: number;
  expected: { perProposal: number; perMember: number };
  safety: {
    ageRuleBrokenProposals: number; declaredMinorContacts: number;
    hiddenMinorContacts: number; adversaryContacts: number; knownAdversaryContacts: number;
    adversaryContactsByKind: Partial<Record<string, number>>; adversariesReached: number; medianReachPerAdversary: number;
    harms: Partial<Record<HarmKind, number>>; harmsReported: number;
    opennessViolations: number;
    /** Harm events whose offender showed no visible red flag (cue, unpassed check, hold) when the proposal was made. */
    harmsUndetected: number;
    teen: TeenSafety;
  };
  selfHangouts: number;
  proposedByOpenness: Record<string, { n: number; share: number }>;
  strataQuality: {
    spendMismatchRate: number;
    reliabilitySpreadMean: number;
    dunbarAlignedShare: number;
    crossClassSharedPurposeMeetups: number;
    leastMiseryMean: number;
    extractiveDilutionMeetups: number;
  };
}

export interface TeenBreaches { adult: number; gap: number; lane: number; unready: number; switchOff: number; group: number; place: number }
interface TeenSafety {
  proposals: TeenBreaches; contacts: TeenBreaches;
  introductions: number; minorContacts: number; validMeetups: number; introShare: number;
  teenMeetups: number; teenGroupMeetups: number; groupShare: number;
  hiddenOutsideRule: number; posersReachingMinor: number; hTeen: number;
}

const BREACH_KEYS = ["adult", "gap", "lane", "unready", "switchOff", "group", "place"] as const;
const noBreaches = (): TeenBreaches => ({ adult: 0, gap: 0, lane: 0, unready: 0, switchOff: 0, group: 0, place: 0 });

export function teenBreachesOf(sides: readonly AgeSide[], r: Pick<RosterAge, "minDay" | "maxDay" | "category" | "teenIntros" | "laneOk" | "placeOk">): TeenBreaches {
  const out = noBreaches();
  if (!rosterHasMinor([...sides])) return out;
  const lane = r.category !== undefined && teenFriendCategory("friends", r.category);
  if (sides.some(s => ageOnDay(s.birthKey, r.maxDay) > teenFriendMaxAge)) out.adult = 1;
  if (sides.some((m, i) => !m.adult && sides.some((s, j) => j !== i && !birthKeysWithinTwoYears(m.birthKey, s.birthKey)))) out.gap = 1;
  if (!r.laneOk) out.lane = 1;
  if (sides.some(s => !s.ready)) out.unready = 1;
  if (!r.teenIntros) out.switchOff = 1;
  const pairFails = sides.some((m, i) => sides.some((s, j) => j > i && (!m.adult || !s.adult) && !sidesAllowed(r.teenIntros, lane, r.minDay, r.maxDay, m, s)));
  if (!teenRosterSizeAllowed(true, sides.length) || (sides.length >= 3 && pairFails)) out.group = 1;
  if (!r.placeOk) out.place = 1;
  return out;
}

const addBreaches = (into: TeenBreaches, b: TeenBreaches) => { for (const k of BREACH_KEYS) into[k] += b[k]; };

function contactSides(f: FlowRecord): AgeSide[] {
  const byId = new Map(f.roster.map((id, i) => [id, f.sides[i]!]));
  return f.going.map(id => byId.get(id) ?? UNKNOWN_AGE_SIDE);
}

function teenSafety(res: FriendsRunResult, proposals: readonly FlowRecord[], good: number): TeenSafety {
  const { world, flows, meetups } = res;
  const persona = new Map(world.personas.map(p => [p.id, p]));
  const prop = noBreaches(), cont = noBreaches();
  let introductions = 0, minorContacts = 0, validMeetups = 0, hiddenOutsideRule = 0, teenMeetups = 0, teenGroupMeetups = 0;
  const introduced = new Set<MemberId>(), posers = new Set<MemberId>();
  for (const f of proposals) {
    addBreaches(prop, teenBreachesOf(f.sides, f));
    if (f.ruleOk && f.sides.some(s => !s.adult)) introductions++;
  }
  const meetupByKey = new Map(meetups.map(m => [m.key, m]));
  for (const f of flows) {
    if (f.going.length < 2) continue;
    const sides = contactSides(f);
    addBreaches(cont, teenBreachesOf(sides, f));
    if (sides.some(s => !s.adult)) {
      minorContacts++;
      f.going.forEach((id, i) => { if (!sides[i]!.adult) introduced.add(id); });
      const m = meetupByKey.get(f.key);
      if (m && f.stage === "held") {
        teenMeetups++;
        if (m.attendees.length >= 3) teenGroupMeetups++;
        if (Math.min(...m.attendees.map(id => m.enjoy[id]!)) >= good) validMeetups++;
      }
    }
    const lane = f.category !== undefined && teenFriendCategory("friends", f.category);
    const truth = f.going.map((id, i) => {
      const h = persona.get(id)!.hidden;
      return { id, poser: h.poser === true, side: { adult: canBeMatched(ageOnDay(h.trueBirthKey, f.minDay)), ready: sides[i]!.ready, birthKey: h.trueBirthKey } };
    });
    for (let i = 0; i < truth.length; i++) for (let j = i + 1; j < truth.length; j++) {
      const x = truth[i]!, y = truth[j]!;
      if ((!x.side.adult || !y.side.adult) && !sidesAllowed(f.teenIntros, lane, f.minDay, f.maxDay, x.side, y.side)) hiddenOutsideRule++;
    }
    if (truth.some(t => !t.side.adult)) for (const t of truth) if (t.poser) posers.add(t.id);
  }
  const statedMinors = world.personas.filter(p => !canBeMatched(ageOnDay(p.stated.birthKey, FRIENDS_START_DAY_KEY)));
  return {
    proposals: prop, contacts: cont, introductions, minorContacts, validMeetups,
    introShare: div(statedMinors.filter(p => introduced.has(p.id)).length, statedMinors.length),
    teenMeetups, teenGroupMeetups, groupShare: div(teenGroupMeetups, teenMeetups),
    hiddenOutsideRule, posersReachingMinor: posers.size, hTeen: hiddenOutsideRule + posers.size,
  };
}

import { medianOrNull as median, safeDiv as div } from "../../stats.ts";

/** V14 (experience design 3.3): mean over days t in [14, D] of the share of eligible members with a value event in (t-14, t]. */
export function v14Of(ids: MemberId[], valueDays: Map<MemberId, number[]>, days: number): number {
  if (!ids.length) return NaN;
  let sum = 0, n = 0;
  for (let t = 14; t <= days; t++) {
    let w = 0;
    for (const id of ids) if ((valueDays.get(id) ?? []).some(d => d <= t && d > t - 14)) w++;
    sum += w / ids.length; n++;
  }
  return n ? sum / n : NaN;
}

export function friendsMetrics(res: FriendsRunResult): FriendsMetrics {
  const { world, flows, meetups, contacts, valueDays } = res;
  const O = world.oracle, P = O.P;
  const real = world.personas.filter(isReal);
  const realIds = new Set(real.map(p => p.id));
  const days = world.weeks * 7;
  const held = meetups.filter(m => m.kind !== "crew_self");
  const proposals = flows.filter(f => friendCountsProposal(f.additionalTable === true));
  const probedProposals = flows.filter(f => friendCountsProbedProposal(f.additionalTable === true, f.probed));
  const byKind: Record<string, number> = {};
  for (const m of meetups) byKind[m.kind] = (byKind[m.kind] ?? 0) + 1;
  const booked = flows.reduce((s, f) => s + f.booked.length, 0), attended = flows.reduce((s, f) => s + f.attended.length, 0);
  const realE = held.flatMap(m => m.attendees.filter(id => realIds.has(id)).map(id => m.enjoy[id]!));

  // Repeat: did >= 2 (or >= 3) of this meetup's attendees meet again together within 30 days? Base:
  // meetups the Network arranged by day D-30; "again" includes a handed-off crew meeting on its own
  // (the same group met again; graduation is a success), not pairs' private hangouts.
  const allMeet = meetups.filter(m => m.kind !== "crew_self");
  let rep = 0, repG = 0, repH = 0, base = 0;
  const handed = world.state.crews.filter(c => c.handedOff).map(c => new Set(c.members));
  for (const m of allMeet) {
    if (m.day > days - 30) continue;
    base++;
    const later = meetups.filter(x => x.day > m.day && x.day <= m.day + 30);
    const overlap = later.map(x => x.attendees.filter(id => m.attendees.includes(id)).length);
    if (overlap.some(c => c >= 2)) rep++;
    if (overlap.some(c => c >= 2) || handed.some(cm => m.attendees.filter(id => cm.has(id)).length >= 2)) repH++;
    if (overlap.some(c => c >= Math.min(3, m.attendees.length))) repG++;
  }

  // Hours and friendship tracks.
  const perMember = new Map<MemberId, number>(), top = new Map<MemberId, number>(), track = new Set<MemberId>(), pace = new Set<MemberId>(), casual = new Set<MemberId>();
  let casualPairs = 0, friendPairs = 0;
  const W = world.weeks;
  for (const [k, h] of world.hours) {
    const [a, b] = k.split("|") as [MemberId, MemberId];
    if (!realIds.has(a) || !realIds.has(b)) continue;
    for (const x of [a, b]) { perMember.set(x, (perMember.get(x) ?? 0) + h); top.set(x, Math.max(top.get(x) ?? 0, h)); }
    if (h >= P.hall.casual) { casualPairs++; casual.add(a); casual.add(b); }
    if (h >= P.hall.friend) friendPairs++;
    // On track: >= 12 hours so far and, at the last 4 weeks' pace, >= 50 hours by week 26 (six months).
    const wk = world.hoursByWeek.get(k) ?? [];
    const recent = wk.slice(Math.max(0, W - 4)).reduce((s, x) => s + x, 0) / Math.min(4, W);
    if (h >= P.hall.casual || (h >= 12 && h + recent * Math.max(0, 26 - W) >= P.hall.casual)) { pace.add(a); pace.add(b); }
    if (world.mutual.has(k) && (world.meetupsTogether.get(k) ?? 0) + (world.selfTogether.get(k) ?? 0) >= 3) { track.add(a); track.add(b); }
  }
  // Time to first meetup.
  const firsts = real.map(p => (valueDays.get(p.id) ?? []).length ? Math.min(...valueDays.get(p.id)!) : null).filter((x): x is number => x !== null);

  // V14 overall and by borough (all real members joined on day 0).
  const v14 = v14Of(real.map(p => p.id), valueDays, days);
  const arranged = new Map<MemberId, number[]>();
  for (const m of meetups) if (m.kind !== "crew_self") for (const id of m.attendees) { if (!arranged.has(id)) arranged.set(id, []); arranged.get(id)!.push(m.day); }
  const byB: Record<string, { n: number; v14: number }> = {};
  for (const b of ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"]) {
    const ids = real.filter(p => hoodOf(p.hidden.home).borough === b).map(p => p.id);
    byB[b] = { n: ids.length, v14: v14Of(ids, valueDays, days) };
  }
  const ratios = Object.values(byB).filter(x => x.n >= 10 && Number.isFinite(x.v14)).map(x => div(x.v14, v14));
  const ratios30 = Object.values(byB).filter(x => x.n >= 30 && Number.isFinite(x.v14)).map(x => div(x.v14, v14));

  // Travel: per held group meetup (>= 3), the longest true trip; per seat, the trip; seats over the member's true tolerance.
  const groupMax = held.filter(m => m.attendees.length >= 3).map(m => Math.max(...m.attendees.map(id => m.travel[id]!)));
  const seats = held.flatMap(m => m.attendees.filter(id => realIds.has(id)).map(id => ({ t: m.travel[id]!, tol: O.p(id).hidden.tolerance })));

  // Safety.
  const holdAt = (id: MemberId) => world.state.safetyHolds.find(h => h.memberId === id);
  // Known: at the time the proposal was made (Monday of the contact's week), the Network could see a
  // red flag (an uncleared cue, a check not passed) or the member was already on a hold.
  const known = (id: MemberId, day: number) => {
    const week = Math.floor(day / 7);
    const h = holdAt(id);
    return friendAdversaryKnownAtProposal(visibleRedFlag(O.p(id), week), !!h && h.from <= weekTime(week, 0, 9));
  };
  // Count distinct pairs. The first contact may predate a hold that was visible at a later contact.
  let adv = 0, hidMinor = 0, decl = 0;
  const seenC = new Set<string>(), declSeen = new Set<string>();
  const knownContacts = new Set<string>();
  const reach = new Map<MemberId, Set<MemberId>>();
  const byAdvKind: Record<string, number> = {};
  const flowByKey = new Map(flows.map(f => [f.key, f]));
  const statedAdultAt = (c: (typeof contacts)[number], id: MemberId) => {
    const f = flowByKey.get(c.key);
    const i = f ? f.roster.indexOf(id) : -1;
    return i >= 0 && f!.sides[i]!.adult;
  };
  const teenRuleHeldAt = (c: (typeof contacts)[number]) => flowByKey.get(c.key)?.ruleOk === true;
  for (const c of contacts) {
    for (const [x, y] of [[c.a, c.b], [c.b, c.a]] as const) {
      const px = O.p(x);
      if (!realIds.has(y)) continue;
      const pair = `${x}>${y}`;
      const adversary = px.hidden.adversary === "age_liar" ? undefined : px.hidden.adversary;
      if (adversary && !knownContacts.has(pair) && known(x, c.day)) knownContacts.add(pair);
      if (!statedAdultAt(c, x) && !teenRuleHeldAt(c) && !declSeen.has(pair)) { declSeen.add(pair); decl++; }
      if (seenC.has(pair)) continue;
      seenC.add(pair);
      if (px.hidden.isMinor) hidMinor++;
      if (adversary) {
        adv++; byAdvKind[adversary] = (byAdvKind[adversary] ?? 0) + 1;
        if (!reach.has(x)) reach.set(x, new Set());
        reach.get(x)!.add(y);
      }
    }
  }
  const harms: Partial<Record<HarmKind, number>> = {};
  let reported = 0;
  let undetected = 0;
  for (const f of flows) for (const h of f.harms) { harms[h.kind] = (harms[h.kind] ?? 0) + 1; if (h.reported) reported++; if (!known(h.offender, f.week * 7)) undetected++; }
  const advIds = world.personas.filter(p => p.hidden.adversary && p.hidden.adversary !== "age_liar").map(p => p.id);
  const meetCount = real.map(p => (valueDays.get(p.id) ?? []).length);

  const persona = new Map(world.personas.map(p => [p.id, p]));
  const pairViolations = (ids: readonly MemberId[]) => {
    let n = 0;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (!friendsStatedOpen(persona.get(ids[i]!)!, persona.get(ids[j]!)!)) n++;
    return n;
  };
  const opennessViolations = proposals.reduce((s, f) => s + pairViolations(f.invited), 0) + held.reduce((s, m) => s + pairViolations(m.attendees), 0);
  const invitedEver = new Set(proposals.flatMap(f => f.invited));
  const proposedByOpenness: Record<string, { n: number; share: number }> = {};
  for (const g of ["anyone", "women only", "men only"]) {
    const ids = real.filter(p => openGroupOf(p) === g);
    proposedByOpenness[g] = { n: ids.length, share: div(ids.filter(p => invitedEver.has(p.id)).length, ids.length) };
  }

  const paidActs = new Set(["restaurant_dinner", "wine_bar", "comedy_show", "climbing_gym"]);
  let spendMismatch = 0, crossClassGuilds = 0, leastMiserySum = 0, leastMiseryN = 0, extractiveMeetups = 0;
  let dunbarAligned = 0, dunbarTotal = 0;
  for (const m of held) {
    const paid = paidActs.has(m.activity);
    const realAtt = m.attendees.filter(id => realIds.has(id));
    if (paid && realAtt.some(id => O.p(id).hidden.spendComfortTier === "free")) spendMismatch++;
    if (realAtt.length >= 2) {
      leastMiserySum += Math.min(...realAtt.map(id => m.enjoy[id]!));
      leastMiseryN++;
    }
    if (!paid && m.good && realAtt.length >= 3 && realAtt.length <= 6) {
      const econs = realAtt.map(id => O.p(id).hidden.economicCapital ?? 0.5);
      if (Math.max(...econs) - Math.min(...econs) >= 0.35) crossClassGuilds++;
    }
    if (m.attendees.some(id => (O.p(id).hidden.extractionPropensity ?? 0) >= 0.65)) extractiveMeetups++;
    for (const id of realAtt) {
      dunbarTotal++;
      const d = O.p(id).hidden.dunbarOpenSlots;
      if (!d || d.inner5 || d.sympathy15) dunbarAligned++;
    }
  }
  const bookedGroups = flows.filter(f => f.booked.length >= 3);
  const relSpreadSum = bookedGroups.reduce((s, f) => {
    const fl = f.booked.map(id => O.p(id).hidden.flakiness);
    return s + (Math.max(...fl) - Math.min(...fl));
  }, 0);

  return {
    matcher: res.matcher, seed: world.seed, weeks: world.weeks, members: world.personas.length, real: real.length,
    proposals: proposals.length, probes: proposals.reduce((s, f) => s + f.probed, 0), probeYesRate: div(proposals.reduce((s, f) => s + f.yes, 0), proposals.reduce((s, f) => s + f.probed, 0)),
    quorumRate: div(probedProposals.filter(f => f.going.length > 0).length, probedProposals.length), capDrops: proposals.reduce((s, f) => s + f.capDrops, 0),
    meetups: held.length, meetupsByKind: byKind, attendance: div(attended, booked), meanGroupSize: div(held.reduce((s, m) => s + m.attendees.length, 0), held.length),
    goodRate: div(held.filter(m => m.good).length, held.length), meanEnjoy: div(realE.reduce((s, x) => s + x, 0), realE.length),
    repeatRate: div(rep, base), repeatGroupRate: div(repG, base), repeatRateWithHandoff: div(repH, base), repeatBase: base,
    crewsFormed: world.state.crews.length, crewSessions: meetups.filter(m => m.crewId && m.kind !== "crew_self").length, crewsHandedOff: world.state.crews.filter(c => c.handedOff).length,
    hoursPerMember: div(real.reduce((s, p) => s + (perMember.get(p.id) ?? 0), 0), real.length), topPairHours: div(real.reduce((s, p) => s + (top.get(p.id) ?? 0), 0), real.length),
    casualFriendPairs: casualPairs, friendPairs, friendshipTrackShare: div(real.filter(p => track.has(p.id)).length, real.length), hallPaceShare: div(real.filter(p => pace.has(p.id)).length, real.length), casualFriendShare: div(real.filter(p => casual.has(p.id)).length, real.length),
    timeToFirstMeetup: { medianDays: median(firsts), shareWithMeetup: div(firsts.length, real.length) },
    v14, v14ByBorough: byB, boroughRatioMin: ratios.length ? Math.min(...ratios) : NaN, boroughRatioMin30: ratios30.length ? Math.min(...ratios30) : NaN, v14Arranged: v14Of(real.map(p => p.id), arranged, days),
    travel: { medianGroupMax: median(groupMax) ?? NaN, meanSeat: div(seats.reduce((s, x) => s + x.t, 0), seats.length), overTolerance: div(seats.filter(x => x.t > x.tol).length, seats.length) },
    giniMeetups: gini(meetCount), zeroMeetupShare: div(meetCount.filter(x => x === 0).length, real.length),
    expected: {
      perProposal: div(proposals.reduce((s, f) => s + f.expected, 0), proposals.length),
      perMember: div(proposals.reduce((s, f) => s + f.expected * f.invited.filter(id => realIds.has(id)).length, 0), real.length),
    },
    safety: {
      ageRuleBrokenProposals: proposals.filter(f => f.ageRuleBroken).length, declaredMinorContacts: decl, hiddenMinorContacts: hidMinor,
      adversaryContacts: adv, knownAdversaryContacts: knownContacts.size, adversaryContactsByKind: byAdvKind, adversariesReached: reach.size,
      medianReachPerAdversary: median(advIds.map(id => reach.get(id)?.size ?? 0)) ?? 0, harms, harmsReported: reported, harmsUndetected: undetected,
      opennessViolations, teen: teenSafety(res, proposals, P.good),
    },
    selfHangouts: world.selfHangouts, proposedByOpenness,
    strataQuality: {
      spendMismatchRate: div(spendMismatch, held.length),
      reliabilitySpreadMean: div(relSpreadSum, bookedGroups.length),
      dunbarAlignedShare: div(dunbarAligned, dunbarTotal),
      crossClassSharedPurposeMeetups: crossClassGuilds,
      leastMiseryMean: div(leastMiserySum, leastMiseryN),
      extractiveDilutionMeetups: extractiveMeetups,
    },
  };
}

export function friendsOutboundLog(res: FriendsRunResult) {
  return {
    flows: res.flows.map(f => ({
      key: f.key, kind: f.kind, invited: f.invited, stage: f.stage, probed: f.probed, yes: f.yes, replied: f.replied,
      going: f.going, booked: f.booked, attended: f.attended, capDrops: f.capDrops, ageRuleBroken: f.ageRuleBroken, meetAt: f.meetAt ?? null,
    })),
    contacts: res.contacts,
  };
}

export const pairKey = pk;
