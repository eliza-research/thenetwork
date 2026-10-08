// Run the slop.date baselines over seeds and print the table used in
// docs/results/2026-10-08-slop-world.md. No LLM calls.
//   bun run packages/sim/src/apps/slop/cli.ts --seeds 1-8 --per-city 300 --weeks 4 [--only random,greedy,oracle] [--json out.json]
import { BASELINES } from "./baselines.ts";
import { slopMetrics, type SlopMetrics } from "./metrics.ts";
import { runSlopWorld } from "./world.ts";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1]! : d; };
const [s0, s1] = (arg("seeds", "1-8")!).split("-").map(Number);
const seeds = Array.from({ length: (s1 ?? s0!) - s0! + 1 }, (_, i) => s0! + i);
const perCity = Number(arg("per-city", "300")), weeks = Number(arg("weeks", "4"));
const only = (arg("only", "random,greedy,oracle")!).split(",") as (keyof typeof BASELINES)[];

const all: Record<string, SlopMetrics[]> = {};
for (const name of only) {
  all[name] = [];
  for (const seed of seeds) {
    const t = performance.now();
    const m = slopMetrics(runSlopWorld({ seed, perCity, weeks, matcher: BASELINES[name] as any }));
    all[name]!.push(m);
    console.error(`${name} seed ${seed}: dates ${m.dates}, second ${(m.secondDateRate * 100).toFixed(1)}% (${((performance.now() - t) / 1000).toFixed(1)}s)`);
  }
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const se = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1) / xs.length); };
const fmt = (xs: number[], pct = false, d = 2) => pct ? `${(mean(xs) * 100).toFixed(1)}% ± ${(se(xs) * 100).toFixed(1)}` : `${mean(xs).toFixed(d)} ± ${se(xs).toFixed(d)}`;
const rows: [string, (m: SlopMetrics) => number, boolean, number?][] = [
  ["Proposals / seed", m => m.proposals, false, 0],
  ["Probes delivered / seed", m => m.probesDelivered, false, 0],
  ["Dropped at a cap / seed", m => m.droppedForCap, false, 0],
  ["Probe reply rate", m => m.probeReplyRate, true],
  ["Probe yes rate", m => m.probeYesRate, true],
  ["Mutual yes rate", m => m.mutualYesRate, true],
  ["Back-out at reveal", m => m.backoutRate, true],
  ["Date | mutual yes", m => m.dateGivenMutual, true],
  ["Attendance (dates / booked)", m => m.attendance, true],
  ["Dates / seed", m => m.dates, false, 1],
  ["Dates per member-month", m => m.datesPerMemberMonth, false, 3],
  ["Good-date rate", m => m.goodDateRate, true],
  ["Second-date rate (per date)", m => m.secondDateRate, true],
  ["Second dates / seed", m => m.secondDateRate * m.dates, false, 1],
  ["Mean date quality", m => m.meanQuality, false, 3],
  ["Seats at a not-free time", m => m.seatsNotFree, true],
  ["Stated-filter violations / seed", m => m.filterViolations, false, 1],
  ["Gini, probes received", m => m.congestion.giniProbes, false, 3],
  ["Gini, proposals", m => m.congestion.giniProposals, false, 3],
  ["Zero-proposal share", m => m.congestion.zeroProposalShare, true],
  ["Top-10% share of proposals", m => m.congestion.top10ProposalShare, true],
  ["Members with a date", m => m.timeToFirstDate.shareWithDate, true],
  ["Median days to first date", m => m.timeToFirstDate.medianDays ?? NaN, false, 1],
  ["Minor contacts (declared; must be 0)", m => m.safety.minorContacts, false, 1],
  ["Hidden-minor contacts (age liars)", m => m.safety.undisclosedMinorContacts, false, 1],
  ["Adversary proposals / seed", m => m.safety.adversaryProposals, false, 1],
  ["Adversary contacts (reveals) / seed", m => m.safety.adversaryContacts, false, 1],
  ["Harm events / seed", m => Object.values(m.safety.harms).reduce((a, b) => a + (b ?? 0), 0), false, 1],
  ["Fairness: min/max dates ratio (groups n>=15)", m => m.fairness.minMaxDateRatio, false, 2],
];
console.log(`| Metric (mean ± SE over seeds ${seeds.join(",")}; ${perCity}/city x 3 cities; ${weeks} weeks) | ${only.join(" | ")} |`);
console.log(`|---|${only.map(() => "---:").join("|")}|`);
for (const [label, f, pct, d] of rows) console.log(`| ${label} | ${only.map(n => fmt(all[n]!.map(f), pct, d)).join(" | ")} |`);
console.log("\nFairness by matching gender (dates per member-month, share with a date):");
for (const n of only) {
  const g = all[n]![0]!.fairness.byGender;
  console.log(`  ${n}: ` + Object.keys(g).map(k => `${k} ${fmt(all[n]!.map(m => m.fairness.byGender[k]?.datesPerMemberMonth ?? 0), false, 3)} / ${fmt(all[n]!.map(m => m.fairness.byGender[k]?.shareWithDate ?? 0), true)}`).join("; "));
}
console.log("\nFairness by group (dates per member-month; n averaged):");
for (const n of only) {
  const keys = Object.keys(all[n]![0]!.fairness.byGroup);
  console.log(`  ${n}: ` + keys.map(k => `${k} (n≈${Math.round(mean(all[n]!.map(m => m.fairness.byGroup[k]?.n ?? 0)))}) ${mean(all[n]!.map(m => m.fairness.byGroup[k]?.datesPerMemberMonth ?? 0)).toFixed(3)}`).join("; "));
}
const out = arg("json");
if (out) await Bun.write(out, JSON.stringify(all, null, 1));
