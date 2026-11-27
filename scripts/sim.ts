import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writePath } from "../packages/core/src/runtime/files.ts";
import { Block, type Gate } from "./sim/gate.ts";

type Opts = { quick: boolean; llm: boolean; transcripts: boolean; matchingPack?: string };
const BLOCKS: Record<string, (b: Block, o: Opts) => Promise<void>> = {
  evals: async (b) => (await import("./sim/evals.ts")).evalsBlock(b),
  network: async (b, o) => (await import("./sim/network.ts")).networkBlock(b, o),
  matching: async (b, o) => (await import("./sim/matching.ts")).matchingBlock(b, o),
  slop: async (b, o) => (await import("./sim/slop.ts")).slopBlock(b, o),
  onboard: async (b, o) => (await import("./sim/onboard.ts")).onboardBlock(b, o),
  relay: async (b) => (await import("./sim/relay.ts")).relayBlock(b),
  peon: async (b, o) => (await import("./sim/peon.ts")).peonBlock(b, o),
  "peon-seats": async (b) => (await import("./sim/peon-seats.ts")).peonSeatsBlock(b),
  friends: async (b, o) => (await import("./sim/friends.ts")).friendsBlock(b, o),
  pipeline: async (b) => (await import("./sim/pipeline.ts")).pipelineBlock(b),
  "pipeline-slop": async (b) => (await import("./sim/pipeline-slop.ts")).pipelineSlopBlock(b),
  safety: async (b) => (await import("./sim/safety.ts")).safetyBlock(b),
  ops: async (b) => (await import("./sim/ops.ts")).opsBlock(b),
  clef: async (b) => (await import("./sim/clef.ts")).clefBlock(b),
  "five-city": async (b, o) => (await import("./sim/five-city.ts")).fiveCityBlock(b, o),
  audit: async (b) => (await import("./sim/audit.ts")).auditBlock(b),
  capital: async (b, o) => (await import("./sim/capital.ts")).capitalBlock(b, o),
};
const DEFAULT = ["evals", "onboard", "network", "matching", "slop", "relay", "peon", "peon-seats", "friends", "clef", "five-city", "safety", "ops", "pipeline", "pipeline-slop", "audit"];
const PG_BLOCKS = new Set(["safety", "ops", "pipeline", "pipeline-slop", "audit"]);

const argv = process.argv.slice(2);
const values = (k: string) => argv.flatMap((x, i) => (x === `--${k}` ? (argv[i + 1] ?? "").split(",") : x.startsWith(`--${k}=`) ? x.slice(k.length + 3).split(",") : []));
const only = [...new Set(values("only").map(name => name.trim()))];
const skip = [...new Set(values("skip").map(name => name.trim()))];
const unknown = [...new Set([...only, ...skip])].filter(x => !Object.hasOwn(BLOCKS, x)).map(name => name || "<empty>");
if (unknown.length) { console.error(`unknown block: ${unknown.join(", ")}; known: ${Object.keys(BLOCKS).join(", ")}`); process.exit(2); }
if (only.length && skip.length) { console.error("Choose --only or --skip."); process.exit(2); }
const run = only.length ? only : [...DEFAULT, ...(argv.includes("--with-capital") || argv.includes("--nightly") ? ["capital"] : [])].filter(name => !skip.includes(name));
if (!run.length) { console.error("Select at least one simulation block."); process.exit(2); }
const matchingPacks = values("matching-pack").filter(Boolean);
const matchingPack = matchingPacks[0];
const isWorker = argv.includes("--worker");
const opts: Opts = { quick: argv.includes("--quick"), llm: argv.includes("--llm"), transcripts: argv.includes("--transcripts"), matchingPack };

if (opts.llm && !isWorker) console.log("--llm: provider keys kept for the onboarding LLM arm (tracked gates only)");
if (!opts.llm) for (const k of ["OPENAI_API_KEY", "SURPLUS_API_KEY", "CLOUDFLARE_AI_TOKEN"]) delete process.env[k];

