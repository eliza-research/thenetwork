// Checks every Quint model in quint/ (docs/research/2026-11-07-state-machines.md section 6; conventions in
// quint/README.md). For each model file: typecheck, the `run` tests, a random simulation of `safety`, and one
// simulation per `witness_*` value that must find a violation (so that a vacuous pass is visible).
//   bun run quint:check                 # every model
//   bun run quint:check quint/relay.qnt # one model
//   bun run quint:check --verify        # also bounded model checking with Apalache (needs Java 17+)
//   bun run quint:check --jobs 2        # at most 2 quint processes at a time (default: CPU count)
//   bun run quint:check --safety-samples 1000  # cap the samples of each safety run (CI); witnesses keep their bounds
// A model sets its bounds on one line: // quint-check: max-steps=20 max-samples=4000 verify-steps=8
// The steps of all models run in parallel; each model's lines are printed together when the model ends.
import { readdirSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { basename, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const QUINT = join(ROOT, "node_modules/.bin/quint");
const SEED = "0x5eed";

type Bounds = { maxSteps: number; maxSamples: number; verifySteps: number };
type Step = { name: string; args: string[]; expectViolation: boolean };

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

async function quint(args: string[]): Promise<{ code: number; out: string }> {
  const p = Bun.spawn([QUINT, ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out: out + err };
}

function stepsFor(file: string, text: string, verify: boolean, safetyCap: number): { steps: Step[]; problems: string[] } {
  const main = basename(file, ".qnt");
  const b = bounds(text);
  const steps: Step[] = [];
  const problems: string[] = [];
  if (/^\s*run\s+\w+/m.test(text)) {
    steps.push({ name: "test", args: ["test", file, "--main", main, "--seed", SEED], expectViolation: false });
  }
  const sim = ["run", file, "--main", main, "--backend", "rust", "--seed", SEED,
    "--max-steps", String(b.maxSteps), "--max-samples", String(b.maxSamples)];
  if (/^\s*val\s+safety\b/m.test(text)) {
    const safetySim = [...sim];
    safetySim[safetySim.indexOf("--max-samples") + 1] = String(Math.min(b.maxSamples, safetyCap));
    steps.push({ name: "safety", args: [...safetySim, "--invariant", "safety"], expectViolation: false });
  } else problems.push(`${file} has no \`val safety\``);
  const witnesses = [...text.matchAll(/^\s*val\s+(witness_\w+)/gm)].map((m) => m[1]);
  if (!witnesses.length) problems.push(`${file} has no \`val witness_*\``);
  for (const w of witnesses) {
    steps.push({ name: `${w} (must be reachable)`, args: [...sim, "--invariant", w], expectViolation: true });
  }
  if (verify) {
    steps.push({ name: "verify safety", args: ["verify", file, "--main", main, "--invariant", "safety",
      "--max-steps", String(b.verifySteps)], expectViolation: false });
  }
  return { steps, problems };
}

async function checkModel(file: string, verify: boolean, safetyCap: number, run: ReturnType<typeof pool>): Promise<string[]> {
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
  const exec = (step: Step) => run(async () => {
    const t0 = performance.now();
    const r = await quint(step.args);
    const ok = step.expectViolation ? r.code !== 0 && /violat/i.test(r.out) : r.code === 0;
    record(step.name, ok, r.out, performance.now() - t0);
  });
  await exec({ name: "typecheck", args: ["typecheck", file], expectViolation: false });
  if (!failures.length) {
    const { steps, problems } = stepsFor(file, text, verify, safetyCap);
    failures.push(...problems);
    // Apalache runs one at a time per model after the simulator steps, so that it does not starve them.
    const verifySteps = steps.filter((s) => s.name === "verify safety");
    await Promise.all(steps.filter((s) => s.name !== "verify safety").map(exec));
    for (const s of verifySteps) await exec(s);
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
  const named = argv.filter((a) => a.endsWith(".qnt"));
  const files = named.length ? named : readdirSync(join(ROOT, "quint"))
    .filter((f) => f.endsWith(".qnt")).sort().map((f) => `quint/${f}`);
  if (!files.length) {
    console.error("no Quint models in quint/");
    process.exit(1);
  }
  const t0 = performance.now();
  const run = pool(jobs);
  const failures = (await Promise.all(files.map((f) => checkModel(f, verify, safetyCap, run)))).flat();
  console.log(`\n${files.length} models, ${failures.length} failures, ${jobs} jobs, ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  for (const f of failures) console.log(`  ${f}`);
  process.exit(failures.length ? 1 : 0);
}
