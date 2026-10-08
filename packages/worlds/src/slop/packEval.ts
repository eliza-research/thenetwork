// Evaluate the slop.date AppPack (the real engine with slopPack) against the baselines on the slop
// world, with the launch gates of docs/results/2026-10-08-slop-pack.md. No LLM calls.
//   bun run packages/worlds/src/slop/packEval.ts --seeds 1-4 --weeks 4 [--arms random,greedy,oracle,slop]
//       [--variant '{"assignment":"stable"}' --variant-name stable] [--json out.json] [--md]
// Arms: random, greedy, oracle (the world's baselines) and slop (the pack with its defaults); every
// --variant adds a slop arm with those pack options (ablations / tuning).
import type { MemberId } from "@thenetwork/core";
import { BASELINES } from "./baselines.ts";
import { slopEngineMatcher } from "./enginePack.ts";
import { slopMetrics, type SlopMetrics } from "./metrics.ts";
import { isSafe } from "./oracle.ts";
import { groupOf } from "./persona.ts";
import { VERIFICATION_DEFAULTS, type VerificationModel } from "./snapshot.ts";
import { runSlopWorld, runSlopWorldAsync, type SlopRunResult } from "./world.ts";

export interface ArmResult { arm: string; seeds: number[]; metrics: SlopMetrics[]; extra: Extra[] }
/** Metrics the world's slopMetrics does not compute. */
export interface Extra {
  /** Distinct real members each scammer reached (a reveal) during the run: median over scammers (PRD 40.8: <= 1). */
  scammerMedianReach: number;
  /** Dates and member-months per fairness group (pooled across seeds for the fairness gate). */
  groups: Record<string, { dates: number; memberMonths: number }>;
  /** The same, over FEASIBLE members only: real members with at least one stated-mutual real partner at the start. */
  feasibleGroups: Record<string, { dates: number; memberMonths: number }>;
  overall: { dates: number; memberMonths: number };
  asksSent: number; asksAnswered: number;
  /**
   * Low-variance companions of the realized rates (for tuning; the gates use the realized ones):
   * mean oracle soft label over the dates that happened (pSecond, 32 chemistry draws; 0 with an
   * adversary or a minor), and its sum (expected second dates).
   */
  softSecondRate: number; softSecondDates: number;
}

const WEEKS_PER_MONTH = 4.345;

export function extraOf(res: SlopRunResult, m: SlopMetrics): Extra {

  const reach = new Map<MemberId, Set<MemberId>>();
  for (const p of res.world.personas) if (p.hidden.adversary === "romance_scammer") reach.set(p.id, new Set());
  for (const f of res.flows) {
    if (!f.revealed) continue;
    for (const [x, y] of [[f.first, f.partner], [f.partner, f.first]] as const) reach.get(x)?.add(y);
  }
  const rs = [...reach.values()].map(s => s.size).sort((a, b) => a - b);
  const months = res.world.weeks / WEEKS_PER_MONTH;
  const groups: Extra["groups"] = {};
  for (const [k, g] of Object.entries(m.fairness.byGroup)) groups[k] = { dates: g.datesPerMemberMonth * g.n * months, memberMonths: g.n * months };

  // Feasible members: at least one other real member inside the stated filters both ways (week 0).
  const O = res.world.oracle, real = res.world.personas.filter(isSafe);
  const datesOf = new Map<MemberId, number>();
  for (const f of res.flows) if (f.stage === "date") for (const id of [f.first, f.partner]) datesOf.set(id, (datesOf.get(id) ?? 0) + 1);
  const feasibleGroups: Extra["feasibleGroups"] = {};
  for (const p of real) {
    if (!real.some(q => O.statedMutual(p, q, 0))) continue;
    const g = (feasibleGroups[groupOf(p)] ??= { dates: 0, memberMonths: 0 });
    g.dates += datesOf.get(p.id) ?? 0; g.memberMonths += months;
  }
  let soft = 0, nd = 0;
  for (const f of res.flows) if (f.stage === "date") { nd++; soft += res.world.oracle.softLabel(f.first, f.partner, f.activity, 32).pSecond; }
  return {
    softSecondRate: nd ? soft / nd : 0, softSecondDates: soft,
    scammerMedianReach: rs.length ? rs[Math.floor((rs.length - 1) / 2)]! : 0,
    groups, feasibleGroups, overall: { dates: m.datesPerMemberMonth * m.members * months, memberMonths: m.members * months },
    asksSent: res.asks?.sent ?? 0, asksAnswered: res.asks?.answered ?? 0,
  };
}