if (argv.some(arg => arg === "--matching-pack" || arg.startsWith("--matching-pack="))) {
  const { MATCHING_PACKS } = await import("./sim/matching.ts");
  if (matchingPacks.length !== 1 || !MATCHING_PACKS.some(app => app === matchingPack) || !run.includes("matching")) {
    console.error(`--matching-pack requires the matching block and one of ${MATCHING_PACKS.join(", ")}.`);
    process.exit(2);
  }
}

interface ShardSpec {
  readonly block: string;
  readonly matchingPack?: string;
  readonly pg: boolean;
}

interface ShardResult {
  readonly spec: ShardSpec;
  readonly stdout: string;
  readonly stderr: string;
  readonly gates: Gate[];
  readonly elapsedSec: number;
  readonly exitCode: number;
}

function workerCount(): number {
  if (isWorker) return 1;
  const raw = process.env.SIM_WORKERS;
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 1) return parsed;
  }
  return Math.min(4, Math.max(1, availableParallelism() - 1));
}

async function buildShards(blocks: readonly string[]): Promise<ShardSpec[]> {
  const shards: ShardSpec[] = [];
  for (const name of blocks) {
    if (name === "matching" && opts.matchingPack === undefined) {
      const { MATCHING_PACKS } = await import("./sim/matching.ts");
      for (const pack of MATCHING_PACKS) shards.push({ block: "matching", matchingPack: pack, pg: false });
    } else {
      shards.push({ block: name, ...(name === "matching" && opts.matchingPack ? { matchingPack: opts.matchingPack } : {}), pg: PG_BLOCKS.has(name) });
    }
  }
  return shards;
}

