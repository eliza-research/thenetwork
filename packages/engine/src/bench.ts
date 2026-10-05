// Benchmark: `bun run packages/engine/src/bench.ts [members] [seed]`. Generates a random world
// and runs the PRODUCTION code path (runEngine) on it (ME-009), then reports runtime, proposals
// by generator, exposure concentration, and the filter funnel.
import { runEngine, type EngineResult } from "./engine.ts";
import { randomWorld } from "./testkit.ts";

export async function runBench(opts: { members?: number; seed?: number; repeats?: number } = {}): Promise<{ result: EngineResult; report: string; ms: number[] }> {
  const members = opts.members ?? 300, seed = opts.seed ?? 42, repeats = opts.repeats ?? 1;
  const world = randomWorld({ members, seed });
  const ms: number[] = [];
  let result!: EngineResult;
  for (let i = 0; i < repeats; i++) {
    const t = performance.now();
    result = await runEngine(world, { seed });
    ms.push(performance.now() - t);
  }
  const { proposals, runLog } = result;
  const f = runLog.funnel, fair = runLog.fairness;
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
  const sortedMs = [...ms].sort((a, b) => a - b);
  const lines: string[] = [];
  lines.push(`World: ${members} members, ${world.intents.length} intents, ${world.facets.length} facets, ${world.edges.length} edges, ${world.events?.length ?? 0} events (seed ${seed})`);
  lines.push(`Runtime: median ${sortedMs[Math.floor(sortedMs.length / 2)]!.toFixed(1)} ms over ${repeats} run(s); stages ${JSON.stringify(Object.fromEntries(Object.entries(runLog.timingsMs).filter(([k]) => !k.startsWith("gen:"))))}`);
  lines.push(`Config hash ${runLog.configHash}, input hash ${runLog.inputHash}, run ${runLog.runId}`);
  lines.push("");
  lines.push(`Proposals: ${proposals.length} (exploration ${f.exploration} = ${pct(proposals.length ? f.exploration / proposals.length : 0)})`);
  lines.push("Proposals by generator (candidates generated -> selected):");
  for (const g of Object.keys(f.byGenerator)) lines.push(`  ${g.padEnd(22)} ${String(f.byGenerator[g]).padStart(5)} -> ${runLog.proposalsByGenerator[g] ?? 0}`);
  const byKind: Record<string, number> = {};
  for (const p of proposals) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
  lines.push(`Proposals by kind: ${JSON.stringify(byKind)}`);
  const sizes: Record<string, number> = {};
  for (const p of proposals) sizes[p.participants.length] = (sizes[p.participants.length] ?? 0) + 1;
  lines.push(`Participants per proposal: ${JSON.stringify(sizes)}`);
  lines.push("");
  lines.push("Exposure / fairness (ME-012):");
  lines.push(`  eligible members ${fair.eligibleMembers}, with >=1 proposal ${fair.membersWithProposal} (${pct(1 - fair.zeroExposureShare)}), viable coverage ${pct(fair.viableCoverage)}`);
  lines.push(`  Gini ${fair.gini.toFixed(3)}, top-10% share ${pct(fair.top10Share)}, max per member ${fair.maxPerMember}`);
  lines.push(`  Lorenz (bottom 10%..100%): ${fair.lorenz.map(x => x.toFixed(2)).join(" ")}`);
  lines.push(`  newcomer share ${pct(fair.newcomerShare)}, newcomer coverage ${pct(fair.newcomerCoverage)}, low-exposure coverage ${pct(fair.lowExposureCoverage)}`);
  lines.push(`  by city ${JSON.stringify(fair.byCity)}; blocking pairs (diagnostic) ${runLog.blockingPairs}`);
  lines.push("");
  lines.push("Filter funnel:");
  lines.push(`  members (first failing member-level filter): ${JSON.stringify(f.memberFunnel)}`);
  lines.push(`  generated ${f.generated}`);
  for (const [r, n] of Object.entries(f.rejectedBy).sort((a, b) => b[1] - a[1])) lines.push(`    - ${r.padEnd(28)} ${n}`);
  lines.push(`  passed hard filters ${f.passedHardFilters}`);
  lines.push(`    - duplicate participant sets ${f.deduped}`);
  lines.push(`    - floors ${JSON.stringify(f.floorViolations)}, dealbreakers ${f.dealbreakers}`);
  lines.push(`    - below threshold ${f.belowThreshold}`);
  lines.push(`  eligible ${f.eligible}`);
  lines.push(`    - not selected (budgets / load / pair reuse / caps) ${f.budgetSkips}`);
  lines.push(`  selected ${f.selected}`);
  lines.push(`  empty-state intents (>= 10 days, nothing proposed): ${runLog.emptyStates.length} ${JSON.stringify(countBy(runLog.emptyStates.map(e => e.reason)))}`);
  return { result, report: lines.join("\n"), ms };
}

function countBy(xs: string[]) { const o: Record<string, number> = {}; for (const x of xs) o[x] = (o[x] ?? 0) + 1; return o; }

if (import.meta.main) {
  const members = Number(process.argv[2] ?? 300), seed = Number(process.argv[3] ?? 42);
  const { report } = await runBench({ members, seed, repeats: 5 });
  console.log(report);
}
