// Metrics for a slop run, computed from the harness's flow records (they include hidden truth, so
// this is harness-side only). Per-member rates use REAL members: true adults who are not
// adversaries. Safety metrics count every contact with an adversary or a minor.
import { gini } from "@thenetwork/core";
export { gini };
import type { MemberId } from "@thenetwork/core";
import { canBeMatched } from "@thenetwork/core";
import type { HarmKind } from "./oracle.ts";
import { isSafe } from "./oracle.ts";
import { groupOf, type SlopPersona } from "./persona.ts";
import type { SlopRunResult } from "./world.ts";

export interface GroupMetrics { n: number; datesPerMemberMonth: number; shareWithProposal: number; shareWithDate: number; goodDateRate: number }

export interface SlopMetrics {
  matcher: string; seed: number; members: number; weeks: number;
  proposals: number; probesDelivered: number; droppedForCap: number;
  probeReplyRate: number; probeYesRate: number;
  /** Both said yes / first probe delivered. */
  mutualYesRate: number;
  /** Dates / mutual yes (Known reports ~80% of intros become dates; Ditto targets ~20% match-to-date). */
  dateGivenMutual: number;
  backoutRate: number;
  /** Dates / booked plans. */
  attendance: number;
  dates: number; datesPerMemberMonth: number; goodDateRate: number; secondDateRate: number; meanQuality: number;
  /** Share of booked seats at a time the member was not really free. */
  seatsNotFree: number;
  /** Proposals outside a member's stated filters (unknown prefs guessed wrong). */
  filterViolations: number;
  congestion: { giniProbes: number; giniProposals: number; zeroProposalShare: number; top10ProposalShare: number; top10ProbeShare: number };
  safety: {
    /** Policy invariant: proposals with a member whose CLAIMED age is under 18. Must be 0. */
    minorContacts: number;
    /** Lying minors (claimed 18+) who reached a reveal with an adult. */
    undisclosedMinorContacts: number; undisclosedMinorProposals: number;
    adversaryProposals: number; adversaryContacts: number;
    harms: Partial<Record<HarmKind, number>>; harmsReported: number;
  };
  timeToFirstDate: { medianDays: number | null; shareWithDate: number };
  expected: { goodPerProposal: number; secondPerProposal: number; goodPerMember: number };
  fairness: { byGroup: Record<string, GroupMetrics>; byGender: Record<string, GroupMetrics>; minMaxDateRatio: number };
  assortativity: {
    meanDesirabilityGap: number;
    crossTierMismatchShare: number;
    topDecileRejectionCascadeRate: number;
    bottom40DateRate: number;
    bottom40SecondDateRate: number;
    secondDateByDesirabilityQuartile: { q1: number; q2: number; q3: number; q4: number };
    anxiousAvoidantDateShare: number;
  };
}

const topShare = (xs: number[], q = 0.1) => {
  const v = [...xs].sort((a, b) => b - a), s = v.reduce((a, b) => a + b, 0);
  return s ? v.slice(0, Math.max(1, Math.round(v.length * q))).reduce((a, b) => a + b, 0) / s : 0;
};
const div = (a: number, b: number) => (b ? a / b : 0);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const WEEKS_PER_MONTH = 4.345;

