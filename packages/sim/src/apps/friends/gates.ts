// friends.help launch gates. OFFICIAL: the replacement gates the founder adopted on 2026-10-08
// (docs/results/2026-10-08-friends-pack.md, "Gates"), plus the gates that held as proposed. The harm
// gate counts TOTAL harm vs random (coordinator's decision, 2026-10-08). TRACKED (non-blocking):
// harm from undetected adversaries vs random, and the 12-week repeat rate counting crew handoffs.
// HISTORICAL: the gates first proposed, kept for the record (V14 >= 60% was infeasible at 400
// personas: even the hidden-truth oracle reaches about 42%; Staten Island has about 9-10 members).
// Each gate compares the pack with random-within-area (and the oracle) on the SAME seeds. Metrics are
// pooled over seeds (mean of each metric); the worst seed is shown where it matters.
import type { FriendsMetrics, TeenBreaches } from "./metrics.ts";

import type { GateResult } from "../gates.ts";
import { meanInterval } from "../../paired.ts";
export type { GateResult } from "../gates.ts";
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const M = (xs: FriendsMetrics[], f: (m: FriendsMetrics) => number) => mean(xs.map(f));
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const BIG = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"];

/** Min over boroughs with >= `minN` real members (mean n over seeds) of mean V14(borough) / mean V14. */
export function boroughRatio(p: FriendsMetrics[], minN: number): { min: number; worst: string; worstSeed: number } {
  const v = M(p, m => m.v14);
  let min = Infinity, worst = "";
  for (const b of BIG) {
    if (M(p, m => m.v14ByBorough[b]?.n ?? 0) < minN) continue;
    const r = M(p, m => m.v14ByBorough[b]?.v14 ?? NaN) / v;
    if (r < min) { min = r; worst = b; }
  }
  const per = p.map(m => Math.min(...BIG.filter(b => (m.v14ByBorough[b]?.n ?? 0) >= minN && Number.isFinite(m.v14ByBorough[b]!.v14)).map(b => m.v14ByBorough[b]!.v14 / m.v14)));
  return { min, worst, worstSeed: Math.min(...per) };
}

/** Official gates: the founder's adopted replacements (2026-10-08) and the gates that held as proposed. */
export function officialGates(p: FriendsMetrics[], r: FriendsMetrics[], o: FriendsMetrics[]): GateResult[] {
  const v = M(p, m => m.v14), vr = M(r, m => m.v14), vo = M(o, m => m.v14);
  const fr = M(p, m => m.friendshipTrackShare), frr = M(r, m => m.friendshipTrackShare);
  const b30 = boroughRatio(p, 30);
  const h = M(p, m => totalHarm(m)), hr = M(r, m => totalHarm(m));
  return [
    // The repeat gate is set at 8 weeks; other horizons are reported under the tracked metrics.
    (p[0]?.weeks ?? 8) === 8
      ? { id: "repeat", gate: "Repeat-meetup rate >= 30% (8 weeks)", value: pct(M(p, m => m.repeatRate)), pass: M(p, m => m.repeatRate) >= 0.3 }
      : { id: "repeat", gate: "Repeat-meetup rate >= 30% (8 weeks)", value: `n/a at ${p[0]!.weeks} weeks (tracked below; ${pct(M(p, m => m.repeatRate))} without handoffs)`, pass: true },
    { id: "v14", gate: "V14 >= 0.75x oracle and >= 1.75x random", value: `${pct(v)}: ${(v / vo).toFixed(2)}x oracle (${pct(vo)}), ${(v / vr).toFixed(2)}x random (${pct(vr)})`, pass: v >= 0.75 * vo && v >= 1.75 * vr },
    { id: "friendship", gate: "Members with a friendship forming >= 2x random", value: `${pct(fr)} vs ${pct(frr)} (${(fr / frr).toFixed(1)}x)`, pass: fr >= 2 * frr },
    { id: "travel", gate: "Median group max travel <= 35 min", value: `${M(p, m => m.travel.medianGroupMax).toFixed(1)} min`, pass: M(p, m => m.travel.medianGroupMax) <= 35 },
    { id: "borough30", gate: "No borough with >= 30 members below 0.7x V14", value: `${b30.min.toFixed(2)} (${b30.worst}; worst seed ${b30.worstSeed.toFixed(2)})`, pass: b30.min >= 0.7 },
    { id: "minors", gate: "Proposals that break the teen age rule, and declared-minor contacts = 0, every seed", value: String(p.reduce((s, m) => s + m.safety.declaredMinorContacts + m.safety.ageRuleBrokenProposals, 0)), pass: p.every(m => m.safety.declaredMinorContacts === 0 && m.safety.ageRuleBrokenProposals === 0) },
    { id: "known_adversary", gate: "Known-adversary contacts = 0, every seed", value: String(p.reduce((s, m) => s + m.safety.knownAdversaryContacts, 0)), pass: p.every(m => m.safety.knownAdversaryContacts === 0) },
    { id: "openness", gate: "Proposals and meetups that violate a stated friendship openness = 0, every seed", value: String(p.reduce((s, m) => s + m.safety.opennessViolations, 0)), pass: p.every(m => m.safety.opennessViolations === 0) },
    { id: "total_harm", gate: "Total harm events <= 0.5x random", value: `${h.toFixed(1)} vs ${hr.toFixed(1)} per seed (${(h / hr).toFixed(2)}x)`, pass: h <= 0.5 * hr },
  ];
}

