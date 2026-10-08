// Calibration sweep for the oracle (docs/results/2026-10-08-slop-world.md "Calibration"). Prints
// random-within-filters vs oracle-optimal rates for a grid of ORACLE_PARAMS overrides.
//   bun run packages/worlds/src/slop/calibrate.ts --seeds 1-4 --grid '{"dateLift":[0.5,1],"wantSecond":[0.5,0.55]}'
import { BASELINES } from "./baselines.ts";
import { slopMetrics } from "./metrics.ts";
import { ORACLE_PARAMS } from "./oracle.ts";
import { runSlopWorld } from "./world.ts";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1]! : d; };
const [s0, s1] = arg("seeds", "1-4")!.split("-").map(Number);
const seeds = Array.from({ length: (s1 ?? s0!) - s0! + 1 }, (_, i) => s0! + i);
const grid = JSON.parse(arg("grid", "{}")!) as Record<string, number[]>;
const keys = Object.keys(grid);
const combos: Record<string, number>[] = keys.reduce<Record<string, number>[]>((acc, k) => acc.flatMap(c => grid[k]!.map(v => ({ ...c, [k]: v }))), [{}]);
const base = { ...ORACLE_PARAMS };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
for (const c of combos) {
  Object.assign(ORACLE_PARAMS, base, c);
  const row: string[] = [];
  for (const name of ["random", "greedy", "oracle"] as const) {
    const ms = seeds.map(seed => slopMetrics(runSlopWorld({ seed, perCity: Number(arg("per-city", "300")), matcher: BASELINES[name] as any })));
    row.push(`${name}: good ${(mean(ms.map(m => m.goodDateRate)) * 100).toFixed(1)}% second ${(mean(ms.map(m => m.secondDateRate)) * 100).toFixed(1)}% dates ${mean(ms.map(m => m.dates)).toFixed(0)} backout ${(mean(ms.map(m => m.backoutRate)) * 100).toFixed(1)}% att ${(mean(ms.map(m => m.attendance)) * 100).toFixed(0)}%`);
  }
  console.log(JSON.stringify(c), "\n  " + row.join("\n  "));
}

// ---- diagnostics against the research grounding (--diag) -------------------------------------
if (process.argv.includes("--diag")) {
  const { createSlopWorld } = await import("./world.ts");
  const { isSafe } = await import("./oracle.ts");
  const { TASTE_DIMS } = await import("./persona.ts");
  Object.assign(ORACLE_PARAMS, base);
  const w = createSlopWorld({ seed: 1, perCity: 300 });
  const O = w.oracle, ps = w.personas.filter(isSafe);
  const sorted = [...ps].sort((a, b) => a.hidden.desirability - b.hidden.desirability);
  const pct = new Map(sorted.map((p, i) => [p.id, (i + 0.5) / sorted.length]));
  let likes = 0, up = 0, mutualW = 0, pairs = 0, upLikes = 0, upReplies = 0;
  const rel: { stated: number; taste: number; relc: number }[] = [];
  const P = ORACLE_PARAMS;
  for (const a of ps) for (const b of ps) {
    if (!O.statedMutual(a, b, 0)) continue;
    const ab = O.attraction(a, b), ba = O.attraction(b, a);
    pairs++; likes += ab; mutualW += ab * ba;
    up += ab * (pct.get(b.id)! - pct.get(a.id)!);
    if (pct.get(b.id)! > pct.get(a.id)!) { upLikes += ab; upReplies += ab * ba; }
    if (a.id < b.id && rel.length < 20000) {
      let taste = 0, stated = 0;
      for (let i = 0; i < TASTE_DIMS.length; i++) { taste += a.hidden.taste[i]! * b.hidden.traits[i]!; stated += a.stated.wantsTraits[i]! * b.stated.selfTraits[i]!; }
      rel.push({ stated, taste: P.wTaste * taste, relc: P.wTaste * taste + O.chemistry(a.id, b.id) });
    }
  }
  const corr = (x: number[], y: number[]) => { const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i]! - mx) * (y[i]! - my); sxx += (x[i]! - mx) ** 2; syy += (y[i]! - my) ** 2; } return sxy / Math.sqrt(sxx * syy); };
  console.log(`stated-mutual ordered pairs ${pairs}`);
  console.log(`profile like rate (mean attraction) ${(likes / pairs * 100).toFixed(1)}%`);
  console.log(`reply rate to a like (P(b likes a | a likes b)) ${(mutualW / likes * 100).toFixed(1)}%; to an upward like ${(upReplies / upLikes * 100).toFixed(1)}%`);
  console.log(`mean desirability-percentile gap of liked targets ${(up / likes * 100).toFixed(1)} points (share of likes that go up: ${(upLikes / likes * 100).toFixed(1)}%)`);
  // Soft labels (Monte Carlo over chemistry, 64 draws) for 3,000 random honest stated-mutual pairs.
  let k = 0, sg = 0, ss = 0;
  for (let i = 0; i < ps.length && k < 3000; i += 3) for (let j = i + 1; j < ps.length && k < 3000; j += 2) {
    if (!O.statedMutual(ps[i]!, ps[j]!, 0)) continue;
    const s = O.softLabel(ps[i]!.id, ps[j]!.id, undefined, 64); sg += s.pGood; ss += s.pSecond; k++;
  }
  console.log(`random honest stated-mutual pairs (n=${k}): mean pGood ${(sg / k * 100).toFixed(1)}%, mean pSecond ${(ss / k * 100).toFixed(1)}%`);
  const r2s = corr(rel.map(r => r.stated), rel.map(r => r.relc)) ** 2, r2t = corr(rel.map(r => r.taste), rel.map(r => r.relc)) ** 2;
  console.log(`relationship component (taste + chemistry): R² from STATED type ${(r2s * 100).toFixed(1)}%, from hidden taste (oracle) ${(r2t * 100).toFixed(1)}%`);
}
