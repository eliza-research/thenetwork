import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { enableCompileCache } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { withFormalCache } from "../tools/vibestack/vibestack/cache.ts";
import type { Model } from "../tools/vibestack/vibestack/gen.ts";
import { generated, readSpecs, show, typecheckAll, type Spec } from "../tools/vibestack/vibestack/pipeline.ts";
import { simulation, type Simulation } from "../tools/vibestack/vibestack/simulate.ts";
import { profile } from "../tools/vibestack/vibestack/testing/profile.ts";
import { assertUnchanged, formalFiles, prepareProject, root } from "./vibestack.ts";

// Use historical summed Quint subprocess seconds to give both runners a similar load.
const weights: Record<string, number> = JSON.parse(readFileSync(join(import.meta.dirname, "formal-shard-weights.json"), "utf8"));
const weight = (spec: Spec) => weights[spec.name] ?? 8;

function shardOf(specs: Spec[], index: number, count: number): Spec[] {
  const bins = Array.from({ length: count }, () => ({ seconds: 0, specs: [] as Spec[] }));
  const ordered = [...specs].sort((a, b) => weight(b) - weight(a) || a.name.localeCompare(b.name, "en"));
  for (const spec of ordered) {
    const lane = bins.reduce((least, bin) => bin.seconds < least.seconds ? bin : least);
    lane.seconds += weight(spec);
    lane.specs.push(spec);
  }
  return bins[index - 1].specs;
}

function withImports(targets: Spec[], specs: Spec[]): Spec[] {
  const byName = new Map(specs.map(spec => [spec.name, spec]));
  const selected = new Map<string, Spec>();
  const add = (spec: Spec) => {
    if (selected.has(spec.name)) return;
    for (const name of spec.imports) add(byName.get(name)!);
    selected.set(spec.name, spec);
  };
  for (const target of targets) add(target);
  return [...selected.values()];
}

async function precompute(project: string, targets: Spec[], specs: Spec[]): Promise<boolean> {
  const selected = withImports(targets, specs);
  const targetNames = new Set(targets.map(spec => spec.name));
  const memory = { root: project, fresh: false, used: new Set<string>() };
  const typed = typecheckAll(memory, selected);
  const models = new Map<string, Model>();
  const started: { spec: Spec; result: Promise<Simulation> }[] = [];
  const { seed } = profile("normal");
  try {
    for (const spec of selected) {
      const model = generated(project, spec, await typed.get(spec.name), models);
      if (!targetNames.has(spec.name) || (!model.stateType && !model.laws.length && !model.evals.length)) continue;
      const domain = await import(pathToFileURL(join(project, "gen", `${spec.name}.ts`)).href);
      const result = simulation(memory, spec, specs, model, domain, seed);
      result.catch(() => {});
      started.push({ spec, result });
    }

    let ok = true;
    for (const { spec, result } of started) {
      const { said } = await result;
      console.log(spec.name);
      for (const verdict of said) {
        console.log(show(verdict));
        ok &&= verdict.ok;
      }
    }
    return ok;
  } finally {
    await Promise.allSettled([...typed.values(), ...started.map(({ result }) => result)]);
  }
}

async function main([indexArg, countArg, list, ...extra]: string[]): Promise<number> {
  const index = Number(indexArg);
  const count = Number(countArg);
  if (!/^\d+$/.test(indexArg) || !/^\d+$/.test(countArg) || !Number.isSafeInteger(index) || !Number.isSafeInteger(count)
      || index < 1 || index > count || (list !== undefined && list !== "--list") || extra.length) {
    throw new Error("Usage: node scripts/precompute-formal-shard.ts <shard index, starting at 1> <shard count> [--list]");
  }
  const compiled = enableCompileCache();
  if (compiled.directory) process.env.NODE_COMPILE_CACHE ??= compiled.directory;
  const files = formalFiles();
  const formalCache = join(root, ".spec-cache/formal");
  const project = mkdtempSync(join(tmpdir(), "thenetwork-formal-shard-"));
  try {
    prepareProject(project, files);
    const specs = readSpecs(project);
    if (count > specs.length) throw new Error(`Cannot assign ${specs.length} specs to ${count} nonempty shards`);
    const targets = shardOf(specs, index, count);
    console.log(JSON.stringify({ index, count, totalModels: specs.length, estimatedToolSeconds: Number(targets.reduce((sum, spec) => sum + weight(spec), 0).toFixed(1)), modules: targets.map(spec => spec.name) }));
    if (list === "--list") return 0;
    const ok = await withFormalCache(formalCache, () => precompute(project, targets, specs));
    assertUnchanged(files);
    return ok ? 0 : 1;
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
