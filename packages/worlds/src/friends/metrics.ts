// Metrics for a friends.help run (harness side: they read hidden truth). Per-member rates use REAL
// members: true adults who are not adversaries. Definitions are in the results doc.
import type { MemberId } from "@thenetwork/core";
import { canBeMatched } from "@thenetwork/core";
import type { HarmKind } from "./oracle.ts";
import { hoodOf, isReal, type FriendsPersona } from "./persona.ts";
import { visibleRedFlag, weekTime } from "./snapshot.ts";
import { pk, type FriendsRunResult } from "./world.ts";

export interface FriendsMetrics {
  matcher: string; seed: number; weeks: number; members: number; real: number;
  proposals: number; probes: number; probeYesRate: number; quorumRate: number; capDrops: number;
  meetups: number; meetupsByKind: Record<string, number>; attendance: number; meanGroupSize: number;
  goodRate: number; meanEnjoy: number;
  /** Meetups (held by day D-30) where >= 2 of the attendees met again (any app meetup) within 30 days. */
  repeatRate: number;
  /** Stricter: >= 3 of the attendees (or both of a pair) met again together within 30 days. */
  repeatGroupRate: number;
  crewsFormed: number; crewSessions: number; crewsHandedOff: number;
  /** Mean over real members of total hours with other members, and of the hours with their top person. */
  hoursPerMember: number; topPairHours: number;
  /** Pairs past Hall's thresholds (50 casual, 90 friend). */
  casualFriendPairs: number; friendPairs: number;
  /** Share of real members with >= 1 pair on a friendship track (definition in the doc). */
  friendshipTrackShare: number;
  /** Share of real members with >= 1 pair past 50 hours. */
  casualFriendShare: number;
  timeToFirstMeetup: { medianDays: number | null; shareWithMeetup: number };
  v14: number; v14ByBorough: Record<string, { n: number; v14: number }>; boroughRatioMin: number;
  /** V14 counting only meetups the Network arranged (excludes handed-off crews meeting on their own). */
  v14Arranged: number;
  travel: { medianGroupMax: number; meanSeat: number; overTolerance: number };
  giniMeetups: number; zeroMeetupShare: number;
  safety: {
    declaredMinorProposals: number; declaredMinorContacts: number;
    hiddenMinorContacts: number; adversaryContacts: number; knownAdversaryContacts: number;
    adversaryContactsByKind: Partial<Record<string, number>>; adversariesReached: number; medianReachPerAdversary: number;
    harms: Partial<Record<HarmKind, number>>; harmsReported: number;
  };
  selfHangouts: number;
}

