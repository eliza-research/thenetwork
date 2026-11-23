// Tangled standalone Quint state machines keep the safety, reachability and trace checks from the
// source branch. See spec/models/README.md for the Markdown source and command options.
import { spawnProcess } from "../packages/core/src/runtime/process.ts";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { availableParallelism, cpus, tmpdir } from "node:os";
import { basename, join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
export const MODEL_DIR = "spec/models";
const OUTPUT_DIR = "runs/quint-models";
const QUINT = join(ROOT, "tools/vibestack/node_modules/.bin/quint");
const SIMULATOR = join(ROOT, "tools/vibestack/vibestack/simulator.ts");
const SEED = "0x5eed";
// Match the pinned Quint CLI's Rust default, independently of the runner's --jobs setting.
const RUST_THREADS = String(cpus().length);

export function modelName(file: string): string | undefined {
  return /^[a-z][a-z0-9_]*\.md$/.test(file) ? basename(file, ".md") : undefined;
}

export function modelNames(): string[] {
  return readdirSync(join(ROOT, MODEL_DIR)).sort().flatMap((file) => modelName(file) ?? []);
}

export function modelSource(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`Invalid Quint model name: ${name}`);
  const spec = `${MODEL_DIR}/${name}.md`;
  const markdown = readFileSync(join(ROOT, spec), "utf8");
  const blocks = [...markdown.matchAll(/^```quint\n([\s\S]*?)^```[ \t]*$/gm)];
  if (blocks.length !== 1 || !new RegExp(`^module ${name}\\b`, "m").test(blocks[0][1])) {
    throw new Error(`${spec} must contain one complete Quint module named ${name}`);
  }
  return blocks[0][1];
}

function tangle(name: string): string {
  const source = modelSource(name);
  const file = `${OUTPUT_DIR}/${name}.qnt`;
  writeFileSync(join(ROOT, file), source);
  return file;
}

type Bounds = { maxSteps: number; maxSamples: number; verifySteps: number };
type Simulation = Pick<Bounds, "maxSteps" | "maxSamples"> & { invariant: string };
type Step = { name: string; args: string[]; expectViolation: boolean; simulation?: Simulation };

function bounds(text: string): Bounds {
  const b: Bounds = { maxSteps: 20, maxSamples: 4000, verifySteps: 8 };
  const line = text.match(/^\/\/\s*quint-check:(.*)$/m)?.[1] ?? "";
  for (const [, k, v] of line.matchAll(/([a-z-]+)=(\d+)/g)) {
    if (k === "max-steps") b.maxSteps = Number(v);
    if (k === "max-samples") b.maxSamples = Number(v);
    if (k === "verify-steps") b.verifySteps = Number(v);
  }
  return b;
}

// A small pool: at most `jobs` quint processes run at one time, across all models.
function pool(jobs: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (running >= jobs) await new Promise<void>((r) => waiting.push(r));
    running++;
    try {
      return await fn();
    } finally {
      running--;
      waiting.shift()?.();
    }
  };
}

async function command(argv: string[], cwd = ROOT): Promise<{ code: number; out: string }> {
  const p = spawnProcess(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code, out: out + err };
}

function simulationArgs(file: string, sim: Simulation): string[] {
  return [file, "--main", basename(file, ".qnt"), "--seed", SEED, "--max-steps", String(sim.maxSteps),
    "--max-samples", String(sim.maxSamples), "--invariant", sim.invariant];
}

function scratchFor(text: string): string | undefined {
  // The CLI requires init and step to be actions. Pass other forms to the CLI for validation.
  if (!/^\s*action\s+init\b/m.test(text) || !/^\s*action\s+step\b/m.test(text)) return;
  try {
    return mkdtempSync(join(tmpdir(), "thenetwork-quint-"));
  } catch {
    // The legacy CLI can run without writable temporary storage for compiled inputs.
  }
}

async function compileModel(file: string, scratch: string): Promise<boolean> {
  try {
    return (await command([process.execPath, SIMULATOR, "compile", join(ROOT, file),
      "--main", basename(file, ".qnt")], scratch)).code === 0;
  } catch {
    return false;
  }
}

async function compiledSimulation(file: string, sim: Simulation, scratch: string): Promise<"safe" | "violation" | undefined> {
  const trace = join(scratch, `${sim.invariant}.itf.json`);
  try {
    const { code, out } = await command([process.execPath, SIMULATOR, "run", ...simulationArgs(join(ROOT, file), sim),
      "--step", "step", "--n-traces", "1", "--n-threads", RUST_THREADS, "--out-itf", trace], scratch);
    if (!statSync(trace).size) return;
    if (code === 0) return "safe";
    if (code === 1 && /invariant violated/i.test(out)) return "violation";
  } catch {
    // Missing traces and evaluator errors need the legacy CLI.
  }
}