export const totalHarm = (m: FriendsMetrics) => Object.values(m.safety.harms).reduce((a, b) => a + (b ?? 0), 0);

/** Tracked metrics: reported with the gates, never blocking. */
export function trackedMetrics(p: FriendsMetrics[], r: FriendsMetrics[]): GateResult[] {
  const hu = M(p, m => m.safety.harmsUndetected), hur = M(r, m => m.safety.harmsUndetected);
  const w = p[0]?.weeks ?? 0;
  return [
    { id: "t_undetected_harm", gate: "Harm from undetected adversaries vs random (target <= 0.5x)", value: `${hu.toFixed(1)} vs ${hur.toFixed(1)} per seed (${(hu / hur).toFixed(2)}x)`, pass: hu <= 0.5 * hur },
    { id: "t_repeat_handoff", gate: `Repeat rate counting crew handoffs as repeats, ${w} weeks (target >= 30%)`, value: `${pct(M(p, m => m.repeatRateWithHandoff))} (without handoffs ${pct(M(p, m => m.repeatRate))})`, pass: M(p, m => m.repeatRateWithHandoff) >= 0.3 },
  ];
}

export function opennessGroups(p: FriendsMetrics[]): GateResult {
  return { id: "t_openness_groups", gate: "Members proposed at least once by stated friendship openness (target: lowest group >= 0.8x anyone)", value: Object.entries(p[0]?.proposedByOpenness ?? {}).map(([g]) => `${g} ${pct(M(p, m => m.proposedByOpenness[g]?.share ?? 0))} (n ${M(p, m => m.proposedByOpenness[g]?.n ?? 0).toFixed(0)})`).join(", "), pass: Math.min(...Object.keys(p[0]?.proposedByOpenness ?? {}).map(g => M(p, m => m.proposedByOpenness[g]?.share ?? 0))) >= 0.8 * M(p, m => m.proposedByOpenness.anyone?.share ?? 0) };
}

/** The first proposed gate set (historical; not the launch criteria). */
export function historicalGates(p: FriendsMetrics[], r: FriendsMetrics[]): GateResult[] {
  const b10 = boroughRatio(p, 1);
  const fr = M(p, m => m.friendshipTrackShare), frr = M(r, m => m.friendshipTrackShare);
  return [
    { id: "h_repeat", gate: "Repeat-meetup rate >= 30%", value: pct(M(p, m => m.repeatRate)), pass: M(p, m => m.repeatRate) >= 0.3 },
    { id: "h_v14", gate: "V14 >= about 60% at 8 weeks", value: pct(M(p, m => m.v14)), pass: M(p, m => m.v14) >= 0.6 },
    { id: "h_friendship", gate: "Members on a friendship track >= 2x random", value: `${(fr / frr).toFixed(1)}x`, pass: fr >= 2 * frr },
    { id: "h_travel", gate: "Median group travel <= 35 min", value: `${M(p, m => m.travel.medianGroupMax).toFixed(1)} min`, pass: M(p, m => m.travel.medianGroupMax) <= 35 },
    { id: "h_borough", gate: "No borough (any with members) below 0.7x the overall value rate", value: `${b10.min.toFixed(2)} (${b10.worst})`, pass: b10.min >= 0.7 },
    hTeen(p),
    { id: "h_adversary", gate: "0 adversary contacts", value: M(p, m => m.safety.adversaryContacts).toFixed(1), pass: p.every(m => m.safety.adversaryContacts === 0) },
  ];
}

