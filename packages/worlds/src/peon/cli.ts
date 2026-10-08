// Run peon.biz arms over seeds and print the tables in docs/results/2026-10-08-peon-pack.md. No LLM calls.
//   bun run packages/worlds/src/peon/cli.ts --seeds 1-4 [--arms keyword,pack,...] [--per-city 400] [--jobs 80] [--weeks 8] [--json out.json] [--impact]
import { ARMS } from "./arms.ts";
import { peonMetrics, poolImpact, STAGES, type PeonMetrics } from "./metrics.ts";
import { runPeonWorld } from "./world.ts";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1]! : d; };
const [s0, s1] = arg("seeds", "1-4")!.split("-").map(Number);
const seeds = Array.from({ length: (s1 ?? s0!) - s0! + 1 }, (_, i) => s0! + i);
const perCity = Number(arg("per-city", "400")), jobsPerCity = Number(arg("jobs", "80")), weeks = Number(arg("weeks", "8"));
const arms = arg("arms", "keyword,keyword3,greedy,oracle,pack")!.split(",");

const all: Record<string, PeonMetrics[]> = {};
for (const a of arms) {
  const arm = ARMS[a];
  if (!arm) throw new Error(`unknown arm ${a}; known: ${Object.keys(ARMS).join(", ")}`);
  all[a] = [];
  for (const seed of seeds) {
    const restore = arm.setup?.();
    const t = performance.now();
    try {
      const r = await runPeonWorld({ seed, perCity, jobsPerCity, weeks, matcher: arm.matcher });
      all[a]!.push(peonMetrics(r));
    } finally { restore?.(); }
    console.error(`${a} seed ${seed}: hires ${all[a]!.at(-1)!.hires} (${((performance.now() - t) / 1000).toFixed(1)}s)`);
  }
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const se = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1) / xs.length); };
const fmt = (xs: number[], pct = false, d = 1) => (pct ? `${(mean(xs) * 100).toFixed(1)}% ± ${(se(xs) * 100).toFixed(1)}` : `${mean(xs).toFixed(d)} ± ${se(xs).toFixed(d)}`);
type Row = [string, (m: PeonMetrics) => number, boolean, number?];
const rows: Row[] = [
  ["Intros delivered", m => m.probesDelivered, false, 0],
  ["Qualified share of intros", m => m.qualifiedShare, true],
  ["Qualified intros", m => m.qualifiedIntros, false, 0],
  ["Reply rate", m => m.replyRate, true],
  ["Apply rate (yes / replied)", m => m.applyRate, true],
  ["Employer yes / reviewed", m => m.employerYesRate, true],
  ["Applications expired unreviewed", m => m.congestion.expiredApplications, false, 0],
  ["Interviews", m => m.interviews, false, 0],
  ["Offer rate per interview", m => m.offerRatePerInterview, true],
  ["Offer acceptance", m => m.acceptRate, true],
  ["**Hires**", m => m.hires, false],
  ["**Interviews per hire**", m => m.interviewsPerHire, false],
  ["Fill rate (hires / real openings)", m => m.fillRate, true],
  ["Median time-to-fill (days, filled)", m => m.medianTimeToFill, false],
  ["**90-day retention**", m => m.retention90, true],
  ["Quality of hire", m => m.qualityOfHire, false, 3],
  ["Gini, applications per job", m => m.congestion.giniApplicationsPerJob, false, 3],
  ["Top-10% jobs' share of applications", m => m.congestion.top10JobShareOfApplications, true],
  ["Candidates with zero intros", m => m.congestion.zeroIntroCandidateShare, true],
  ["**Under-applied: hires**", m => m.underApplied.hires, false],
  ["Under-applied: jobs filled", m => m.underApplied.jobsFilled, false],
  ["**Impact ratio, automated (min)**", m => m.impact.minAutomated, false, 2],
  ["Impact ratio, human stages (min)", m => m.impact.minHuman, false, 2],
  ["**Scam reach (candidates)**", m => m.safety.scamReach, false],
  ["Scam-job intros", m => m.safety.scamIntros, false],
  ["Unverified-employer intros", m => m.safety.unverifiedIntros, false],
  ["No-pay-range intros", m => m.safety.noRangeIntros, false],
  ["Fake candidates reaching employers", m => m.safety.fakeReachedEmployer, false],
  ["**Minors matched**", m => m.safety.minorsMatched, false, 0],
  ["Discriminatory employers detected (of)", m => m.discrimination.detected, false],
  ["Audit false flags", m => m.discrimination.falseFlags, false],
];
console.log(`| Metric (mean ± SE, seeds ${seeds.join(",")}; ${perCity} candidates + ${jobsPerCity} jobs per city; ${weeks} weeks) | ${arms.map(a => ARMS[a]!.name).join(" | ")} |`);
console.log(`|---|${arms.map(() => "---:").join("|")}|`);
for (const [label, f, pct, d] of rows) console.log(`| ${label} | ${arms.map(a => fmt(all[a]!.map(f), pct, d)).join(" | ")} |`);

