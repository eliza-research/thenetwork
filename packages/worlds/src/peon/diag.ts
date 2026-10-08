// Funnel diagnostics for calibration (development aid). bun run packages/worlds/src/peon/diag.ts [seed] [arms]
import { BASELINES, peonMetrics, runPeonWorld } from "./index.ts";
const seed = Number(process.argv[2] ?? 1);
const arms = (process.argv[3] ?? "keyword,pack,oracle").split(",");
for (const name of arms) {
  const r = await runPeonWorld({ seed, matcher: (BASELINES as any)[name] });
  const d = r.flows.filter(f => f.delivered);
  const q = (fs: typeof d) => `${fs.length} (q ${fs.filter(f => f.qualified).length})`;
  const m = peonMetrics(r);
  console.log(`${name}: delivered ${q(d)} applied ${q(d.filter(f => f.yes))} reviewed ${q(d.filter(f => f.reviewed))} empYes ${q(d.filter(f => f.employerYes))} interviewed ${q(d.filter(f => f.interviewed))} passed ${q(d.filter(f => f.passed))} offered ${q(d.filter(f => f.offered))} hired ${q(d.filter(f => f.hired))} expired ${d.filter(f => f.expired).length} withdrawn ${d.filter(f => f.withdrawn).length}`);
  console.log(`   hires ${m.hires} ivph ${m.interviewsPerHire.toFixed(1)} offer/iv ${(m.offerRatePerInterview * 100).toFixed(1)}% accept ${(m.acceptRate * 100).toFixed(0)}% fill ${(m.fillRate * 100).toFixed(0)}% ttf ${m.medianTimeToFill} ret ${(m.retention90 * 100).toFixed(0)}% ua hires ${m.underApplied.hires} zeroIntro ${(m.congestion.zeroIntroCandidateShare * 100).toFixed(0)}% gini ${m.congestion.giniApplicationsPerJob.toFixed(2)} impAuto ${m.impact.minAutomated.toFixed(2)} impHuman ${m.impact.minHuman.toFixed(2)} scamReach ${m.safety.scamReach}`);
  console.log("   ratios", JSON.stringify(m.impact.ratio));
}