export function slopMetrics(res: SlopRunResult): SlopMetrics {
  const { world, flows } = res;
  const P = world.oracle.byId;
  const real = world.personas.filter(isSafe);
  const months = world.weeks / WEEKS_PER_MONTH;
  const proposalsOf = new Map<MemberId, number>(), probesOf = new Map<MemberId, number>(), datesOf = new Map<MemberId, number>(), goodOf = new Map<MemberId, number>();
  const firstDay = new Map<MemberId, number>();
  const add = (m: Map<MemberId, number>, id: MemberId) => m.set(id, (m.get(id) ?? 0) + 1);
  let probes = 0, replies = 0, yeses = 0, firstDelivered = 0, mutual = 0, backouts = 0, booked = 0, dates = 0, good = 0, second = 0, quality = 0;
  let seats = 0, seatsNotFree = 0, dropped = 0, viol = 0;
  const safety: SlopMetrics["safety"] = { minorContacts: 0, undisclosedMinorContacts: 0, undisclosedMinorProposals: 0, adversaryProposals: 0, adversaryContacts: 0, harms: {}, harmsReported: 0 };
  for (const f of flows) {
    const a = P.get(f.first), b = P.get(f.partner);
    if (!a || !b) continue;
    add(proposalsOf, a.id); add(proposalsOf, b.id);
    if (f.declaredMinor || !canBeMatched(a.stated.claimedAge) || !canBeMatched(b.stated.claimedAge)) safety.minorContacts++;
    const hiddenMinor = a.hidden.isMinor || b.hidden.isMinor, adv = !!(a.hidden.adversary && a.hidden.adversary !== "age_liar") || !!(b.hidden.adversary && b.hidden.adversary !== "age_liar");
    if (hiddenMinor) safety.undisclosedMinorProposals++;
    if (adv) safety.adversaryProposals++;
    if (f.revealed && hiddenMinor) safety.undisclosedMinorContacts++;
    if (f.revealed && adv) safety.adversaryContacts++;
    for (const h of f.harms) { safety.harms[h.kind] = (safety.harms[h.kind] ?? 0) + 1; if (h.reported) safety.harmsReported++; }
    if (f.filterViolation) viol++;
    if (f.stage === "dropped_first_cap" || f.stage === "dropped_partner_cap") dropped++;
    if (f.firstYes !== undefined || f.stage === "first_silent") {
      firstDelivered++; probes++; add(probesOf, a.id);
      if (f.stage !== "first_silent") replies++;
      if (f.firstYes) yeses++;
    }
    if (f.partnerYes !== undefined || f.stage === "partner_silent") {
      probes++; add(probesOf, b.id);
      if (f.stage !== "partner_silent") replies++;
      if (f.partnerYes) yeses++;
    }
    if (f.mutualYes) mutual++;
    if (f.stage === "backout") backouts++;
    if (f.stage === "no_show" || f.stage === "date") { booked++; seats += 2; seatsNotFree += f.seatsNotFree ?? 0; }
    if (f.stage === "date") {
      dates++; quality += f.outcome!.quality;
      if (f.good) good++;
      if (f.secondDate) second++;
      for (const id of [a.id, b.id]) {
        add(datesOf, id); if (f.good) add(goodOf, id);
        if (!firstDay.has(id) || firstDay.get(id)! > f.day!) firstDay.set(id, f.day!);
      }
    }
  }
  const realVals = (m: Map<MemberId, number>) => real.map(p => m.get(p.id) ?? 0);
  const group = (ps: SlopPersona[]): GroupMetrics => {
    const d = ps.reduce((s, p) => s + (datesOf.get(p.id) ?? 0), 0), g = ps.reduce((s, p) => s + (goodOf.get(p.id) ?? 0), 0);
    return {
      n: ps.length, datesPerMemberMonth: div(d, ps.length * months),
      shareWithProposal: div(ps.filter(p => (proposalsOf.get(p.id) ?? 0) > 0).length, ps.length),
      shareWithDate: div(ps.filter(p => (datesOf.get(p.id) ?? 0) > 0).length, ps.length), goodDateRate: div(g, d),
    };
  };
  const by = (key: (p: SlopPersona) => string) => {
    const m = new Map<string, SlopPersona[]>();
    for (const p of real) { const k = key(p); m.set(k, [...(m.get(k) ?? []), p]); }
    return Object.fromEntries([...m.entries()].sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, ps]) => [k, group(ps)]));
  };
  const byGroup = by(groupOf), byGender = by(p => p.stated.matchGender);
  const rates = Object.values(byGroup).filter(g => g.n >= 15).map(g => g.datesPerMemberMonth);
  const days = real.map(p => firstDay.get(p.id)).filter((d): d is number => d !== undefined).sort((x, y) => x - y);
  const rankedReal = [...real].sort((x, y) => (x.hidden.desirability - y.hidden.desirability) || (x.id < y.id ? -1 : 1));
  const R = rankedReal.length;
  const bottom40Ids = new Set(R ? rankedReal.slice(0, Math.max(1, Math.round(R * 0.40))).map(p => p.id) : []);
  const topDecileIds = new Set(R ? rankedReal.slice(Math.max(0, R - Math.max(1, Math.round(R * 0.10)))).map(p => p.id) : []);
  const qOf = new Map<MemberId, "q1" | "q2" | "q3" | "q4">();
  rankedReal.forEach((p, idx) => {
    const frac = R > 1 ? idx / R : 0.5;
    qOf.set(p.id, frac < 0.25 ? "q1" : frac < 0.50 ? "q2" : frac < 0.75 ? "q3" : "q4");
  });
  const realIds = new Set(real.map(p => p.id));
  let gapSum = 0, gapN = 0, crossTier = 0, topCascadeRej = 0, topCascadeN = 0;
  let b40Dates = 0, b40Second = 0, aaDates = 0;
  const qDates = { q1: { d: 0, s: 0 }, q2: { d: 0, s: 0 }, q3: { d: 0, s: 0 }, q4: { d: 0, s: 0 } };
  for (const f of flows) {
    const a = P.get(f.first), b = P.get(f.partner);
    if (!a || !b || !realIds.has(a.id) || !realIds.has(b.id)) continue;
    const gap = Math.abs(a.hidden.desirability - b.hidden.desirability);
    gapSum += gap; gapN++;
    if (gap > 1.5) crossTier++;
    if ((topDecileIds.has(a.id) || topDecileIds.has(b.id)) && gap > 1.2 && f.stage !== "dropped_first_cap" && f.stage !== "dropped_partner_cap" && f.stage !== "dropped_policy") {
      topCascadeN++;
      if (f.stage === "first_no" || f.stage === "partner_no" || f.stage === "backout") topCascadeRej++;
    }
    if (f.stage === "date") {
      if (bottom40Ids.has(a.id) || bottom40Ids.has(b.id)) {
        b40Dates++;
        if (f.secondDate) b40Second++;
      }
      const trap = (a.hidden.attachmentStyle === "anxious" && b.hidden.attachmentStyle === "avoidant")
        || (a.hidden.attachmentStyle === "avoidant" && b.hidden.attachmentStyle === "anxious");
      if (trap) aaDates++;
      for (const id of [a.id, b.id]) {
        const q = qOf.get(id);
        if (q) { qDates[q].d++; if (f.secondDate) qDates[q].s++; }
      }
    }
  }
  const b40MemberDates = [...bottom40Ids].reduce((s, id) => s + (datesOf.get(id) ?? 0), 0);
  return {
    matcher: res.matcher, seed: world.seed, members: real.length, weeks: world.weeks,
    proposals: flows.length, probesDelivered: probes, droppedForCap: dropped,
    probeReplyRate: div(replies, probes), probeYesRate: div(yeses, probes), mutualYesRate: div(mutual, firstDelivered),
    dateGivenMutual: div(dates, mutual), backoutRate: div(backouts, mutual), attendance: div(dates, booked),
    dates, datesPerMemberMonth: div(real.reduce((s, p) => s + (datesOf.get(p.id) ?? 0), 0), real.length * months),
    goodDateRate: div(good, dates), secondDateRate: div(second, dates), meanQuality: div(quality, dates),
    seatsNotFree: div(seatsNotFree, seats), filterViolations: viol,
    congestion: {
      giniProbes: gini(realVals(probesOf)), giniProposals: gini(realVals(proposalsOf)),
      zeroProposalShare: div(real.filter(p => !(proposalsOf.get(p.id) ?? 0)).length, real.length),
      top10ProposalShare: topShare(realVals(proposalsOf)), top10ProbeShare: topShare(realVals(probesOf)),
    },
    safety,
    timeToFirstDate: { medianDays: median(days), shareWithDate: div(days.length, real.length) },
    expected: {
      goodPerProposal: div(flows.reduce((s, f) => s + f.expected.good, 0), flows.length),
      secondPerProposal: div(flows.reduce((s, f) => s + f.expected.second, 0), flows.length),
      goodPerMember: div(2 * flows.reduce((s, f) => s + f.expected.good, 0), real.length),
    },
    fairness: { byGroup, byGender, minMaxDateRatio: rates.length ? div(Math.min(...rates), Math.max(...rates)) : 0 },
    assortativity: {
      meanDesirabilityGap: div(gapSum, gapN),
      crossTierMismatchShare: div(crossTier, gapN),
      topDecileRejectionCascadeRate: div(topCascadeRej, topCascadeN),
      bottom40DateRate: div(b40MemberDates, bottom40Ids.size * months),
      bottom40SecondDateRate: div(b40Second, b40Dates),
      secondDateByDesirabilityQuartile: {
        q1: div(qDates.q1.s, qDates.q1.d),
        q2: div(qDates.q2.s, qDates.q2.d),
        q3: div(qDates.q3.s, qDates.q3.d),
        q4: div(qDates.q4.s, qDates.q4.d),
      },
      anxiousAvoidantDateShare: div(aaDates, dates),
    },
  };
}
