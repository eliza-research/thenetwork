// peon.biz launch gates. OFFICIAL: the replacement gates the founder adopted on 2026-10-08
// (docs/results/2026-10-08-peon-pack.md, "Gates"), plus the safety gates that were never in doubt.
// HISTORICAL: the gates first proposed, kept for the record (two were infeasible in a 400 x 80 pilot
// market: even the hidden-truth oracle could not reach them).
// Each gate compares the pack with the keyword job board (and the oracle) on the SAME seeds.
import { poolImpact, type PeonMetrics } from "./metrics.ts";

export interface GateResult { id: string; gate: string; value: string; pass: boolean }
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const M = (xs: PeonMetrics[], f: (m: PeonMetrics) => number) => mean(xs.map(f));
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

export function officialGates(p: PeonMetrics[], k: PeonMetrics[], o?: PeonMetrics[]): GateResult[] {
  const hiresX = M(p, m => m.hires) / M(k, m => m.hires);
  const introsX = M(p, m => m.probesDelivered) / M(k, m => m.probesDelivered);
  const ivX = M(p, m => m.interviewsPerHire) / M(k, m => m.interviewsPerHire);
  const retD = M(p, m => m.retention90) - M(k, m => m.retention90);
  const uaX = M(p, m => m.underApplied.hires) / Math.max(1e-9, M(k, m => m.underApplied.hires));
  const gP = M(p, m => m.congestion.giniApplicationsPerJob), gK = M(k, m => m.congestion.giniApplicationsPerJob);
  const pooled = poolImpact(p.map(m => m.impact));
  const reach = p.flatMap(m => m.safety.scamReachByEmployer);
  const out: GateResult[] = [
    { id: "hires_vs_keyword", gate: "Hires >= 0.9x keyword, with <= 1/5 of its intros", value: `${hiresX.toFixed(2)}x, intros ${introsX.toFixed(2)}x`, pass: hiresX >= 0.9 && introsX <= 0.2 },
  ];
  if (o) { const x = M(p, m => m.hires) / M(o, m => m.hires); out.push({ id: "hires_vs_oracle", gate: "Hires >= 0.8x oracle", value: `${x.toFixed(2)}x`, pass: x >= 0.8 }); }
  out.push(
    { id: "interviews_per_hire", gate: "Interviews per hire <= 0.75x keyword", value: `${ivX.toFixed(2)}x`, pass: ivX <= 0.75 },
    { id: "retention_90d", gate: "90-day retention within 2 points of keyword (or better)", value: `${(retD * 100).toFixed(1)} pt`, pass: retD >= -0.02 },
    { id: "under_applied", gate: "Under-applied hires >= 0.9x keyword, and Gini of applications per job below keyword's", value: `${uaX.toFixed(2)}x; Gini ${gP.toFixed(2)} vs ${gK.toFixed(2)}`, pass: uaX >= 0.9 && gP < gK },
    { id: "impact_ratio", gate: "Impact ratio >= 0.8 for every sealed group at the automated stage (pooled; worst seed shown)", value: `${pooled.minAutomated.toFixed(2)} (worst seed ${Math.min(...p.map(m => m.impact.minAutomated)).toFixed(2)})`, pass: pooled.minAutomated >= 0.8 },
    { id: "scam_reach", gate: "Median reach per scam employer that got an intro <= 1 (max shown)", value: reach.length ? `${median(reach)} (n=${reach.length}, max ${Math.max(...reach)})` : "0 (no scam got an intro)", pass: median(reach) <= 1 },
    { id: "minors", gate: "Minors matched = 0, every seed", value: String(p.reduce((s, m) => s + m.safety.minorsMatched, 0)), pass: p.every(m => m.safety.minorsMatched === 0) },
    { id: "unverified", gate: "Unverified-employer intros = 0", value: String(p.reduce((s, m) => s + m.safety.unverifiedIntros, 0)), pass: p.every(m => m.safety.unverifiedIntros === 0) },
    { id: "pay_range", gate: "Intros to jobs without a pay range = 0", value: String(p.reduce((s, m) => s + m.safety.noRangeIntros, 0)), pass: p.every(m => m.safety.noRangeIntros === 0) },
  );
  return out;
}

/** The first proposed gate set (historical; not the launch criteria). */
export function historicalGates(p: PeonMetrics[], k: PeonMetrics[]): GateResult[] {
  const hiresX = M(p, m => m.hires) / M(k, m => m.hires);
  const uaX = M(p, m => m.underApplied.hires) / Math.max(1e-9, M(k, m => m.underApplied.hires));
  const pooled = poolImpact(p.map(m => m.impact));
  const scamWorst = Math.max(...p.map(m => m.safety.scamReach));
  return [
    { id: "h_hires_2x", gate: "Hires >= 2x keyword", value: `${hiresX.toFixed(2)}x`, pass: hiresX >= 2 },
    { id: "h_ivph", gate: "Interviews per hire <= 12", value: M(p, m => m.interviewsPerHire).toFixed(1), pass: M(p, m => m.interviewsPerHire) <= 12 },
    { id: "h_retention", gate: "90-day retention >= keyword", value: `${(M(p, m => m.retention90) * 100).toFixed(1)}% vs ${(M(k, m => m.retention90) * 100).toFixed(1)}%`, pass: M(p, m => m.retention90) >= M(k, m => m.retention90) },
    { id: "h_impact", gate: "Impact ratio >= 0.8, every sealed group", value: pooled.minAutomated.toFixed(2), pass: pooled.minAutomated >= 0.8 },
    { id: "h_scam", gate: "Scam reach <= 1 per seed (worst seed)", value: String(scamWorst), pass: scamWorst <= 1 },
    { id: "h_under_applied", gate: "Under-applied roles filled >= 1.5x keyword", value: `${uaX.toFixed(2)}x`, pass: uaX >= 1.5 },
    { id: "h_minors", gate: "Minors matched = 0", value: String(p.reduce((s, m) => s + m.safety.minorsMatched, 0)), pass: p.every(m => m.safety.minorsMatched === 0) },
  ];
}