export async function runArm(arm: string, seeds: number[], weeks: number, perCity: number, options?: object, verification?: VerificationModel): Promise<ArmResult> {
  const out: ArmResult = { arm, seeds, metrics: [], extra: [] };
  for (const seed of seeds) {
    const res = arm in BASELINES && !options
      ? runSlopWorld({ seed, perCity, weeks, matcher: BASELINES[arm as keyof typeof BASELINES] as never, ...(verification ? { verification } : {}) })
      : await runSlopWorldAsync({ seed, perCity, weeks, matcher: slopEngineMatcher({ name: arm, options: options ?? {}, seed }), ...(verification ? { verification } : {}) });
    const m = slopMetrics(res);
    out.metrics.push(m);
    out.extra.push(extraOf(res, m));
  }
  return out;
}

export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
export const se = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1) / Math.max(1, xs.length)); };
const harms = (m: SlopMetrics) => Object.values(m.safety.harms).reduce((a, b) => a + (b ?? 0), 0);

/**
 * Pooled fairness: each group's dates per member-month over the overall rate (groups with n >= 15
 * per seed on average). `feasible`: both sides over members who have at least one stated-mutual
 * partner (a member whose stated filters admit nobody cannot be served by any matcher).
 */
export function fairnessRatios(a: ArmResult, feasible = false): { byGroup: Record<string, { n: number; rate: number; ratio: number }>; min: number; minGroup: string } {
  const G = (e: Extra) => (feasible ? e.feasibleGroups : e.groups);
  const all = a.extra.reduce((s, e) => { for (const g of Object.values(G(e))) { s.dates += g.dates; s.mm += g.memberMonths; } return s; }, { dates: 0, mm: 0 });
  const overall = all.dates / all.mm;
  const keys = new Set(a.extra.flatMap(e => Object.keys(G(e))));
  const byGroup: Record<string, { n: number; rate: number; ratio: number }> = {};
  const months = a.metrics[0]!.weeks / WEEKS_PER_MONTH;
  for (const k of [...keys].sort()) {
    const d = a.extra.reduce((s, e) => s + (G(e)[k]?.dates ?? 0), 0), mm = a.extra.reduce((s, e) => s + (G(e)[k]?.memberMonths ?? 0), 0);
    const n = mm / months / a.seeds.length;
    byGroup[k] = { n, rate: d / mm, ratio: d / mm / overall };
  }
  const elig = Object.entries(byGroup).filter(([, g]) => g.n >= 15);
  const [minGroup, minG] = elig.sort((x, y) => x[1].ratio - y[1].ratio)[0] ?? ["-", { ratio: 0 }];
  return { byGroup, min: minG.ratio, minGroup };
}