export function hTeen(p: FriendsMetrics[]): GateResult {
  const xs = p.map(m => m.safety.teen.hTeen);
  return {
    id: "h_teen", gate: "0 contacts outside the teen friendship rule by true age, and 0 adults posing as teens who reached a minor",
    value: `${meanInterval(xs)}; outside the rule ${p.reduce((s, m) => s + m.safety.teen.hiddenOutsideRule, 0)}, posers who reached a minor ${p.reduce((s, m) => s + m.safety.teen.posersReachingMinor, 0)}`,
    pass: xs.every(x => x === 0),
  };
}

const TEEN_GATES: readonly { id: string; gate: string; of: (b: TeenBreaches) => number }[] = [
  { id: "teen_adult_contact", gate: "Proposals and contacts with a minor and a person aged 19 or more = 0", of: b => b.adult },
  { id: "teen_gap_contact", gate: "Proposals and contacts with a minor and a member born more than 2 years apart = 0", of: b => b.gap },
  { id: "teen_lane_contact", gate: "Proposals and contacts with a minor outside a friends.help friendship category, generator or meeting shape = 0", of: b => b.lane },
  { id: "teen_unready_contact", gate: "Teen introductions with a member who is not teen ready = 0", of: b => b.unready },
  { id: "teen_switch_off_contact", gate: "Proposals and contacts with a minor while teen introductions are stopped = 0", of: b => b.switchOff },
  { id: "teen_group_contact", gate: "Groups with a minor in which a pair with a minor breaks the teen rule, or larger than 6 = 0", of: b => b.group },
  { id: "teen_place_contact", gate: "Groups and meetings with a minor at a place or activity that is not all-ages, or outside 10:00 to 19:00 = 0", of: b => b.place },
];

export function teenGates(p: FriendsMetrics[]): GateResult[] {
  return TEEN_GATES.map(g => {
    const per = p.map(m => g.of(m.safety.teen.proposals) + g.of(m.safety.teen.contacts));
    return { id: g.id, gate: `${g.gate}, every seed`, value: `${per.reduce((a, b) => a + b, 0)} (proposals ${p.reduce((s, m) => s + g.of(m.safety.teen.proposals), 0)}, contacts ${p.reduce((s, m) => s + g.of(m.safety.teen.contacts), 0)})`, pass: per.every(x => x === 0) };
  });
}

export function teenTracked(p: FriendsMetrics[]): GateResult[] {
  return [
    hTeen(p),
    { id: "teen_valued_meetups", gate: "Held meetups with a minor that every attendee enjoyed", value: meanInterval(p.map(m => m.safety.teen.validMeetups)), pass: true },
    { id: "teen_intro_share", gate: "Stated minors with at least one teen introduction", value: pct(M(p, m => m.safety.teen.introShare)), pass: true },
    { id: "teen_group_share", gate: "Held teen meetups with 3 or more people", value: `${pct(M(p, m => m.safety.teen.groupShare))} (${p.reduce((s, m) => s + m.safety.teen.teenGroupMeetups, 0)} of ${p.reduce((s, m) => s + m.safety.teen.teenMeetups, 0)})`, pass: true },
  ];
}

export function printGates(title: string, gs: GateResult[], tracked = false): string {
  return [`${title}`, `| ${tracked ? "Tracked metric" : "Gate"} | Value | ${tracked ? "On target" : "Pass"} |`, "|---|---|---|", ...gs.map(g => `| ${g.gate} | ${g.value} | ${g.pass ? (tracked ? "yes" : "pass") : (tracked ? "no" : "FAIL")} |`)].join("\n");
}
