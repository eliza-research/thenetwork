// Checks every Quint model in quint/ (docs/research/2026-11-07-state-machines.md section 6; conventions in
// quint/README.md). For each model file: typecheck, the `run` tests, a random simulation of `safety`, and one
// simulation per `witness_*` value that must find a violation (so that a vacuous pass is visible).
//   bun run quint:check                 # every model
//   bun run quint:check quint/relay.qnt # one model
//   bun run quint:check --verify        # also bounded model checking with Apalache (needs Java 17+)
// A model sets its bounds on one line: // quint-check: max-steps=20 max-samples=4000 verify-steps=8
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const QUINT = join(ROOT, "node_modules/.bin/quint");
const SEED = "0x5eed";

type Bounds = { maxSteps: number; maxSamples: number; verifySteps: number };

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

async function quint(args: string[]): Promise<{ code: number; out: string }> {
  const p = Bun.spawn([QUINT, ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out: out + err };
}

async function checkModel(file: string, verify: boolean): Promise<string[]> {
  const text = readFileSync(join(ROOT, file), "utf8");
  const main = basename(file, ".qnt");
  const b = bounds(text);
  const failures: string[] = [];
  const step = async (name: string, args: string[], expectViolation = false) => {
    const r = await quint(args);
    const ok = expectViolation ? r.code !== 0 && /violat/i.test(r.out) : r.code === 0;
    console.log(`${ok ? "ok  " : "FAIL"} ${file} ${name}`);
    if (!ok) {
      failures.push(`${file} ${name}`);
      console.log(r.out.split("\n").slice(-40).join("\n"));
    }
    return ok;
  };
  if (!(await step("typecheck", ["typecheck", file]))) return failures;
  if (/^\s*run\s+\w+/m.test(text)) await step("test", ["test", file, "--main", main, "--seed", SEED]);
  const sim = ["run", file, "--main", main, "--backend", "rust", "--seed", SEED,
    "--max-steps", String(b.maxSteps), "--max-samples", String(b.maxSamples)];
  if (/^\s*val\s+safety\b/m.test(text)) await step("safety", [...sim, "--invariant", "safety"]);
  else failures.push(`${file} has no \`val safety\``);
  const witnesses = [...text.matchAll(/^\s*val\s+(witness_\w+)/gm)].map((m) => m[1]);
  if (!witnesses.length) failures.push(`${file} has no \`val witness_*\``);
  for (const w of witnesses) await step(`${w} (must be reachable)`, [...sim, "--invariant", w], true);
  if (verify) {
    await step("verify safety", ["verify", file, "--main", main, "--invariant", "safety",
      "--max-steps", String(b.verifySteps)]);
  }
  return failures;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const verify = argv.includes("--verify");
  const named = argv.filter((a) => a.endsWith(".qnt"));
  const files = named.length ? named : readdirSync(join(ROOT, "quint"))
    .filter((f) => f.endsWith(".qnt")).sort().map((f) => `quint/${f}`);
  if (!files.length) {
    console.error("no Quint models in quint/");
    process.exit(1);
  }
  const failures: string[] = [];
  for (const f of files) failures.push(...(await checkModel(f, verify)));
  console.log(`\n${files.length} models, ${failures.length} failures`);
  for (const f of failures) console.log(`  ${f}`);
  process.exit(failures.length ? 1 : 0);
}