export interface Gate { name: string; value: number; target: string; pass: boolean }
/** The launch gates for "matches go well" (docs/results/2026-10-08-slop-pack.md section 3). */
export function gates(a: ArmResult, random: ArmResult): Gate[] {
  const M = (f: (m: SlopMetrics) => number, r = a) => mean(r.metrics.map(f));
  const sdr = M(m => m.secondDateRate), sdrR = M(m => m.secondDateRate, random);
  const sec = M(m => m.secondDateRate * m.dates), secR = M(m => m.secondDateRate * m.dates, random);
  const adv = M(m => m.safety.adversaryContacts), advR = M(m => m.safety.adversaryContacts, random);
  const hm = M(harms), hmR = M(harms, random);
  const fair = fairnessRatios(a), fairF = fairnessRatios(a, true);
  return [
    { name: "Declared-minor contacts", value: M(m => m.safety.minorContacts), target: "= 0", pass: a.metrics.every(m => m.safety.minorContacts === 0) },
    { name: "Hidden-minor contacts once flagged (age liars)", value: M(m => m.safety.undisclosedMinorContacts), target: "report", pass: true },
    { name: "Adversary contacts cut vs random", value: 1 - adv / advR, target: ">= 90%", pass: 1 - adv / advR >= 0.9 },
    { name: "Harm events cut vs random", value: 1 - hm / hmR, target: ">= 90%", pass: 1 - hm / hmR >= 0.9 },
    { name: "Scammer median reach (PRD 40.8)", value: mean(a.extra.map(e => e.scammerMedianReach)), target: "<= 1", pass: mean(a.extra.map(e => e.scammerMedianReach)) <= 1 },
    { name: "Second-date rate vs random", value: sdr / sdrR, target: ">= 2.5x (and >= 20%)", pass: sdr / sdrR >= 2.5 && sdr >= 0.2 },
    { name: "Second dates per seed vs random", value: sec / secR, target: ">= 2x", pass: sec / secR >= 2 },
    { name: "Top-10% share of proposals", value: M(m => m.congestion.top10ProposalShare), target: "<= 20%", pass: M(m => m.congestion.top10ProposalShare) <= 0.2 },
    { name: `Min group dates/member-month vs overall (${fair.minGroup})`, value: fair.min, target: ">= 0.7x", pass: fair.min >= 0.7 },
    { name: `Same, feasible members only (${fairF.minGroup})`, value: fairF.min, target: ">= 0.7x", pass: fairF.min >= 0.7 },
    { name: "Back-outs at reveal", value: M(m => m.backoutRate), target: "< 10%", pass: M(m => m.backoutRate) < 0.1 },
    { name: "Dates per member-month vs random", value: M(m => m.datesPerMemberMonth) / M(m => m.datesPerMemberMonth, random), target: ">= 0.9x", pass: M(m => m.datesPerMemberMonth) / M(m => m.datesPerMemberMonth, random) >= 0.9 },
    { name: "Stated-filter violations", value: M(m => m.filterViolations), target: "= 0", pass: a.metrics.every(m => m.filterViolations === 0) },
  ];
}

export const ROWS: [string, (m: SlopMetrics) => number, boolean, number?][] = [
  ["Proposals / seed", m => m.proposals, false, 0],
  ["Probes delivered / seed", m => m.probesDelivered, false, 0],
  ["Dropped at a cap / seed", m => m.droppedForCap, false, 0],
  ["Mutual-yes rate", m => m.mutualYesRate, true],
  ["Back-out at reveal", m => m.backoutRate, true],
  ["Attendance (dates / booked)", m => m.attendance, true],
  ["Dates / seed", m => m.dates, false, 1],
  ["Dates per member-month", m => m.datesPerMemberMonth, false, 3],
  ["Good-date rate", m => m.goodDateRate, true],
  ["**Second-date rate (per date)**", m => m.secondDateRate, true],
  ["**Second dates / seed**", m => m.secondDateRate * m.dates, false, 1],
  ["Mean date quality", m => m.meanQuality, false, 3],
  ["Seats at a not-free time", m => m.seatsNotFree, true],
  ["Stated-filter violations / seed", m => m.filterViolations, false, 1],
  ["Members with a date", m => m.timeToFirstDate.shareWithDate, true],
  ["Median days to first date", m => m.timeToFirstDate.medianDays ?? NaN, false, 1],
  ["Top-10% share of proposals", m => m.congestion.top10ProposalShare, true],
  ["Zero-proposal share", m => m.congestion.zeroProposalShare, true],
  ["Gini, proposals", m => m.congestion.giniProposals, false, 3],
  ["Gini, probes received", m => m.congestion.giniProbes, false, 3],
  ["Declared-minor contacts (must be 0)", m => m.safety.minorContacts, false, 1],
  ["Hidden-minor contacts (age liars) / seed", m => m.safety.undisclosedMinorContacts, false, 1],
  ["Adversary contacts (reveals) / seed", m => m.safety.adversaryContacts, false, 1],
  ["Harm events / seed", harms, false, 1],
];

export function fmt(xs: number[], pct = false, d = 2): string {
  return pct ? `${(mean(xs) * 100).toFixed(1)}% ± ${(se(xs) * 100).toFixed(1)}` : `${mean(xs).toFixed(d)} ± ${se(xs).toFixed(d)}`;
}

