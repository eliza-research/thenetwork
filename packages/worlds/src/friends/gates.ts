// friends.help launch gates. OFFICIAL: the replacement gates the founder adopted on 2026-10-08
// (docs/results/2026-10-08-friends-pack.md, "Gates"), plus the gates that held as proposed. The harm
// gate counts TOTAL harm vs random (coordinator's decision, 2026-10-08). TRACKED (non-blocking):
// harm from undetected adversaries vs random, and the 12-week repeat rate counting crew handoffs.
// HISTORICAL: the gates first proposed, kept for the record (V14 >= 60% was infeasible at 400
// personas: even the hidden-truth oracle reaches about 42%; Staten Island has about 9-10 members).
// Each gate compares the pack with random-within-area (and the oracle) on the SAME seeds. Metrics are
// pooled over seeds (mean of each metric); the worst seed is shown where it matters.
import type { FriendsMetrics } from "./metrics.ts";

export interface GateResult { id: string; gate: string; value: string; pass: boolean }
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
    { id: "minors", gate: "Declared-minor proposals and contacts = 0, every seed", value: String(p.reduce((s, m) => s + m.safety.declaredMinorContacts + m.safety.declaredMinorProposals, 0)), pass: p.every(m => m.safety.declaredMinorContacts === 0 && m.safety.declaredMinorProposals === 0) },
    { id: "known_adversary", gate: "Known-adversary contacts = 0, every seed", value: String(p.reduce((s, m) => s + m.safety.knownAdversaryContacts, 0)), pass: p.every(m => m.safety.knownAdversaryContacts === 0) },
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
    { id: "h_minor", gate: "0 minor contacts (declared and hidden)", value: String(p.reduce((s, m) => s + m.safety.declaredMinorContacts + m.safety.hiddenMinorContacts, 0)), pass: p.every(m => m.safety.declaredMinorContacts + m.safety.hiddenMinorContacts === 0) },
    { id: "h_adversary", gate: "0 adversary contacts", value: M(p, m => m.safety.adversaryContacts).toFixed(1), pass: p.every(m => m.safety.adversaryContacts === 0) },
  ];
}

export function printGates(title: string, gs: GateResult[], tracked = false): string {
  return [`${title}`, `| ${tracked ? "Tracked metric" : "Gate"} | Value | ${tracked ? "On target" : "Pass"} |`, "|---|---|---|", ...gs.map(g => `| ${g.gate} | ${g.value} | ${g.pass ? (tracked ? "yes" : "pass") : (tracked ? "no" : "FAIL")} |`)].join("\n");
}