function stepsFor(file: string, text: string, verify: boolean, safetyCap: number): { steps: Step[]; problems: string[] } {
  const main = basename(file, ".qnt");
  const b = bounds(text);
  const steps: Step[] = [];
  const problems: string[] = [];
  if (/^\s*run\s+\w+/m.test(text)) {
    steps.push({ name: "test", args: ["test", file, "--main", main, "--seed", SEED], expectViolation: false });
  }
  const addSimulation = (invariant: string, maxSamples: number, expectViolation: boolean) => {
    const simulation = { invariant, maxSamples, maxSteps: b.maxSteps };
    steps.push({
      name: expectViolation ? `${invariant} (must be reachable)` : invariant,
      args: ["run", ...simulationArgs(file, simulation), "--backend", "rust"],
      expectViolation, simulation,
    });
  };
  if (/^\s*val\s+safety\b/m.test(text)) {
    addSimulation("safety", Math.min(b.maxSamples, safetyCap), false);
  } else problems.push(`${file} has no \`val safety\``);
  const witnesses = [...text.matchAll(/^\s*val\s+(witness_\w+)/gm)].map((m) => m[1]);
  if (!witnesses.length) problems.push(`${file} has no \`val witness_*\``);
  for (const w of witnesses) {
    addSimulation(w, b.maxSamples, true);
  }
  if (verify) {
    steps.push({ name: "verify safety", args: ["verify", file, "--main", main, "--invariant", "safety",
      "--max-steps", String(b.verifySteps)], expectViolation: false });
  }
  return { steps, problems };
}

async function checkModel(file: string, verify: boolean, typecheckOnly: boolean, safetyCap: number, run: ReturnType<typeof pool>): Promise<string[]> {
  const text = readFileSync(join(ROOT, file), "utf8");
  const lines: string[] = [];
  const failures: string[] = [];
  const record = (name: string, ok: boolean, out: string, ms: number) => {
    lines.push(`${ok ? "ok  " : "FAIL"} ${file} ${name} (${(ms / 1000).toFixed(1)}s)`);
    if (!ok) {
      failures.push(`${file} ${name}`);
      lines.push(out.split("\n").slice(-40).join("\n"));
    }
  };
  const scratch = typecheckOnly ? undefined : scratchFor(text);
  try {
    const compiled = await run(async () => {
      const t0 = performance.now();
      if (scratch && await compileModel(file, scratch)) {
        record("typecheck", true, "", performance.now() - t0);
        return scratch;
      }
      const r = await command([QUINT, "typecheck", file]);
      record("typecheck", r.code === 0, r.out, performance.now() - t0);
    });
    if (!failures.length && !typecheckOnly) {
      const exec = (step: Step) => run(async () => {
        const t0 = performance.now();
        const simulated = compiled && step.simulation ? await compiledSimulation(file, step.simulation, compiled) : undefined;
        if (simulated === (step.expectViolation ? "violation" : "safe")) {
          record(step.name, true, "", performance.now() - t0);
          return;
        }
        // Use the same CLI result and diagnostics on errors, safety failures and unreached witnesses.
        const r = await command([QUINT, ...step.args]);
        const ok = step.expectViolation ? r.code !== 0 && /invariant violated/i.test(r.out) : r.code === 0;
        // A diagnostic retry cannot erase a counterexample the evaluator already found.
        const disagreement = ok && !step.expectViolation && simulated === "violation";
        const out = disagreement ? `Invariant violated in the compiled simulation. The CLI retry did not reproduce it.\n${r.out}` : r.out;
        record(step.name, ok && !disagreement, out, performance.now() - t0);
      });
      const { steps, problems } = stepsFor(file, text, verify, safetyCap);
      failures.push(...problems);
      // Apalache runs one at a time per model after the simulator steps, so that it does not starve them.
      const verifySteps = steps.filter((s) => s.name === "verify safety");
      await Promise.all(steps.filter((s) => s.name !== "verify safety").map(exec));
      for (const s of verifySteps) await exec(s);
    }
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
  console.log(lines.join("\n"));
  return failures;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const verify = argv.includes("--verify");
  const jobsAt = argv.indexOf("--jobs");
  const jobs = jobsAt >= 0 ? Number(argv[jobsAt + 1]) : availableParallelism();
  if (!Number.isInteger(jobs) || jobs < 1) {
    console.error("--jobs takes a whole number of 1 or more");
    process.exit(1);
  }
  const capAt = argv.indexOf("--safety-samples");
  const safetyCap = capAt >= 0 ? Number(argv[capAt + 1]) : Infinity;
  if (capAt >= 0 && (!Number.isInteger(safetyCap) || safetyCap < 1)) {
    console.error("--safety-samples takes a whole number of 1 or more");
    process.exit(1);
  }
  const named = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--jobs" && argv[i - 1] !== "--safety-samples");
  const names = named.length ? [...new Set(named.map((a) => basename(a).replace(/\.(qnt|md)$/, "")))] : modelNames();
  if (!names.length) {
    console.error(`No Quint models in ${MODEL_DIR}/`);
    process.exit(1);
  }
  mkdirSync(join(ROOT, OUTPUT_DIR), { recursive: true });
  const files = names.map(tangle);
  if (argv.includes("--tangle-only")) {
    console.log(`Tangled ${files.length} models to ${OUTPUT_DIR}/`);
    process.exit(0);
  }
  if (!existsSync(QUINT)) {
    console.error("Quint is missing. Run pnpm run spec:setup.");
    process.exit(1);
  }
  const typecheckOnly = argv.includes("--typecheck-only");
  const t0 = performance.now();
  const run = pool(jobs);
  const failures = (await Promise.all(files.map((f) => checkModel(f, verify, typecheckOnly, safetyCap, run)))).flat();
  console.log(`\n${files.length} models, ${failures.length} failures, ${jobs} jobs, ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  for (const f of failures) console.log(`  ${f}`);
  process.exit(failures.length ? 1 : 0);
}