export function table(arms: ArmResult[]): string {
  const lines = [`| Metric (mean ± SE, seeds ${arms[0]!.seeds.join(",")}) | ${arms.map(a => a.arm).join(" | ")} |`, `|---|${arms.map(() => "---:").join("|")}|`];
  for (const [label, f, pct, d] of ROWS) lines.push(`| ${label} | ${arms.map(a => fmt(a.metrics.map(f), pct, d)).join(" | ")} |`);
  lines.push(`| Soft second-date rate (oracle pSecond of dates held) | ${arms.map(a => fmt(a.extra.map(e => e.softSecondRate), true)).join(" | ")} |`);
  lines.push(`| Soft second dates / seed | ${arms.map(a => fmt(a.extra.map(e => e.softSecondDates), false, 1)).join(" | ")} |`);
  lines.push(`| Scammer median reach | ${arms.map(a => mean(a.extra.map(e => e.scammerMedianReach)).toFixed(2)).join(" | ")} |`);
  lines.push(`| Asks sent / answered per seed | ${arms.map(a => `${mean(a.extra.map(e => e.asksSent)).toFixed(0)} / ${mean(a.extra.map(e => e.asksAnswered)).toFixed(0)}`).join(" | ")} |`);
  lines.push(`| Min group ratio (pooled; group) | ${arms.map(a => { const f = fairnessRatios(a); return `${f.min.toFixed(2)} (${f.minGroup})`; }).join(" | ")} |`);
  lines.push(`| Min group ratio, feasible members (pooled) | ${arms.map(a => { const f = fairnessRatios(a, true); return `${f.min.toFixed(2)} (${f.minGroup})`; }).join(" | ")} |`);
  return lines.join("\n");
}

if (import.meta.main) {
  const argv = process.argv;
  const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1]! : d; };
  const all = (k: string) => argv.flatMap((x, i) => (x === `--${k}` ? [argv[i + 1]!] : []));
  const [s0, s1] = arg("seeds", "1-4")!.split("-").map(Number);
  const seeds = Array.from({ length: (s1 ?? s0!) - s0! + 1 }, (_, i) => s0! + i);
  const weeks = Number(arg("weeks", "4")), perCity = Number(arg("per-city", "300"));
  const arms = arg("arms", "random,greedy,oracle,slop")!.split(",").filter(Boolean);
  const variants = all("variant"), names = all("variant-name");
  // --verification: the world models PRD 40.5 verification for the slop arms (variants) only; the
  // baselines stay the world-doc baselines (no verification), so "cut vs random" is vs today's floor.
  const verification = argv.includes("--verification") ? VERIFICATION_DEFAULTS : undefined;
  const results: ArmResult[] = [];
  for (const a of arms) { const t = performance.now(); results.push(await runArm(a, seeds, weeks, perCity, a === "slop" ? {} : undefined, a === "slop" ? verification : undefined)); console.error(`${a}: ${((performance.now() - t) / 1000).toFixed(1)}s`); }
  for (let i = 0; i < variants.length; i++) { const t = performance.now(); results.push(await runArm(names[i] ?? `v${i}`, seeds, weeks, perCity, JSON.parse(variants[i]!), verification)); console.error(`${names[i] ?? `v${i}`}: ${((performance.now() - t) / 1000).toFixed(1)}s`); }
  console.log(table(results));
  const random = results.find(r => r.arm === "random");
  if (random) for (const r of results.filter(x => x.arm !== "random")) {
    console.log(`\nGates: ${r.arm}`);
    for (const g of gates(r, random)) console.log(`  ${g.pass ? "PASS" : "FAIL"}  ${g.name}: ${g.name.includes("cut") ? (g.value * 100).toFixed(1) + "%" : g.value.toFixed(3)} (${g.target})`);
  }
  if (argv.includes("--groups")) for (const r of results) {
    const f = fairnessRatios(r);
    console.log(`\nGroups ${r.arm}: ` + Object.entries(f.byGroup).map(([k, g]) => `${k} n${g.n.toFixed(0)} ${g.rate.toFixed(3)} (${g.ratio.toFixed(2)})`).join("; "));
  }
  const out = arg("json");
  if (out) await Bun.write(out, JSON.stringify(results.map(r => ({ arm: r.arm, seeds: r.seeds, metrics: r.metrics, extra: r.extra })), null, 1));
}