// ---- gates (the pack against keyword on the same seeds) -----------------------------------------
if (all.pack && all.keyword) {
  const p = all.pack, k = all.keyword;
  const pooled = poolImpact(p.map(m => m.impact));
  const gates: [string, string, boolean][] = [
    ["Hires >= 2x keyword", `${(mean(p.map(m => m.hires)) / mean(k.map(m => m.hires))).toFixed(2)}x`, mean(p.map(m => m.hires)) >= 2 * mean(k.map(m => m.hires))],
    ["Interviews per hire <= 12", mean(p.map(m => m.interviewsPerHire)).toFixed(1), mean(p.map(m => m.interviewsPerHire)) <= 12],
    ["90-day retention >= keyword", `${(mean(p.map(m => m.retention90)) * 100).toFixed(1)}% vs ${(mean(k.map(m => m.retention90)) * 100).toFixed(1)}%`, mean(p.map(m => m.retention90)) >= mean(k.map(m => m.retention90))],
    ["Impact ratio >= 0.8, every sealed group (automated stage; pooled / worst seed)", `${pooled.minAutomated.toFixed(2)} / ${Math.min(...p.map(m => m.impact.minAutomated)).toFixed(2)}`, pooled.minAutomated >= 0.8],
    ["Scam reach <= 1 per seed (worst seed)", String(Math.max(...p.map(m => m.safety.scamReach))), Math.max(...p.map(m => m.safety.scamReach)) <= 1],
    ["Under-applied roles filled >= 1.5x keyword (hires)", `${(mean(p.map(m => m.underApplied.hires)) / Math.max(1e-9, mean(k.map(m => m.underApplied.hires)))).toFixed(2)}x`, mean(p.map(m => m.underApplied.hires)) >= 1.5 * mean(k.map(m => m.underApplied.hires))],
    ["Minors matched = 0 (all seeds)", String(p.reduce((s, m) => s + m.safety.minorsMatched, 0)), p.every(m => m.safety.minorsMatched === 0)],
    ["Unverified-employer intros = 0", String(p.reduce((s, m) => s + m.safety.unverifiedIntros, 0)), p.every(m => m.safety.unverifiedIntros === 0)],
    ["No-pay-range intros = 0", String(p.reduce((s, m) => s + m.safety.noRangeIntros, 0)), p.every(m => m.safety.noRangeIntros === 0)],
  ];
  console.log("\n| Gate | pack | pass |\n|---|---:|---|");
  for (const [g, v, ok] of gates) console.log(`| ${g} | ${v} | ${ok ? "pass" : "FAIL"} |`);
}

if (process.argv.includes("--impact")) {
  for (const a of arms) {
    const pooled = poolImpact(all[a]!.map(m => m.impact));
    console.log(`\nImpact ratios, ${ARMS[a]!.name} (pooled over seeds; groups with n >= 30 per seed):`);
    const attrs = Object.keys(pooled.ratio[STAGES[0]]!);
    console.log(`| Stage | ${attrs.join(" | ")} |\n|---|${attrs.map(() => "---:").join("|")}|`);
    for (const st of STAGES) console.log(`| ${st} | ${attrs.map(x => (pooled.ratio[st]![x] ?? 1).toFixed(2)).join(" | ")} |`);
    console.log("Selection rates (offered|assessed / hired|active) by group:");
    for (const attr of ["sex", "race", "age40", "disability", "caregiver"]) {
      const g1 = pooled.rates["offered|assessed"]![attr]!, g2 = pooled.rates["hired|active"]![attr]!;
      console.log(`  ${attr}: ${Object.keys(g1).sort().map(v => `${v} ${(g1[v]!.rate * 100).toFixed(1)}% (n ${g1[v]!.n}) / ${((g2[v]?.rate ?? 0) * 100).toFixed(1)}%`).join("; ")}`);
    }
  }
}
const out = arg("json");
if (out) await Bun.write(out, JSON.stringify(all, null, 1));