function runChildShard(spec: ShardSpec, scriptPath: string, jsonPath: string): Promise<ShardResult> {
  const childArgs = [
    "--import", "tsx", "--conditions", "eliza-source", scriptPath,
    "--worker", "--only", spec.block,
    ...(spec.matchingPack ? ["--matching-pack", spec.matchingPack] : []),
    ...(opts.quick ? ["--quick"] : []),
    ...(opts.llm ? ["--llm"] : []),
    ...(opts.transcripts ? ["--transcripts"] : []),
    "--json", jsonPath,
  ];
  const t0 = performance.now();
  return new Promise(resolve => {
    const child = spawn(process.execPath, childArgs, {
      cwd: process.cwd(),
      env: { ...process.env, SIM_WORKERS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on("data", chunk => outChunks.push(chunk));
    child.stderr.on("data", chunk => errChunks.push(chunk));
    child.on("close", async code => {
      const elapsedSec = Math.round((performance.now() - t0) / 100) / 10;
      let gates: Gate[] = [];
      try {
        const parsed = JSON.parse(await readFile(jsonPath, "utf8")) as { gates?: Gate[] };
        if (Array.isArray(parsed.gates)) gates = parsed.gates;
      } catch (err) {
        gates = [{
          block: spec.block,
          name: `${spec.block}${spec.matchingPack ? ` (${spec.matchingPack})` : ""} worker completed`,
          pass: false,
          blocking: true,
          detail: `exit ${code ?? -1}: ${String(err)}`,
        }];
      }
      resolve({
        spec,
        stdout: Buffer.concat(outChunks).toString("utf8"),
        stderr: Buffer.concat(errChunks).toString("utf8"),
        gates,
        elapsedSec,
        exitCode: code ?? 1,
      });
    });
  });
}

async function runPooled(shards: readonly ShardSpec[], limit: number): Promise<Map<ShardSpec, ShardResult>> {
  const results = new Map<ShardSpec, ShardResult>();
  const scriptPath = fileURLToPath(import.meta.url);
  const workDir = await mkdtemp(join(tmpdir(), "sim-pool-"));
  try {
    const nonPg = shards.filter(s => !s.pg);
    const pg = shards.filter(s => s.pg);
    let nextIdx = 0;
    const workers = Array.from({ length: Math.min(limit, Math.max(1, nonPg.length)) }, async () => {
      while (nextIdx < nonPg.length) {
        const idx = nextIdx++;
        const spec = nonPg[idx]!;
        const jsonPath = join(workDir, `nonpg-${idx}.json`);
        results.set(spec, await runChildShard(spec, scriptPath, jsonPath));
      }
    });
    const pgLane = (async () => {
      for (let i = 0; i < pg.length; i++) {
        const spec = pg[i]!;
        const jsonPath = join(workDir, `pg-${i}.json`);
        results.set(spec, await runChildShard(spec, scriptPath, jsonPath));
      }
    })();
    await Promise.all([...workers, pgLane]);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
  return results;
}

const all: Gate[] = [];
const timings: Record<string, number> = {};
const t0 = performance.now();
const workers = workerCount();
const shards = workers > 1 ? await buildShards(run) : [];
const usePool = workers > 1 && shards.length > 1;

if (usePool) {
  const results = await runPooled(shards, workers);
  for (const name of run) {
    const blockShards = shards.filter(s => s.block === name);
    console.log(`\n== ${name}${opts.quick ? " (quick)" : ""}`);
    let blockGates: Gate[] = [];
    let blockSec = 0;
    for (const s of blockShards) {
      const r = results.get(s)!;
      const cleanedOut = r.stdout
        .split("\n")
        .filter(line => !line.startsWith(`== ${name}`) && !line.startsWith(`-- ${name}:`) && !/^(?:PASS|FAIL): \d+\/\d+ blocking gates/.test(line))
        .join("\n")
        .trim();
      if (cleanedOut) console.log(cleanedOut);
      const cleanedErr = r.stderr
        .split("\n")
        .filter(line => !line.startsWith(`  FAIL [${name}]`))
        .join("\n")
        .trim();
      if (cleanedErr) console.error(cleanedErr);
      blockGates.push(...r.gates);
      blockSec = Math.max(blockSec, r.elapsedSec);
    }
    timings[name] = Math.round(blockSec * 10) / 10;
    all.push(...blockGates);
    const failed = blockGates.filter(g => g.blocking && !g.pass).length;
    const tracked = blockGates.filter(g => !g.blocking).length;
    console.log(`-- ${name}: ${blockGates.length - tracked - failed}/${blockGates.length - tracked} blocking gates pass${tracked ? `, ${tracked} tracked` : ""} (${timings[name]}s)`);
  }
} else {
  for (const name of run) {
    if (!isWorker) console.log(`\n== ${name}${opts.quick ? " (quick)" : ""}`);
    const b = new Block(name);
    const t = performance.now();
    try { await BLOCKS[name]!(b, opts); } catch (e) { b.gate(`${name} block ran to completion`, false, (e as Error)?.stack ?? String(e)); }
    timings[name] = Math.round((performance.now() - t) / 100) / 10;
    all.push(...b.gates);
    const failed = b.gates.filter(g => g.blocking && !g.pass).length, tracked = b.gates.filter(g => !g.blocking).length;
    if (!isWorker) console.log(`-- ${name}: ${b.gates.length - tracked - failed}/${b.gates.length - tracked} blocking gates pass${tracked ? `, ${tracked} tracked` : ""} (${timings[name]}s)`);
  }
}

const failed = all.filter(g => g.blocking && !g.pass);
const total = Math.round((performance.now() - t0) / 100) / 10;
if (!isWorker) {
  console.log(`\n${failed.length ? "FAIL" : "PASS"}: ${all.filter(g => g.blocking).length - failed.length}/${all.filter(g => g.blocking).length} blocking gates, ${all.filter(g => !g.blocking && !g.pass).length} tracked off target, ${total}s (${Object.entries(timings).map(([k, v]) => `${k} ${v}s`).join(", ")})`);
  for (const g of failed) console.error(`  FAIL [${g.block}] ${g.name}${g.detail ? `: ${g.detail.split("\n")[0]}` : ""}`);
}
const out = values("json").find(Boolean);
if (out) await writePath(out, JSON.stringify({ quick: opts.quick, blocks: run, timings, total, gates: all }, null, 1));
await new Promise<void>(resolve => process.stdout.write("", () => process.stderr.write("", () => resolve())));
process.exit(failed.length ? 1 : 0);
