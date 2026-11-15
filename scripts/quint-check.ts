// Tangled standalone Quint state machines keep the safety, reachability and trace checks from the
// source branch. See spec/models/README.md for the Markdown source and command options.
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { basename, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const MODEL_DIR = "spec/models";
const OUTPUT_DIR = "runs/quint-models";
const QUINT = join(ROOT, "tools/vibespec/node_modules/.bin/quint");
const SEED = "0x5eed";

function tangle(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`Invalid Quint model name: ${name}`);
  const spec = `${MODEL_DIR}/${name}.md`;
  const markdown = readFileSync(join(ROOT, spec), "utf8");
  const blocks = [...markdown.matchAll(/^```quint\n([\s\S]*?)^```[ \t]*$/gm)];
  if (blocks.length !== 1 || !new RegExp(`^module ${name}\\b`, "m").test(blocks[0][1])) {
    throw new Error(`${spec} must contain one complete Quint module named ${name}`);
  }
  const file = `${OUTPUT_DIR}/${name}.qnt`;
  writeFileSync(join(ROOT, file), blocks[0][1]);
  return file;
}

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
  const exec = (step: Step) => run(async () => {
    const t0 = performance.now();
    const r = await quint(step.args);
    const ok = step.expectViolation ? r.code !== 0 && /invariant violated/i.test(r.out) : r.code === 0;
    record(step.name, ok, r.out, performance.now() - t0);
  });
  await exec({ name: "typecheck", args: ["typecheck", file], expectViolation: false });
  if (!failures.length && !typecheckOnly) {
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
  const named = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--jobs" && argv[i - 1] !== "--safety-samples");
  const names = named.length ? [...new Set(named.map((a) => basename(a).replace(/\.(qnt|md)$/, "")))] : readdirSync(join(ROOT, MODEL_DIR))
    .filter((f) => /^[a-z][a-z0-9_]*\.md$/.test(f)).sort().map((f) => basename(f, ".md"));
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
    console.error("Quint is missing. Run bun run spec:setup.");
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
