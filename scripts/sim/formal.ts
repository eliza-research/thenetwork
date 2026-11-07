// The formal block: LemmaScript proofs of the pure decision cores (docs/formal-verification.md).
// LemmaScript-files.txt is the manifest. Each entry runs `lsc check --backend=dafny` one at a time, and
// three structure gates keep the proofs honest:
//   - every file with a `//@ verify` is listed, and every listed file exists (nothing drops out unseen);
//   - every listed file is imported by non-test code (a proof of code production does not run is worth nothing);
//   - trust does not grow: the counts of assume, havoc, extern and axiom stay at or under proofs/trust.json.
// Without Dafny the block records a tracked "skipped" gate, as the Postgres blocks do; REQUIRE_DAFNY=1 makes that fail.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { type Block, expect } from "./gate.ts";

const ROOT = join(import.meta.dir, "..", "..");
const SCAN = ["packages", "deploy", "scripts", "sites", "tests", "tools"];
const LSC = join(ROOT, "node_modules", ".bin", "lsc");
const CHECK_TIMEOUT_MS = 600_000;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name === "dist" || name === ".wrangler") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const isTest = (rel: string) => /(^|\/)(test|tests)\//.test(rel) || /\.test\.tsx?$/.test(rel);

/** The source files of the manifest: `path [timeout] [dafny flags]`, one per line. */
export function manifest(text = readFileSync(join(ROOT, "LemmaScript-files.txt"), "utf8")): string[] {
  return text.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(l => l.split(/\s+/)[0]!);
}

export function trustCounts(files: string[]): Record<string, number> {
  const counts = { assume: 0, havoc: 0, extern: 0, axiom: 0 };
  for (const f of files) {
    const text = readFileSync(join(ROOT, f), "utf8");
    counts.assume += (text.match(/\/\/@ assume\b/g) ?? []).length;
    counts.havoc += (text.match(/\/\/@ (auto)?havoc\b/g) ?? []).length;
    counts.extern += (text.match(/\/\/@ extern\b/g) ?? []).length;
    const proof = join(ROOT, "proofs", f.replace(/\.ts$/, ".dfy"));
    if (existsSync(proof)) {
      const dfy = readFileSync(proof, "utf8");
      counts.assume += (dfy.match(/^\s*assume\b/gm) ?? []).length;
      counts.axiom += (dfy.match(/\{:axiom\}/g) ?? []).length;
    }
  }
  return counts;
}

export async function formalBlock(b: Block): Promise<void> {
  const listed = manifest();
  const sources = SCAN.flatMap(d => walk(join(ROOT, d))).map(p => relative(ROOT, p));
  const verified = sources.filter(f => !isTest(f) && f !== "scripts/sim/formal.ts" && readFileSync(join(ROOT, f), "utf8").includes("//@ verify"));

  await b.run("every file with //@ verify is in LemmaScript-files.txt, and every entry exists", () => {
    expect(verified.filter(f => !listed.includes(f))).toEqual([]);
    expect(listed.filter(f => !existsSync(join(ROOT, f)))).toEqual([]);
  });

  await b.run("every proved file is imported by non-test code", () => {
    const code = sources.filter(f => !isTest(f)).map(f => ({ f, text: readFileSync(join(ROOT, f), "utf8") }));
    const unused = listed.filter(f => {
      return !code.some(c => c.f !== f && resolvesTo(c.f, c.text, f));
    });
    expect(unused).toEqual([]);
  });

  await b.run("trust does not grow (assume, havoc, extern, axiom)", () => {
    const limit = JSON.parse(readFileSync(join(ROOT, "proofs", "trust.json"), "utf8")) as Record<string, number>;
    const now = trustCounts(listed);
    expect(Object.keys(now).filter(k => now[k]! > (limit[k] ?? 0)).map(k => `${k}: ${now[k]} over ${limit[k] ?? 0}`)).toEqual([]);
  });

  const dafny = Bun.which("dafny");
  if (!dafny || !existsSync(LSC)) {
    b.gate("proofs ran", process.env.REQUIRE_DAFNY !== "1", `skipped: ${dafny ? "lsc" : "dafny"} not found`, process.env.REQUIRE_DAFNY === "1");
    return;
  }
  for (const f of listed) {
    await b.run(`proof holds: ${f}`, async () => {
      const p = Bun.spawn([LSC, "check", "--backend=dafny", f], { cwd: ROOT, stdout: "pipe", stderr: "pipe", env: { ...process.env, LSC_RUN_LOG: "false" }, timeout: CHECK_TIMEOUT_MS });
      const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      const code = await p.exited;
      if (code !== 0 || !/ 0 errors/.test(out)) throw new Error(`lsc check exited ${code}\n${(out + err).trim().split("\n").slice(-12).join("\n")}`);
    });
  }
}

/** True when an import in `from` names the file `target` (a basename match alone is not enough). */
function resolvesTo(from: string, text: string, target: string): boolean {
  for (const m of text.matchAll(/(?:from\s+|import\()"(\.[^"]+)"/g)) {
    const p = join(dirname(from), m[1]!);
    const tsPath = p.endsWith(".js") ? p.replace(/\.js$/, ".ts") : `${p}.ts`;
    if (p === target || tsPath === target) return true;
  }
  return false;
}
