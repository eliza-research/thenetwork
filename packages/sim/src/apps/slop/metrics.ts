// Metrics for a slop run, computed from the harness's flow records (they include hidden truth, so
// this is harness-side only). Per-member rates use REAL members: true adults who are not
// adversaries. Safety metrics count every contact with an adversary or a minor.
import type { MemberId } from "@thenetwork/core";
import { canBeMatched } from "@thenetwork/core";
import type { HarmKind } from "./oracle.ts";
import { isSafe } from "./oracle.ts";
import { groupOf, type SlopPersona } from "./persona.ts";
import type { FlowRecord, SlopRunResult } from "./world.ts";

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
  fairness: { byGroup: Record<string, GroupMetrics>; byGender: Record<string, GroupMetrics>; minMaxDateRatio: number };
}

export function gini(xs: number[]): number {
  const v = [...xs].sort((a, b) => a - b), n = v.length, s = v.reduce((a, b) => a + b, 0);
  if (!n || !s) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * v[i]!;
  return (2 * cum) / (n * s) - (n + 1) / n;
}
const topShare = (xs: number[], q = 0.1) => {
  const v = [...xs].sort((a, b) => b - a), s = v.reduce((a, b) => a + b, 0);
  return s ? v.slice(0, Math.max(1, Math.round(v.length * q))).reduce((a, b) => a + b, 0) / s : 0;
};
const div = (a: number, b: number) => (b ? a / b : 0);
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
    timeToFirstDate: { medianDays: days.length ? days[Math.floor(days.length / 2)]! : null, shareWithDate: div(days.length, real.length) },
    fairness: { byGroup, byGender, minMaxDateRatio: rates.length ? div(Math.min(...rates), Math.max(...rates)) : 0 },
  };
}