export function gini(xs: number[]): number {
  const v = [...xs].sort((a, b) => a - b), n = v.length, s = v.reduce((a, b) => a + b, 0);
  if (!n || !s) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * v[i]!;
  return (2 * cum) / (n * s) - (n + 1) / n;
}
const div = (a: number, b: number) => (b ? a / b : 0);
const median = (xs: number[]) => { if (!xs.length) return null; const v = [...xs].sort((a, b) => a - b); const m = v.length >> 1; return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2; };

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
  const byKind: Record<string, number> = {};
  for (const m of meetups) byKind[m.kind] = (byKind[m.kind] ?? 0) + 1;
  const booked = flows.reduce((s, f) => s + f.booked.length, 0), attended = flows.reduce((s, f) => s + f.attended.length, 0);
  const realE = held.flatMap(m => m.attendees.filter(id => realIds.has(id)).map(id => m.enjoy[id]!));

  // Repeat: did >= 2 (or >= 3) of this meetup's attendees meet again together within 30 days?
  const allMeet = meetups.filter(m => m.kind !== "crew_self");
  let rep = 0, repG = 0, base = 0;
  for (const m of allMeet) {
    if (m.day > days - 30) continue;
    base++;
    const later = allMeet.filter(x => x.day > m.day && x.day <= m.day + 30);
    const overlap = later.map(x => x.attendees.filter(id => m.attendees.includes(id)).length);
    if (overlap.some(c => c >= 2)) rep++;
    if (overlap.some(c => c >= Math.min(3, m.attendees.length))) repG++;
  }

  // Hours and friendship tracks.
  const perMember = new Map<MemberId, number>(), top = new Map<MemberId, number>(), track = new Set<MemberId>(), casual = new Set<MemberId>();
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
    if (h >= P.hall.casual || (h >= 12 && h + recent * Math.max(0, 26 - W) >= P.hall.casual)) { track.add(a); track.add(b); }
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
    return visibleRedFlag(O.p(id), week) || (!!h && h.from <= weekTime(week, 0, 9));
  };
  let adv = 0, knownAdv = 0, hidMinor = 0, decl = 0;
  const reach = new Map<MemberId, Set<MemberId>>();
  const byAdvKind: Record<string, number> = {};
  for (const c of contacts) {
    for (const [x, y] of [[c.a, c.b], [c.b, c.a]] as const) {
      const px = O.p(x), py = O.p(y);
      if (!realIds.has(y)) continue;
      if (!canBeMatched(px.stated.claimedAge)) decl++;
      if (px.hidden.isMinor) hidMinor++;
      if (px.hidden.adversary && px.hidden.adversary !== "age_liar") {
        adv++; byAdvKind[px.hidden.adversary] = (byAdvKind[px.hidden.adversary] ?? 0) + 1;
        if (known(x, c.day)) knownAdv++;
        if (!reach.has(x)) reach.set(x, new Set());
        reach.get(x)!.add(y);
      }
    }
  }
  const harms: Partial<Record<HarmKind, number>> = {};
  let reported = 0;
  for (const f of flows) for (const h of f.harms) { harms[h.kind] = (harms[h.kind] ?? 0) + 1; if (h.reported) reported++; }
  const advIds = world.personas.filter(p => p.hidden.adversary && p.hidden.adversary !== "age_liar").map(p => p.id);
  const meetCount = real.map(p => (valueDays.get(p.id) ?? []).length);

  return {
    matcher: res.matcher, seed: world.seed, weeks: world.weeks, members: world.personas.length, real: real.length,
    proposals: flows.length, probes: flows.reduce((s, f) => s + f.probed, 0), probeYesRate: div(flows.reduce((s, f) => s + f.yes, 0), flows.reduce((s, f) => s + f.probed, 0)),
    quorumRate: div(flows.filter(f => f.going.length > 0 && f.stage !== "no_quorum").length, flows.filter(f => f.probed > 0).length), capDrops: flows.reduce((s, f) => s + f.capDrops, 0),
    meetups: held.length, meetupsByKind: byKind, attendance: div(attended, booked), meanGroupSize: div(held.reduce((s, m) => s + m.attendees.length, 0), held.length),
    goodRate: div(held.filter(m => m.good).length, held.length), meanEnjoy: div(realE.reduce((s, x) => s + x, 0), realE.length),
    repeatRate: div(rep, base), repeatGroupRate: div(repG, base),
    crewsFormed: world.state.crews.length, crewSessions: meetups.filter(m => m.crewId && m.kind !== "crew_self").length, crewsHandedOff: world.state.crews.filter(c => c.handedOff).length,
    hoursPerMember: div(real.reduce((s, p) => s + (perMember.get(p.id) ?? 0), 0), real.length), topPairHours: div(real.reduce((s, p) => s + (top.get(p.id) ?? 0), 0), real.length),
    casualFriendPairs: casualPairs, friendPairs, friendshipTrackShare: div(real.filter(p => track.has(p.id)).length, real.length), casualFriendShare: div(real.filter(p => casual.has(p.id)).length, real.length),
    timeToFirstMeetup: { medianDays: median(firsts), shareWithMeetup: div(firsts.length, real.length) },
    v14, v14ByBorough: byB, boroughRatioMin: ratios.length ? Math.min(...ratios) : NaN, v14Arranged: v14Of(real.map(p => p.id), arranged, days),
    travel: { medianGroupMax: median(groupMax) ?? NaN, meanSeat: div(seats.reduce((s, x) => s + x.t, 0), seats.length), overTolerance: div(seats.filter(x => x.t > x.tol).length, seats.length) },
    giniMeetups: gini(meetCount), zeroMeetupShare: div(meetCount.filter(x => x === 0).length, real.length),
    safety: {
      declaredMinorProposals: flows.filter(f => f.declaredMinor).length, declaredMinorContacts: decl, hiddenMinorContacts: hidMinor,
      adversaryContacts: adv, knownAdversaryContacts: knownAdv, adversaryContactsByKind: byAdvKind, adversariesReached: reach.size,
      medianReachPerAdversary: median(advIds.map(id => reach.get(id)?.size ?? 0)) ?? 0, harms, harmsReported: reported,
    },
    selfHangouts: world.selfHangouts,
  };
}

export const pairKey = pk;
